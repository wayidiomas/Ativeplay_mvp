/**
 * Playlist Store - Stateless Version
 * All data comes from Rust backend API
 * Only stores hash in localStorage for auto-resume
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  PlaylistStats,
  PlaylistGroup,
  SeriesInfo,
  StoredPlaylist,
  PlaylistItem,
  MediaKind,
  SourceType,
} from '@core/services/api';
import { createXtreamClient, XtreamAPI } from '@core/services/api';

// Row data cached per tab
export interface CachedRow {
  group: PlaylistGroup;
  items: PlaylistItem[];
  series?: SeriesInfo[];
  isSeries?: boolean;
  hasMore?: boolean;
}

// Xtream items cache by category ID
export type XtreamItemsCache = Record<string, PlaylistItem[]>;

// ============================================================================
// Types
// ============================================================================

interface PlaylistState {
  // Current playlist info (from backend)
  hash: string | null;
  url: string | null;
  name: string | null;
  stats: PlaylistStats | null;

  // Hybrid support: Xtream vs M3U
  sourceType: SourceType | null;
  playlistId: string | null; // UUID for Xtream playlists
  xtreamClient: XtreamAPI | null; // Lazy-loaded Xtream client

  // UI state
  isLoading: boolean;
  error: string | null;
  parseInProgress: boolean; // True when parsing is still happening in background

  // Cache for current session (not persisted)
  groupsCache: PlaylistGroup[] | null;
  seriesCache: SeriesInfo[] | null;
  rowsCache: Record<MediaKind, CachedRow[]>; // Cache rows per tab (movie, series, live)
  xtreamItemsCache: Record<MediaKind, XtreamItemsCache>; // Xtream items by category ID per media type

  // Actions
  setPlaylist: (playlist: StoredPlaylist) => void;
  setStats: (stats: PlaylistStats) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setParseInProgress: (inProgress: boolean) => void;
  setGroupsCache: (groups: PlaylistGroup[] | null) => void;
  setSeriesCache: (series: SeriesInfo[] | null) => void;
  setRowsCache: (mediaKind: MediaKind, rows: CachedRow[]) => void;
  getRowsCache: (mediaKind: MediaKind) => CachedRow[] | null;
  setXtreamItemsCache: (mediaKind: MediaKind, itemsByCategory: XtreamItemsCache) => void;
  getXtreamItemsCache: (mediaKind: MediaKind) => XtreamItemsCache | null;
  clearCache: () => void;
  reset: () => void;

  // Xtream helpers
  isXtream: () => boolean;
  getXtreamClient: () => XtreamAPI | null;
}

// ============================================================================
// Initial State
// ============================================================================

const emptyRowsCache: Record<MediaKind, CachedRow[]> = {
  movie: [],
  series: [],
  live: [],
  unknown: [],
};

const emptyXtreamItemsCache: Record<MediaKind, XtreamItemsCache> = {
  movie: {},
  series: {},
  live: {},
  unknown: {},
};

const initialState = {
  hash: null as string | null,
  url: null as string | null,
  name: null as string | null,
  stats: null as PlaylistStats | null,
  sourceType: null as SourceType | null,
  playlistId: null as string | null,
  xtreamClient: null as XtreamAPI | null,
  isLoading: false,
  error: null as string | null,
  parseInProgress: false,
  groupsCache: null as PlaylistGroup[] | null,
  seriesCache: null as SeriesInfo[] | null,
  rowsCache: { ...emptyRowsCache } as Record<MediaKind, CachedRow[]>,
  xtreamItemsCache: { ...emptyXtreamItemsCache } as Record<MediaKind, XtreamItemsCache>,
};

// ============================================================================
// Store
// ============================================================================

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setPlaylist: (playlist) => {
        const isXtream = playlist.sourceType === 'xtream';
        const client = isXtream && playlist.playlistId
          ? createXtreamClient(playlist.playlistId)
          : null;

        set({
          hash: playlist.hash,
          url: playlist.url,
          name: playlist.name,
          stats: playlist.stats,
          sourceType: playlist.sourceType || 'm3u',
          playlistId: playlist.playlistId || null,
          xtreamClient: client,
          error: null,
          // Clear session cache when switching playlists
          groupsCache: null,
          seriesCache: null,
          rowsCache: { ...emptyRowsCache },
          xtreamItemsCache: { ...emptyXtreamItemsCache },
        });
      },

      setStats: (stats) => set({ stats }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      setParseInProgress: (parseInProgress) => set({ parseInProgress }),

      setGroupsCache: (groupsCache) => set({ groupsCache }),

      setSeriesCache: (seriesCache) => set({ seriesCache }),

      setRowsCache: (mediaKind, rows) =>
        set((state) => ({
          rowsCache: {
            ...state.rowsCache,
            [mediaKind]: rows,
          },
        })),

      getRowsCache: (mediaKind) => {
        const rows = get().rowsCache[mediaKind];
        return rows && rows.length > 0 ? rows : null;
      },

      setXtreamItemsCache: (mediaKind, itemsByCategory) =>
        set((state) => ({
          xtreamItemsCache: {
            ...state.xtreamItemsCache,
            [mediaKind]: itemsByCategory,
          },
        })),

      getXtreamItemsCache: (mediaKind) => {
        const cache = get().xtreamItemsCache[mediaKind];
        return cache && Object.keys(cache).length > 0 ? cache : null;
      },

      clearCache: () =>
        set({
          groupsCache: null,
          seriesCache: null,
          rowsCache: { ...emptyRowsCache },
          xtreamItemsCache: { ...emptyXtreamItemsCache },
        }),

      reset: () => set(initialState),

      // Xtream helpers
      isXtream: () => get().sourceType === 'xtream',

      getXtreamClient: () => {
        const state = get();
        if (state.sourceType !== 'xtream' || !state.playlistId) {
          return null;
        }
        // Lazy create client if needed
        if (!state.xtreamClient) {
          const client = createXtreamClient(state.playlistId);
          set({ xtreamClient: client });
          return client;
        }
        return state.xtreamClient;
      },
    }),
    {
      name: 'ativeplay-playlist',
      storage: createJSONStorage(() => localStorage),
      // Only persist essential data for auto-resume
      partialize: (state) => ({
        hash: state.hash,
        url: state.url,
        name: state.name,
        stats: state.stats,
        sourceType: state.sourceType,
        playlistId: state.playlistId,
      }),
    }
  )
);

// ============================================================================
// Selectors (for convenience)
// ============================================================================

export const selectHash = (state: PlaylistState) => state.hash;
export const selectStats = (state: PlaylistState) => state.stats;
export const selectIsLoading = (state: PlaylistState) => state.isLoading;
export const selectError = (state: PlaylistState) => state.error;
export const selectHasPlaylist = (state: PlaylistState) => !!state.hash;
export const selectParseInProgress = (state: PlaylistState) => state.parseInProgress;
export const selectSourceType = (state: PlaylistState) => state.sourceType;
export const selectIsXtream = (state: PlaylistState) => state.sourceType === 'xtream';
export const selectPlaylistId = (state: PlaylistState) => state.playlistId;

export default usePlaylistStore;
