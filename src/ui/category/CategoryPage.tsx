/**
 * Category Page - Grid view of all items in a category with virtualized scroll
 * For series groups, shows series cards; for others, shows item cards
 *
 * Uses VirtualizedGrid for efficient TV remote navigation.
 */

import { useState, useEffect, useCallback, memo, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
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
import { VirtualizedGrid } from '@ui/shared/VirtualizedGrid';
import styles from './CategoryPage.module.css';

const ITEMS_PER_PAGE = 50;

// ============================================================================
// Card Content Components (focus handled by VirtualizedGrid)
// ============================================================================

/**
 * Helper to get icon based on media kind
 */
const getMediaIcon = (mediaKind: MediaKind) => {
  switch (mediaKind) {
    case 'movie': return <MdMovie size={32} />;
    case 'series': return <MdTv size={32} />;
    case 'live': return <MdLiveTv size={32} />;
    default: return <MdHelpOutline size={32} />;
  }
};

/**
 * ItemCardContent - Pure visual component for item cards
 * Focus state is passed from VirtualizedGrid wrapper
 */
const ItemCardContent = memo(({ item, mediaKind, isFocused }: {
  item: PlaylistItem;
  mediaKind: MediaKind;
  isFocused: boolean;
}) => {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className={`${styles.card} ${isFocused ? styles.focused : ''}`}
      data-focused={isFocused}
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
          {getMediaIcon(mediaKind)}
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
    </div>
  );
}, (prev, next) => prev.item.id === next.item.id && prev.isFocused === next.isFocused);

/**
 * SeriesCardContent - Pure visual component for series cards
 * Focus state is passed from VirtualizedGrid wrapper
 */
const SeriesCardContent = memo(({ series, isFocused }: {
  series: SeriesInfo;
  isFocused: boolean;
}) => {
  const [imageError, setImageError] = useState(false);

  return (
    <div
      className={`${styles.card} ${isFocused ? styles.focused : ''}`}
      data-focused={isFocused}
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
    </div>
  );
}, (prev, next) => prev.series.id === next.series.id && prev.isFocused === next.isFocused);

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

  // Page-level focus context
  const { ref: pageRef, focusKey: pageFocusKey } = useFocusable({
    focusKey: 'category-page',
    isFocusBoundary: true,
    saveLastFocusedChild: true,
  });

  // Back button focus
  const { ref: backRef, focused: backFocused } = useFocusable({
    focusKey: 'category-back',
    onEnterPress: () => navigate(-1),
  });

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

  // Set initial focus when content loads
  useEffect(() => {
    if (!loading && displayItems.length > 0) {
      // Focus first card in grid
      const firstItem = isSeries ? displayedSeries[0] : items[0];
      if (firstItem) {
        setFocus(`category-grid-item-${firstItem.id}`);
      }
    }
  }, [loading, displayItems.length, isSeries]);

  // If an item is selected, show the player
  if (selectedItem) {
    return (
      <PlayerContainer
        url={selectedItem.url}
        title={selectedItem.parsedTitle?.title || selectedItem.name}
        isLive={selectedItem.mediaKind === 'live'}
        onClose={handleClosePlayer}
        onEnded={handleClosePlayer}
      />
    );
  }

  return (
    <FocusContext.Provider value={pageFocusKey}>
      <div ref={pageRef} className={styles.page}>
        <header className={styles.header}>
          <button
            ref={backRef}
            className={`${styles.backButton} ${backFocused ? styles.focused : ''}`}
            onClick={handleBack}
            data-focused={backFocused}
          >
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
          ) : isSeries ? (
            <VirtualizedGrid
              focusKey="category-grid"
              items={displayedSeries}
              hasMore={hasMore}
              isLoading={loadingMore}
              onLoadMore={loadMoreSeries}
              getItemKey={(series) => series.id}
              renderItem={(series, _index, _focusKey, isFocused) => (
                <SeriesCardContent series={series} isFocused={isFocused} />
              )}
              onItemSelect={(series) => handleSelectSeries(series)}
              columnCount={4}
              cardWidth={240}
              cardHeight={360}
              cardGap={20}
              className={styles.gridContainer}
            />
          ) : (
            <VirtualizedGrid
              focusKey="category-grid"
              items={items}
              hasMore={hasMore}
              isLoading={loadingMore}
              onLoadMore={() => loadItems(offset, true)}
              getItemKey={(item) => item.id}
              renderItem={(item, _index, _focusKey, isFocused) => (
                <ItemCardContent item={item} mediaKind={mediaKind} isFocused={isFocused} />
              )}
              onItemSelect={(item) => handleSelectItem(item)}
              columnCount={4}
              cardWidth={240}
              cardHeight={360}
              cardGap={20}
              className={styles.gridContainer}
            />
          )}
        </main>
      </div>
    </FocusContext.Provider>
  );
}

export default CategoryPage;
