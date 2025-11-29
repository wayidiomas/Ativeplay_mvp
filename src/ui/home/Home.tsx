/**
 * Home Screen - Top navigation with lazy-loaded category carousels
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { usePlaylistStore } from '@store/playlistStore';
import {
  db,
  getPlaylistGroups,
  type M3UGroup,
  type M3UItem,
  type MediaKind,
} from '@core/db/schema';
import {
  MdMovie,
  MdTv,
  MdLiveTv,
  MdSearch,
  MdExitToApp,
  MdCloudDownload,
  MdNavigateNext,
  MdNavigateBefore,
  MdHelpOutline,
  MdErrorOutline,
} from 'react-icons/md';
import styles from './Home.module.css';

type NavItem = 'movies' | 'series' | 'live';
type SearchKind = 'all' | MediaKind;

const GROUP_BATCH_SIZE = 6;
const ITEMS_PER_GROUP = 24;

interface HomeProps {
  onSelectGroup: (group: M3UGroup) => void;
  onSelectMediaKind: (kind: MediaKind) => void;
  onSelectItem: (item: M3UItem) => void;
}

interface Row {
  group: M3UGroup;
  items: M3UItem[];
}

const MediaCard = memo(({ item, groupName, onSelectItem }: { item: M3UItem; groupName: string; onSelectItem: (item: M3UItem) => void }) => {
  return (
    <button className={styles.card} onClick={() => onSelectItem(item)}>
      {item.logo ? (
        <img
          src={item.logo}
          alt={item.title || item.name}
          className={styles.cardPoster}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : null}
      <div className={styles.cardPlaceholder} style={item.logo ? { display: 'none' } : undefined}>
        {item.mediaKind === 'live' ? <MdLiveTv size={32} /> : <MdMovie size={32} />}
      </div>
      <div className={styles.cardOverlay}>
        <div className={styles.cardTitle}>{item.title || item.name}</div>
        <div className={styles.cardMeta}>
          {item.year && <span>{item.year}</span>}
          <span>{groupName}</span>
        </div>
      </div>
    </button>
  );
}, (prev, next) => prev.item.id === next.item.id);

const SearchResultCard = memo(({ item, onSelectItem }: { item: M3UItem; onSelectItem: (item: M3UItem) => void }) => {
  return (
    <button className={styles.card} onClick={() => onSelectItem(item)}>
      {item.logo ? (
        <img
          src={item.logo}
          alt={item.title || item.name}
          className={styles.cardPoster}
          loading="lazy"
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      ) : null}
      <div className={styles.cardOverlay}>
        <div className={styles.cardTitle}>{item.title || item.name}</div>
      </div>
    </button>
  );
}, (prev, next) => prev.item.id === next.item.id);

export function Home({ onSelectGroup, onSelectMediaKind, onSelectItem }: HomeProps) {
  const navigate = useNavigate();
  const { activePlaylist: storedPlaylist, isSyncing, syncProgress } = usePlaylistStore();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const setSyncing = usePlaylistStore((s) => s.setSyncing);
  const setSyncProgress = usePlaylistStore((s) => s.setSyncProgress);

  const liveActivePlaylist = useLiveQuery(
    async () => {
      if (!storedPlaylist) return null;
      return await db.playlists.get(storedPlaylist.id);
    },
    [storedPlaylist?.id],
    storedPlaylist
  );

  useEffect(() => {
    if (liveActivePlaylist && storedPlaylist && liveActivePlaylist.id === storedPlaylist.id) {
      if (JSON.stringify(liveActivePlaylist) !== JSON.stringify(storedPlaylist)) {
        setActivePlaylist(liveActivePlaylist);
      }
    }
  }, [liveActivePlaylist, storedPlaylist, setActivePlaylist]);

  const activePlaylist = liveActivePlaylist;

  const [selectedNav, setSelectedNav] = useState<NavItem>('movies');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [searchResults, setSearchResults] = useState<M3UItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [loadingMoreGroups, setLoadingMoreGroups] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const rowsCacheRef = useRef<Record<NavItem, Row[]>>({
    movies: [],
    series: [],
    live: [],
  });
  const allGroupsRef = useRef<Record<NavItem, M3UGroup[]>>({
    movies: [],
    series: [],
    live: [],
  });
  const nextIndexRef = useRef<Record<NavItem, number>>({
    movies: 0,
    series: 0,
    live: 0,
  });
  const hasMoreRef = useRef<Record<NavItem, boolean>>({
    movies: true,
    series: true,
    live: true,
  });

  const loadBatch = useCallback(
    async (mediaKind: MediaKind, startIndex: number, allGroups: M3UGroup[]) => {
      const batch = allGroups.slice(startIndex, startIndex + GROUP_BATCH_SIZE);
      if (batch.length === 0) return [];
      const rowsLoaded = await Promise.all(
        batch.map(async (group) => {
          const items = await db.items
            .where({ playlistId: activePlaylist!.id, group: group.name, mediaKind })
            .limit(ITEMS_PER_GROUP)
            .toArray();
          return items.length > 0 ? { group, items } : null;
        })
      );
      return rowsLoaded.filter(Boolean) as Row[];
    },
    [activePlaylist]
  );

  useEffect(() => {
    async function loadRows() {
      if (!activePlaylist) {
        setLoading(false);
        return;
      }

      const cachedRows = rowsCacheRef.current[selectedNav];
      const cachedGroups = allGroupsRef.current[selectedNav];
      if (cachedRows.length > 0 && cachedGroups.length > 0 && !hasMoreRef.current[selectedNav]) {
        setRows(cachedRows);
        setLoading(false);
        return;
      }

      setRows(cachedRows);
      setLoading(true);

      try {
        const mediaKind: MediaKind =
          selectedNav === 'movies' ? 'movie' : selectedNav === 'series' ? 'series' : 'live';

        // Carrega todos os grupos apenas uma vez por aba
        if (cachedGroups.length === 0) {
          const allGroups = await getPlaylistGroups(activePlaylist.id, mediaKind);
          allGroupsRef.current[selectedNav] = allGroups;
          nextIndexRef.current[selectedNav] = 0;
          hasMoreRef.current[selectedNav] = allGroups.length > 0;
        }

        const allGroups = allGroupsRef.current[selectedNav];
        const startIndex = nextIndexRef.current[selectedNav];
        const batch = await loadBatch(mediaKind, startIndex, allGroups);
        const newNextIndex = Math.min(startIndex + GROUP_BATCH_SIZE, allGroups.length);
        const mergedRows = [...cachedRows, ...batch];

        rowsCacheRef.current[selectedNav] = mergedRows;
        nextIndexRef.current[selectedNav] = newNextIndex;
        hasMoreRef.current[selectedNav] = newNextIndex < allGroups.length;

        setRows(mergedRows);
      } catch (error) {
        console.error('Erro ao carregar carrosseis:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    loadRows();
  }, [activePlaylist, selectedNav, loadBatch]);

  const loadMoreGroups = useCallback(async () => {
    if (loadingMoreGroups) return;
    if (!hasMoreRef.current[selectedNav]) return;
    setLoadingMoreGroups(true);

    const mediaKind: MediaKind =
      selectedNav === 'movies' ? 'movie' : selectedNav === 'series' ? 'series' : 'live';
    const allGroups = allGroupsRef.current[selectedNav];
    const startIndex = nextIndexRef.current[selectedNav];

    const batch = await loadBatch(mediaKind, startIndex, allGroups);
    const newNextIndex = Math.min(startIndex + GROUP_BATCH_SIZE, allGroups.length);
    const mergedRows = [...rowsCacheRef.current[selectedNav], ...batch];

    rowsCacheRef.current[selectedNav] = mergedRows;
    nextIndexRef.current[selectedNav] = newNextIndex;
    hasMoreRef.current[selectedNav] = newNextIndex < allGroups.length;
    setRows(mergedRows);
    setLoadingMoreGroups(false);
  }, [loadingMoreGroups, selectedNav, loadBatch]);

  // Monitor sync status
  useEffect(() => {
    if (!activePlaylist || activePlaylist.lastSyncStatus !== 'syncing') {
      setSyncing(false);
      setSyncProgress(null);
      return;
    }

    setSyncing(true);
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        const loadedCount = await db.items.where('playlistId').equals(activePlaylist.id).count();
        const total = activePlaylist.itemCount;
        const percentage = total > 0 ? Math.round((loadedCount / total) * 100) : 0;
        setSyncProgress({ current: loadedCount, total, percentage });

        const updated = await db.playlists.get(activePlaylist.id);
        if (updated?.lastSyncStatus !== 'syncing') {
          setSyncing(false);
          setSyncProgress(null);
          break;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    poll();
    return () => { cancelled = true; };
  }, [activePlaylist, setSyncProgress, setSyncing]);

  const handleNavClick = useCallback((item: NavItem) => {
    setSelectedNav(item);
    if (item === 'movies') onSelectMediaKind('movie');
    if (item === 'series') onSelectMediaKind('series');
    if (item === 'live') onSelectMediaKind('live');
  }, [onSelectMediaKind]);

  const headerTitle = useMemo(() => {
    switch (selectedNav) {
      case 'movies': return 'Filmes';
      case 'series': return 'Séries';
      case 'live': return 'TV ao Vivo';
      default: return '';
    }
  }, [selectedNav]);

  // Busca (debounce)
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!activePlaylist || term.length < 2) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      try {
        const playlistId = activePlaylist.id;
        const results = await db.items
          .where('playlistId')
          .equals(playlistId)
          .filter((item) => {
            if (searchKind !== 'all' && item.mediaKind !== searchKind) return false;
            const name = (item.title || item.name || '').toLowerCase();
            return name.includes(term);
          })
          .limit(120)
          .toArray();
        if (!cancelled) setSearchResults(results);
      } catch (e) {
        if (!cancelled) setSearchResults([]);
      } finally {
        if (!cancelled) setSearchLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timeoutId); };
  }, [activePlaylist, searchKind, searchTerm]);

  const handleExit = useCallback(() => {
    setActivePlaylist(null);
    navigate('/onboarding/input', { replace: true });
  }, [navigate, setActivePlaylist]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    contentRef.current?.scrollBy({ top: e.deltaY });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (document.activeElement?.tagName === 'INPUT') return;

    const scrollAmount = 200;
    const pageScrollAmount = contentRef.current?.clientHeight || 500;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        contentRef.current?.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        break;
      case 'ArrowUp':
        e.preventDefault();
        contentRef.current?.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
        break;
      case 'PageDown':
        e.preventDefault();
        contentRef.current?.scrollBy({ top: pageScrollAmount, behavior: 'smooth' });
        break;
      case 'PageUp':
        e.preventDefault();
        contentRef.current?.scrollBy({ top: -pageScrollAmount, behavior: 'smooth' });
        break;
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Infinite scroll: detecta quando usuário chega perto do fim
  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = contentRef.current;
      const scrollPercentage = (scrollTop + clientHeight) / scrollHeight;
      if (scrollPercentage > 0.7 && !loadingMoreGroups) {
        loadMoreGroups();
      }
    };
    const content = contentRef.current;
    content?.addEventListener('scroll', handleScroll);
    return () => content?.removeEventListener('scroll', handleScroll);
  }, [loadingMoreGroups, loadMoreGroups]);

  // Reset flags ao trocar aba
  useEffect(() => {
    setLoadingMoreGroups(false);
  }, [selectedNav]);

  const renderHero = () => {
    if (searchTerm.trim().length >= 2) return null;
    return (
      <div className={styles.heroCompact}>
        <div>
          <p className={styles.heroKicker}>{headerTitle}</p>
          <h1 className={styles.heroTitleSmall}>Escolha rápido nos destaques</h1>
        </div>
        <div className={styles.heroActions}>
          <button className={styles.heroButtonGhost}>Minhas listas</button>
          <button className={styles.heroButtonGhost}>Assistidos</button>
        </div>
      </div>
    );
  };

  const renderSearch = () => {
    if (searchTerm.trim().length < 2) return null;
    if (searchLoading) {
      return (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Pesquisando...</span>
        </div>
      );
    }
    if (searchResults.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><MdHelpOutline size={64} /></div>
          <h2 className={styles.emptyTitle}>Nenhum resultado</h2>
          <p className={styles.emptyText}>Tente outro termo ou filtro.</p>
        </div>
      );
    }
    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Resultados</h2>
        </div>
        <div className={styles.carouselTrack} style={{ gap: 16 }}>
          {searchResults.map((item) => (
            <SearchResultCard key={item.id} item={item} onSelectItem={onSelectItem} />
          ))}
        </div>
      </div>
    );
  };

  const renderRows = () => {
    if (loading && rows.length === 0) {
      return (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Carregando...</h2>
          </div>
          <div className={styles.skeletonCarousel}>
            {Array.from({ length: 10 }).map((_, idx) => (
              <div key={idx} className={styles.skeletonPoster} />
            ))}
          </div>
        </div>
      );
    }

    if (rows.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><MdErrorOutline size={64} /></div>
          <h2 className={styles.emptyTitle}>Nenhum conteúdo</h2>
          <p className={styles.emptyText}>Nada encontrado nesta aba.</p>
        </div>
      );
    }

    return (
      <>
        {rows.map((row) => (
          <div className={styles.section} key={row.group.id}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{row.group.name}</h2>
              <button className={styles.sectionMore} onClick={() => onSelectGroup(row.group)}>
                Ver tudo <MdNavigateNext />
              </button>
            </div>
            <div className={styles.carousel}>
              <button
                className={styles.carouselArrow}
                aria-label="Anterior"
                onClick={() => {
                  const container = document.getElementById(`row-${row.group.id}`);
                  container?.scrollBy({ left: -600, behavior: 'smooth' });
                }}
              >
                <MdNavigateBefore />
              </button>
              <div className={styles.carouselTrack} id={`row-${row.group.id}`}>
                {row.items.map((item) => (
                  <MediaCard key={item.id} item={item} groupName={row.group.name} onSelectItem={onSelectItem} />
                ))}
              </div>
              <button
                className={styles.carouselArrow}
                aria-label="Próximo"
                onClick={() => {
                  const container = document.getElementById(`row-${row.group.id}`);
                  container?.scrollBy({ left: 600, behavior: 'smooth' });
                }}
              >
                <MdNavigateNext />
              </button>
            </div>
          </div>
        ))}
        {loadingMoreGroups && (
          <div className={styles.loadingMore}>
            <div className={styles.spinner} />
            <span>Carregando mais categorias...</span>
          </div>
        )}
      </>
    );
  };

  return (
    <div className={styles.page}>
      {isSyncing && syncProgress && (
        <div className={styles.syncBanner}>
          <div className={styles.syncIcon}>
            <MdCloudDownload size={24} className={styles.syncIconRotate} />
          </div>
          <div className={styles.syncText}>
            Carregando itens... {syncProgress.percentage}% ({syncProgress.current.toLocaleString()}/{syncProgress.total.toLocaleString()})
          </div>
          <div className={styles.syncProgressBarContainer}>
            <div
              className={styles.syncProgressBar}
              style={{ width: `${syncProgress.percentage}%` }}
            />
          </div>
        </div>
      )}

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
            <MdTv /> Séries
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
              tabIndex={0}
            />
          </div>
          <button className={styles.exitButton} onClick={handleExit}>
            <MdExitToApp size={20} style={{ marginRight: 8 }} />
            Sair
          </button>
        </div>
      </header>

      <main className={styles.main} ref={contentRef} onWheel={handleWheel}>
        {renderHero()}
        {renderSearch()}
        {searchTerm.trim().length < 2 && renderRows()}
      </main>
    </div>
  );
}

export default Home;
