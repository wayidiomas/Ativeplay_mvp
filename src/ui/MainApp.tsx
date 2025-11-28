/**
 * MainApp
 * Main application container that handles navigation between screens
 */

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Home } from '@ui/home';
import { MediaGrid } from '@ui/components';
import { PlayerContainer } from '@ui/player';
import type { M3UGroup, M3UItem, MediaKind } from '@core/db/schema';
import { db } from '@core/db/schema';
import { usePlaylistStore } from '@store/playlistStore';

type Screen = 'home' | 'grid' | 'player';

export function MainApp() {
  const navigate = useNavigate();
  const { setActivePlaylist } = usePlaylistStore();
  const [currentScreen, setCurrentScreen] = useState<Screen>('home');
  const [selectedGroup, setSelectedGroup] = useState<M3UGroup | null>(null);
  const [selectedItem, setSelectedItem] = useState<M3UItem | null>(null);
  const [loadingPlaylist, setLoadingPlaylist] = useState(true);

  // Ensure active playlist is hydrated even after F5 directly on /home
  useEffect(() => {
    let mounted = true;
    async function ensureActivePlaylist() {
      try {
        const active = await db.playlists.where('isActive').equals(1).first();
        if (!mounted) return;
        if (active) {
          setActivePlaylist(active);
        } else {
          navigate('/onboarding/input', { replace: true });
        }
      } finally {
        if (mounted) setLoadingPlaylist(false);
      }
    }
    ensureActivePlaylist();
    return () => {
      mounted = false;
    };
  }, [navigate, setActivePlaylist]);

  // Handle group selection from Home
  const handleSelectGroup = useCallback((group: M3UGroup) => {
    setSelectedGroup(group);
    setCurrentScreen('grid');
  }, []);

  // Handle media kind change (for future use)
  const handleSelectMediaKind = useCallback((_kind: MediaKind) => {
    // Reserved for future filtering functionality
  }, []);

  // Handle item selection from Grid
  const handleSelectItem = useCallback((item: M3UItem) => {
    setSelectedItem(item);
    setCurrentScreen('player');
  }, []);

  // Handle back from Grid
  const handleBackFromGrid = useCallback(() => {
    setSelectedGroup(null);
    setCurrentScreen('home');
  }, []);

  // Handle close player
  const handleClosePlayer = useCallback(() => {
    setCurrentScreen('grid');
    setSelectedItem(null);
  }, []);

  // Handle video ended
  const handleVideoEnded = useCallback(() => {
    setCurrentScreen('grid');
    setSelectedItem(null);
  }, []);

  // Render based on current screen
  if (loadingPlaylist) {
    return null;
  }

  switch (currentScreen) {
    case 'player':
      if (selectedItem) {
        return (
          <PlayerContainer
            url={selectedItem.url}
            title={selectedItem.title || selectedItem.name}
            onClose={handleClosePlayer}
            onEnded={handleVideoEnded}
          />
        );
      }
      // Fall through if no item selected
      setCurrentScreen('home');
      return null;

    case 'grid':
      if (selectedGroup) {
        return (
          <MediaGrid
            group={selectedGroup}
            onBack={handleBackFromGrid}
            onSelectItem={handleSelectItem}
          />
        );
      }
      // Fall through if no group selected
      setCurrentScreen('home');
      return null;

    case 'home':
    default:
      return (
        <Home
          onSelectGroup={handleSelectGroup}
          onSelectMediaKind={handleSelectMediaKind}
          onSelectItem={handleSelectItem}
        />
      );
  }
}

export default MainApp;
