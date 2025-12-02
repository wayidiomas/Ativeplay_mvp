/**
 * Movie Detail Page - Rich metadata display for VOD content
 * Shows plot, cast, directors, genres, rating, duration and trailer
 * Supports D-PAD navigation for TV remotes
 */

import { useEffect, useState, memo, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { usePlaylistStore } from '@store/playlistStore';
import {
  type PlaylistItem,
  type XtreamVodInfo,
} from '@core/services/api';
import {
  MdArrowBack,
  MdPlayArrow,
  MdStar,
  MdAccessTime,
  MdCalendarToday,
  MdMovie,
} from 'react-icons/md';
import { FaYoutube } from 'react-icons/fa';
import styles from './MovieDetail.module.css';

// ============================================================================
// Focusable Button Components
// ============================================================================

interface ActionButtonProps {
  focusKey: string;
  icon: React.ReactNode;
  label: string;
  variant?: 'primary' | 'secondary';
  onPress: () => void;
  onArrowPress?: (direction: string) => boolean;
  disabled?: boolean;
}

const ActionButton = memo(function ActionButton({
  focusKey,
  icon,
  label,
  variant = 'secondary',
  onPress,
  onArrowPress,
  disabled = false,
}: ActionButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress,
    focusable: !disabled,
  });

  return (
    <button
      ref={ref}
      className={`${styles.actionButton} ${styles[variant]} ${focused ? styles.focused : ''}`}
      onClick={onPress}
      tabIndex={-1}
      data-focused={focused}
      disabled={disabled}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

// ============================================================================
// YouTube Trailer Modal
// ============================================================================

interface TrailerModalProps {
  youtubeId: string;
  onClose: () => void;
}

const TrailerModal = memo(function TrailerModal({ youtubeId, onClose }: TrailerModalProps) {
  const { ref, focused } = useFocusable({
    focusKey: 'trailer-close',
    onEnterPress: onClose,
  });

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Focus close button on mount
  useEffect(() => {
    setFocus('trailer-close');
  }, []);

  return (
    <div className={styles.trailerModal} onClick={onClose}>
      <div className={styles.trailerContent} onClick={(e) => e.stopPropagation()}>
        <button
          ref={ref}
          className={`${styles.trailerClose} ${focused ? styles.focused : ''}`}
          onClick={onClose}
          data-focused={focused}
        >
          &times;
        </button>
        <iframe
          className={styles.trailerIframe}
          src={`https://www.youtube.com/embed/${youtubeId}?autoplay=1&rel=0`}
          title="Trailer"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
        />
      </div>
    </div>
  );
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Format duration from seconds to "Xh Ym" format
 */
function formatDuration(seconds?: number): string {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}min`;
  }
  return `${minutes}min`;
}

/**
 * Extract YouTube video ID from various URL formats
 */
function extractYoutubeId(url?: string): string | null {
  if (!url) return null;

  // Already just an ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  // Full YouTube URL patterns
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

// ============================================================================
// Main Component
// ============================================================================

interface MovieDetailProps {
  onPlay: (item: PlaylistItem) => void;
}

export function MovieDetail({ onPlay }: MovieDetailProps) {
  const { movieId } = useParams<{ movieId: string }>();
  const navigate = useNavigate();

  // Store
  const isXtream = usePlaylistStore((s) => s.isXtream);
  const getXtreamClient = usePlaylistStore((s) => s.getXtreamClient);

  // State
  const [vodInfo, setVodInfo] = useState<XtreamVodInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showTrailer, setShowTrailer] = useState(false);

  // Page focus context
  const { ref: pageRef, focusKey: pageFocusKey } = useFocusable({
    focusKey: 'movie-detail-page',
    isFocusBoundary: true,
    saveLastFocusedChild: true,
  });

  // Back button
  const { ref: backRef, focused: backFocused } = useFocusable({
    focusKey: 'movie-back',
    onEnterPress: () => navigate(-1),
  });

  // Load movie info
  useEffect(() => {
    async function loadMovieData() {
      if (!movieId) {
        navigate('/home');
        return;
      }

      if (!isXtream()) {
        setError('VOD details only available for Xtream playlists');
        setLoading(false);
        return;
      }

      const client = getXtreamClient();
      if (!client) {
        setError('Xtream client not available');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);

        console.log('[MovieDetail] Loading VOD info:', movieId);
        const info = await client.getVodInfo(movieId);
        setVodInfo(info);

      } catch (err) {
        console.error('[MovieDetail] Failed to load VOD info:', err);
        setError('Failed to load movie details');
      } finally {
        setLoading(false);
      }
    }

    loadMovieData();
  }, [movieId, navigate, isXtream, getXtreamClient]);

  // Handle play
  const handlePlay = useCallback(async () => {
    if (!vodInfo || !movieId) return;

    const client = getXtreamClient();
    if (!client) return;

    try {
      const playUrl = await client.getPlayUrl(
        vodInfo.streamId,
        'vod',
        vodInfo.containerExtension || 'mp4'
      );

      const item: PlaylistItem = {
        id: movieId,
        name: vodInfo.name || vodInfo.title || 'Unknown',
        url: playUrl,
        logo: vodInfo.cover,
        group: '',
        mediaKind: 'movie',
        xtreamId: vodInfo.streamId,
        xtreamExtension: vodInfo.containerExtension,
        xtreamMediaType: 'vod',
      };

      onPlay(item);
    } catch (err) {
      console.error('[MovieDetail] Failed to get play URL:', err);
    }
  }, [vodInfo, movieId, getXtreamClient, onPlay]);

  // Handle trailer
  const handleTrailer = useCallback(() => {
    const youtubeId = extractYoutubeId(vodInfo?.youtubeTrailer);
    if (youtubeId) {
      setShowTrailer(true);
    }
  }, [vodInfo?.youtubeTrailer]);

  // Navigation handlers
  const handlePlayArrowPress = useCallback((direction: string): boolean => {
    if (direction === 'up') {
      setFocus('movie-back');
      return false;
    }
    if (direction === 'right' && extractYoutubeId(vodInfo?.youtubeTrailer)) {
      setFocus('movie-trailer');
      return false;
    }
    return false;
  }, [vodInfo?.youtubeTrailer]);

  const handleTrailerArrowPress = useCallback((direction: string): boolean => {
    if (direction === 'up') {
      setFocus('movie-back');
      return false;
    }
    if (direction === 'left') {
      setFocus('movie-play');
      return false;
    }
    return false;
  }, []);

  // Set initial focus
  useEffect(() => {
    if (!loading && vodInfo) {
      setFocus('movie-play');
    }
  }, [loading, vodInfo]);

  // Derived values
  const youtubeId = extractYoutubeId(vodInfo?.youtubeTrailer);
  const hasTrailer = !!youtubeId;

  // Loading state
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Carregando detalhes...</span>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !vodInfo) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <MdMovie size={48} />
          <p>{error || 'Movie not found'}</p>
          <button onClick={() => navigate(-1)}>Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <FocusContext.Provider value={pageFocusKey}>
      <div ref={pageRef} className={styles.container}>
        {/* Backdrop */}
        {vodInfo.backdrop && vodInfo.backdrop.length > 0 && (
          <div
            className={styles.backdrop}
            style={{ backgroundImage: `url(${vodInfo.backdrop[0]})` }}
          />
        )}

        <div className={styles.content}>
          {/* Header */}
          <div className={styles.header}>
            <button
              ref={backRef}
              className={`${styles.backButton} ${backFocused ? styles.focused : ''}`}
              onClick={() => navigate(-1)}
              data-focused={backFocused}
            >
              <MdArrowBack size={24} />
              <span>Voltar</span>
            </button>
          </div>

          {/* Movie Info */}
          <div className={styles.movieInfo}>
            {/* Poster */}
            <div className={styles.poster}>
              {vodInfo.cover ? (
                <img src={vodInfo.cover} alt={vodInfo.name} />
              ) : (
                <div className={styles.posterPlaceholder}>
                  <MdMovie size={64} />
                </div>
              )}
            </div>

            {/* Metadata */}
            <div className={styles.metadata}>
              <h1 className={styles.title}>{vodInfo.name || vodInfo.title}</h1>

              {/* Stats row */}
              <div className={styles.stats}>
                {vodInfo.rating && (
                  <span className={styles.rating}>
                    <MdStar className={styles.starIcon} />
                    {vodInfo.rating.toFixed(1)}
                  </span>
                )}
                {vodInfo.year && (
                  <span className={styles.stat}>
                    <MdCalendarToday />
                    {vodInfo.year}
                  </span>
                )}
                {vodInfo.durationSecs && (
                  <span className={styles.stat}>
                    <MdAccessTime />
                    {formatDuration(vodInfo.durationSecs)}
                  </span>
                )}
              </div>

              {/* Genres */}
              {vodInfo.genres && vodInfo.genres.length > 0 && (
                <div className={styles.genres}>
                  {vodInfo.genres.map((genre, idx) => (
                    <span key={idx} className={styles.genre}>{genre}</span>
                  ))}
                </div>
              )}

              {/* Plot */}
              {vodInfo.plot && (
                <p className={styles.plot}>{vodInfo.plot}</p>
              )}

              {/* Credits */}
              <div className={styles.credits}>
                {vodInfo.directors && vodInfo.directors.length > 0 && (
                  <div className={styles.creditRow}>
                    <span className={styles.creditLabel}>Diretor:</span>
                    <span className={styles.creditValue}>
                      {vodInfo.directors.join(', ')}
                    </span>
                  </div>
                )}
                {vodInfo.cast && vodInfo.cast.length > 0 && (
                  <div className={styles.creditRow}>
                    <span className={styles.creditLabel}>Elenco:</span>
                    <span className={styles.creditValue}>
                      {vodInfo.cast.slice(0, 5).join(', ')}
                      {vodInfo.cast.length > 5 && '...'}
                    </span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className={styles.actions}>
                <ActionButton
                  focusKey="movie-play"
                  icon={<MdPlayArrow size={24} />}
                  label="Assistir"
                  variant="primary"
                  onPress={handlePlay}
                  onArrowPress={handlePlayArrowPress}
                />

                {hasTrailer && (
                  <ActionButton
                    focusKey="movie-trailer"
                    icon={<FaYoutube size={20} />}
                    label="Trailer"
                    variant="secondary"
                    onPress={handleTrailer}
                    onArrowPress={handleTrailerArrowPress}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Trailer Modal */}
        {showTrailer && youtubeId && (
          <TrailerModal
            youtubeId={youtubeId}
            onClose={() => {
              setShowTrailer(false);
              setFocus('movie-trailer');
            }}
          />
        )}
      </div>
    </FocusContext.Provider>
  );
}

export default MovieDetail;
