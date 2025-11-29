import { promises as fs } from 'fs';
import path from 'path';

const CACHE_DIR = process.env.PARSE_CACHE_DIR || path.join(process.cwd(), '.parse-cache');

/**
 * CacheIndex - Gerencia índice de cache de playlists
 *
 * Persiste metadados no disco (.meta.json) para sobreviver a restarts do servidor.
 * Na inicialização, reconstrói índice em memória lendo todos os .meta.json.
 */
class CacheIndex {
  constructor() {
    this.index = new Map();
  }

  get size() {
    return this.index.size;
  }

  /**
   * Carrega índice do disco na inicialização do servidor
   */
  async load() {
    console.log('[CacheIndex] Carregando índice do disco...');

    try {
      // Garante que diretório existe
      await fs.mkdir(CACHE_DIR, { recursive: true });

      const files = await fs.readdir(CACHE_DIR);
      const metaFiles = files.filter(f => f.endsWith('.meta.json'));

      let loaded = 0;
      let expired = 0;
      let orphaned = 0;

      for (const file of metaFiles) {
        try {
          const metaPath = path.join(CACHE_DIR, file);
          const content = await fs.readFile(metaPath, 'utf8');
          const meta = JSON.parse(content);

          // Verifica se expirou
          if (Date.now() > meta.expiresAt) {
            console.log(`[CacheIndex] Cache expirado: ${meta.hash}`);
            await this.delete(meta.hash);
            expired++;
            continue;
          }

          // Verifica se arquivo .ndjson existe
          const itemsPath = path.join(CACHE_DIR, `${meta.hash}.ndjson`);
          try {
            await fs.access(itemsPath);
            this.index.set(meta.hash, meta);
            loaded++;
          } catch {
            console.warn(`[CacheIndex] Arquivo .ndjson órfão: ${meta.hash}`);
            await fs.rm(metaPath, { force: true });
            orphaned++;
          }
        } catch (error) {
          console.error(`[CacheIndex] Erro ao ler ${file}:`, error.message);
        }
      }

      console.log(`[CacheIndex] ✓ ${loaded} entradas carregadas`);
      if (expired > 0) console.log(`[CacheIndex] ${expired} caches expirados removidos`);
      if (orphaned > 0) console.log(`[CacheIndex] ${orphaned} metadados órfãos removidos`);
    } catch (error) {
      console.error('[CacheIndex] Erro ao carregar índice:', error);
    }
  }

  /**
   * Salva metadados no disco
   */
  async set(hash, meta) {
    const fullMeta = { hash, ...meta };
    const metaPath = path.join(CACHE_DIR, `${hash}.meta.json`);

    await fs.writeFile(metaPath, JSON.stringify(fullMeta, null, 2));
    this.index.set(hash, fullMeta);

    console.log(`[CacheIndex] Salvo: ${hash} (${meta.stats.totalItems} items)`);
  }

  /**
   * Busca no índice (memória + fallback ao disco)
   * Multi-processo safe: se não encontrar em memória OU se estiver expirado, tenta carregar do disco
   */
  async get(hash) {
    // 1. Tenta memória primeiro (rápido)
    let entry = this.index.get(hash);

    // 2. Se encontrou em memória mas está expirado → tenta recarregar do disco
    //    (Worker pode ter salvo versão atualizada do mesmo hash)
    const needsReload = entry && Date.now() > entry.expiresAt;

    // 3. Se não encontrou OU precisa recarregar → tenta disco
    if (!entry || needsReload) {
      try {
        const metaPath = path.join(CACHE_DIR, `${hash}.meta.json`);
        const content = await fs.readFile(metaPath, 'utf8');
        const diskEntry = JSON.parse(content);

        // Verifica se arquivo .ndjson existe
        const itemsPath = path.join(CACHE_DIR, `${hash}.ndjson`);
        await fs.access(itemsPath);

        // Atualiza em memória
        this.index.set(hash, diskEntry);
        entry = diskEntry;

        if (needsReload) {
          console.log(`[CacheIndex] Recarregado do disco (expirado atualizado): ${hash}`);
        } else {
          console.log(`[CacheIndex] Carregado do disco: ${hash}`);
        }
      } catch {
        // Disco também não tem ou está expirado
        if (entry) {
          console.log(`[CacheIndex] Cache expirado (não atualizado no disco): ${hash}`);
          this.delete(hash); // Cleanup assíncrono
        }
        return null;
      }
    }

    // 4. Verifica expiração final (após reload)
    if (Date.now() > entry.expiresAt) {
      console.log(`[CacheIndex] Cache expirado após reload: ${hash}`);
      this.delete(hash); // Cleanup assíncrono
      return null;
    }

    return entry;
  }

  /**
   * Verifica se cache existe e não expirou
   */
  has(hash) {
    return this.get(hash) !== null;
  }

  /**
   * Remove cache (disco + memória)
   */
  async delete(hash) {
    this.index.delete(hash);

    const itemsPath = path.join(CACHE_DIR, `${hash}.ndjson`);
    const metaPath = path.join(CACHE_DIR, `${hash}.meta.json`);

    await Promise.all([
      fs.rm(itemsPath, { force: true }),
      fs.rm(metaPath, { force: true }),
    ]);

    console.log(`[CacheIndex] Removido: ${hash}`);
  }

  /**
   * Retorna estatísticas do cache
   */
  getStats() {
    return {
      totalEntries: this.index.size,
      entries: Array.from(this.index.values()).map(meta => ({
        hash: meta.hash,
        totalItems: meta.stats.totalItems,
        createdAt: new Date(meta.createdAt).toISOString(),
        expiresAt: new Date(meta.expiresAt).toISOString(),
      })),
    };
  }
}

export const cacheIndex = new CacheIndex();
