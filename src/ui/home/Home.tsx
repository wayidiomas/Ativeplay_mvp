/**
 * Home Screen - Stateless version using Rust backend API
 * All data comes from backend - no IndexedDB/Dexie
 *
 * Uses VirtualizedCarousel for efficient TV remote navigation.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { usePlaylistStore } from '@store/playlistStore';
import {
  getGroups,
  getSeries,
  getItems,
  searchItems,
  getParseStatus,
  normalizeXtreamCategories,
  normalizeXtreamStreams,
  normalizeXtreamSeriesToSeriesInfo,
  type PlaylistGroup,
  type PlaylistItem,
  type SeriesInfo,
  type MediaKind,
  type XtreamStreamItem,
} from '@core/services/api';
import {
  MdMovie,
  MdTv,
  MdLiveTv,
  MdSearch,
  MdExitToApp,
  MdNavigateNext,
  MdHelpOutline,
  MdErrorOutline,
} from 'react-icons/md';
import { SkeletonCard } from '@ui/shared';
import { VirtualizedCarousel } from '@ui/shared/VirtualizedCarousel';
import { PlayerContainer } from '@ui/player';
import styles from './Home.module.css';

type NavItem = 'movies' | 'series' | 'live';

const ITEMS_PER_GROUP = 4; // Mostrar 4 cards por linha para um carrossel mais limpo
const CARD_WIDTH = 260; // Cartas maiores para ocupar melhor o espaço
const CARD_GAP = 18;
const CAROUSEL_HEIGHT = 400;

interface Row {
  group: PlaylistGroup;
  items: PlaylistItem[];
  series?: SeriesInfo[];
  isSeries?: boolean;
  hasMore?: boolean;
}

// ============================================================================
// Card Content Components (focus handled by VirtualizedCarousel)
// ============================================================================

/**
 * MediaCardContent - Pure visual component for media items
 * Focus state is passed from VirtualizedCarousel wrapper
 */
const MediaCardContent = memo(({ item, isFocused }: {
  item: PlaylistItem;
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
          className={styles.cardPoster}
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className={styles.cardPlaceholder}>
          {item.mediaKind === 'live' ? <MdLiveTv size={32} /> : <MdMovie size={32} />}
        </div>
      )}
      <div className={styles.cardOverlay}>
        <div className={styles.cardTitle}>{item.parsedTitle?.title || item.name}</div>
        <div className={styles.cardMeta}>
          {item.parsedTitle?.year && <span>{item.parsedTitle.year}</span>}
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.item.id === next.item.id && prev.isFocused === next.isFocused);

/**
 * SeriesCardContent - Pure visual component for series items
 * Focus state is passed from VirtualizedCarousel wrapper
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
          className={styles.cardPoster}
          loading="lazy"
          onError={() => setImageError(true)}
        />
      ) : (
        <div className={styles.cardPlaceholder}>
          <MdTv size={32} />
        </div>
      )}
      <div className={styles.cardOverlay}>
        <div className={styles.cardTitle}>{series.name}</div>
        <div className={styles.cardMeta}>
          <span>{series.totalEpisodes} ep.</span>
          {series.totalSeasons > 1 && <span>{series.totalSeasons} temp.</span>}
        </div>
      </div>
    </div>
  );
}, (prev, next) => prev.series.id === next.series.id && prev.isFocused === next.isFocused);

/**
 * FocusableSection - Wrapper that groups header + carousel for proper focus tree
 * This ensures vertical navigation goes to carousels, not headers
 */
const FocusableSection = memo(({ focusKey, carouselFocusKey, className, children }: {
  focusKey: string;
  carouselFocusKey: string;
  className?: string;
  children: React.ReactNode;
}) => {
  const { ref, focusKey: currentFocusKey } = useFocusable({
    focusKey,
    isFocusBoundary: false,
    saveLastFocusedChild: true,
    preferredChildFocusKey: carouselFocusKey,
  });

  return (
    <FocusContext.Provider value={currentFocusKey}>
      <div ref={ref} className={className}>
        {children}
      </div>
    </FocusContext.Provider>
  );
});

/**
 * FocusableSectionHeader - Section header with "Ver tudo" button for TV remote
 */
const FocusableSectionHeader = memo(({ title, focusKey, onSeeAll, onArrowUp }: {
  title: string;
  focusKey: string;
  onSeeAll: () => void;
  onArrowUp?: () => void;
}) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSeeAll,
    onArrowPress: (direction) => {
      if (direction === 'up' && onArrowUp) {
        onArrowUp();
        return false;
      }
      return true;
    },
  });

  // Scroll into view when focused
  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [focused]);

  return (
    <div className={styles.sectionHeader}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <button
        ref={ref}
        className={`${styles.sectionMore} ${focused ? styles.focused : ''}`}
        onClick={onSeeAll}
        data-focused={focused}
      >
        Ver tudo <MdNavigateNext />
      </button>
    </div>
  );
});

// ============================================================================
// Main Component
// ============================================================================

export function Home() {
  const navigate = useNavigate();
  const hash = usePlaylistStore((s) => s.hash);
  const stats = usePlaylistStore((s) => s.stats);
  const reset = usePlaylistStore((s) => s.reset);
  const groupsCache = usePlaylistStore((s) => s.groupsCache);
  const seriesCache = usePlaylistStore((s) => s.seriesCache);
  const setGroupsCache = usePlaylistStore((s) => s.setGroupsCache);
  const setSeriesCache = usePlaylistStore((s) => s.setSeriesCache);
  const getRowsCache = usePlaylistStore((s) => s.getRowsCache);
  const setRowsCache = usePlaylistStore((s) => s.setRowsCache);
  const parseInProgress = usePlaylistStore((s) => s.parseInProgress);
  const setParseInProgress = usePlaylistStore((s) => s.setParseInProgress);
  const setStats = usePlaylistStore((s) => s.setStats);
  // Hybrid Xtream support
  const isXtream = usePlaylistStore((s) => s.isXtream);
  const getXtreamClient = usePlaylistStore((s) => s.getXtreamClient);
  const setXtreamItemsCache = usePlaylistStore((s) => s.setXtreamItemsCache);
  const getXtreamItemsCache = usePlaylistStore((s) => s.getXtreamItemsCache);

  const [selectedNav, setSelectedNav] = useState<NavItem>('movies');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PlaylistItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PlaylistItem | null>(null);
  const [hasMoreGroups, setHasMoreGroups] = useState(false);
  const [allFilteredGroups, setAllFilteredGroups] = useState<PlaylistGroup[]>([]);
  const [loadedGroupsCount, setLoadedGroupsCount] = useState(0); // Track groups loaded (not rows, since empty rows are filtered)
  const [loadingRowId, setLoadingRowId] = useState<string | null>(null);

  // First row keys to help D-PAD navigation to header/nav
  const firstRowHeaderFocusKey = rows.length > 0 ? `header-${rows[0].group.id}` : undefined;

  const activeNavFocusKey = useMemo(() => {
    switch (selectedNav) {
      case 'movies': return 'nav-movies';
      case 'series': return 'nav-series';
      case 'live': return 'nav-live';
    }
  }, [selectedNav]);

  const contentRef = useRef<HTMLDivElement>(null);
  const lastItemCount = useRef<number>(0);
  const initialFocusSet = useRef(false); // Track if initial focus was set
  const GROUPS_PER_PAGE = 10;

  // Redirect if no hash
  useEffect(() => {
    if (!hash) {
      navigate('/', { replace: true });
    }
  }, [hash, navigate]);

  // Poll for parse status while parsing is in progress
  // This allows Home to show updated content as parsing continues in background
  useEffect(() => {
    if (!hash || !parseInProgress) return;

    const currentHash = hash;

    const pollInterval = setInterval(async () => {
      try {
        const status = await getParseStatus(currentHash);
        console.log('[Home] Parse status:', status.status, status.itemsParsed);

        // Update stats with latest counts
        if (status.itemsParsed && status.itemsParsed !== lastItemCount.current) {
          lastItemCount.current = status.itemsParsed;

          // Update stats in store
          setStats({
            totalItems: status.itemsParsed,
            liveCount: 0,
            movieCount: 0,
            seriesCount: status.seriesCount || 0,
            unknownCount: 0,
            groupCount: status.groupsCount || 0,
          });

          // Invalidate cache to trigger reload
          setGroupsCache(null);
          setSeriesCache(null);
        }

        // Stop polling when complete or failed
        if (status.status === 'complete' || status.status === 'failed') {
          setParseInProgress(false);

          // Final cache invalidation
          setGroupsCache(null);
          setSeriesCache(null);
        }
      } catch (err) {
        console.error('[Home] Poll error:', err);
      }
    }, 3000); // Poll every 3 seconds (less aggressive than loading screen)

    return () => clearInterval(pollInterval);
  }, [hash, parseInProgress, setParseInProgress, setStats, setGroupsCache, setSeriesCache]);

  // Map nav to mediaKind
  const mediaKind: MediaKind = useMemo(() => {
    switch (selectedNav) {
      case 'movies': return 'movie';
      case 'series': return 'series';
      case 'live': return 'live';
    }
  }, [selectedNav]);

  // Load groups and series from API (with caching per tab)
  useEffect(() => {
    if (!hash) return;

    // Check if we have cached rows for this tab - instant switch!
    const cachedRows = getRowsCache(mediaKind);
    if (cachedRows && cachedRows.length > 0) {
      console.log(`[Home] Using cached rows for ${mediaKind} tab (${cachedRows.length} rows)`);
      setRows(cachedRows);
      setLoading(false);
      // Also restore pagination state from cache
      if (groupsCache) {
        const filteredGroups = groupsCache.filter(g => {
          if (mediaKind === 'movie') {
            return g.mediaKind === 'movie' || g.mediaKind === 'unknown';
          }
          return g.mediaKind === mediaKind;
        });
        setAllFilteredGroups(filteredGroups);
        setLoadedGroupsCount(cachedRows.length);
        setHasMoreGroups(filteredGroups.length > cachedRows.length);
      }
      return;
    }

    // Capture hash for use in async function (TypeScript narrowing)
    const currentHash = hash;
    const xtreamMode = isXtream();
    const xtreamClient = xtreamMode ? getXtreamClient() : null;

    async function loadData() {
      setLoading(true);

      try {
        // =====================================================================
        // XTREAM MODE: Load data directly from Xtream API
        // =====================================================================
        if (xtreamMode && xtreamClient) {
          console.log(`[Home] Loading ${mediaKind} from Xtream API`);

          // Get categories based on media type
          let categories;
          let streams: XtreamStreamItem[];
          const xtreamMediaType: 'live' | 'vod' | 'series' =
            mediaKind === 'live' ? 'live' :
            mediaKind === 'series' ? 'series' : 'vod';

          if (mediaKind === 'live') {
            categories = await xtreamClient.getLiveCategories();
            streams = await xtreamClient.getLiveStreams();
          } else if (mediaKind === 'series') {
            categories = await xtreamClient.getSeriesCategories();
            streams = await xtreamClient.getSeries();
          } else {
            // movies / vod
            categories = await xtreamClient.getVodCategories();
            streams = await xtreamClient.getVodStreams();
          }

          // Normalize categories to PlaylistGroup format
          const groups = normalizeXtreamCategories(categories, mediaKind);
          setGroupsCache(groups);

          // Store all groups for pagination
          setAllFilteredGroups(groups);

          // Load first page of groups
          const groupsToLoad = groups.slice(0, GROUPS_PER_PAGE);
          setLoadedGroupsCount(groupsToLoad.length);
          setHasMoreGroups(groups.length > GROUPS_PER_PAGE);

          // =====================================================================
          // SERIES: Use SeriesInfo[] format with isSeries: true
          // This ensures handleSelectSeries is called instead of handleSelectItem
          // =====================================================================
          if (mediaKind === 'series') {
            // Convert to SeriesInfo[] instead of PlaylistItem[]
            const allSeriesInfo = normalizeXtreamSeriesToSeriesInfo(streams);

            // Build a map of series by category ID for fast lookup
            const seriesByCategory: Record<string, SeriesInfo[]> = {};
            for (const series of allSeriesInfo) {
              const categoryId = series.group || 'uncategorized';
              if (!seriesByCategory[categoryId]) {
                seriesByCategory[categoryId] = [];
              }
              seriesByCategory[categoryId].push(series);
            }

            // Cache for pagination
            setXtreamItemsCache(mediaKind, seriesByCategory as unknown as Record<string, PlaylistItem[]>);

            // Build rows with series data and isSeries: true
            const rowsData: Row[] = groupsToLoad.map((group) => {
              const categorySeries = seriesByCategory[group.id] || [];
              const slicedSeries = categorySeries.slice(0, ITEMS_PER_GROUP);
              return {
                group: { ...group, itemCount: categorySeries.length },
                items: [],
                series: slicedSeries,
                isSeries: true,
                hasMore: categorySeries.length > ITEMS_PER_GROUP,
              };
            });

            // Filter out empty rows
            const nonEmptyRows = rowsData.filter(r => (r.series && r.series.length > 0));
            setRows(nonEmptyRows);
            setRowsCache(mediaKind, nonEmptyRows);
            console.log(`[Home] Xtream: Cached ${nonEmptyRows.length} series rows for ${mediaKind} tab`);
            return;
          }

          // =====================================================================
          // VOD/LIVE: Use PlaylistItem[] format (existing behavior)
          // =====================================================================
          // Normalize streams to PlaylistItem format
          const allItems = normalizeXtreamStreams(streams, xtreamMediaType);

          // Build a map of items by category ID for fast lookup
          const itemsByCategory: Record<string, PlaylistItem[]> = {};
          for (const item of allItems) {
            const categoryId = item.group || 'uncategorized';
            if (!itemsByCategory[categoryId]) {
              itemsByCategory[categoryId] = [];
            }
            itemsByCategory[categoryId].push(item);
          }

          // Cache itemsByCategory for pagination (loadMoreGroups needs this)
          setXtreamItemsCache(mediaKind, itemsByCategory);

          // Build rows with items from the streams
          const rowsData: Row[] = groupsToLoad.map((group) => {
            const categoryItems = itemsByCategory[group.id] || [];
            const slicedItems = categoryItems.slice(0, ITEMS_PER_GROUP);
            return {
              group: { ...group, itemCount: categoryItems.length },
              items: slicedItems,
              hasMore: categoryItems.length > ITEMS_PER_GROUP,
            };
          });

          // Filter out empty rows
          const nonEmptyRows = rowsData.filter(r => r.items.length > 0);
          setRows(nonEmptyRows);
          setRowsCache(mediaKind, nonEmptyRows);
          console.log(`[Home] Xtream: Cached ${nonEmptyRows.length} rows for ${mediaKind} tab`);
          return;
        }

        // =====================================================================
        // M3U MODE: Load data from backend database
        // =====================================================================

        // Load groups if not cached
        let groups = groupsCache;
        if (!groups) {
          const groupsRes = await getGroups(currentHash);
          groups = groupsRes.groups;
          setGroupsCache(groups);
        }

        // Load series if not cached (only needed for series tab)
        let series = seriesCache;
        if (!series && selectedNav === 'series') {
          const seriesRes = await getSeries(currentHash);
          series = seriesRes.series;
          setSeriesCache(series);
        }

        // Filter groups by mediaKind
        // Include "unknown" groups in the movies tab as a category
        const filteredGroups = groups.filter(g => {
          if (mediaKind === 'movie') {
            return g.mediaKind === 'movie' || g.mediaKind === 'unknown';
          }
          return g.mediaKind === mediaKind;
        });

        // Store all filtered groups for pagination
        setAllFilteredGroups(filteredGroups);

        // Load only first page of groups
        const groupsToLoad = filteredGroups.slice(0, GROUPS_PER_PAGE);
        setLoadedGroupsCount(groupsToLoad.length);
        setHasMoreGroups(filteredGroups.length > GROUPS_PER_PAGE);

        // For each group, load initial items
        const rowsData: Row[] = await Promise.all(
          groupsToLoad.map(async (group) => {
            // For series tab, show series cards instead of items
            if (mediaKind === 'series' && series) {
              const groupSeries = series.filter(s => s.group === group.name).slice(0, ITEMS_PER_GROUP);
              return {
                group,
                items: [],
                series: groupSeries,
                isSeries: true,
                hasMore: groupSeries.length >= ITEMS_PER_GROUP,
              };
            }

            // For movies/live, load items
            const itemsRes = await getItems(currentHash, {
              group: group.name,
              mediaKind,
              limit: ITEMS_PER_GROUP,
            });

            return {
              group,
              items: itemsRes.items,
              hasMore: itemsRes.hasMore,
            };
          })
        );

        // Filter out empty rows
        const nonEmptyRows = rowsData.filter(r => r.items.length > 0 || (r.series && r.series.length > 0));
        setRows(nonEmptyRows);

        // Cache rows for this tab for instant switching
        setRowsCache(mediaKind, nonEmptyRows);
        console.log(`[Home] Cached ${nonEmptyRows.length} rows for ${mediaKind} tab`);
      } catch (error) {
        console.error('[Home] Error loading data:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [hash, selectedNav, mediaKind, groupsCache, seriesCache, setGroupsCache, setSeriesCache, getRowsCache, setRowsCache, isXtream, getXtreamClient, setXtreamItemsCache]);

  // Search with debounce
  // - M3U mode: uses PostgreSQL fuzzy search (pg_trgm) - fast server-side
  // - Xtream mode: uses client-side filtering over loaded items (API has no search)
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!hash || term.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      try {
        // =====================================================================
        // XTREAM MODE: Client-side search over loaded items
        // Xtream API doesn't have a search endpoint, so we filter locally
        // =====================================================================
        if (isXtream()) {
          // Collect all items from cached rows
          const allItems: PlaylistItem[] = [];
          for (const row of rows) {
            allItems.push(...row.items);
          }

          // Simple fuzzy match: check if term appears in name
          const filtered = allItems.filter((item) =>
            item.name.toLowerCase().includes(term)
          );

          if (!cancelled) {
            setSearchResults(filtered.slice(0, 100));
            console.log(`[Home] Xtream client-side search: "${term}" → ${filtered.length} results`);
          }
          return;
        }

        // =====================================================================
        // M3U MODE: Server-side fuzzy search (much faster for large playlists)
        // =====================================================================
        const res = await searchItems(hash, term, 100);
        if (!cancelled) setSearchResults(res.items);
      } catch (error) {
        console.error('[Home] Search failed:', error);
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);

    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [hash, searchTerm, isXtream, rows]);

  const handleNavClick = useCallback((item: NavItem) => {
    setSelectedNav(item);
    setRows([]); // Clear rows when switching tabs
    setAllFilteredGroups([]);
    setLoadedGroupsCount(0);
    setHasMoreGroups(false);
    setLoading(true);
    initialFocusSet.current = false; // Reset so initial focus is set on new tab
  }, []);

  const handleExit = useCallback(() => {
    reset();
    navigate('/onboarding/input', { replace: true });
  }, [navigate, reset]);

  const handleSelectItem = useCallback(async (item: PlaylistItem) => {
    console.log('[Home] Selected item:', item.name, item.url);

    // For Xtream items, fetch the play URL first
    if (item.xtreamId && item.xtreamMediaType && isXtream()) {
      const client = getXtreamClient();
      if (client) {
        try {
          const playUrl = await client.getPlayUrl(
            item.xtreamId,
            item.xtreamMediaType,
            item.xtreamExtension
          );
          // Set item with resolved URL
          if (playUrl) {
            setSelectedItem({ ...item, url: playUrl });
          } else {
            console.error('[Home] Empty play URL returned from Xtream API');
          }
          return;
        } catch (err) {
          console.error('[Home] Failed to get Xtream play URL:', err);
          // Don't proceed to player if URL fetch failed for Xtream items
          // that don't have a fallback URL
          if (!item.url) {
            console.error('[Home] No fallback URL available, cannot play');
            return;
          }
          // Fall through to use item.url if available
        }
      }
    }

    // Only proceed if we have a valid URL
    if (!item.url) {
      console.error('[Home] Cannot play item without URL:', item.name);
      return;
    }

    setSelectedItem(item);
  }, [isXtream, getXtreamClient]);

  const handleClosePlayer = useCallback(() => {
    setSelectedItem(null);
    // Restore focus to first carousel after closing player
    // This is needed because initialFocusSet is already true from initial load
    if (rows.length > 0) {
      const firstRow = rows[0];
      setTimeout(() => {
        setFocus(`carousel-${firstRow.group.id}`);
      }, 50);
    }
  }, [rows]);

  const handleVideoEnded = useCallback(() => {
    setSelectedItem(null);
    // Restore focus after video ends (same logic as handleClosePlayer)
    if (rows.length > 0) {
      const firstRow = rows[0];
      setTimeout(() => {
        setFocus(`carousel-${firstRow.group.id}`);
      }, 50);
    }
  }, [rows]);

  const handleSelectSeries = useCallback((seriesId: string) => {
    navigate(`/series/${seriesId}`);
  }, [navigate]);

  const headerTitle = useMemo(() => {
    switch (selectedNav) {
      case 'movies': return 'Filmes';
      case 'series': return 'Series';
      case 'live': return 'TV ao Vivo';
    }
  }, [selectedNav]);

  // Page-level focus context for spatial navigation
  const { ref: pageRef, focusKey: pageFocusKey } = useFocusable({
    focusKey: 'home-page',
    isFocusBoundary: true,
    preferredChildFocusKey: undefined,
    saveLastFocusedChild: true,
  });

  // Nav tabs focusable
  const { ref: navMoviesRef, focused: navMoviesFocused } = useFocusable({
    focusKey: 'nav-movies',
    onEnterPress: () => handleNavClick('movies'),
    onArrowPress: (direction) => {
      if (direction === 'down' && firstRowHeaderFocusKey) {
        setFocus(firstRowHeaderFocusKey);
        return false;
      }
      // Block left navigation (leftmost tab)
      if (direction === 'left') return false;
      return true;
    },
  });

  const { ref: navSeriesRef, focused: navSeriesFocused } = useFocusable({
    focusKey: 'nav-series',
    onEnterPress: () => handleNavClick('series'),
    onArrowPress: (direction) => {
      if (direction === 'down' && firstRowHeaderFocusKey) {
        setFocus(firstRowHeaderFocusKey);
        return false;
      }
      return true;
    },
  });

  const { ref: navLiveRef, focused: navLiveFocused } = useFocusable({
    focusKey: 'nav-live',
    onEnterPress: () => handleNavClick('live'),
    onArrowPress: (direction) => {
      if (direction === 'down' && firstRowHeaderFocusKey) {
        setFocus(firstRowHeaderFocusKey);
        return false;
      }
      // Allow right navigation to search
      if (direction === 'right') {
        setFocus('nav-search');
        return false;
      }
      return true;
    },
  });

  // Search input wrapper focus
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { ref: searchWrapperRef, focused: searchFocused } = useFocusable({
    focusKey: 'nav-search',
    onEnterPress: () => {
      // Focus the actual input element for typing
      searchInputRef.current?.focus();
    },
    onArrowPress: (direction) => {
      if (direction === 'left') {
        setFocus('nav-live');
        return false;
      }
      if (direction === 'right') {
        setFocus('nav-exit');
        return false;
      }
      if (direction === 'down' && firstRowHeaderFocusKey) {
        setFocus(firstRowHeaderFocusKey);
        return false;
      }
      return true;
    },
  });

  // Exit button focus
  const { ref: exitRef, focused: exitFocused } = useFocusable({
    focusKey: 'nav-exit',
    onEnterPress: handleExit,
    onArrowPress: (direction) => {
      if (direction === 'left') {
        setFocus('nav-search');
        return false;
      }
      // Block right - rightmost element
      if (direction === 'right') return false;
      if (direction === 'down' && firstRowHeaderFocusKey) {
        setFocus(firstRowHeaderFocusKey);
        return false;
      }
      return true;
    },
  });

  // Set initial focus after content loads (only once per nav change)
  useEffect(() => {
    if (!loading && rows.length > 0 && !initialFocusSet.current) {
      // Focus first section - it will delegate to carousel via preferredChildFocusKey
      const firstRow = rows[0];
      if (firstRow) {
        setFocus(`section-${firstRow.group.id}`);
        initialFocusSet.current = true;
      }
    }
  }, [loading, rows]);

  // Load more groups function for infinite scroll
  const loadMoreGroups = useCallback(async () => {
    if (!hash || !hasMoreGroups || loading) return;

    const currentHash = hash;
    const xtreamMode = isXtream();
    // Use loadedGroupsCount instead of rows.length to avoid duplicates
    // (rows.length can be less than loaded groups if some rows were empty)
    const startIndex = loadedGroupsCount;
    const endIndex = startIndex + GROUPS_PER_PAGE;
    const groupsToLoad = allFilteredGroups.slice(startIndex, endIndex);

    if (groupsToLoad.length === 0) {
      setHasMoreGroups(false);
      return;
    }

    // =====================================================================
    // XTREAM MODE: Use cached items (loaded during initial load)
    // =====================================================================
    if (xtreamMode) {
      const itemsCache = getXtreamItemsCache(mediaKind);
      if (!itemsCache) {
        console.warn('[Home] Xtream items cache not available for pagination');
        setHasMoreGroups(false);
        return;
      }

      // For series, treat cache as SeriesInfo[] and use isSeries: true
      if (mediaKind === 'series') {
        const seriesCache = itemsCache as unknown as Record<string, SeriesInfo[]>;
        const newRowsData: Row[] = groupsToLoad.map((group) => {
          const categorySeries = seriesCache[group.id] || [];
          const slicedSeries = categorySeries.slice(0, ITEMS_PER_GROUP);
          return {
            group: { ...group, itemCount: categorySeries.length },
            items: [],
            series: slicedSeries,
            isSeries: true,
            hasMore: categorySeries.length > ITEMS_PER_GROUP,
          };
        });

        const nonEmptyRows = newRowsData.filter(r => r.series && r.series.length > 0);
        console.log(`[Home] Xtream loadMoreGroups (series): adding ${nonEmptyRows.length} rows (${startIndex}-${endIndex})`);

        setRows(prev => {
          const updatedRows = [...prev, ...nonEmptyRows];
          setRowsCache(mediaKind, updatedRows);
          return updatedRows;
        });
        setLoadedGroupsCount(endIndex);
        setHasMoreGroups(endIndex < allFilteredGroups.length);
        return;
      }

      // For VOD/LIVE, use existing PlaylistItem[] behavior
      const newRowsData: Row[] = groupsToLoad.map((group) => {
        const categoryItems = itemsCache[group.id] || [];
        const slicedItems = categoryItems.slice(0, ITEMS_PER_GROUP);
        return {
          group: { ...group, itemCount: categoryItems.length },
          items: slicedItems,
          hasMore: categoryItems.length > ITEMS_PER_GROUP,
        };
      });

      const nonEmptyRows = newRowsData.filter(r => r.items.length > 0);
      console.log(`[Home] Xtream loadMoreGroups: adding ${nonEmptyRows.length} rows (${startIndex}-${endIndex})`);

      setRows(prev => {
        const updatedRows = [...prev, ...nonEmptyRows];
        setRowsCache(mediaKind, updatedRows);
        return updatedRows;
      });
      setLoadedGroupsCount(endIndex);
      setHasMoreGroups(endIndex < allFilteredGroups.length);
      return;
    }

    // =====================================================================
    // M3U MODE: Load from backend API
    // =====================================================================

    // Load series if needed for series tab
    let series = seriesCache;
    if (!series && selectedNav === 'series') {
      const seriesRes = await getSeries(currentHash);
      series = seriesRes.series;
      setSeriesCache(series);
    }

    const newRowsData: Row[] = await Promise.all(
      groupsToLoad.map(async (group) => {
        if (mediaKind === 'series' && series) {
          const groupSeries = series.filter(s => s.group === group.name).slice(0, ITEMS_PER_GROUP);
          return {
            group,
            items: [],
            series: groupSeries,
            isSeries: true,
            hasMore: groupSeries.length >= ITEMS_PER_GROUP,
          };
        }

        const itemsRes = await getItems(currentHash, {
          group: group.name,
          mediaKind,
          limit: ITEMS_PER_GROUP,
        });

        return {
          group,
          items: itemsRes.items,
          hasMore: itemsRes.hasMore,
        };
      })
    );

    const nonEmptyRows = newRowsData.filter(r => r.items.length > 0 || (r.series && r.series.length > 0));
    setRows(prev => {
      const updatedRows = [...prev, ...nonEmptyRows];
      // Update cache with new rows
      setRowsCache(mediaKind, updatedRows);
      return updatedRows;
    });
    setLoadedGroupsCount(endIndex); // Track actual groups loaded
    setHasMoreGroups(endIndex < allFilteredGroups.length);
  }, [hash, hasMoreGroups, loading, loadedGroupsCount, allFilteredGroups, seriesCache, selectedNav, mediaKind, setSeriesCache, setRowsCache, isXtream, getXtreamItemsCache]);

  // Handler for "Ver tudo" (See All) button
  const handleSeeAll = useCallback((group: PlaylistGroup) => {
    // In Xtream mode, pass category ID for API filtering
    const state: { groupName: string; mediaKind: string; xtreamCategoryId?: string } = {
      groupName: group.name,
      mediaKind: group.mediaKind,
    };
    if (isXtream()) {
      state.xtreamCategoryId = group.id;
    }
    navigate(`/category/${encodeURIComponent(group.id)}`, { state });
  }, [navigate, isXtream]);

  // Load more items for a specific carousel row (progressive loading)
  const loadMoreRowItems = useCallback(async (rowIndex: number) => {
    if (!hash) return;

    const row = rows[rowIndex];
    if (!row || !row.hasMore || loadingRowId === row.group.id) return;

    setLoadingRowId(row.group.id);
    const xtreamMode = isXtream();

    try {
      // For series rows, load more from cache
      if (row.isSeries && seriesCache) {
        const allGroupSeries = seriesCache.filter(s => s.group === row.group.name);
        const currentCount = row.series?.length || 0;
        const nextSeries = allGroupSeries.slice(currentCount, currentCount + ITEMS_PER_GROUP);
        const hasMore = currentCount + nextSeries.length < allGroupSeries.length;

        setRows(prev => {
          const updatedRows = prev.map((r, idx) => {
            if (idx === rowIndex) {
              return {
                ...r,
                series: [...(r.series || []), ...nextSeries],
                hasMore,
              };
            }
            return r;
          });
          // Update cache with updated rows
          setRowsCache(mediaKind, updatedRows);
          return updatedRows;
        });
        return;
      }

      // =====================================================================
      // XTREAM MODE: Load more items from cache
      // =====================================================================
      if (xtreamMode) {
        const itemsCache = getXtreamItemsCache(mediaKind);
        if (!itemsCache) {
          console.warn('[Home] Xtream items cache not available for row pagination');
          return;
        }

        const allCategoryItems = itemsCache[row.group.id] || [];
        const currentCount = row.items.length;
        const nextItems = allCategoryItems.slice(currentCount, currentCount + ITEMS_PER_GROUP);
        const hasMore = currentCount + nextItems.length < allCategoryItems.length;

        console.log(`[Home] Xtream loadMoreRowItems: ${row.group.name} - adding ${nextItems.length} items (${currentCount} -> ${currentCount + nextItems.length}/${allCategoryItems.length})`);

        setRows(prev => {
          const updatedRows = prev.map((r, idx) => {
            if (idx === rowIndex) {
              return {
                ...r,
                items: [...r.items, ...nextItems],
                hasMore,
              };
            }
            return r;
          });
          setRowsCache(mediaKind, updatedRows);
          return updatedRows;
        });
        return;
      }

      // =====================================================================
      // M3U MODE: Load more items from API
      // =====================================================================
      const itemsRes = await getItems(hash, {
        group: row.group.name,
        mediaKind: row.group.mediaKind,
        limit: ITEMS_PER_GROUP,
        offset: row.items.length,
      });

      setRows(prev => {
        const updatedRows = prev.map((r, idx) => {
          if (idx === rowIndex) {
            return {
              ...r,
              items: [...r.items, ...itemsRes.items],
              hasMore: itemsRes.hasMore,
            };
          }
          return r;
        });
        // Update cache with updated rows
        setRowsCache(mediaKind, updatedRows);
        return updatedRows;
      });
    } catch (error) {
      console.error('[Home] Failed to load more items:', error);
    } finally {
      setLoadingRowId(null);
    }
  }, [hash, rows, loadingRowId, seriesCache, mediaKind, setRowsCache, isXtream, getXtreamItemsCache]);

  // ============================================================================
  // Render
  // ============================================================================

  const renderRows = () => {
    // Show skeleton while loading OR while parsing is in progress with no rows
    const showSkeleton = loading || (parseInProgress && rows.length === 0);

    if (showSkeleton) {
      return (
        <>
          {parseInProgress && (
            <div className={styles.parsingBanner}>
              <div className={styles.spinner} />
              <span>Carregando mais conteudo... ({stats?.totalItems?.toLocaleString() || 0} items)</span>
            </div>
          )}
          {Array.from({ length: 3 }).map((_, idx) => (
            <div className={styles.section} key={`skeleton-${idx}`}>
              <div className={styles.sectionHeader}>
                <div style={{ width: 200, height: 24, background: '#333', borderRadius: 4 }} />
              </div>
              <div className={styles.carouselTrack}>
                <SkeletonCard count={8} />
              </div>
            </div>
          ))}
        </>
      );
    }

    if (rows.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><MdErrorOutline size={64} /></div>
          <h2 className={styles.emptyTitle}>Nenhum conteudo</h2>
          <p className={styles.emptyText}>Nada encontrado nesta aba.</p>
        </div>
      );
    }

    return (
      <>
        {rows.map((row, rowIndex) => {
          // Trigger loadMoreGroups when focusing cards in last 2 rows
          const isNearEnd = hasMoreGroups && rowIndex >= rows.length - 2;
          const carouselFocusKey = `carousel-${row.group.id}`;
          const headerFocusKey = `header-${row.group.id}`;
          const isFirstRow = rowIndex === 0;

          // For series rows, use series data; for items, use items data
          if (row.isSeries && row.series) {
            return (
              <FocusableSection
                key={row.group.id}
                focusKey={`section-${row.group.id}`}
                carouselFocusKey={carouselFocusKey}
                className={styles.section}
              >
                <FocusableSectionHeader
                  title={row.group.name}
                  focusKey={headerFocusKey}
                  onSeeAll={() => handleSeeAll(row.group)}
                  onArrowUp={isFirstRow && activeNavFocusKey ? () => setFocus(activeNavFocusKey) : undefined}
                />
                <VirtualizedCarousel
                  focusKey={carouselFocusKey}
                  items={row.series}
                  hasMore={row.hasMore ?? false}
                  isLoading={loadingRowId === row.group.id}
                  onLoadMore={() => loadMoreRowItems(rowIndex)}
                  getItemKey={(series) => series.id}
                  renderItem={(series, _index, _focusKey, isFocused) => (
                    <SeriesCardContent series={series} isFocused={isFocused} />
                  )}
                  onItemFocus={isNearEnd ? () => loadMoreGroups() : undefined}
                  onItemSelect={(series) => handleSelectSeries(series.id)}
                  upFocusKey={isFirstRow ? headerFocusKey : undefined}
                  cardWidth={CARD_WIDTH}
                  cardGap={CARD_GAP}
                  height={CAROUSEL_HEIGHT}
                />
              </FocusableSection>
            );
          }

          return (
            <FocusableSection
              key={row.group.id}
              focusKey={`section-${row.group.id}`}
              carouselFocusKey={carouselFocusKey}
              className={styles.section}
            >
              <FocusableSectionHeader
                title={row.group.name}
                focusKey={headerFocusKey}
                onSeeAll={() => handleSeeAll(row.group)}
                onArrowUp={isFirstRow && activeNavFocusKey ? () => setFocus(activeNavFocusKey) : undefined}
              />
              <VirtualizedCarousel
                focusKey={carouselFocusKey}
                items={row.items}
                hasMore={row.hasMore ?? false}
                isLoading={loadingRowId === row.group.id}
                onLoadMore={() => loadMoreRowItems(rowIndex)}
                getItemKey={(item) => item.id}
                renderItem={(item, _index, _focusKey, isFocused) => (
                  <MediaCardContent item={item} isFocused={isFocused} />
                )}
                onItemFocus={isNearEnd ? () => loadMoreGroups() : undefined}
                onItemSelect={(item) => handleSelectItem(item)}
                upFocusKey={isFirstRow ? headerFocusKey : undefined}
                cardWidth={CARD_WIDTH}
                cardGap={CARD_GAP}
                height={CAROUSEL_HEIGHT}
              />
            </FocusableSection>
          );
        })}

        {/* Loading indicator when more groups are being loaded */}
        {hasMoreGroups && loading && (
          <div className={styles.loadingMore}>
            <div className={styles.spinner} />
            <span>Carregando mais categorias...</span>
          </div>
        )}
      </>
    );
  };

  const renderSearch = () => {
    if (searchTerm.trim().length < 2) return null;

    if (searchLoading) {
      return (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span>Pesquisando...</span>
        </div>
      );
    }

    if (searchResults.length === 0) {
      return (
        <div className={styles.emptyState}>
          <MdHelpOutline size={64} />
          <h2>Nenhum resultado</h2>
        </div>
      );
    }

    // Use VirtualizedCarousel for search results to avoid rendering all items at once
    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Resultados ({searchResults.length})</h2>
        <VirtualizedCarousel<PlaylistItem>
          focusKey="search-results"
          items={searchResults}
          hasMore={false}
          isLoading={false}
          onLoadMore={() => {}}
          getItemKey={(item) => item.id}
          renderItem={(item, _index, _focusKey, isFocused) => (
            <button
              type="button"
              className={`${styles.card} ${isFocused ? styles.focused : ''}`}
              data-focused={isFocused}
              tabIndex={-1}
            >
              {item.logo ? (
                <img src={item.logo} alt={item.name} className={styles.cardPoster} loading="lazy" />
              ) : (
                <div className={styles.cardPlaceholder}>
                  <MdMovie size={48} />
                </div>
              )}
              <div className={styles.cardOverlay}>
                <span className={styles.cardTitle}>{item.parsedTitle?.title || item.name}</span>
                <div className={styles.cardMeta}>
                  {item.parsedTitle?.year && <span>{item.parsedTitle.year}</span>}
                  {item.parsedTitle?.quality && <span>{item.parsedTitle.quality}</span>}
                </div>
              </div>
            </button>
          )}
          onItemSelect={(item) => handleSelectItem(item)}
          cardWidth={CARD_WIDTH}
          cardGap={CARD_GAP}
          height={CAROUSEL_HEIGHT}
        />
      </div>
    );
  };

  // Show player if an item is selected
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

  return (
    <FocusContext.Provider value={pageFocusKey}>
      <div ref={pageRef} className={styles.page}>
        <header className={styles.topbar}>
          <div className={styles.brand}>
            <img src="/vite.svg" alt="AtivePlay" className={styles.logoIcon} />
            <span className={styles.logoText}>AtivePlay</span>
          </div>

          <nav className={styles.topnav}>
            <button
              ref={navMoviesRef}
              className={`${styles.topnavItem} ${selectedNav === 'movies' ? styles.active : ''} ${navMoviesFocused ? styles.focused : ''}`}
              onClick={() => handleNavClick('movies')}
              data-focused={navMoviesFocused}
            >
              <MdMovie /> Filmes
            </button>
            <button
              ref={navSeriesRef}
              className={`${styles.topnavItem} ${selectedNav === 'series' ? styles.active : ''} ${navSeriesFocused ? styles.focused : ''}`}
              onClick={() => handleNavClick('series')}
              data-focused={navSeriesFocused}
            >
              <MdTv /> Series
            </button>
            <button
              ref={navLiveRef}
              className={`${styles.topnavItem} ${selectedNav === 'live' ? styles.active : ''} ${navLiveFocused ? styles.focused : ''}`}
              onClick={() => handleNavClick('live')}
              data-focused={navLiveFocused}
            >
              <MdLiveTv /> TV ao Vivo
            </button>
          </nav>

          <div className={styles.searchContainer}>
            <div
              ref={searchWrapperRef}
              className={`${styles.searchInputWrapper} ${searchFocused ? styles.focused : ''}`}
              data-focused={searchFocused}
            >
              <MdSearch className={styles.searchIcon} size={20} />
              <input
                ref={searchInputRef}
                type="text"
                className={styles.searchInput}
                placeholder="Buscar..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button
              ref={exitRef}
              className={`${styles.exitButton} ${exitFocused ? styles.focused : ''}`}
              onClick={handleExit}
              data-focused={exitFocused}
            >
              <MdExitToApp size={20} style={{ marginRight: 8 }} />
              Sair
            </button>
          </div>
        </header>

      <main className={styles.main} ref={contentRef}>
        <div className={styles.heroCompact}>
          <div>
            <p className={styles.heroKicker}>{headerTitle}</p>
            <h1 className={styles.heroTitleSmall}>
              {stats ? `${stats.totalItems.toLocaleString()} itens` : 'Carregando...'}
            </h1>
          </div>
        </div>

        {searchTerm.trim().length >= 2 ? renderSearch() : renderRows()}
      </main>
      </div>
    </FocusContext.Provider>
  );
}

export default Home;
