/**
 * Series Detail Page
 * Página de detalhes de uma série com lista de episódios estilo Netflix
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getSeriesById, getEpisodesBySeries, type Series, type M3UItem } from '@core/db/schema';
import { MdArrowBack, MdPlayArrow } from 'react-icons/md';
import styles from './SeriesDetail.module.css';

interface SeriesDetailProps {
  onSelectItem: (item: M3UItem) => void;
}

export function SeriesDetail({ onSelectItem }: SeriesDetailProps) {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();

  const [series, setSeries] = useState<Series | null>(null);
  const [episodes, setEpisodes] = useState<M3UItem[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadSeriesData() {
      if (!seriesId) {
        navigate('/home');
        return;
      }

      setLoading(true);

      try {
        // Carrega dados da série
        const seriesData = await getSeriesById(seriesId);
        if (!seriesData) {
          console.error('Série não encontrada:', seriesId);
          navigate('/home');
          return;
        }

        setSeries(seriesData);
        setSelectedSeason(seriesData.firstSeason || 1);

        // Carrega todos os episódios
        const allEpisodes = await getEpisodesBySeries(seriesId);
        setEpisodes(allEpisodes);
      } catch (error) {
        console.error('Erro ao carregar série:', error);
        navigate('/home');
      } finally {
        setLoading(false);
      }
    }

    loadSeriesData();
  }, [seriesId, navigate]);

  // Agrupa episódios por temporada
  const episodesBySeason = episodes.reduce((acc, episode) => {
    const season = episode.seasonNumber || 1;
    if (!acc[season]) {
      acc[season] = [];
    }
    acc[season].push(episode);
    return acc;
  }, {} as Record<number, M3UItem[]>);

  // Episódios da temporada selecionada
  const currentSeasonEpisodes = episodesBySeason[selectedSeason] || [];

  // Lista de temporadas disponíveis
  const availableSeasons = Object.keys(episodesBySeason)
    .map(Number)
    .sort((a, b) => a - b);

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
            <span>{series.totalSeasons} {series.totalSeasons === 1 ? 'Temporada' : 'Temporadas'}</span>
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
        <h2 className={styles.episodesTitle}>
          Episódios - Temporada {selectedSeason}
        </h2>
        {currentSeasonEpisodes.length === 0 ? (
          <div className={styles.noEpisodes}>
            Nenhum episódio encontrado para esta temporada.
          </div>
        ) : (
          <div className={styles.episodes}>
            {currentSeasonEpisodes.map((episode) => (
              <button
                key={episode.id}
                className={styles.episodeCard}
                onClick={() => onSelectItem(episode)}
              >
                <div className={styles.episodeNumber}>
                  {episode.episodeNumber || '?'}
                </div>
                <div className={styles.episodeThumbnail}>
                  {episode.logo ? (
                    <img src={episode.logo} alt={episode.name} />
                  ) : (
                    <div className={styles.thumbnailPlaceholder}>
                      <MdPlayArrow size={32} />
                    </div>
                  )}
                </div>
                <div className={styles.episodeInfo}>
                  <div className={styles.episodeTitle}>
                    {episode.title || episode.name}
                  </div>
                  <div className={styles.episodeMeta}>
                    {episode.quality && <span>{episode.quality}</span>}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SeriesDetail;
