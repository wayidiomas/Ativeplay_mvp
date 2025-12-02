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
  normalizeXtreamCategories,
  normalizeXtreamStreams,
  type PlaylistItem,
  type SeriesInfo,
  type MediaKind,
} from '@core/services/api';
import { usePlaylistStore } from '@store/playlistStore';

import { PlayerContainer } from '@ui/player';
import { VirtualizedGrid } from '@ui/shared/VirtualizedGrid';
import styles from './CategoryPage.module.css';

// Map MediaKind to Xtream media type
const mediaKindToXtreamType = (kind: MediaKind): 'live' | 'vod' | 'series' | undefined => {
  switch (kind) {
    case 'live': return 'live';
    case 'movie': return 'vod';
    case 'series': return 'series';
    default: return undefined;
  }
};

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
  // Xtream support
  const isXtream = usePlaylistStore((s) => s.isXtream);
  const getXtreamClient = usePlaylistStore((s) => s.getXtreamClient);

  // Get group info from navigation state or decode from URL
  const groupName = location.state?.groupName || decodeURIComponent(groupId || '');
  const mediaKind: MediaKind = location.state?.mediaKind || 'unknown';
  const isSeries = mediaKind === 'series';
  // Xtream category ID (for filtering by category)
  const xtreamCategoryId = location.state?.xtreamCategoryId;

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
  // Xtream: resolved category name (in case groupName is missing from state)
  const [resolvedCategoryName, setResolvedCategoryName] = useState<string | null>(null);


  // Filter series by group (memoized)
  // Note: For Xtream mode, series are already filtered by category_id in the API call
  const filteredSeries = useMemo(() => {
    if (!isSeries) return [];
    // Xtream mode: data is already filtered by category_id, no need to filter again
    if (isXtream()) return allSeries;
    // M3U mode: filter by group name
    return allSeries.filter(s => s.group === groupName);
  }, [allSeries, groupName, isSeries, isXtream]);

  // Currently displayed series (paginated from filtered)
  const displayedSeries = useMemo(() => {
    return filteredSeries.slice(0, displayedSeriesCount);
  }, [filteredSeries, displayedSeriesCount]);

  // Load items (for non-series)
  const loadItems = useCallback(async (currentOffset: number, append = false) => {
    if (isSeries) return;

    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      // =========================================================================
      // XTREAM MODE: Load from Xtream API with category filter
      // =========================================================================
      if (isXtream()) {
        const xtreamClient = getXtreamClient();
        if (!xtreamClient) {
          console.error('[CategoryPage] Xtream client not available');
          setLoading(false);
          return;
        }

        const xtreamMediaType = mediaKindToXtreamType(mediaKind);
        let streams: any[] = [];
        let categories: any[] = [];

        // Fetch streams and categories by media type
        if (xtreamMediaType === 'live') {
          [streams, categories] = await Promise.all([
            xtreamClient.getLiveStreams(xtreamCategoryId),
            xtreamClient.getLiveCategories(),
          ]);
        } else if (xtreamMediaType === 'vod') {
          [streams, categories] = await Promise.all([
            xtreamClient.getVodStreams(xtreamCategoryId),
            xtreamClient.getVodCategories(),
          ]);
        }

        // Resolve category name from categories list if needed
        if (xtreamCategoryId && categories.length > 0) {
          const normalizedCategories = normalizeXtreamCategories(categories, mediaKind);
          const matchingCategory = normalizedCategories.find(c => c.id === xtreamCategoryId);
          if (matchingCategory) {
            setResolvedCategoryName(matchingCategory.name);
          }
        }

        // Normalize to PlaylistItem format
        const normalizedItems = normalizeXtreamStreams(streams, xtreamMediaType || 'live');

        // Xtream doesn't support pagination, so we load all at once
        setItems(normalizedItems);
        setTotal(normalizedItems.length);
        setHasMore(false);
        setOffset(normalizedItems.length);
        return;
      }

      // =========================================================================
      // M3U MODE: Load from backend database
      // =========================================================================
      if (!hash || !groupName) return;

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
  }, [hash, groupName, isSeries, isXtream, getXtreamClient, mediaKind, xtreamCategoryId]);

  // Load series (for series groups)
  const loadSeries = useCallback(async () => {
    if (!isSeries) return;

    try {
      setLoading(true);

      // =========================================================================
      // XTREAM MODE: Load series from Xtream API
      // =========================================================================
      if (isXtream()) {
        const xtreamClient = getXtreamClient();
        if (!xtreamClient) {
          console.error('[CategoryPage] Xtream client not available');
          setLoading(false);
          return;
        }

        // Fetch series and categories in parallel
        const [streams, categories] = await Promise.all([
          xtreamClient.getSeries(xtreamCategoryId),
          xtreamClient.getSeriesCategories(),
        ]);

        // Resolve category name from categories list if needed
        if (xtreamCategoryId && categories.length > 0) {
          const normalizedCategories = normalizeXtreamCategories(categories, mediaKind);
          const matchingCategory = normalizedCategories.find(c => c.id === xtreamCategoryId);
          if (matchingCategory) {
            setResolvedCategoryName(matchingCategory.name);
          }
        }

        // Normalize to SeriesInfo format
        const normalizedSeries: SeriesInfo[] = streams.map((s: any) => ({
          id: String(s.seriesId),
          name: s.name,
          logo: s.cover,
          group: resolvedCategoryName || groupName,
          totalEpisodes: 0, // Not available until we call getSeriesInfo
          totalSeasons: 0,
          firstSeason: 1,
          lastSeason: 1,
        }));

        setAllSeries(normalizedSeries);
        return;
      }

      // =========================================================================
      // M3U MODE: Load from backend database
      // =========================================================================
      if (!hash) return;

      const response = await getSeries(hash);
      setAllSeries(response.series);
    } catch (error) {
      console.error('[CategoryPage] Failed to load series:', error);
    } finally {
      setLoading(false);
    }
  }, [hash, isSeries, isXtream, getXtreamClient, xtreamCategoryId, groupName]);

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
  const handleSelectItem = useCallback(async (item: PlaylistItem) => {
    if (item.seriesId) {
      navigate(`/series/${item.seriesId}`);
      return;
    }

    // =========================================================================
    // XTREAM MODE: Fetch play URL from Xtream API
    // =========================================================================
    if (item.xtreamId && item.xtreamMediaType && isXtream()) {
      const xtreamClient = getXtreamClient();
      if (xtreamClient) {
        try {
          console.log('[CategoryPage] Fetching Xtream play URL for:', item.name);
          const playUrl = await xtreamClient.getPlayUrl(
            item.xtreamId,
            item.xtreamMediaType,
            item.xtreamExtension
          );
          setSelectedItem({ ...item, url: playUrl });
          return;
        } catch (err) {
          console.error('[CategoryPage] Failed to get Xtream play URL:', err);
        }
      }
    }

    // M3U MODE: Use URL directly
    console.log('[CategoryPage] Selected item:', item.name, item.url);
    setSelectedItem(item);
  }, [navigate, isXtream, getXtreamClient]);

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
  }, [loading, displayItems.length, isSeries, displayedSeries, items]);

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
            <h1>{resolvedCategoryName || groupName}</h1>
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
