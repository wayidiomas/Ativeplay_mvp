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
} from '@core/services/api';

// Row data cached per tab
export interface CachedRow {
  group: PlaylistGroup;
  items: PlaylistItem[];
  series?: SeriesInfo[];
  isSeries?: boolean;
  hasMore?: boolean;
}

// ============================================================================
// Types
// ============================================================================

interface PlaylistState {
  // Current playlist info (from backend)
  hash: string | null;
  url: string | null;
  name: string | null;
  stats: PlaylistStats | null;

  // UI state
  isLoading: boolean;
  error: string | null;
  parseInProgress: boolean; // True when parsing is still happening in background

  // Cache for current session (not persisted)
  groupsCache: PlaylistGroup[] | null;
  seriesCache: SeriesInfo[] | null;
  rowsCache: Record<MediaKind, CachedRow[]>; // Cache rows per tab (movie, series, live)

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
  clearCache: () => void;
  reset: () => void;
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

const initialState = {
  hash: null as string | null,
  url: null as string | null,
  name: null as string | null,
  stats: null as PlaylistStats | null,
  isLoading: false,
  error: null as string | null,
  parseInProgress: false,
  groupsCache: null as PlaylistGroup[] | null,
  seriesCache: null as SeriesInfo[] | null,
  rowsCache: { ...emptyRowsCache } as Record<MediaKind, CachedRow[]>,
};

// ============================================================================
// Store
// ============================================================================

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setPlaylist: (playlist) =>
        set({
          hash: playlist.hash,
          url: playlist.url,
          name: playlist.name,
          stats: playlist.stats,
          error: null,
          // Clear session cache when switching playlists
          groupsCache: null,
          seriesCache: null,
          rowsCache: { ...emptyRowsCache },
        }),

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

      clearCache: () =>
        set({
          groupsCache: null,
          seriesCache: null,
          rowsCache: { ...emptyRowsCache },
        }),

      reset: () => set(initialState),
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

export default usePlaylistStore;
