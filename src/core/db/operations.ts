/**
 * Database Operations
 * Operacoes de alto nivel para gerenciar playlists e conteudo
 */

import { db, type Playlist, type M3UItem, type M3UGroup } from './schema';
import type { ProgressCallback } from '../services/m3u';

const MAX_PLAYLISTS = parseInt(import.meta.env.VITE_MAX_PLAYLISTS || '3', 10);
const SERVER_URL = import.meta.env.VITE_BRIDGE_URL;

/**
 * Faz polling do status de um job até completar
 */
async function pollJobUntilComplete(
  jobId: string,
  onProgress?: ProgressCallback
): Promise<{ hash: string; stats: any; groups: any[] }> {
  const pollInterval = 2000; // Poll a cada 2s
  const maxAttempts = 300; // 10 minutos (300 × 2s)
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts++;

    try {
      const response = await fetch(`${SERVER_URL}/api/jobs/${jobId}`, {
        signal: AbortSignal.timeout(10000), // 10s timeout para cada poll
      });

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Job não encontrado (pode ter expirado)');
        }
        throw new Error(`Erro ao verificar status do job (${response.status})`);
      }

      const jobStatus = await response.json();

      // Job completado com sucesso
      if (jobStatus.status === 'completed') {
        return {
          hash: jobStatus.data.hash,
          stats: jobStatus.data.stats,
          groups: jobStatus.data.groups,
        };
      }

      // Job falhou
      if (jobStatus.status === 'failed') {
        throw new Error(`Erro ao processar playlist: ${jobStatus.error || 'Erro desconhecido'}`);
      }

      // Job ainda processando - atualiza progresso
      const workerProgress = typeof jobStatus.progress === 'object'
        ? jobStatus.progress?.percentage
        : typeof jobStatus.progress === 'number'
          ? jobStatus.progress
          : 0;

      const percentage = Math.min(80, workerProgress || 0);
      const statusMessages: Record<string, string> = {
        waiting: `Aguardando na fila (posição ${jobStatus.queuePosition || '?'})...`,
        active: 'Processando playlist...',
        delayed: 'Processamento atrasado...',
      };

      onProgress?.({
        phase: 'downloading',
        current: percentage,
        total: 100,
        percentage,
        message: statusMessages[jobStatus.status] || 'Processando...',
      });

      // Aguarda antes do próximo poll
      await new Promise(resolve => setTimeout(resolve, pollInterval));

    } catch (error) {
      // Se for timeout ou erro de rede, tenta novamente
      if (attempts >= maxAttempts) {
        throw new Error('Timeout ao processar playlist. Tente novamente.');
      }
      // Aguarda antes de retentar
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }
  }

  throw new Error('Timeout ao processar playlist após 10 minutos');
}

/**
 * Processa M3U usando servidor com Worker Pool architecture
 * - Cache hit: retorna imediatamente
 * - Cache miss: faz polling até job completar
 */
async function fetchFromServer(
  url: string,
  onProgress?: ProgressCallback
): Promise<{ hash: string; stats: any; groups: any[] }> {
  // Validação: servidor deve estar configurado
  if (!SERVER_URL) {
    throw new Error('Servidor não configurado. Configure VITE_BRIDGE_URL no .env');
  }

  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Conectando ao servidor...',
  });

  try {
    // 1. Envia request para servidor (pode retornar cache OU jobId)
    onProgress?.({
      phase: 'downloading',
      current: 5,
      total: 100,
      percentage: 5,
      message: 'Verificando cache...',
    });

    const parseResponse = await fetch(`${SERVER_URL}/api/playlist/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        options: {
          includeGroups: true,
          normalize: true,
          removeDuplicates: true,
        },
      }),
      signal: AbortSignal.timeout(30000), // 30s timeout (só para request inicial)
    });

    if (!parseResponse.ok) {
      const errorText = await parseResponse.text();
      throw new Error(`Erro do servidor (${parseResponse.status}): ${errorText}`);
    }

    const parseResult = await parseResponse.json();

    if (!parseResult.success) {
      throw new Error(parseResult.error || 'Erro ao processar playlist no servidor');
    }

    let hash: string;
    let stats: any;
    let groups: any[];

    // Cache hit → dados retornados imediatamente
    if (parseResult.cached) {
      hash = parseResult.hash;
      stats = parseResult.data.stats;
      groups = parseResult.data.groups;
    }
    // Job enfileirado → faz polling até completar
    else if (parseResult.queued) {
      const jobId = parseResult.jobId;

      onProgress?.({
        phase: 'downloading',
        current: 10,
        total: 100,
        percentage: 10,
        message: 'Processando playlist (aguardando na fila)...',
      });

      // Polling até job completar
      const jobResult = await pollJobUntilComplete(jobId, onProgress);

      hash = jobResult.hash;
      stats = jobResult.stats;
      groups = jobResult.groups;

      onProgress?.({
        phase: 'downloading',
        current: 50,
        total: 100,
        percentage: 50,
        message: 'Processamento completo! Sincronizando itens em segundo plano...',
      });
    } else {
      throw new Error('Resposta inesperada do servidor');
    }
    return { hash, stats, groups };

  } catch (error) {
    // Erro específico: mostra mensagem clara ao usuário
    const errorMessage = error instanceof Error
      ? error.message
      : 'Erro desconhecido ao processar playlist';

    console.error('[Server] Erro ao processar playlist:', errorMessage);

    onProgress?.({
      phase: 'error',
      current: 0,
      total: 100,
      percentage: 0,
      message: errorMessage,
    });

    throw new Error(`Falha no servidor: ${errorMessage}`);
  }
}

/**
 * Sincroniza itens paginados do servidor e insere no Dexie
 * Pode ser usado em background (fire-and-forget) ou aguardado em refresh
 *
 * @param options.loadPartial - Se true, carrega apenas os primeiros N items (early navigation)
 * @param options.partialLimit - Quantidade de items para carregar no modo partial (padrão: 1000)
 * @returns Informações sobre o carregamento (partial, loaded, total)
 */
async function syncItemsFromServer(
  hash: string,
  playlistId: string,
  onProgress?: ProgressCallback,
  options?: { loadPartial?: boolean; partialLimit?: number }
): Promise<{ partial: boolean; loaded: number; total: number }> {
  if (!SERVER_URL) {
    throw new Error('Servidor não configurado. Configure VITE_BRIDGE_URL no .env');
  }

  const batchSize = 500;
  let total = 0;
  let processed = 0;

  // MODO PARTIAL: Carrega apenas primeiros N items para early navigation
  if (options?.loadPartial) {
    const partialLimit = options.partialLimit || 1000;

    const itemsResponse = await fetch(
      `${SERVER_URL}/api/playlist/items/${hash}/partial?limit=${partialLimit}`
    );

    if (!itemsResponse.ok) {
      throw new Error(`Erro ao buscar itens parciais: ${itemsResponse.status}`);
    }

    const page = await itemsResponse.json();
    const items = page.items || [];
    total = page.total || 0;

    const dbItems: M3UItem[] = items.map((item: any) => ({
      id: `${playlistId}_${item.id}`,
      playlistId,
      name: item.name,
      url: item.url,
      logo: item.logo,
      group: item.group,
      mediaKind: item.mediaKind,
      title: item.parsedTitle?.title || item.title || item.name,
      year: item.parsedTitle?.year || item.year,
      season: item.parsedTitle?.season || item.season,
      episode: item.parsedTitle?.episode || item.episode,
      quality: item.parsedTitle?.quality || item.quality,
      epgId: item.epgId,
      createdAt: Date.now(),
    }));

    // Insere em batches
    for (let i = 0; i < dbItems.length; i += batchSize) {
      const batch = dbItems.slice(i, i + batchSize);
      await db.items.bulkAdd(batch);
    }

    processed = items.length;

    onProgress?.({
      phase: 'indexing',
      current: processed,
      total,
      percentage: Math.min(100, Math.round((processed / total) * 100)),
      message: `Carregados primeiros ${processed} itens...`,
    });

    return { partial: true, loaded: processed, total };
  }

  // MODO COMPLETO: Carrega todos os items com paginação
  const pageSize = 5000;
  let offset = 0;

  while (true) {
    const itemsResponse = await fetch(
      `${SERVER_URL}/api/playlist/items/${hash}?limit=${pageSize}&offset=${offset}`
    );

    if (!itemsResponse.ok) {
      throw new Error(`Erro ao buscar itens: ${itemsResponse.status}`);
    }

    const page = await itemsResponse.json();
    const items = page.items || [];
    total = page.total || total || items.length;

    if (items.length === 0) {
      break;
    }

    // Inserir em lotes menores para evitar travar
    const dbItems: M3UItem[] = items.map((item: any) => ({
      id: `${playlistId}_${item.id}`,
      playlistId,
      name: item.name,
      url: item.url,
      logo: item.logo,
      group: item.group,
      mediaKind: item.mediaKind,
      title: item.parsedTitle?.title || item.title || item.name,
      year: item.parsedTitle?.year || item.year,
      season: item.parsedTitle?.season || item.season,
      episode: item.parsedTitle?.episode || item.episode,
      quality: item.parsedTitle?.quality || item.quality,
      epgId: item.epgId,
      createdAt: Date.now(),
    }));

    for (let i = 0; i < dbItems.length; i += batchSize) {
      const batch = dbItems.slice(i, i + batchSize);
      await db.items.bulkAdd(batch);
    }

    processed += items.length;
    offset += page.limit || pageSize;

    const percentage = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
    onProgress?.({
      phase: 'indexing',
      current: processed,
      total: total || processed,
      percentage,
      message: `Sincronizando itens... (${processed}/${total || '?'})`,
    });

    if (processed >= total) break;
  }

  onProgress?.({
    phase: 'complete',
    current: processed,
    total: total || processed,
    percentage: 100,
    message: 'Itens sincronizados',
  });

  return { partial: false, loaded: processed, total };
}

/**
 * Continua sincronização completa em background após early navigation
 * Aguarda 1s antes de começar (para UI se estabilizar)
 * Atualiza lastSyncStatus conforme progresso
 */
async function continueBackgroundSync(
  hash: string,
  playlistId: string
): Promise<void> {
  console.log('[DB DEBUG] ===== BACKGROUND SYNC: Iniciando em 1s =====');

  // Aguarda 1s para UI se estabilizar
  await new Promise(resolve => setTimeout(resolve, 1000));

  try {
    // Carrega resto dos items com paginação completa
    console.log('[DB DEBUG] BACKGROUND SYNC: Carregando resto dos items...');
    await syncItemsFromServer(hash, playlistId, undefined, { loadPartial: false });

    // Atualiza status para 'success'
    await db.playlists.update(playlistId, { lastSyncStatus: 'success' });
    console.log('[DB DEBUG] BACKGROUND SYNC: Concluído com sucesso!');

  } catch (error) {
    console.error('[DB DEBUG] BACKGROUND SYNC: Erro durante sincronização:', error);

    // Marca como erro
    await db.playlists.update(playlistId, { lastSyncStatus: 'error' });
  }
}

/**
 * Adiciona uma nova playlist a partir de uma URL
 * Usa APENAS o servidor para processar M3U (sem fallback client-side)
 */
export async function addPlaylist(
  url: string,
  name?: string,
  onProgress?: ProgressCallback
): Promise<string> {
  // Verifica limite de playlists
  const playlistCount = await db.playlists.count();
  if (playlistCount >= MAX_PLAYLISTS) {
    throw new Error(`Limite de ${MAX_PLAYLISTS} playlists atingido`);
  }

  // Verifica se URL ja existe
  const existing = await db.playlists.where('url').equals(url).first();
  if (existing) {
    throw new Error('Esta playlist ja foi adicionada');
  }

  // Gera ID unico
  const playlistId = `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // APENAS SERVIDOR (sem fallback) - não bloqueia no download de itens
  const parsed = await fetchFromServer(url, onProgress);

  // Determina se deve ser ativa (primeira playlist = ativa)
  const isFirst = playlistCount === 0;

  // DEBUG: Log antes de salvar
  console.log('[DB DEBUG] ===== SALVANDO PLAYLIST =====');
  console.log('[DB DEBUG] PlaylistId:', playlistId);
  console.log('[DB DEBUG] Groups a salvar:', parsed.groups.length);
  console.log('[DB DEBUG] Stats:', parsed.stats);

  // Salva no banco com status 'syncing' (early navigation)
  await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
    // Cria registro da playlist
    const playlist: Playlist = {
      id: playlistId,
      name: name || extractNameFromUrl(url),
      url,
      isActive: isFirst ? 1 : 0,
      lastUpdated: Date.now(),
      lastSyncStatus: 'syncing', // Early navigation: marca como syncing
      itemCount: parsed.stats.totalItems,
      liveCount: parsed.stats.liveCount,
      movieCount: parsed.stats.movieCount,
      seriesCount: parsed.stats.seriesCount,
      createdAt: Date.now(),
    };
    console.log('[DB DEBUG] Playlist object:', playlist);
    await db.playlists.add(playlist);

    // Salva grupos (grupos sempre vêm no retorno)
    const groups: M3UGroup[] = parsed.groups.map((group: any) => ({
      id: `${playlistId}_${group.id}`,
      playlistId,
      name: group.name,
      mediaKind: group.mediaKind,
      itemCount: group.itemCount,
      logo: group.logo,
      createdAt: Date.now(),
    }));

    // Grupos podem já ter sido inseridos pelo streaming parser
    if (groups.length > 0) {
      try {
        await db.groups.bulkAdd(groups);
      } catch (error) {
        // Se erro de chave duplicada, ignora (grupos já foram inseridos)
        console.log('[DB DEBUG] Grupos já existem (inseridos pelo streaming parser)');
      }
    }

    console.log('[DB DEBUG] Transação completada com sucesso!');
  });

  // DEBUG: Verifica o que foi salvo
  const savedPlaylist = await db.playlists.get(playlistId);
  const savedGroupsCount = await db.groups.where('playlistId').equals(playlistId).count();
  console.log('[DB DEBUG] ===== VERIFICAÇÃO PÓS-SAVE =====');
  console.log('[DB DEBUG] Playlist salva:', savedPlaylist);
  console.log('[DB DEBUG] Groups salvos:', savedGroupsCount);

  // Verifica grupos por mediaKind
  const movieGroups = await db.groups.where({ playlistId, mediaKind: 'movie' }).count();
  const seriesGroups = await db.groups.where({ playlistId, mediaKind: 'series' }).count();
  const liveGroups = await db.groups.where({ playlistId, mediaKind: 'live' }).count();
  console.log('[DB DEBUG] Movie groups:', movieGroups);
  console.log('[DB DEBUG] Series groups:', seriesGroups);
  console.log('[DB DEBUG] Live groups:', liveGroups);

  // EARLY NAVIGATION: Carrega apenas primeiros 1000 items
  console.log('[DB DEBUG] ===== EARLY NAVIGATION: Carregando primeiros 1000 items =====');
  await syncItemsFromServer(parsed.hash, playlistId, onProgress, {
    loadPartial: true,
    partialLimit: 1000,
  });

  const savedItemsCount = await db.items.where('playlistId').equals(playlistId).count();
  console.log('[DB DEBUG] Items salvos (parcial):', savedItemsCount);

  // Continua sincronização completa em background (fire-and-forget)
  continueBackgroundSync(parsed.hash, playlistId).catch((err) => {
    console.error('[DB DEBUG] Erro ao continuar sincronização em background:', err);
  });

  return playlistId;
}

/**
 * Atualiza uma playlist existente (re-sincroniza)
 * Usa APENAS o servidor para re-processar M3U
 */
export async function refreshPlaylist(
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) {
    throw new Error('Playlist nao encontrada');
  }

  // Re-processa usando servidor (retorna stats/grupos/hash)
  const parsed = await fetchFromServer(playlist.url, onProgress);

  await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
    // Remove itens e grupos antigos
    await db.items.where('playlistId').equals(playlistId).delete();
    await db.groups.where('playlistId').equals(playlistId).delete();

    // Atualiza playlist
    await db.playlists.update(playlistId, {
      lastUpdated: Date.now(),
      lastSyncStatus: 'success',
      itemCount: parsed.stats.totalItems,
      liveCount: parsed.stats.liveCount,
      movieCount: parsed.stats.movieCount,
      seriesCount: parsed.stats.seriesCount,
    });

    // Re-insere grupos
    const groups: M3UGroup[] = parsed.groups.map((group: any) => ({
      id: `${playlistId}_${group.id}`,
      playlistId,
      name: group.name,
      mediaKind: group.mediaKind,
      itemCount: group.itemCount,
      logo: group.logo,
      createdAt: Date.now(),
    }));

    if (groups.length > 0) {
      await db.groups.bulkAdd(groups);
    }
  });

  // Sincroniza itens (aqui aguardamos para garantir atualização completa)
  await syncItemsFromServer(parsed.hash, playlistId, onProgress);
}

/**
 * Lista todas as playlists
 */
export async function getAllPlaylists(): Promise<Playlist[]> {
  return db.playlists.toArray();
}

/**
 * Obtem playlist ativa
 */
export async function getActivePlaylist(): Promise<Playlist | undefined> {
  return db.playlists.where('isActive').equals(1).first();
}

/**
 * Define playlist ativa
 */
export async function setActivePlaylist(playlistId: string): Promise<void> {
  await db.transaction('rw', db.playlists, async () => {
    // Desativa todas
    await db.playlists.toCollection().modify({ isActive: 0 });
    // Ativa a selecionada
    await db.playlists.update(playlistId, { isActive: 1 });
  });
}

/**
 * Remove uma playlist e todos os dados associados
 */
export async function removePlaylist(playlistId: string): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) return;

  const wasActive = playlist.isActive === 1;

  await db.transaction('rw', [db.playlists, db.items, db.groups, db.favorites, db.watchProgress], async () => {
    // Remove dados
    await db.items.where('playlistId').equals(playlistId).delete();
    await db.groups.where('playlistId').equals(playlistId).delete();
    await db.favorites.where('playlistId').equals(playlistId).delete();
    await db.watchProgress.where('playlistId').equals(playlistId).delete();
    await db.playlists.delete(playlistId);

    // Se era ativa, ativa a proxima
    if (wasActive) {
      const next = await db.playlists.toCollection().first();
      if (next) {
        await db.playlists.update(next.id, { isActive: 1 });
      }
    }
  });
}

/**
 * Extrai nome da playlist a partir da URL
 */
function extractNameFromUrl(url: string): string {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.replace('www.', '');
    return hostname.charAt(0).toUpperCase() + hostname.slice(1);
  } catch {
    return 'Minha Playlist';
  }
}

/**
 * Obtem estatisticas da playlist ativa
 */
export async function getActivePlaylistStats(): Promise<{
  movies: number;
  series: number;
  live: number;
  total: number;
} | null> {
  const playlist = await getActivePlaylist();
  if (!playlist) return null;

  return {
    movies: playlist.movieCount,
    series: playlist.seriesCount,
    live: playlist.liveCount,
    total: playlist.itemCount,
  };
}
