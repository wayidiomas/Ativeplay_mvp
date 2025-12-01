/**
 * Home Screen - Stateless version using Rust backend API
 * All data comes from backend - no IndexedDB/Dexie
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '@store/playlistStore';
import {
  getGroups,
  getSeries,
  getItems,
  searchItems,
  type PlaylistGroup,
  type PlaylistItem,
  type SeriesInfo,
  type MediaKind,
} from '@core/services/api';
import {
  MdMovie,
  MdTv,
  MdLiveTv,
  MdSearch,
  MdExitToApp,
  MdNavigateNext,
  MdNavigateBefore,
  MdHelpOutline,
  MdErrorOutline,
} from 'react-icons/md';
import { SkeletonCard } from '@ui/shared';
import { PlayerContainer } from '@ui/player';
import styles from './Home.module.css';

type NavItem = 'movies' | 'series' | 'live';

const ITEMS_PER_GROUP = 24;

interface Row {
  group: PlaylistGroup;
  items: PlaylistItem[];
  series?: SeriesInfo[];
  isSeries?: boolean;
  hasMore?: boolean;
}

// ============================================================================
// Card Components
// ============================================================================

const MediaCard = memo(({ item, onSelect }: { item: PlaylistItem; onSelect: (item: PlaylistItem) => void }) => {
  const [imageError, setImageError] = useState(false);

  return (
    <button className={styles.card} onClick={() => onSelect(item)} tabIndex={0}>
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
    </button>
  );
}, (prev, next) => prev.item.id === next.item.id);

const SeriesCard = memo(({ series, onNavigate }: { series: SeriesInfo; onNavigate: (id: string) => void }) => {
  const [imageError, setImageError] = useState(false);

  return (
    <button className={styles.card} onClick={() => onNavigate(series.id)} tabIndex={0}>
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
    </button>
  );
}, (prev, next) => prev.series.id === next.series.id);

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

  const [selectedNav, setSelectedNav] = useState<NavItem>('movies');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PlaylistItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [selectedItem, setSelectedItem] = useState<PlaylistItem | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);

  // Redirect if no hash
  useEffect(() => {
    if (!hash) {
      navigate('/', { replace: true });
    }
  }, [hash, navigate]);

  // Map nav to mediaKind
  const mediaKind: MediaKind = useMemo(() => {
    switch (selectedNav) {
      case 'movies': return 'movie';
      case 'series': return 'series';
      case 'live': return 'live';
    }
  }, [selectedNav]);

  // Load groups and series from API (with caching)
  useEffect(() => {
    if (!hash) return;

    // Capture hash for use in async function (TypeScript narrowing)
    const currentHash = hash;

    async function loadData() {
      setLoading(true);

      try {
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
        const filteredGroups = groups.filter(g => g.mediaKind === mediaKind);

        // For each group, load initial items
        const rowsData: Row[] = await Promise.all(
          filteredGroups.slice(0, 12).map(async (group) => {
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
      } catch (error) {
        console.error('[Home] Error loading data:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [hash, selectedNav, mediaKind, groupsCache, seriesCache, setGroupsCache, setSeriesCache]);

  // Search with debounce - uses PostgreSQL fuzzy search (pg_trgm)
  useEffect(() => {
    const term = searchTerm.trim();
    if (!hash || term.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      try {
        // Use server-side fuzzy search (much faster than client-side filtering)
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
  }, [hash, searchTerm]);

  const handleNavClick = useCallback((item: NavItem) => {
    setSelectedNav(item);
    setRows([]); // Clear rows when switching tabs
    setLoading(true);
  }, []);

  const handleExit = useCallback(() => {
    reset();
    navigate('/onboarding/input', { replace: true });
  }, [navigate, reset]);

  const handleSelectItem = useCallback((item: PlaylistItem) => {
    console.log('[Home] Selected item:', item.name, item.url);
    setSelectedItem(item);
  }, []);

  const handleClosePlayer = useCallback(() => {
    setSelectedItem(null);
  }, []);

  const handleVideoEnded = useCallback(() => {
    setSelectedItem(null);
  }, []);

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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;

      const scrollAmount = 200;
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          contentRef.current?.scrollBy({ top: scrollAmount, behavior: 'smooth' });
          break;
        case 'ArrowUp':
          e.preventDefault();
          contentRef.current?.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  const renderRows = () => {
    if (loading) {
      return (
        <>
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

    return rows.map((row) => (
      <div className={styles.section} key={row.group.id}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{row.group.name}</h2>
          <button className={styles.sectionMore}>
            Ver tudo <MdNavigateNext />
          </button>
        </div>
        <div className={styles.carousel}>
          <button
            className={styles.carouselArrow}
            onClick={() => {
              const el = document.getElementById(`row-${row.group.id}`);
              el?.scrollBy({ left: -600, behavior: 'smooth' });
            }}
          >
            <MdNavigateBefore />
          </button>
          <div className={styles.carouselTrack} id={`row-${row.group.id}`}>
            {row.isSeries && row.series?.map((series) => (
              <SeriesCard key={series.id} series={series} onNavigate={handleSelectSeries} />
            ))}
            {row.items.map((item) => (
              <MediaCard key={item.id} item={item} onSelect={handleSelectItem} />
            ))}
          </div>
          <button
            className={styles.carouselArrow}
            onClick={() => {
              const el = document.getElementById(`row-${row.group.id}`);
              el?.scrollBy({ left: 600, behavior: 'smooth' });
            }}
          >
            <MdNavigateNext />
          </button>
        </div>
      </div>
    ));
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

    return (
      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Resultados</h2>
        <div className={styles.carouselTrack}>
          {searchResults.map((item) => (
            <MediaCard key={item.id} item={item} onSelect={handleSelectItem} />
          ))}
        </div>
      </div>
    );
  };

  // Show player if an item is selected
  if (selectedItem) {
    return (
      <PlayerContainer
        url={selectedItem.url}
        title={selectedItem.parsedTitle?.title || selectedItem.name}
        onClose={handleClosePlayer}
        onEnded={handleVideoEnded}
      />
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <img src="/vite.svg" alt="AtivePlay" className={styles.logoIcon} />
          <span className={styles.logoText}>AtivePlay</span>
        </div>

        <nav className={styles.topnav}>
          <button
            className={`${styles.topnavItem} ${selectedNav === 'movies' ? styles.active : ''}`}
            onClick={() => handleNavClick('movies')}
          >
            <MdMovie /> Filmes
          </button>
          <button
            className={`${styles.topnavItem} ${selectedNav === 'series' ? styles.active : ''}`}
            onClick={() => handleNavClick('series')}
          >
            <MdTv /> Series
          </button>
          <button
            className={`${styles.topnavItem} ${selectedNav === 'live' ? styles.active : ''}`}
            onClick={() => handleNavClick('live')}
          >
            <MdLiveTv /> TV ao Vivo
          </button>
        </nav>

        <div className={styles.searchContainer}>
          <div className={styles.searchInputWrapper}>
            <MdSearch className={styles.searchIcon} size={20} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button className={styles.exitButton} onClick={handleExit}>
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
  );
}

export default Home;
