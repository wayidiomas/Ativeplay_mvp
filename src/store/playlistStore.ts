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
} from '@core/services/api';

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

  // Actions
  setPlaylist: (playlist: StoredPlaylist) => void;
  setStats: (stats: PlaylistStats) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setParseInProgress: (inProgress: boolean) => void;
  setGroupsCache: (groups: PlaylistGroup[] | null) => void;
  setSeriesCache: (series: SeriesInfo[] | null) => void;
  clearCache: () => void;
  reset: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

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
};

// ============================================================================
// Store
// ============================================================================

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set) => ({
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
        }),

      setStats: (stats) => set({ stats }),

      setLoading: (isLoading) => set({ isLoading }),

      setError: (error) => set({ error }),

      setParseInProgress: (parseInProgress) => set({ parseInProgress }),

      setGroupsCache: (groupsCache) => set({ groupsCache }),

      setSeriesCache: (seriesCache) => set({ seriesCache }),

      clearCache: () =>
        set({
          groupsCache: null,
          seriesCache: null,
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
