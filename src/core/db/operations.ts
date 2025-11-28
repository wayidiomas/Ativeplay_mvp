/**
 * Database Operations
 * Operacoes de alto nivel para gerenciar playlists e conteudo
 */

import { db, type Playlist, type M3UItem, type M3UGroup } from './schema';
import { fetchAndParseM3U, type ProgressCallback } from '../services/m3u';

const MAX_PLAYLISTS = parseInt(import.meta.env.VITE_MAX_PLAYLISTS || '3', 10);

/**
 * Adiciona uma nova playlist a partir de uma URL
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

  // Parseia a playlist
  const parsed = await fetchAndParseM3U(url, playlistId, onProgress);

  // Determina se deve ser ativa (primeira playlist = ativa)
  const isFirst = playlistCount === 0;

  // DEBUG: Log antes de salvar
  console.log('[DB DEBUG] ===== SALVANDO PLAYLIST =====');
  console.log('[DB DEBUG] PlaylistId:', playlistId);
  console.log('[DB DEBUG] Items a salvar:', parsed.items.length);
  console.log('[DB DEBUG] Groups a salvar:', parsed.groups.length);
  console.log('[DB DEBUG] Stats:', parsed.stats);

  // Salva no banco
  await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
    // Cria registro da playlist
    const playlist: Playlist = {
      id: playlistId,
      name: name || extractNameFromUrl(url),
      url,
      isActive: isFirst ? 1 : 0,
      lastUpdated: Date.now(),
      lastSyncStatus: 'success',
      itemCount: parsed.stats.totalItems,
      liveCount: parsed.stats.liveCount,
      movieCount: parsed.stats.movieCount,
      seriesCount: parsed.stats.seriesCount,
      createdAt: Date.now(),
    };
    console.log('[DB DEBUG] Playlist object:', playlist);
    await db.playlists.add(playlist);

    // Salva itens em lotes
    const items: M3UItem[] = parsed.items.map((item) => ({
      id: `${playlistId}_${item.id}`,
      playlistId,
      name: item.name,
      url: item.url,
      logo: item.logo,
      group: item.group,
      mediaKind: item.mediaKind,
      title: item.parsedTitle.title,
      year: item.parsedTitle.year,
      season: item.parsedTitle.season,
      episode: item.parsedTitle.episode,
      quality: item.parsedTitle.quality,
      epgId: item.epgId,
      createdAt: Date.now(),
    }));

    // Insere em lotes de 500
    const batchSize = 500;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await db.items.bulkAdd(batch);
    }

    // Salva grupos
    const groups: M3UGroup[] = parsed.groups.map((group) => ({
      id: `${playlistId}_${group.id}`,
      playlistId,
      name: group.name,
      mediaKind: group.mediaKind,
      itemCount: group.itemCount,
      logo: group.logo,
      createdAt: Date.now(),
    }));
    await db.groups.bulkAdd(groups);
    console.log('[DB DEBUG] Transação completada com sucesso!');
  });

  // DEBUG: Verifica o que foi salvo
  const savedPlaylist = await db.playlists.get(playlistId);
  const savedItemsCount = await db.items.where('playlistId').equals(playlistId).count();
  const savedGroupsCount = await db.groups.where('playlistId').equals(playlistId).count();
  console.log('[DB DEBUG] ===== VERIFICAÇÃO PÓS-SAVE =====');
  console.log('[DB DEBUG] Playlist salva:', savedPlaylist);
  console.log('[DB DEBUG] Items salvos:', savedItemsCount);
  console.log('[DB DEBUG] Groups salvos:', savedGroupsCount);

  // Verifica grupos por mediaKind
  const movieGroups = await db.groups.where({ playlistId, mediaKind: 'movie' }).count();
  const seriesGroups = await db.groups.where({ playlistId, mediaKind: 'series' }).count();
  const liveGroups = await db.groups.where({ playlistId, mediaKind: 'live' }).count();
  console.log('[DB DEBUG] Movie groups:', movieGroups);
  console.log('[DB DEBUG] Series groups:', seriesGroups);
  console.log('[DB DEBUG] Live groups:', liveGroups);

  return playlistId;
}

/**
 * Atualiza uma playlist existente (re-sincroniza)
 */
export async function refreshPlaylist(
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const playlist = await db.playlists.get(playlistId);
  if (!playlist) {
    throw new Error('Playlist nao encontrada');
  }

  // Parseia novamente
  const parsed = await fetchAndParseM3U(playlist.url, playlistId, onProgress);

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

    // Re-insere itens
    const items: M3UItem[] = parsed.items.map((item) => ({
      id: `${playlistId}_${item.id}`,
      playlistId,
      name: item.name,
      url: item.url,
      logo: item.logo,
      group: item.group,
      mediaKind: item.mediaKind,
      title: item.parsedTitle.title,
      year: item.parsedTitle.year,
      season: item.parsedTitle.season,
      episode: item.parsedTitle.episode,
      quality: item.parsedTitle.quality,
      epgId: item.epgId,
      createdAt: Date.now(),
    }));

    const batchSize = 500;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await db.items.bulkAdd(batch);
    }

    // Re-insere grupos
    const groups: M3UGroup[] = parsed.groups.map((group) => ({
      id: `${playlistId}_${group.id}`,
      playlistId,
      name: group.name,
      mediaKind: group.mediaKind,
      itemCount: group.itemCount,
      logo: group.logo,
      createdAt: Date.now(),
    }));
    await db.groups.bulkAdd(groups);
  });
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
