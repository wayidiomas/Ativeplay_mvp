/**
 * Movie Detail Wrapper
 * Wrapper for MovieDetail that integrates with navigation and player
 */

import { useState, useCallback } from 'react';
import { MovieDetail } from './MovieDetail';
import { PlayerContainer } from '@ui/player';
import type { PlaylistItem } from '@core/services/api';

export function MovieDetailWrapper() {
  const [selectedItem, setSelectedItem] = useState<PlaylistItem | null>(null);

  const handlePlay = useCallback((item: PlaylistItem) => {
    setSelectedItem(item);
  }, []);

  const handleClosePlayer = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setSelectedItem(null);
  }, []);

  // If playing, show the player
  if (selectedItem) {
    return (
      <PlayerContainer
        url={selectedItem.url}
        title={selectedItem.parsedTitle?.title || selectedItem.name}
        isLive={false}
        onClose={handleClosePlayer}
        onEnded={handleVideoEnded}
      />
    );
  }

  // Otherwise show movie details
  return <MovieDetail onPlay={handlePlay} />;
}

export default MovieDetailWrapper;
