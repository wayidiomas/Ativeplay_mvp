/**
 * Playlist Store
 * Estado global para gerenciamento de playlists
 */

import { create } from 'zustand';
import type { Playlist, M3UItem } from '@core/db';

interface SyncProgress {
  current: number;
  total: number;
  percentage: number;
}

interface PlaylistState {
  // Estado
  activePlaylist: Playlist | null;
  playlists: Playlist[];
  isLoading: boolean;
  error: string | null;

  // Estado de sincronização (early navigation)
  isSyncing: boolean;
  syncProgress: SyncProgress | null;

  // Cache de grupos visitados (10x faster on revisit)
  groupCache: Map<string, M3UItem[]>;
  // Cache de telas de grid ("ver todos"): mantém visibleCount/scroll
  mediaGridCache: Map<string, { visibleCount: number; scrollTop: number }>;

  // Actions
  setActivePlaylist: (playlist: Playlist | null) => void;
  setPlaylists: (playlists: Playlist[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: SyncProgress | null) => void;
  cacheGroupItems: (playlistId: string, group: string, items: M3UItem[]) => void;
  getGroupCache: (playlistId: string, group: string) => M3UItem[] | undefined;
  setMediaGridCache: (key: string, value: { visibleCount: number; scrollTop: number }) => void;
  getMediaGridCache: (key: string) => { visibleCount: number; scrollTop: number } | undefined;
  clearGroupCache: () => void;
  reset: () => void;
}

const initialState = {
  activePlaylist: null,
  playlists: [],
  isLoading: false,
  error: null,
  isSyncing: false,
  syncProgress: null,
  groupCache: new Map<string, M3UItem[]>(),
  mediaGridCache: new Map<string, { visibleCount: number; scrollTop: number }>(),
};

export const usePlaylistStore = create<PlaylistState>((set) => ({
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
    const state = usePlaylistStore.getState();
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
    const state = usePlaylistStore.getState();
    return state.mediaGridCache.get(key);
  },

  clearGroupCache: () =>
    set({
      groupCache: new Map<string, M3UItem[]>(),
      mediaGridCache: new Map<string, { visibleCount: number; scrollTop: number }>(),
    }),

  reset: () => set({ ...initialState, groupCache: new Map<string, M3UItem[]>() }),
}));

export default usePlaylistStore;
