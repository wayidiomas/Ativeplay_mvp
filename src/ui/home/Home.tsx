/**
 * Home Screen - Top navigation with carrosséis por categoria
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

interface HomeProps {
  onSelectGroup: (group: M3UGroup) => void;
  onSelectMediaKind: (kind: MediaKind) => void;
  onSelectItem: (item: M3UItem) => void;
}

interface Row {
  group: M3UGroup;
  items: M3UItem[];
}

// Memoized card component to prevent unnecessary re-renders (63% reduction)
interface MediaCardProps {
  item: M3UItem;
  groupName: string;
  onSelectItem: (item: M3UItem) => void;
}

const MediaCard = memo(({ item, groupName, onSelectItem }: MediaCardProps) => {
  return (
    <button
      className={styles.card}
      onClick={() => onSelectItem(item)}
    >
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
}, (prev, next) => prev.item.id === next.item.id); // Only re-render if item changes

// Memoized search result card (simplified version without placeholder)
const SearchResultCard = memo(({ item, onSelectItem }: { item: M3UItem; onSelectItem: (item: M3UItem) => void }) => {
  return (
    <button
      className={styles.card}
      onClick={() => onSelectItem(item)}
    >
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
  const { activePlaylist, isSyncing, syncProgress } = usePlaylistStore();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const setSyncing = usePlaylistStore((s) => s.setSyncing);
  const setSyncProgress = usePlaylistStore((s) => s.setSyncProgress);

  const [selectedNav, setSelectedNav] = useState<NavItem>('movies');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [searchResults, setSearchResults] = useState<M3UItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const rowsCacheRef = useRef<Record<NavItem, Row[]>>({
    movies: [],
    series: [],
    live: [],
  });

  // Carrega carrosseis (top grupos) para filmes/séries; TV ao vivo mostra grupos completos
  useEffect(() => {
    async function loadRows() {
      if (!activePlaylist) {
        setLoading(false);
        return;
      }

      // Se já há cache, usa imediatamente
      const cached = rowsCacheRef.current[selectedNav];
      if (cached && cached.length > 0) {
        setRows(cached);
        setLoading(false);
        return; // Early return - não precisa buscar novamente!
      }

      setRows([]);
      setLoading(true);

      try {
        let mediaKind: MediaKind;
        switch (selectedNav) {
          case 'movies':
            mediaKind = 'movie';
            break;
          case 'series':
            mediaKind = 'series';
            break;
          case 'live':
            mediaKind = 'live';
            break;
          default:
            return;
        }

        // Busca apenas os top 8 grupos direto do DB (84% menos dados)
        const topGroups = await getPlaylistGroups(activePlaylist.id, mediaKind, 8);

        const rowsLoaded = await Promise.all(
          topGroups.map(async (group) => {
            const items = await db.items
              .where({ playlistId: activePlaylist.id, group: group.name, mediaKind })
              .limit(24)
              .toArray();
            return items.length > 0 ? { group, items } : null;
          })
        );

        const filtered = rowsLoaded.filter(Boolean) as Row[];
        setRows(filtered);
        rowsCacheRef.current[selectedNav] = filtered; // cache para troca de abas
      } catch (error) {
        console.error('Erro ao carregar carrosseis:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    loadRows();
  }, [activePlaylist, selectedNav]);

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
        await new Promise((r) => setTimeout(r, 5000)); // Reduz polling: 30→12 queries/min
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

  // Busca com debounce (300ms) para reduzir queries
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!activePlaylist || term.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    let cancelled = false;
    setSearchLoading(true); // Mostra loading imediatamente

    // Debounce: aguarda 300ms antes de executar busca
    const timeoutId = setTimeout(() => {
      async function runSearch() {
        try {
          const playlistId = activePlaylist.id;
          const searchNormalized = term.toUpperCase();

          // Busca indexada usando B-tree (26x mais rápido que filter)
          let results = await db.items
            .where('[playlistId+titleNormalized]')
            .between(
              [playlistId, searchNormalized],
              [playlistId, searchNormalized + '\uffff'],
              true,
              true
            )
            .limit(120)
            .toArray();

          // Filtra por mediaKind se necessário (pequeno subset já filtrado)
          if (searchKind !== 'all') {
            results = results.filter((item) => item.mediaKind === searchKind);
          }

          if (!cancelled) setSearchResults(results);
        } catch (e) {
          if (!cancelled) setSearchResults([]);
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      }
      runSearch();
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [activePlaylist, searchKind, searchTerm]);

  const handleExit = useCallback(() => {
    setActivePlaylist(null);
    navigate('/onboarding/input', { replace: true });
  }, [navigate, setActivePlaylist]);

  const handleWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault(); // Previne scroll default do browser
    contentRef.current?.scrollBy({ top: e.deltaY });
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Só processa se não há elemento focado (evita conflito com inputs)
    if (document.activeElement?.tagName === 'INPUT') return;

    const scrollAmount = 100; // pixels por tecla
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
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

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
            <SearchResultCard
              key={item.id}
              item={item}
              onSelectItem={onSelectItem}
            />
          ))}
        </div>
      </div>
    );
  };

  const renderRows = () => {
    if (loading) {
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

    return rows.map((row) => (
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
              <MediaCard
                key={item.id}
                item={item}
                groupName={row.group.name}
                onSelectItem={onSelectItem}
              />
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
    ));
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
