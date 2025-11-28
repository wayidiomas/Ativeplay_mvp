/**
 * Home Screen
 * Main navigation hub for the IPTV player
 */

import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '@store/playlistStore';
import {
  db,
  getPlaylistGroups,
  type M3UGroup,
  type MediaKind,
  type M3UItem,
} from '@core/db/schema';
import styles from './Home.module.css';

interface HomeProps {
  onSelectGroup: (group: M3UGroup) => void;
  onSelectMediaKind: (kind: MediaKind) => void;
  onSelectItem: (item: M3UItem) => void;
}

type NavItem = 'movies' | 'series' | 'live' | 'favorites' | 'settings';
type SearchKind = 'all' | MediaKind;

export function Home({ onSelectGroup, onSelectMediaKind, onSelectItem }: HomeProps) {
  const { activePlaylist } = usePlaylistStore();
  const setActivePlaylist = usePlaylistStore((s) => s.setActivePlaylist);
  const navigate = useNavigate();
  const [selectedNav, setSelectedNav] = useState<NavItem>('movies');
  const [groups, setGroups] = useState<M3UGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchKind, setSearchKind] = useState<SearchKind>('all');
  const [searchResults, setSearchResults] = useState<M3UItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Load groups when nav changes
  useEffect(() => {
    async function loadGroups() {
      console.log('[HOME DEBUG] ===== CARREGANDO GRUPOS =====');
      console.log('[HOME DEBUG] activePlaylist:', activePlaylist);
      console.log('[HOME DEBUG] selectedNav:', selectedNav);

      if (!activePlaylist) {
        console.log('[HOME DEBUG] SEM activePlaylist - abortando');
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

        console.log('[HOME DEBUG] Buscando grupos com playlistId:', activePlaylist.id, 'mediaKind:', mediaKind);
        const loadedGroups = await getPlaylistGroups(activePlaylist.id, mediaKind);
        console.log('[HOME DEBUG] Grupos carregados:', loadedGroups.length);
        console.log('[HOME DEBUG] Primeiros 3 grupos:', loadedGroups.slice(0, 3));
        setGroups(loadedGroups.sort((a, b) => a.name.localeCompare(b.name)));
      } catch (error) {
        console.error('[HOME DEBUG] Erro ao carregar grupos:', error);
        setGroups([]);
      } finally {
        setLoading(false);
      }
    }

    loadGroups();
  }, [activePlaylist, selectedNav]);

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
        }
        return;
      }

      // Handle content area scroll with arrow keys
      const contentArea = document.querySelector(`.${styles.content}`) as HTMLElement;
      if (contentArea && document.activeElement?.closest(`.${styles.content}`)) {
        const scrollAmount = 200;
        switch (e.key) {
          case 'ArrowUp':
            contentArea.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
            e.preventDefault();
            break;
          case 'ArrowDown':
            contentArea.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            e.preventDefault();
            break;
          case 'PageUp':
            contentArea.scrollBy({ top: -contentArea.clientHeight, behavior: 'smooth' });
            e.preventDefault();
            break;
          case 'PageDown':
            contentArea.scrollBy({ top: contentArea.clientHeight, behavior: 'smooth' });
            e.preventDefault();
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
        return 'Series';
      case 'live':
        return 'TV ao Vivo';
      case 'favorites':
        return 'Favoritos';
      case 'settings':
        return 'Configuracoes';
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
        const playlistId = activePlaylist!.id; // já checado acima
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
            <div className={styles.emptyIcon}>?</div>
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
                  {item.mediaKind === 'live' ? 'O' : '#'}
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
          <span className={styles.loadingText}>Carregando...</span>
        </div>
      );
    }

    if (selectedNav === 'favorites') {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>*</div>
          <h2 className={styles.emptyTitle}>Sem Favoritos</h2>
          <p className={styles.emptyText}>
            Adicione items aos favoritos para velos aqui
          </p>
        </div>
      );
    }

    if (selectedNav === 'settings') {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>@</div>
          <h2 className={styles.emptyTitle}>Configuracoes</h2>
          <p className={styles.emptyText}>
            Em breve: opcoes de playlist, tema e mais
          </p>
        </div>
      );
    }

    if (groups.length === 0) {
      return (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>?</div>
          <h2 className={styles.emptyTitle}>Nenhum Conteudo</h2>
          <p className={styles.emptyText}>
            Nao foram encontrados itens nesta categoria
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
                // Auto scroll to keep focused card visible
                e.currentTarget.scrollIntoView({
                  behavior: 'smooth',
                  block: 'nearest',
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
      <aside className={styles.sidebar}>
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
            <span className={styles.navIcon}>#</span>
            Filmes
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'series' ? styles.active : ''}`}
            onClick={() => handleNavClick('series')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}>=</span>
            Series
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'live' ? styles.active : ''}`}
            onClick={() => handleNavClick('live')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}>O</span>
            TV ao Vivo
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'favorites' ? styles.active : ''}`}
            onClick={() => handleNavClick('favorites')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}>*</span>
            Favoritos
          </button>
          <button
            className={`${styles.navItem} ${selectedNav === 'settings' ? styles.active : ''}`}
            onClick={() => handleNavClick('settings')}
            onFocus={(e) => e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest' })}
            tabIndex={0}
          >
            <span className={styles.navIcon}>@</span>
            Configuracoes
          </button>
        </nav>

        {activePlaylist && (
          <div className={styles.playlistInfo}>
            <div className={styles.playlistName}>{activePlaylist.name}</div>
            <div className={styles.playlistStats}>
              {activePlaylist.movieCount} filmes | {activePlaylist.seriesCount} series | {activePlaylist.liveCount} canais
            </div>
          </div>
        )}

        <button className={styles.exitButton} onClick={handleExit} tabIndex={0}>
          Sair para Onboarding
        </button>
      </aside>

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
              <option value="series">Series</option>
              <option value="live">TV ao Vivo</option>
            </select>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Buscar..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              tabIndex={0}
            />
          </div>
        </header>

        <div className={styles.content}>
          {renderContent()}
        </div>
      </main>
    </div>
  );
}

export default Home;
