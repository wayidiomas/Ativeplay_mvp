/**
 * Series Detail Wrapper
 * Wrapper para SeriesDetail que integra com navegação e player
 */

import { useState, useCallback } from 'react';
import { SeriesDetail } from './SeriesDetail';
import { PlayerContainer } from '@ui/player';
import type { PlaylistItem } from '@core/services/api';

export function SeriesDetailWrapper() {
  const [selectedItem, setSelectedItem] = useState<PlaylistItem | null>(null);

  const handleSelectItem = useCallback((item: PlaylistItem) => {
    setSelectedItem(item);
  }, []);

  const handleClosePlayer = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setSelectedItem(null);
  }, []);

  // Se um item foi selecionado, mostra o player
  if (selectedItem) {
    return (
      <PlayerContainer
        url={selectedItem.url}
        title={selectedItem.parsedTitle?.title || selectedItem.name}
        isLive={selectedItem.mediaKind === 'live'}
        xtreamStreamId={selectedItem.xtreamId?.toString()}
        hasTvArchive={selectedItem.xtreamTvArchive}
        onClose={handleClosePlayer}
        onEnded={handleVideoEnded}
      />
    );
  }

  // Caso contrário, mostra a página de detalhes da série
  return <SeriesDetail onSelectItem={handleSelectItem} />;
}

export default SeriesDetailWrapper;
