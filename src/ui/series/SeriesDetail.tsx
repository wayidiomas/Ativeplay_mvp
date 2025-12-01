/**
 * Series Detail Page - Stateless version using Rust backend API
 * Página de detalhes de uma série com lista de episódios estilo Netflix
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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

interface SeriesDetailProps {
  onSelectItem: (item: PlaylistItem) => void;
}

export function SeriesDetail({ onSelectItem }: SeriesDetailProps) {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const hash = usePlaylistStore((s) => s.hash);
  const seriesCache = usePlaylistStore((s) => s.seriesCache);
  const setSeriesCache = usePlaylistStore((s) => s.setSeriesCache);

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

  // Build episode lookup for full data (when using seasonsData)
  const episodeLookup = new Map(episodes.map((ep) => [ep.id, ep]));

  // Get full episode data for playback
  const getFullEpisode = (episodeId: string): PlaylistItem | null => {
    return episodeLookup.get(episodeId) || null;
  };

  const handleEpisodeClick = async (episode: { id: string; name: string }) => {
    // If we have the full episode data, use it
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
      onSelectItem(fullEpisode);
    }
  };

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
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.backButton} onClick={() => navigate('/home')}>
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

      {/* Season Selector */}
      {availableSeasons.length > 1 && (
        <div className={styles.seasonSelector}>
          <label htmlFor="season-select">Temporada:</label>
          <select
            id="season-select"
            value={selectedSeason}
            onChange={(e) => setSelectedSeason(Number(e.target.value))}
            className={styles.seasonDropdown}
          >
            {availableSeasons.map((season) => (
              <option key={season} value={season}>
                Temporada {season}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Episodes List */}
      <div className={styles.episodesList}>
        <h2 className={styles.episodesTitle}>Episódios - Temporada {selectedSeason}</h2>
        {currentSeasonEpisodes.length === 0 ? (
          <div className={styles.noEpisodes}>Nenhum episódio encontrado para esta temporada.</div>
        ) : (
          <div className={styles.episodes}>
            {currentSeasonEpisodes.map((episode) => {
              const fullData = getFullEpisode(episode.id);
              return (
                <button
                  key={episode.id}
                  className={styles.episodeCard}
                  onClick={() => handleEpisodeClick(episode)}
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
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default SeriesDetail;
