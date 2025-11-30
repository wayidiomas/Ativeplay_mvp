/**
 * Playlist Store
 * Estado global para playlists e caches
 */

import { create } from 'zustand';
import type { Playlist, M3UItem } from '@core/db';

interface SyncProgress {
  current: number;
  total: number;
  percentage: number;
}

type CacheGridState = { visibleCount: number; scrollTop: number };

interface PlaylistState {
  activePlaylist: Playlist | null;
  playlists: Playlist[];
  isLoading: boolean;
  error: string | null;
  isSyncing: boolean;
  syncProgress: SyncProgress | null;
  groupCache: Map<string, M3UItem[]>;
  mediaGridCache: Map<string, CacheGridState>;
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
};

export const usePlaylistStore = create<PlaylistState>()((set, get) => ({
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

  reset: () =>
    set({
      ...initialState,
      groupCache: new Map<string, M3UItem[]>(),
      mediaGridCache: new Map<string, CacheGridState>(),
    }),
}));

export default usePlaylistStore;
