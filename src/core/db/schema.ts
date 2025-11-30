import Dexie, { type Table } from 'dexie';

// Types
export interface Playlist {
  id: string;
  name: string;
  url: string;
  hash: string; // SHA-1 hash da URL (para reuso do cache do servidor)
  isActive: number; // 0 ou 1 (IndexedDB nao suporta boolean como chave)
  lastUpdated: number;
  lastSyncStatus: 'syncing' | 'success' | 'error';
  itemCount: number;
  liveCount: number;
  movieCount: number;
  seriesCount: number;
  createdAt: number;
}

export type MediaKind = 'live' | 'movie' | 'series' | 'unknown';

export interface M3UItem {
  id: string;
  playlistId: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  mediaKind: MediaKind;
  // Metadados extraidos do titulo
  title?: string;
  titleNormalized?: string; // Uppercase para busca case-insensitive
  year?: number;
  season?: number;
  episode?: number;
  quality?: string;
  // TMDB (sera preenchido depois)
  tmdbId?: number;
  tmdbType?: 'movie' | 'tv';
  // EPG ID para Live TV
  epgId?: string;
  // IDs extras (Xtream/xui)
  xuiId?: string;
  // Series grouping (novo)
  seriesId?: string; // Referência à série (se for episódio)
  seasonNumber?: number; // Número da temporada
  episodeNumber?: number; // Número do episódio
  // FASE OTIMIZAÇÃO: Campos normalizados para queries rápidas
  groupNormalized?: string; // Uppercase, sem emojis (para busca O(1))
  urlHash?: string;         // Hash da URL (dedupe ultra-rápido)
  // Indices compostos para queries
  createdAt: number;
}

export interface M3UGroup {
  id: string;
  playlistId: string;
  name: string;
  mediaKind: MediaKind;
  itemCount: number;
  logo?: string;
  createdAt: number;
}

export interface Series {
  id: string; // série_{playlistId}_{seriesSlug}
  playlistId: string;
  name: string; // Nome base (sem SxxExx)
  logo: string; // Poster/logo
  group: string;
  totalEpisodes: number; // Count total
  totalSeasons: number; // Número de temporadas
  firstEpisode: number; // Primeiro episódio disponível
  lastEpisode: number; // Último episódio disponível
  firstSeason: number; // Primeira temporada disponível
  lastSeason: number; // Última temporada disponível
  year?: number; // Ano (se extraído)
  quality?: string; // Qualidade (se extraído)
  createdAt: number;
}

export interface Favorite {
  id: string;
  playlistId: string;
  itemId: string;
  createdAt: number;
}

export interface WatchProgress {
  id: string;
  playlistId: string;
  itemId: string;
  position: number; // em milisegundos
  duration: number;
  percentage: number;
  watchedAt: number;
  completed: boolean;
}

// Database class
class AtivePlayDB extends Dexie {
  playlists!: Table<Playlist>;
  items!: Table<M3UItem>;
  groups!: Table<M3UGroup>;
  series!: Table<Series>;
  favorites!: Table<Favorite>;
  watchProgress!: Table<WatchProgress>;

  constructor() {
    super('AtivePlayDB');

    // Schema v2 - Base MVP
    this.version(2).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt',
    });

    // Schema v3 - Adiciona índice URL para deduplicação O(1)
    this.version(3).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt',
    });

    // Schema v4 - Adiciona titleNormalized para busca case-insensitive otimizada
    this.version(4).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, titleNormalized, [playlistId+titleNormalized], [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    }).upgrade(async (tx) => {
      // Popula titleNormalized para items existentes
      console.log('[DB] Migrando para v4: normalizando títulos...');
      let count = 0;
      await tx.table('items').toCollection().modify((item) => {
        item.titleNormalized = (item.title || item.name || '').toUpperCase();
        count++;
        if (count % 1000 === 0) {
          console.log(`[DB] Normalizado ${count} items...`);
        }
      });
      console.log(`[DB] Migração v4 completa: ${count} items normalizados`);
    });

    // Schema v5 - Adiciona índice composto triplo para queries de carrosséis
    this.version(5).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, titleNormalized, [playlistId+titleNormalized], [playlistId+group], [playlistId+mediaKind], [playlistId+group+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    });

    // Schema v6 - Adiciona tabela Series e campos para agrupamento de episódios
    this.version(6).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, titleNormalized, seriesId, [playlistId+titleNormalized], [playlistId+group], [playlistId+mediaKind], [playlistId+group+mediaKind], [seriesId+seasonNumber+episodeNumber]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      series: 'id, playlistId, [playlistId+group]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    });

    // Schema v7 - Mantém índices estáveis; não adiciona campos não populados para evitar migrações vazias
    this.version(7).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, titleNormalized, seriesId, [playlistId+titleNormalized], [playlistId+group], [playlistId+mediaKind], [playlistId+group+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      series: 'id, playlistId, [playlistId+group]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    });

    // Schema v8 - Reintroduz tabela series e índices para exibição de séries agrupadas
    this.version(8).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, titleNormalized, seriesId, seasonNumber, episodeNumber, [playlistId+titleNormalized], [playlistId+group], [playlistId+mediaKind], [playlistId+group+mediaKind], [seriesId+seasonNumber+episodeNumber]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      series: 'id, playlistId, [playlistId+group]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    });

    // Schema v9 - Armazena xuiId (hash secundário) e índice para dedupe/diagnóstico
    this.version(9).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, url, group, mediaKind, titleNormalized, seriesId, seasonNumber, episodeNumber, xuiId, [playlistId+titleNormalized], [playlistId+group], [playlistId+mediaKind], [playlistId+group+mediaKind], [seriesId+seasonNumber+episodeNumber], [playlistId+xuiId]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      series: 'id, playlistId, [playlistId+group]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    });

    // Schema v10 - FASE OTIMIZAÇÃO: Adiciona campos normalizados e índices otimizados
    this.version(10).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: `
        id,
        playlistId,
        url,
        group,
        mediaKind,
        titleNormalized,
        groupNormalized,
        urlHash,
        seriesId,
        seasonNumber,
        episodeNumber,
        xuiId,
        [playlistId+titleNormalized],
        [playlistId+group],
        [playlistId+groupNormalized],
        [playlistId+mediaKind],
        [playlistId+group+mediaKind],
        [playlistId+url],
        [playlistId+urlHash],
        [seriesId+seasonNumber+episodeNumber],
        [playlistId+xuiId]
      `.replace(/\s+/g, ' ').trim(),
      groups: 'id, playlistId, mediaKind, name, [playlistId+mediaKind]',
      series: 'id, playlistId, name, [playlistId+group]',
      favorites: 'id, [playlistId+itemId], playlistId',
      watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
    }).upgrade(async (tx) => {
      // Popula campos normalizados para items existentes
      console.log('[DB] Migrando para v10: adicionando campos normalizados...');

      const { normalizeGroup, normalizeTitle, hashURL } = await import('../services/m3u/utils');

      let count = 0;
      await tx.table('items').toCollection().modify((item) => {
        // Adiciona campos normalizados
        item.groupNormalized = normalizeGroup(item.group || '');
        item.titleNormalized = normalizeTitle(item.title || item.name || '');
        item.urlHash = hashURL(item.url);

        count++;
        if (count % 1000 === 0) {
          console.log(`[DB] Normalizado ${count} items...`);
        }
      });

      console.log(`[DB] Migração v10 completa: ${count} items normalizados`);
    });
  }
}

// Singleton instance
export const db = new AtivePlayDB();

// Helper functions
export async function getActivePlaylist(): Promise<Playlist | undefined> {
  return db.playlists.where('isActive').equals(1).first();
}

export async function setActivePlaylist(playlistId: string): Promise<void> {
  await db.transaction('rw', db.playlists, async () => {
    // Desativa todas as playlists
    await db.playlists.toCollection().modify({ isActive: 0 });
    // Ativa a playlist selecionada
    await db.playlists.update(playlistId, { isActive: 1 });
  });
}

export async function getPlaylistItems(
  playlistId: string,
  mediaKind?: MediaKind
): Promise<M3UItem[]> {
  if (mediaKind) {
    return db.items.where({ playlistId, mediaKind }).toArray();
  }
  return db.items.where('playlistId').equals(playlistId).toArray();
}

export async function getPlaylistGroups(
  playlistId: string,
  mediaKind?: MediaKind,
  limit?: number
): Promise<M3UGroup[]> {
  let query;
  if (mediaKind) {
    query = db.groups.where({ playlistId, mediaKind });
  } else {
    query = db.groups.where('playlistId').equals(playlistId);
  }

  if (limit) {
    return query.limit(limit).toArray();
  }
  return query.toArray();
}

export async function getItemsByGroup(
  playlistId: string,
  group: string
): Promise<M3UItem[]> {
  return db.items.where({ playlistId, group }).toArray();
}

export async function addFavorite(
  playlistId: string,
  itemId: string
): Promise<string> {
  const id = `${playlistId}_${itemId}`;
  await db.favorites.put({
    id,
    playlistId,
    itemId,
    createdAt: Date.now(),
  });
  return id;
}

export async function removeFavorite(
  playlistId: string,
  itemId: string
): Promise<void> {
  await db.favorites.where({ playlistId, itemId }).delete();
}

export async function isFavorite(
  playlistId: string,
  itemId: string
): Promise<boolean> {
  const count = await db.favorites.where({ playlistId, itemId }).count();
  return count > 0;
}

export async function updateWatchProgress(
  playlistId: string,
  itemId: string,
  position: number,
  duration: number
): Promise<void> {
  const id = `${playlistId}_${itemId}`;
  const percentage = duration > 0 ? (position / duration) * 100 : 0;
  const completed = percentage >= 90;

  await db.watchProgress.put({
    id,
    playlistId,
    itemId,
    position,
    duration,
    percentage,
    watchedAt: Date.now(),
    completed,
  });
}

export async function getWatchProgress(
  playlistId: string,
  itemId: string
): Promise<WatchProgress | undefined> {
  return db.watchProgress.where({ playlistId, itemId }).first();
}

export async function getContinueWatching(
  playlistId: string,
  limit = 20
): Promise<WatchProgress[]> {
  return db.watchProgress
    .where('playlistId')
    .equals(playlistId)
    .and((p) => !p.completed && p.percentage > 5)
    .reverse()
    .sortBy('watchedAt')
    .then((items) => items.slice(0, limit));
}

export async function clearPlaylistData(playlistId: string): Promise<void> {
  await db.transaction('rw', [db.items, db.groups, db.series, db.favorites, db.watchProgress], async () => {
    await db.items.where('playlistId').equals(playlistId).delete();
    await db.groups.where('playlistId').equals(playlistId).delete();
    await db.series.where('playlistId').equals(playlistId).delete();
    await db.favorites.where('playlistId').equals(playlistId).delete();
    await db.watchProgress.where('playlistId').equals(playlistId).delete();
  });
}

export async function removePlaylistWithData(playlistId: string): Promise<void> {
  await db.transaction('rw', [db.playlists, db.items, db.groups, db.favorites, db.watchProgress, db.series], async () => {
    await clearPlaylistData(playlistId);
    await db.playlists.delete(playlistId);
  });
}

// Series helper functions
export async function getSeriesByPlaylist(
  playlistId: string,
  group?: string
): Promise<Series[]> {
  if (group) {
    return db.series.where({ playlistId, group }).toArray();
  }
  return db.series.where('playlistId').equals(playlistId).toArray();
}

export async function getSeriesById(seriesId: string): Promise<Series | undefined> {
  return db.series.get(seriesId);
}

export async function getEpisodesBySeries(
  seriesId: string
): Promise<M3UItem[]> {
  return db.items
    .where('seriesId')
    .equals(seriesId)
    .sortBy('[seasonNumber+episodeNumber]');
}

export async function getEpisodesBySeriesAndSeason(
  seriesId: string,
  seasonNumber: number
): Promise<M3UItem[]> {
  return db.items
    .where({ seriesId })
    .filter((item) => item.seasonNumber === seasonNumber)
    .sortBy('episodeNumber');
}
