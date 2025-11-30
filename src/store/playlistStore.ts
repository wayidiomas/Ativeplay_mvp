/**
 * Playlist Store
 * Estado global para playlists e caches
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Playlist, M3UItem, M3UGroup, Series } from '@core/db';

interface SyncProgress {
  current: number;
  total: number;
  percentage: number;
}

type CacheGridState = { visibleCount: number; scrollTop: number };

// ✅ NOVO: Interface Row para cache de navegação (mesma do Home.tsx)
export interface Row {
  group: M3UGroup;
  items: M3UItem[];
  series?: Series[];
  isSeries?: boolean;
  lastSeriesId?: string;
  lastItemId?: string;
  hasMoreSeries?: boolean;
  hasMoreItems?: boolean;
}

// ✅ NOVO: Cache de navegação por tab
export interface TabCache {
  rows: Row[];
  timestamp: number;
  nextIndex: number;
  hasMore: boolean;
}

// ✅ NOVO: Cache completo por playlist + tab
export interface NavigationCache {
  [playlistId: string]: {
    movies?: TabCache;
    series?: TabCache;
    live?: TabCache;
  };
}

interface PlaylistState {
  activePlaylist: Playlist | null;
  playlists: Playlist[];
  isLoading: boolean;
  error: string | null;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  groupCache: Map<string, M3UItem[]>;
  mediaGridCache: Map<string, CacheGridState>;

  // ✅ NOVO: Cache de navegação persistente
  navigationCache: NavigationCache;

  setActivePlaylist: (playlist: Playlist | null) => void;
  setPlaylists: (playlists: Playlist[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: SyncProgress | null) => void;
  cacheGroupItems: (playlistId: string, group: string, items: M3UItem[]) => void;
  getGroupCache: (playlistId: string, group: string) => M3UItem[] | undefined;
  setMediaGridCache: (key: string, value: CacheGridState) => void;
  getMediaGridCache: (key: string) => CacheGridState | undefined;
  clearGroupCache: () => void;

  // ✅ NOVO: Ações para cache de navegação
  setTabCache: (playlistId: string, tab: 'movies' | 'series' | 'live', cache: TabCache) => void;
  getTabCache: (playlistId: string, tab: 'movies' | 'series' | 'live') => TabCache | undefined;
  clearNavigationCache: (playlistId?: string) => void;

  reset: () => void;
}

const initialState = {
  activePlaylist: null as Playlist | null,
  playlists: [] as Playlist[],
  isLoading: false,
  error: null as string | null,
  isSyncing: false,
  syncProgress: null as SyncProgress | null,
  groupCache: new Map<string, M3UItem[]>(),
  mediaGridCache: new Map<string, CacheGridState>(),
  navigationCache: {} as NavigationCache,
};

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      ...initialState,

      setActivePlaylist: (playlist) => set({ activePlaylist: playlist }),
      setPlaylists: (playlists) => set({ playlists }),
      setLoading: (isLoading) => set({ isLoading }),
      setError: (error) => set({ error }),
      setSyncing: (isSyncing) => set({ isSyncing }),
      setSyncProgress: (syncProgress) => set({ syncProgress }),

      cacheGroupItems: (playlistId, group, items) =>
        set((state) => {
          const key = `${playlistId}:${group}`;
          const newCache = new Map(state.groupCache);
          newCache.set(key, items);
          return { groupCache: newCache };
        }),

      getGroupCache: (playlistId, group) => {
        const state = get();
        const key = `${playlistId}:${group}`;
        return state.groupCache.get(key);
      },

      setMediaGridCache: (key, value) =>
        set((state) => {
          const next = new Map(state.mediaGridCache);
          next.set(key, value);
          return { mediaGridCache: next };
        }),

      getMediaGridCache: (key) => {
        const state = get();
        return state.mediaGridCache.get(key);
      },

      clearGroupCache: () =>
        set({
          groupCache: new Map<string, M3UItem[]>(),
          mediaGridCache: new Map<string, CacheGridState>(),
        }),

      // ✅ NOVO: Ações para cache de navegação
      setTabCache: (playlistId, tab, cache) =>
        set((state) => ({
          navigationCache: {
            ...state.navigationCache,
            [playlistId]: {
              ...(state.navigationCache[playlistId] || {}),
              [tab]: cache,
            },
          },
        })),

      getTabCache: (playlistId, tab) => {
        const state = get();
        return state.navigationCache[playlistId]?.[tab];
      },

      clearNavigationCache: (playlistId) =>
        set((state) => {
          if (playlistId) {
            const next = { ...state.navigationCache };
            delete next[playlistId];
            return { navigationCache: next };
          }
          return { navigationCache: {} };
        }),

      reset: () =>
        set({
          ...initialState,
          groupCache: new Map<string, M3UItem[]>(),
          mediaGridCache: new Map<string, CacheGridState>(),
          navigationCache: {},
        }),
    }),
    {
      name: 'ativeplay-playlist-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // ✅ Persiste apenas campos essenciais
        activePlaylist: state.activePlaylist,
        navigationCache: state.navigationCache,
      }),
    }
  )
);

export default usePlaylistStore;
