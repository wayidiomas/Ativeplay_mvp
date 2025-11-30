/**
 * Database Operations
 * Operacoes de alto nivel para gerenciar playlists e conteudo
 * FASE 5: Refatorado para usar parseM3ULocal (frontend-only parsing)
 */

import { db, type Playlist } from './schema';
import type { ProgressCallback } from '../services/m3u';
import { parseM3ULocal, type EarlyReadyCallback } from '../services/m3u/parser'; // ✅ FASE 5: Frontend parsing

const MAX_PLAYLISTS = parseInt(import.meta.env.VITE_MAX_PLAYLISTS || '3', 10);

// ✅ Lock em memória para prevenir race conditions (React StrictMode executa effects 2x)
const processingUrls = new Map<string, Promise<string>>();

// ============================================================================
// FASE 5: Funções do servidor REMOVIDAS
// ============================================================================
// As seguintes funções foram removidas e substituídas por parseM3ULocal:
//   - pollJobUntilComplete()
//   - fetchFromServer()
//   - syncItemsFromServer()
//   - continueBackgroundSync()
//
// Para referência/rollback, veja operations.ts.backup ou operations.ts.backup2
// ============================================================================

/**
 * Adiciona uma nova playlist a partir de uma URL
 * ✅ FASE 5: Usa parseM3ULocal (frontend-only parsing)
 * ✅ FASE 7.1: Fire-and-forget com early navigation
 */
export async function addPlaylist(
  url: string,
  name?: string,
  onProgress?: ProgressCallback
): Promise<string> {
  // ✅ LOCK: Previne race conditions (React StrictMode executa effects 2x)
  const processingPromise = processingUrls.get(url);
  if (processingPromise) {
    console.log('[DB DEBUG] ⚠️ URL já está sendo processada, reutilizando Promise existente');
    return processingPromise;
  }

  // Cria Promise e adiciona ao lock
  const promise = (async () => {
    try {
      // Verifica limite de playlists
      const playlistCount = await db.playlists.count();
      if (playlistCount >= MAX_PLAYLISTS) {
        throw new Error(`Limite de ${MAX_PLAYLISTS} playlists atingido`);
      }

      // Verifica se URL ja existe
      const existing = await db.playlists.where('url').equals(url).first();
      if (existing) {
        console.log('[DB DEBUG] Playlist já existe:', existing.id);

        // Verifica status de sincronização e items carregados
        const itemsCount = await db.items.where('playlistId').equals(existing.id).count();
        const totalItems = existing.itemCount;

        console.log('[DB DEBUG] Items carregados:', itemsCount, '/', totalItems);
        console.log('[DB DEBUG] Status atual:', existing.lastSyncStatus);

        // 🔥 FIX: PRIORIZA CACHE - Mostra dados imediatamente se tiver QUALQUER item em cache
        if (itemsCount > 0) {
          console.log('[DB DEBUG] ✅ CACHE HIT! Mostrando dados imediatamente (',itemsCount,'items)');

          // Ativa a playlist IMEDIATAMENTE (não bloqueia)
          await setActivePlaylist(existing.id);

          // Case 1: Items completos → apenas corrige status se necessário
          if (itemsCount >= totalItems && existing.lastSyncStatus === 'syncing') {
            console.log('[DB DEBUG] Corrigindo status para "success" (items já completos)');
            await db.playlists.update(existing.id, { lastSyncStatus: 'success' });
          }

          // Case 2: Items incompletos → reprocessa EM BACKGROUND (não bloqueia!)
          // ✅ FASE 5: Usa parseM3ULocal ao invés do servidor
          else if (itemsCount < totalItems) {
            console.log('[DB DEBUG] Items incompletos, reprocessando em background...');

            // Fire-and-forget: Reprocessa playlist completa em background
            // parseM3ULocal já salva tudo no DB (items + groups + series)
            parseM3ULocal(existing.url, existing.id, undefined)
              .then(async (parsed) => {
                // Atualiza stats da playlist
                await db.playlists.update(existing.id, {
                  itemCount: parsed.stats.totalItems,
                  liveCount: parsed.stats.liveCount,
                  movieCount: parsed.stats.movieCount,
                  seriesCount: parsed.stats.seriesCount,
                  lastSyncStatus: 'success',
                  lastUpdated: Date.now(),
                });
                console.log('[DB DEBUG] ✓ Background sync completo');
              })
              .catch(err => {
                console.error('[DB DEBUG] Erro ao reprocessar em background:', err);
                db.playlists.update(existing.id, { lastSyncStatus: 'error' });
              });
          }

          // Retorna IMEDIATAMENTE (usuário vê dados em <1s)
          return existing.id;
        }

        // Case 3: ZERO items no cache → usa fire-and-forget (early navigation)
        // ✅ FASE 7.1: Não bloqueia mais! Navega após 500 items
        console.log('[DB DEBUG] ⚠️ ZERO items em cache, iniciando parsing com early navigation...');

        // Marca como 'syncing' imediatamente
        await db.playlists.update(existing.id, {
          lastSyncStatus: 'syncing',
          lastUpdated: Date.now(),
        });

        // ✅ FASE 7.1: Fire-and-forget - parseM3ULocal continua em background
        const earlyNavCallback: EarlyReadyCallback = async (partialStats) => {
          console.log('[DB DEBUG] ✅ Early Ready! Ativando playlist com', partialStats.itemsLoaded, 'items...');

          // Atualiza stats parciais
          await db.playlists.update(existing.id, {
            itemCount: partialStats.itemsLoaded,
            liveCount: partialStats.liveCount,
            movieCount: partialStats.movieCount,
            seriesCount: partialStats.seriesCount,
            lastSyncStatus: 'syncing', // Ainda carregando
          });

          // Ativa playlist IMEDIATAMENTE (navega para home)
          await setActivePlaylist(existing.id);
        };

        // Inicia parsing (não bloqueia!)
        parseM3ULocal(existing.url, existing.id, onProgress, earlyNavCallback)
          .then(async (parsed) => {
            // Atualiza com stats finais quando completo
            await db.playlists.update(existing.id, {
              itemCount: parsed.stats.totalItems,
              liveCount: parsed.stats.liveCount,
              movieCount: parsed.stats.movieCount,
              seriesCount: parsed.stats.seriesCount,
              lastSyncStatus: 'success',
              lastUpdated: Date.now(),
            });
            console.log('[DB DEBUG] ✓ Parsing completo em background');
          })
          .catch(err => {
            console.error('[DB DEBUG] Erro no parsing:', err);
            db.playlists.update(existing.id, { lastSyncStatus: 'error' });
          });

        // Retorna IMEDIATAMENTE (navegação acontece no early callback)
        return existing.id;
      }

      // Gera ID unico
      const playlistId = `playlist_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

      // Determina se deve ser ativa (primeira playlist = ativa)
      const isFirst = playlistCount === 0;

      // ✅ FASE 7.1: Cria playlist IMEDIATAMENTE (status 'syncing')
      const playlist: Playlist = {
        id: playlistId,
        name: name || extractNameFromUrl(url),
        url,
        hash: '', // ✅ FASE 5: Hash não é mais necessário (sem servidor)
        isActive: 0, // Será ativada no early callback
        lastUpdated: Date.now(),
        lastSyncStatus: 'syncing', // ✅ FASE 7.1: Ainda carregando
        itemCount: 0, // Será atualizado no early callback
        liveCount: 0,
        movieCount: 0,
        seriesCount: 0,
        createdAt: Date.now(),
      };

      console.log('[DB DEBUG] ===== CRIANDO PLAYLIST (fire-and-forget) =====');
      console.log('[DB DEBUG] PlaylistId:', playlistId);
      console.log('[DB DEBUG] IsFirst:', isFirst);

      await db.playlists.add(playlist);

      // ✅ FASE 7.1: Early navigation callback
      const earlyNavCallback: EarlyReadyCallback = async (partialStats) => {
        console.log('[DB DEBUG] ✅ Early Ready! Atualizando playlist com', partialStats.itemsLoaded, 'items...');

        // Atualiza com stats parciais
        await db.playlists.update(playlistId, {
          itemCount: partialStats.itemsLoaded,
          liveCount: partialStats.liveCount,
          movieCount: partialStats.movieCount,
          seriesCount: partialStats.seriesCount,
          lastSyncStatus: 'syncing', // Ainda carregando
        });

        // Ativa playlist se for a primeira (navega para home)
        if (isFirst) {
          console.log('[DB DEBUG] Ativando primeira playlist...');
          await setActivePlaylist(playlistId);
        }
      };

      // ✅ FASE 7.1: Fire-and-forget - inicia parsing sem bloquear
      parseM3ULocal(url, playlistId, onProgress, earlyNavCallback)
        .then(async (parsed) => {
          // Atualiza com stats finais quando completo
          console.log('[DB DEBUG] ✓ Parsing completo! Atualizando stats finais...');
          await db.playlists.update(playlistId, {
            itemCount: parsed.stats.totalItems,
            liveCount: parsed.stats.liveCount,
            movieCount: parsed.stats.movieCount,
            seriesCount: parsed.stats.seriesCount,
            lastSyncStatus: 'success',
            lastUpdated: Date.now(),
          });
          console.log('[DB DEBUG] ✓ Playlist finalizada:', playlistId);
        })
        .catch(err => {
          console.error('[DB DEBUG] ❌ Erro no parsing:', err);
          db.playlists.update(playlistId, { lastSyncStatus: 'error' });
        });

      // Retorna IMEDIATAMENTE (navegação acontece no early callback)
      console.log('[DB DEBUG] ✓ Retornando playlistId imediatamente (parsing em background)');
      return playlistId;
    } finally {
      // ✅ Remove lock quando terminar (sucesso ou erro)
      processingUrls.delete(url);
    }
  })();

  // ✅ Adiciona ao Map antes de executar
  processingUrls.set(url, promise);

  return promise;
}

/**
 * Atualiza uma playlist existente (re-sincroniza)
 * ✅ FASE 5: Usa parseM3ULocal (frontend-only parsing)
 */
export async function refreshPlaylist(
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) {
    throw new Error('Playlist nao encontrada');
  }

  // Remove dados antigos (items/groups/series)
  await db.transaction('rw', [db.items, db.groups, db.series], async () => {
    await db.items.where('playlistId').equals(playlistId).delete();
    await db.groups.where('playlistId').equals(playlistId).delete();
    await db.series.where('playlistId').equals(playlistId).delete();
  });

  console.log('[DB DEBUG] ✓ Dados antigos removidos, reprocessando playlist...');

  // ✅ FASE 5: parseM3ULocal faz TUDO (download + parse + batch save + series grouping)
  const parsed = await parseM3ULocal(playlist.url, playlistId, onProgress);

  // Atualiza stats da playlist
  await db.playlists.update(playlistId, {
    lastUpdated: Date.now(),
    lastSyncStatus: 'success',
    itemCount: parsed.stats.totalItems,
    liveCount: parsed.stats.liveCount,
    movieCount: parsed.stats.movieCount,
    seriesCount: parsed.stats.seriesCount,
  });

  console.log('[DB DEBUG] ✓ Playlist atualizada com sucesso');
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
