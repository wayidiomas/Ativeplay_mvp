/**
 * Home Screen
 * Main navigation hub for the IPTV player
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '@store/playlistStore';
import {
  db,
  getPlaylistGroups,
  type M3UGroup,
  type MediaKind,
  type M3UItem,
} from '@core/db/schema';
import {
  MdMovie,
  MdTv,
  MdLiveTv,
  MdFavorite,
  MdSettings,
  MdSearch,
  MdExitToApp,
  MdPlayArrow,
  MdInfoOutline,
  MdErrorOutline,
  MdHelpOutline,
  MdCloudDownload
} from 'react-icons/md';
import styles from './Home.module.css';

interface HomeProps {
  onSelectGroup: (group: M3UGroup) => void;
  onSelectMediaKind: (kind: MediaKind) => void;
  onSelectItem: (item: M3UItem) => void;
}

type NavItem = 'movies' | 'series' | 'live' | 'favorites' | 'settings';
type SearchKind = 'all' | MediaKind;

export function Home({ onSelectGroup, onSelectMediaKind, onSelectItem }: HomeProps) {
  const { activePlaylist, isSyncing, syncProgress } = usePlaylistStore();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const setSyncing = usePlaylistStore((s) => s.setSyncing);
  const setSyncProgress = usePlaylistStore((s) => s.setSyncProgress);
  const navigate = useNavigate();
  const [selectedNav, setSelectedNav] = useState<NavItem>('movies');
  const [groups, setGroups] = useState<M3UGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [searchResults, setSearchResults] = useState<M3UItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Refs for focus management
  const contentRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  // Load groups when nav changes
  useEffect(() => {
    async function loadGroups() {
      if (!activePlaylist) {
        setLoading(false);
        return;
      }

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
            setGroups([]);
            setLoading(false);
            return;
        }

        const loadedGroups = await getPlaylistGroups(activePlaylist.id, mediaKind);
        setGroups(loadedGroups.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (error) {
        console.error('Erro ao carregar grupos:', error);
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }

    loadGroups();
  }, [activePlaylist, selectedNav]);

  // Monitor sync status (early navigation)
  useEffect(() => {
    if (!activePlaylist || activePlaylist.lastSyncStatus !== 'syncing') {
      setSyncing(false);
      setSyncProgress(null);
      return;
    }

    // Playlist está sincronizando - iniciar polling
    setSyncing(true);
    let cancelled = false;

    const pollSyncProgress = async () => {
      while (!cancelled) {
        try {
          // Conta items carregados
          const loadedCount = await db.items.where('playlistId').equals(activePlaylist.id).count();
          const total = activePlaylist.itemCount;
          const percentage = total > 0 ? Math.round((loadedCount / total) * 100) : 0;

          setSyncProgress({
            current: loadedCount,
            total,
            percentage,
          });

          // Para quando sincronização completa
          const updated = await db.playlists.get(activePlaylist.id);
          if (updated?.lastSyncStatus !== 'syncing') {
            setSyncing(false);
            setSyncProgress(null);
            break;
          }

          // Poll a cada 2 segundos
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (error) {
          console.error('[Home] Erro ao monitorar sincronização:', error);
          break;
        }
      }
    };

    pollSyncProgress();

    return () => {
      cancelled = true;
    };
  }, [activePlaylist, setSyncing, setSyncProgress]);

  // Keyboard navigation for sidebar and scroll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const navItems: NavItem[] = ['movies', 'series', 'live', 'favorites', 'settings'];
      const currentIndex = navItems.indexOf(selectedNav);

      // Handle sidebar navigation
      if (document.activeElement?.closest(`.${styles.sidebar}`)) {
        switch (e.key) {
          case 'ArrowUp':
            if (currentIndex > 0) {
              setSelectedNav(navItems[currentIndex - 1]);
            }
            break;
          case 'ArrowDown':
            if (currentIndex < navItems.length - 1) {
              setSelectedNav(navItems[currentIndex + 1]);
            }
            break;
          case 'ArrowRight':
            // Move focus to content
            const firstContent = contentRef.current?.querySelector('button');
            if (firstContent) {
              (firstContent as HTMLElement).focus();
            }
            break;
        }
        return;
      }

      // Handle content area navigation
      if (document.activeElement?.closest(`.${styles.content}`)) {
        switch (e.key) {
          case 'ArrowLeft':
            // If on the left edge, move back to sidebar
            const rect = document.activeElement.getBoundingClientRect();
            if (rect.left < 350) { // Threshold for sidebar return
              const currentNavBtn = sidebarRef.current?.querySelector(`.${styles.active}`) as HTMLElement;
              if (currentNavBtn) currentNavBtn.focus();
            }
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedNav]);

  const handleNavClick = useCallback((item: NavItem) => {
    setSelectedNav(item);
    if (item === 'movies') {
      onSelectMediaKind('movie');
    } else if (item === 'series') {
      onSelectMediaKind('series');
    } else if (item === 'live') {
      onSelectMediaKind('live');
    }
  }, [onSelectMediaKind]);

  const getDisplayName = useCallback((item: M3UItem): string => {
    return item.title || item.name;
  }, []);

  const getHeaderTitle = () => {
    switch (selectedNav) {
      case 'movies':
        return 'Filmes';
      case 'series':
        return 'Séries';
      case 'live':
        return 'TV ao Vivo';
      case 'favorites':
        return 'Favoritos';
      case 'settings':
        return 'Configurações';
      default:
        return '';
    }
  };

  // Search effect
  useEffect(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!activePlaylist) {
      setSearchResults([]);
      return;
    }
    if (term.length < 2) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    async function runSearch() {
      setSearchLoading(true);
      try {
        const playlistId = activePlaylist!.id;
        let collection = db.items.where('playlistId').equals(playlistId);
        if (searchKind !== 'all') {
          collection = db.items.where({ playlistId, mediaKind: searchKind });
        }

        const results = await collection
          .filter((item) => {
            const name = (item.title || item.name || '').toLowerCase();
            return name.includes(term);
          })
          .limit(120)
          .toArray();

        if (!cancelled) {
          setSearchResults(results);
        }
      } catch (e) {
        if (!cancelled) {
          console.error('Erro ao pesquisar:', e);
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    }

    runSearch();
    return () => {
      cancelled = true;
    };
  }, [activePlaylist, searchKind, searchTerm]);

  const renderHero = () => {
    // Only show hero for Movies/Series when not searching
    if (searchTerm.trim().length >= 2 || (selectedNav !== 'movies' && selectedNav !== 'series')) {
      return null;
    }

    return (
      <div className={styles.hero}>
        <div
          className={styles.heroBackground}
          style={{ backgroundImage: 'url(https://image.tmdb.org/t/p/original/wwemzKWzjKYJFfCeiB57q3r4Bcm.svg)' }} // Placeholder hero
        />
        <div className={styles.heroContent}>
          <h1 className={styles.heroTitle}>
            {selectedNav === 'movies' ? 'Destaque Filmes' : 'Destaque Séries'}
          </h1>
          <p className={styles.heroDescription}>
            Explore os melhores conteúdos selecionados para você.
            Uma experiência cinematográfica completa na sua sala de estar.
          </p>
          <div className={styles.heroActions}>
            <button className={`${styles.heroButton} ${styles.heroButtonPrimary}`}>
              <MdPlayArrow size={24} /> Assistir
            </button>
            <button className={`${styles.heroButton} ${styles.heroButtonSecondary}`}>
              <MdInfoOutline size={24} /> Mais Informações
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    const isSearching = searchTerm.trim().length >= 2;

    if (isSearching) {
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
            <h2 className={styles.sectionTitle}>Resultados da Busca</h2>
          </div>
          <div className={styles.resultsGrid}>
            {searchResults.map((item) => (
              <button
                key={item.id}
                className={styles.resultCard}
                onClick={() => onSelectItem(item)}
                tabIndex={0}
              >
                {item.logo ? (
                  <img
                    src={item.logo}
                    alt={getDisplayName(item)}
                    className={styles.resultPoster}
                    loading="lazy"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      (e.target as HTMLImageElement).nextElementSibling?.classList.remove(styles.hidden);
                    }}
                  />
                ) : null}
                <div className={styles.resultPlaceholder} style={item.logo ? { display: 'none' } : undefined}>
                  {item.mediaKind === 'live' ? <MdLiveTv size={48} /> : <MdMovie size={48} />}
                </div>
                <div className={styles.resultOverlay}>
                  <div className={styles.resultTitle}>{getDisplayName(item)}</div>
                  <div className={styles.resultMeta}>
                    {item.year && <span>{item.year}</span>}
                    <span>{item.group}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (loading) {
      return (
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Carregando catálogo...</span>
        </div>
      );
    }

    if (selectedNav === 'favorites') {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><MdFavorite size={64} /></div>
          <h2 className={styles.emptyTitle}>Sem Favoritos</h2>
          <p className={styles.emptyText}>
            Adicione items aos favoritos para vê-los aqui
          </p>
        </div>
      );
    }

    if (selectedNav === 'settings') {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><MdSettings size={64} /></div>
          <h2 className={styles.emptyTitle}>Configurações</h2>
          <p className={styles.emptyText}>
            Em breve: opções de playlist, tema e mais
          </p>
        </div>
      );
    }

    if (groups.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}><MdErrorOutline size={64} /></div>
          <h2 className={styles.emptyTitle}>Nenhum Conteúdo</h2>
          <p className={styles.emptyText}>
            Não foram encontrados itens nesta categoria
          </p>
        </div>
      );
    }

    return (
      <div className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Categorias</h2>
        </div>
        <div className={styles.groupsGrid}>
          {groups.map((group) => (
            <button
              key={group.id}
              className={styles.groupCard}
              onClick={() => onSelectGroup(group)}
              onFocus={(e) => {
                e.currentTarget.scrollIntoView({
                  behavior: 'smooth',
                  block: 'center',
                  inline: 'nearest'
                });
              }}
              tabIndex={0}
            >
              <div className={styles.groupName}>{group.name}</div>
              <div className={styles.groupCount}>
                {group.itemCount} {group.itemCount === 1 ? 'item' : 'itens'}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  const handleExit = () => {
    setActivePlaylist(null);
    navigate('/onboarding/input', { replace: true });
  };

  return (
    <div className={styles.container}>
      {/* Sidebar */}
      <aside className={styles.sidebar} ref={sidebarRef}>
        <div className={styles.logo}>
          <img src="/vite.svg" alt="AtivePlay" className={styles.logoIcon} />
          <span className={styles.logoText}>AtivePlay</span>
        </div>

        <nav className={styles.nav}>
          <button
            className={`${styles.navItem} ${selectedNav === 'movies' ? styles.active : ''}`}
            onClick={() => handleNavClick('movies')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}><MdMovie /></span>
            Filmes
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'series' ? styles.active : ''}`}
            onClick={() => handleNavClick('series')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}><MdTv /></span>
            Séries
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'live' ? styles.active : ''}`}
            onClick={() => handleNavClick('live')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}><MdLiveTv /></span>
            TV ao Vivo
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'favorites' ? styles.active : ''}`}
            onClick={() => handleNavClick('favorites')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}><MdFavorite /></span>
            Favoritos
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'settings' ? styles.active : ''}`}
            onClick={() => handleNavClick('settings')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}><MdSettings /></span>
            Configurações
          </button>
        </nav>

        {activePlaylist && (
          <div className={styles.playlistInfo}>
            <div className={styles.playlistName}>{activePlaylist.name}</div>
            <div className={styles.playlistStats}>
              {activePlaylist.movieCount} filmes | {activePlaylist.seriesCount} séries
            </div>
          </div>
        )}

        <button className={styles.exitButton} onClick={handleExit} tabIndex={0}>
          <MdExitToApp size={20} style={{ marginRight: 8 }} />
          Sair
        </button>
      </aside>

      {/* Sync Banner (Early Navigation) */}
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

      {/* Main Content */}
      <main className={styles.main}>
        <header className={styles.header}>
          <h1 className={styles.headerTitle}>{getHeaderTitle()}</h1>
          <div className={styles.searchContainer}>
            <select
              className={styles.searchSelect}
              value={searchKind}
              onChange={(e) => setSearchKind(e.target.value as SearchKind)}
            >
              <option value="all">Todos</option>
              <option value="movie">Filmes</option>
              <option value="series">Séries</option>
              <option value="live">TV ao Vivo</option>
            </select>
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
          </div>
        </header>

        <div className={styles.content} ref={contentRef}>
          {renderHero()}
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default Home;
