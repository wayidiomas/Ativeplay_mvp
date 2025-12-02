/**
 * Series Detail Page - Stateless version using Rust backend API
 * Página de detalhes de uma série com lista de episódios estilo Netflix
 */

import { useEffect, useState, memo, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { usePlaylistStore } from '@store/playlistStore';
import {
  getSeries,
  getSeriesEpisodes,
  type SeriesInfo,
  type PlaylistItem,
  type SeasonData,
} from '@core/services/api';
import { MdArrowBack, MdPlayArrow } from 'react-icons/md';
import styles from './SeriesDetail.module.css';

// Episode list virtualization constants
const EPISODE_HEIGHT = 122; // episodeCard height (90px thumbnail + 32px padding)
const EPISODE_GAP = 12;
const EPISODE_ROW_HEIGHT = EPISODE_HEIGHT + EPISODE_GAP;

// Episode card with spatial navigation
interface EpisodeCardProps {
  episode: {
    id: string;
    name: string;
    url?: string;
    episodeNumber?: number;
  };
  fullData: PlaylistItem | null;
  focusKey: string;
  onSelect: () => void;
  onArrowPress?: (direction: string) => boolean;
}

const EpisodeCard = memo(({ episode, fullData, focusKey, onSelect, onArrowPress }: EpisodeCardProps) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onArrowPress,
  });

  return (
    <button
      ref={ref}
      className={`${styles.episodeCard} ${focused ? styles.focused : ''}`}
      onClick={onSelect}
      tabIndex={-1}
      data-focused={focused}
    >
      <div className={styles.episodeNumber}>{episode.episodeNumber || '?'}</div>
      <div className={styles.episodeThumbnail}>
        {fullData?.logo ? (
          <img src={fullData.logo} alt={episode.name} />
        ) : (
          <div className={styles.thumbnailPlaceholder}>
            <MdPlayArrow size={32} />
          </div>
        )}
      </div>
      <div className={styles.episodeInfo}>
        <div className={styles.episodeTitle}>{episode.name}</div>
        <div className={styles.episodeMeta}>
          {fullData?.parsedTitle?.quality && <span>{fullData.parsedTitle.quality}</span>}
        </div>
      </div>
    </button>
  );
}, (prev, next) => prev.episode.id === next.episode.id && prev.focusKey === next.focusKey);

// Season button with spatial navigation for TV remotes
interface SeasonButtonProps {
  season: number;
  isSelected: boolean;
  focusKey: string;
  onSelect: () => void;
  onArrowPress?: (direction: string) => boolean;
}

const SeasonButton = memo(({ season, isSelected, focusKey, onSelect, onArrowPress }: SeasonButtonProps) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onArrowPress,
  });

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
    }
  }, [focused]);

  return (
    <button
      ref={ref}
      className={`${styles.seasonButton} ${isSelected ? styles.selected : ''} ${focused ? styles.focused : ''}`}
      onClick={onSelect}
      tabIndex={-1}
      data-focused={focused}
    >
      T{season}
    </button>
  );
}, (prev, next) => prev.season === next.season && prev.isSelected === next.isSelected);

interface SeriesDetailProps {
  onSelectItem: (item: PlaylistItem) => void;
}

export function SeriesDetail({ onSelectItem }: SeriesDetailProps) {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const hash = usePlaylistStore((s) => s.hash);
  const seriesCache = usePlaylistStore((s) => s.seriesCache);
  const setSeriesCache = usePlaylistStore((s) => s.setSeriesCache);

  // Page-level focus context
  const { ref: pageRef, focusKey: pageFocusKey } = useFocusable({
    focusKey: 'series-detail-page',
    isFocusBoundary: true,
    saveLastFocusedChild: true,
  });

  // Back button focus - simple version, navigation handled by handleBackArrowPress
  const { ref: backRef, focused: backFocused } = useFocusable({
    focusKey: 'series-back',
    onEnterPress: () => navigate('/home'),
  });

  const [series, setSeries] = useState<SeriesInfo | null>(null);
  const [episodes, setEpisodes] = useState<PlaylistItem[]>([]);
  const [seasonsData, setSeasonsData] = useState<SeasonData[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSeriesData() {
      if (!seriesId || !hash) {
        navigate('/home');
        return;
      }

      setLoading(true);

      try {
        // Get series info from cache or API
        let allSeries = seriesCache;
        if (!allSeries) {
          const res = await getSeries(hash);
          allSeries = res.series;
          setSeriesCache(allSeries);
        }

        // Find the specific series
        const seriesData = allSeries.find((s) => s.id === seriesId);
        if (!seriesData) {
          console.error('Série não encontrada:', seriesId);
          navigate('/home');
          return;
        }

        setSeries(seriesData);
        setSelectedSeason(seriesData.firstSeason || 1);

        // Check if series has pre-computed seasonsData
        if (seriesData.seasonsData && seriesData.seasonsData.length > 0) {
          setSeasonsData(seriesData.seasonsData);
          // We don't need to fetch episodes separately, seasonsData has them
        } else {
          // Fallback: load episodes from API
          const episodesRes = await getSeriesEpisodes(hash, seriesId, { limit: 500 });
          setEpisodes(episodesRes.episodes);
          if (episodesRes.seasonsData) {
            setSeasonsData(episodesRes.seasonsData);
          }
        }
      } catch (error) {
        console.error('Erro ao carregar série:', error);
        navigate('/home');
      } finally {
        setLoading(false);
      }
    }

    loadSeriesData();
  }, [seriesId, hash, navigate, seriesCache, setSeriesCache]);

  // Get episodes for selected season
  const currentSeasonEpisodes = (() => {
    // If we have seasonsData (pre-computed), use it
    if (seasonsData.length > 0) {
      const seasonInfo = seasonsData.find((s) => s.seasonNumber === selectedSeason);
      if (seasonInfo) {
        // Map SeriesEpisode to a display format
        return seasonInfo.episodes.map((ep) => ({
          id: ep.itemId,
          name: ep.name,
          episodeNumber: ep.episode,
          seasonNumber: ep.season,
          url: ep.url, // URL from backend seasonsData
          logo: undefined,
          group: '',
          mediaKind: 'series' as const,
        }));
      }
    }

    // Fallback: use episodes array
    return episodes.filter((ep) => ep.seasonNumber === selectedSeason);
  })();

  // Get available seasons
  const availableSeasons = (() => {
    if (seasonsData.length > 0) {
      return seasonsData.map((s) => s.seasonNumber).sort((a, b) => a - b);
    }
    // Fallback: extract from episodes
    const seasons = new Set(episodes.map((ep) => ep.seasonNumber || 1));
    return Array.from(seasons).sort((a, b) => a - b);
  })();

  // Handle season button navigation
  const handleSeasonArrowPress = useCallback((direction: string, seasonIndex: number) => {
    if (direction === 'left') {
      if (seasonIndex > 0) {
        setFocus(`series-season-${availableSeasons[seasonIndex - 1]}`);
      } else {
        // At first season - go to back button
        setFocus('series-back');
      }
      return false;
    }
    if (direction === 'right') {
      if (seasonIndex < availableSeasons.length - 1) {
        setFocus(`series-season-${availableSeasons[seasonIndex + 1]}`);
      }
      // Block at last season
      return false;
    }
    if (direction === 'down' && currentSeasonEpisodes.length > 0) {
      // Navigate to first episode
      setFocus(`series-ep-${currentSeasonEpisodes[0]?.id}`);
      return false;
    }
    if (direction === 'up') {
      // Navigate to back button
      setFocus('series-back');
      return false;
    }
    return true;
  }, [availableSeasons, currentSeasonEpisodes]);

  // Virtualized episode list
  const episodesContainerRef = useRef<HTMLDivElement>(null);

  const episodeVirtualizer = useVirtualizer({
    count: currentSeasonEpisodes.length,
    getScrollElement: () => episodesContainerRef.current,
    estimateSize: () => EPISODE_ROW_HEIGHT,
    overscan: 3,
  });

  // Handle episode navigation (scroll first, then focus for virtualization)
  const handleEpisodeArrowPress = useCallback((direction: string, index: number) => {
    if (direction === 'down') {
      if (index < currentSeasonEpisodes.length - 1) {
        const nextEpisode = currentSeasonEpisodes[index + 1];
        if (nextEpisode) {
          // Scroll first to ensure item is rendered
          episodeVirtualizer.scrollToIndex(index + 1, { align: 'center', behavior: 'auto' });
          setTimeout(() => {
            setFocus(`series-ep-${nextEpisode.id}`);
          }, 50);
        }
      }
      return false; // Block at last episode
    }
    if (direction === 'up') {
      if (index > 0) {
        const prevEpisode = currentSeasonEpisodes[index - 1];
        if (prevEpisode) {
          // Scroll first to ensure item is rendered
          episodeVirtualizer.scrollToIndex(index - 1, { align: 'center', behavior: 'auto' });
          setTimeout(() => {
            setFocus(`series-ep-${prevEpisode.id}`);
          }, 50);
        }
      } else {
        // At first episode, go to season buttons or back button
        if (availableSeasons.length > 1) {
          setFocus(`series-season-${selectedSeason}`);
        } else {
          setFocus('series-back');
        }
      }
      return false;
    }
    // Block horizontal navigation in episode list
    if (direction === 'left' || direction === 'right') {
      return false;
    }
    return true;
  }, [currentSeasonEpisodes, availableSeasons, selectedSeason, episodeVirtualizer]);

  // Build episode lookup for full data (when using seasonsData)
  const episodeLookup = new Map(episodes.map((ep) => [ep.id, ep]));

  // Get full episode data for playback
  const getFullEpisode = (episodeId: string): PlaylistItem | null => {
    return episodeLookup.get(episodeId) || null;
  };

  const handleEpisodeClick = async (episode: {
    id: string;
    name: string;
    url?: string;
    seasonNumber?: number;
    episodeNumber?: number;
  }) => {
    // If episode already has URL (from seasonsData), use it directly
    if (episode.url) {
      const playlistItem: PlaylistItem = {
        id: episode.id,
        name: episode.name,
        url: episode.url,
        group: series?.group || '',
        mediaKind: 'series',
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        seriesId: seriesId,
      };
      console.log('[SeriesDetail] Playing episode with URL from seasonsData:', episode.name);
      onSelectItem(playlistItem);
      return;
    }

    // Fallback: If we have the full episode data in lookup, use it
    let fullEpisode = episodeLookup.get(episode.id);

    if (!fullEpisode && hash) {
      // Fetch episode data if we don't have it
      try {
        const res = await getSeriesEpisodes(hash, seriesId!, { limit: 500 });
        const found = res.episodes.find((ep) => ep.id === episode.id);
        if (found) {
          fullEpisode = found;
          setEpisodes(res.episodes);
        }
      } catch (e) {
        console.error('Failed to fetch episode:', e);
      }
    }

    if (fullEpisode) {
      console.log('[SeriesDetail] Playing episode from lookup/API:', fullEpisode.name);
      onSelectItem(fullEpisode);
    } else {
      console.error('[SeriesDetail] Episode not found and no URL available:', episode.id);
    }
  };

  // Set initial focus when content loads
  useEffect(() => {
    if (!loading && currentSeasonEpisodes.length > 0) {
      // Focus first episode
      setFocus(`series-ep-${currentSeasonEpisodes[0]?.id}`);
    }
  }, [loading, selectedSeason, currentSeasonEpisodes.length]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Carregando...</div>
      </div>
    );
  }

  if (!series) {
    return null;
  }

  return (
    <FocusContext.Provider value={pageFocusKey}>
      <div ref={pageRef} className={styles.container}>
        {/* Header */}
        <div className={styles.header}>
          <button
            ref={backRef}
            className={`${styles.backButton} ${backFocused ? styles.focused : ''}`}
            onClick={() => navigate('/home')}
            data-focused={backFocused}
          >
            <MdArrowBack size={24} />
            <span>Voltar para Séries</span>
          </button>
        </div>

      {/* Series Info */}
      <div className={styles.seriesInfo}>
        <div className={styles.poster}>
          {series.logo ? (
            <img src={series.logo} alt={series.name} />
          ) : (
            <div className={styles.posterPlaceholder}>
              <MdPlayArrow size={64} />
            </div>
          )}
        </div>
        <div className={styles.metadata}>
          <h1 className={styles.title}>{series.name}</h1>
          <div className={styles.stats}>
            <span>
              {series.totalSeasons} {series.totalSeasons === 1 ? 'Temporada' : 'Temporadas'}
            </span>
            <span>•</span>
            <span>{series.totalEpisodes} Episódios</span>
            {series.year && (
              <>
                <span>•</span>
                <span>{series.year}</span>
              </>
            )}
            {series.quality && (
              <>
                <span>•</span>
                <span>{series.quality}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Season Selector - TV Remote Friendly */}
      {availableSeasons.length > 1 && (
        <div className={styles.seasonSelector}>
          <span className={styles.seasonLabel}>Temporada:</span>
          <div className={styles.seasonButtons}>
            {availableSeasons.map((season, index) => (
              <SeasonButton
                key={season}
                season={season}
                isSelected={season === selectedSeason}
                focusKey={`series-season-${season}`}
                onSelect={() => setSelectedSeason(season)}
                onArrowPress={(direction) => handleSeasonArrowPress(direction, index)}
              />
            ))}
          </div>
        </div>
      )}

        {/* Episodes List - Virtualized */}
        <div className={styles.episodesList}>
          <h2 className={styles.episodesTitle}>Episódios - Temporada {selectedSeason}</h2>
          {currentSeasonEpisodes.length === 0 ? (
            <div className={styles.noEpisodes}>Nenhum episódio encontrado para esta temporada.</div>
          ) : (
            <div
              ref={episodesContainerRef}
              className={styles.episodesVirtualized}
              style={{
                height: '500px', // Fixed height for virtualization
                overflow: 'auto',
              }}
            >
              <div
                style={{
                  height: `${episodeVirtualizer.getTotalSize()}px`,
                  width: '100%',
                  position: 'relative',
                }}
              >
                {episodeVirtualizer.getVirtualItems().map((virtualItem) => {
                  const episode = currentSeasonEpisodes[virtualItem.index];
                  if (!episode) return null;
                  return (
                    <div
                      key={episode.id}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: `${EPISODE_HEIGHT}px`,
                        transform: `translateY(${virtualItem.start}px)`,
                      }}
                    >
                      <EpisodeCard
                        episode={episode}
                        fullData={getFullEpisode(episode.id)}
                        focusKey={`series-ep-${episode.id}`}
                        onSelect={() => handleEpisodeClick(episode)}
                        onArrowPress={(dir) => handleEpisodeArrowPress(dir, virtualItem.index)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default SeriesDetail;
