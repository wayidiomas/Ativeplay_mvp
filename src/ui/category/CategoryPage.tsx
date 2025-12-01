/**
 * Category Page - Grid view of all items in a category with infinite scroll
 * For series groups, shows series cards; for others, shows item cards
 */

import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  MdArrowBack,
  MdMovie,
  MdTv,
  MdLiveTv,
  MdHelpOutline,
} from 'react-icons/md';
import {
  getItems,
  getSeries,
  type PlaylistItem,
  type SeriesInfo,
  type MediaKind,
} from '@core/services/api';
import { usePlaylistStore } from '@store/playlistStore';
import { PlayerContainer } from '@ui/player';
import styles from './CategoryPage.module.css';

const ITEMS_PER_PAGE = 50;

// ============================================================================
// Card Components
// ============================================================================

const ItemCard = memo(({ item, mediaKind, onSelect }: {
  item: PlaylistItem;
  mediaKind: MediaKind;
  onSelect: (item: PlaylistItem) => void;
}) => {
  const [imageError, setImageError] = useState(false);

  const getIcon = () => {
    switch (mediaKind) {
      case 'movie': return <MdMovie size={32} />;
      case 'series': return <MdTv size={32} />;
      case 'live': return <MdLiveTv size={32} />;
      default: return <MdHelpOutline size={32} />;
    }
  };

  return (
    <button
      className={styles.card}
      onClick={() => onSelect(item)}
      tabIndex={0}
    >
      {item.logo && !imageError ? (
        <img
          src={item.logo}
          alt={item.name}
          className={styles.poster}
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className={styles.placeholder}>
          {getIcon()}
        </div>
      )}
      <div className={styles.overlay}>
        <span className={styles.itemName}>
          {item.parsedTitle?.title || item.name}
        </span>
        {item.parsedTitle?.year && (
          <span className={styles.itemYear}>{item.parsedTitle.year}</span>
        )}
      </div>
    </button>
  );
}, (prev, next) => prev.item.id === next.item.id);

const SeriesCard = memo(({ series, onSelect }: {
  series: SeriesInfo;
  onSelect: (series: SeriesInfo) => void;
}) => {
  const [imageError, setImageError] = useState(false);

  return (
    <button
      className={styles.card}
      onClick={() => onSelect(series)}
      tabIndex={0}
    >
      {series.logo && !imageError ? (
        <img
          src={series.logo}
          alt={series.name}
          className={styles.poster}
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className={styles.placeholder}>
          <MdTv size={32} />
        </div>
      )}
      <div className={styles.overlay}>
        <span className={styles.itemName}>{series.name}</span>
        <span className={styles.itemYear}>
          {series.totalEpisodes} ep. {series.totalSeasons > 1 && `• ${series.totalSeasons} temp.`}
        </span>
      </div>
    </button>
  );
}, (prev, next) => prev.series.id === next.series.id);

// ============================================================================
// Main Component
// ============================================================================

export function CategoryPage() {
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const hash = usePlaylistStore((s) => s.hash);

  // Get group info from navigation state or decode from URL
  const groupName = location.state?.groupName || decodeURIComponent(groupId || '');
  const mediaKind: MediaKind = location.state?.mediaKind || 'unknown';
  const isSeries = mediaKind === 'series';

  // State for items (movies, live, unknown)
  const [items, setItems] = useState<PlaylistItem[]>([]);

  // State for series
  const [allSeries, setAllSeries] = useState<SeriesInfo[]>([]);
  const [displayedSeriesCount, setDisplayedSeriesCount] = useState(ITEMS_PER_PAGE);

  // State for player
  const [selectedItem, setSelectedItem] = useState<PlaylistItem | null>(null);

  // Common state
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);

  const observerRef = useRef<HTMLDivElement>(null);

  // Filter series by group (memoized)
  const filteredSeries = useMemo(() => {
    if (!isSeries) return [];
    return allSeries.filter(s => s.group === groupName);
  }, [allSeries, groupName, isSeries]);

  // Currently displayed series (paginated from filtered)
  const displayedSeries = useMemo(() => {
    return filteredSeries.slice(0, displayedSeriesCount);
  }, [filteredSeries, displayedSeriesCount]);

  // Load items (for non-series)
  const loadItems = useCallback(async (currentOffset: number, append = false) => {
    if (!hash || !groupName || isSeries) return;

    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const response = await getItems(hash, {
        group: groupName,
        limit: ITEMS_PER_PAGE,
        offset: currentOffset,
      });

      if (append) {
        setItems(prev => [...prev, ...response.items]);
      } else {
        setItems(response.items);
      }

      setTotal(response.total);
      setHasMore(currentOffset + response.items.length < response.total);
      setOffset(currentOffset + response.items.length);
    } catch (error) {
      console.error('[CategoryPage] Failed to load items:', error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [hash, groupName, isSeries]);

  // Load series (for series groups)
  const loadSeries = useCallback(async () => {
    if (!hash || !isSeries) return;

    try {
      setLoading(true);
      const response = await getSeries(hash);
      setAllSeries(response.series);
    } catch (error) {
      console.error('[CategoryPage] Failed to load series:', error);
    } finally {
      setLoading(false);
    }
  }, [hash, isSeries]);

  // Update total and hasMore when filteredSeries changes
  useEffect(() => {
    if (isSeries && filteredSeries.length > 0) {
      setTotal(filteredSeries.length);
      setHasMore(displayedSeriesCount < filteredSeries.length);
    }
  }, [isSeries, filteredSeries.length, displayedSeriesCount]);

  // Initial load
  useEffect(() => {
    if (isSeries) {
      loadSeries();
    } else {
      loadItems(0);
    }
  }, [isSeries, loadSeries, loadItems]);

  // Load more series (client-side pagination)
  const loadMoreSeries = useCallback(() => {
    if (!isSeries || loadingMore) return;

    setLoadingMore(true);
    // Small delay to show loading state
    setTimeout(() => {
      setDisplayedSeriesCount(prev => {
        const newCount = prev + ITEMS_PER_PAGE;
        setHasMore(newCount < filteredSeries.length);
        return newCount;
      });
      setLoadingMore(false);
    }, 100);
  }, [isSeries, loadingMore, filteredSeries.length]);

  // Infinite scroll with IntersectionObserver
  useEffect(() => {
    if (!hasMore || loadingMore || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (isSeries) {
            loadMoreSeries();
          } else {
            loadItems(offset, true);
          }
        }
      },
      { threshold: 0.1 }
    );

    if (observerRef.current) {
      observer.observe(observerRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, loadingMore, loading, offset, loadItems, isSeries, loadMoreSeries]);

  // Navigate back
  const handleBack = useCallback(() => {
    navigate(-1);
  }, [navigate]);

  // Handle item selection - open player inline
  const handleSelectItem = useCallback((item: PlaylistItem) => {
    if (item.seriesId) {
      navigate(`/series/${item.seriesId}`);
      return;
    }
    // Open player inline instead of navigating
    console.log('[CategoryPage] Selected item:', item.name, item.url);
    setSelectedItem(item);
  }, [navigate]);

  // Handle player close
  const handleClosePlayer = useCallback(() => {
    setSelectedItem(null);
  }, []);

  // Handle series selection
  const handleSelectSeries = useCallback((series: SeriesInfo) => {
    navigate(`/series/${series.id}`);
  }, [navigate]);

  // Get icon for header
  const getHeaderIcon = () => {
    switch (mediaKind) {
      case 'movie': return <MdMovie size={24} />;
      case 'series': return <MdTv size={24} />;
      case 'live': return <MdLiveTv size={24} />;
      default: return <MdHelpOutline size={24} />;
    }
  };

  // Redirect if no hash
  useEffect(() => {
    if (!hash) {
      navigate('/', { replace: true });
    }
  }, [hash, navigate]);

  // Determine what to display
  const displayItems = isSeries ? displayedSeries : items;
  const isEmpty = displayItems.length === 0;

  // If an item is selected, show the player
  if (selectedItem) {
    return (
      <PlayerContainer
        url={selectedItem.url}
        title={selectedItem.parsedTitle?.title || selectedItem.name}
        onClose={handleClosePlayer}
        onEnded={handleClosePlayer}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={handleBack}>
          <MdArrowBack size={20} />
        </button>
        <div className={styles.titleArea}>
          {getHeaderIcon()}
          <h1>{groupName}</h1>
          <span className={styles.count}>
            ({total.toLocaleString()} {isSeries ? 'séries' : 'items'})
          </span>
        </div>
      </header>

      <main className={styles.main}>
        {loading ? (
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <span>Carregando...</span>
          </div>
        ) : isEmpty ? (
          <div className={styles.empty}>
            <MdHelpOutline size={64} />
            <p>Nenhum item encontrado</p>
          </div>
        ) : (
          <>
            <div className={styles.grid}>
              {isSeries ? (
                displayedSeries.map((series) => (
                  <SeriesCard
                    key={series.id}
                    series={series}
                    onSelect={handleSelectSeries}
                  />
                ))
              ) : (
                items.map((item) => (
                  <ItemCard
                    key={item.id}
                    item={item}
                    mediaKind={mediaKind}
                    onSelect={handleSelectItem}
                  />
                ))
              )}
            </div>

            {/* Infinite scroll trigger */}
            {hasMore && (
              <div ref={observerRef} className={styles.loadingMore}>
                {loadingMore && (
                  <>
                    <div className={styles.spinner} />
                    <span>Carregando mais...</span>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

export default CategoryPage;
