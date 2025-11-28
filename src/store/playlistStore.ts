/**
 * Playlist Store
 * Estado global para gerenciamento de playlists
 */

import { create } from 'zustand';
import type { Playlist } from '@core/db';

interface PlaylistState {
  // Estado
  activePlaylist: Playlist | null;
  playlists: Playlist[];
  isLoading: boolean;
  error: string | null;

  // Actions
  setActivePlaylist: (playlist: Playlist | null) => void;
  setPlaylists: (playlists: Playlist[]) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

const initialState = {
  activePlaylist: null,
  playlists: [],
  isLoading: false,
  error: null,
};

export const usePlaylistStore = create<PlaylistState>((set) => ({
  ...initialState,

  setActivePlaylist: (playlist) => set({ activePlaylist: playlist }),

  setPlaylists: (playlists) => set({ playlists }),

  setLoading: (isLoading) => set({ isLoading }),

  setError: (error) => set({ error }),

  reset: () => set(initialState),
}));

export default usePlaylistStore;
