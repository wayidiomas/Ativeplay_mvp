/**
 * Home Screen - Top navigation with lazy-loaded category carousels
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { usePlaylistStore } from '@store/playlistStore';
import {
  db,
  type M3UGroup,
  type M3UItem,
  type MediaKind,
  type Series,
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
const ITEMS_PER_GROUP = 24; // Carregamento inicial por grupo
const ITEMS_LOAD_MORE = 24; // Quantos itens carregar por vez no lazy loading horizontal
const INITIAL_BATCHES = 2; // carrega mais de um lote no início para garantir scroll

interface HomeProps {
  onSelectGroup: (group: M3UGroup) => void;
  onSelectMediaKind: (kind: MediaKind) => void;
  onSelectItem: (item: M3UItem) => void;
}

interface Row {
  group: M3UGroup;
  items: M3UItem[];
  series?: Series[]; // Para aba de séries: contém séries agrupadas
  isSeries?: boolean; // Flag para indicar que é row de séries
  lastSeriesId?: string; // ID da última série carregada (keyset pagination)
  lastItemId?: string; // ID do último item carregado (keyset pagination)
  hasMoreSeries?: boolean; // Se há mais séries para carregar
  hasMoreItems?: boolean; // Se há mais items para carregar
}

const MediaCard = memo(({ item, groupName, onSelectItem }: { item: M3UItem; groupName: string; onSelectItem: (item: M3UItem) => void }) => {
  const [imageError, setImageError] = useState(false);

  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setImageError(true);
    // Suprime erro do console evitando que navegador mostre ERR_NAME_NOT_RESOLVED
    e.preventDefault();
  }, []);

  return (
    <button className={styles.card} onClick={() => onSelectItem(item)}>
      {item.logo && !imageError ? (
        <img
          src={item.logo}
          alt={item.title || item.name}
          className={styles.cardPoster}
          loading="lazy"
          onError={handleImageError}
        />
      ) : (
        <div className={styles.cardPlaceholder}>
          {item.mediaKind === 'live' ? <MdLiveTv size={32} /> : <MdMovie size={32} />}
        </div>
      )}
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
  const [imageError, setImageError] = useState(false);

  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setImageError(true);
    e.preventDefault();
  }, []);

  return (
    <button className={styles.card} onClick={() => onSelectItem(item)}>
      {item.logo && !imageError ? (
        <img
          src={item.logo}
          alt={item.title || item.name}
          className={styles.cardPoster}
          loading="lazy"
          onError={handleImageError}
        />
      ) : (
        <div className={styles.cardPlaceholder}>
          {item.mediaKind === 'live' ? <MdLiveTv size={32} /> : <MdMovie size={32} />}
        </div>
      )}
      <div className={styles.cardOverlay}>
        <div className={styles.cardTitle}>{item.title || item.name}</div>
      </div>
    </button>
  );
}, (prev, next) => prev.item.id === next.item.id);

const SeriesCard = memo(({ series, onNavigate }: { series: Series; onNavigate: (seriesId: string) => void }) => {
  const [imageError, setImageError] = useState(false);

  const handleImageError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    setImageError(true);
    e.preventDefault();
  }, []);

  return (
    <button className={styles.card} onClick={() => onNavigate(series.id)}>
      {series.logo && !imageError ? (
        <img
          src={series.logo}
          alt={series.name}
          className={styles.cardPoster}
          loading="lazy"
          onError={handleImageError}
        />
      ) : (
        <div className={styles.cardPlaceholder}>
          <MdTv size={32} />
        </div>
      )}
      <div className={styles.cardOverlay}>
        <div className={styles.cardTitle}>{series.name}</div>
        <div className={styles.cardMeta}>
          <span>{series.totalEpisodes} episódios</span>
          {series.totalSeasons > 1 && <span>{series.totalSeasons} temporadas</span>}
        </div>
      </div>
    </button>
  );
}, (prev, next) => prev.series.id === next.series.id);

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
  const [loadingCarousels, setLoadingCarousels] = useState<Set<string>>(new Set());

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

  // Zera caches quando playlist ativa muda para evitar dados de playlists antigas
  useEffect(() => {
    rowsCacheRef.current = { movies: [], series: [], live: [] };
    allGroupsRef.current = { movies: [], series: [], live: [] };
    nextIndexRef.current = { movies: 0, series: 0, live: 0 };
    hasMoreRef.current = { movies: true, series: true, live: true };
    setRows([]);
    setLoading(true);
  }, [activePlaylist?.id]);

  const loadBatch = useCallback(
    async (mediaKind: MediaKind, startIndex: number, allGroups: M3UGroup[]) => {
      const batch = allGroups.slice(startIndex, startIndex + GROUP_BATCH_SIZE);
      if (batch.length === 0) return [];

      // Lógica especial para séries: carrega séries agrupadas + items não agrupados
      if (mediaKind === 'series') {
        // Se tabela series não existir (schema simplificado), evita erro e retorna vazio
        if (!(db as any).series) {
          console.warn('[HOME DEBUG] Tabela "series" não disponível no Dexie. Pulando carga de séries.');
          return [];
        }

        const rowsLoaded = await Promise.all(
          batch.map(async (group) => {
            // Conta total de séries e items deste grupo
            const totalSeriesCount = await db.series
              .where({ playlistId: activePlaylist!.id, group: group.name })
              .count();

            const totalItemsCount = await db.items
              .where({ playlistId: activePlaylist!.id, group: group.name, mediaKind })
              .filter((item) => !item.seriesId)
              .count();

            // Carrega séries agrupadas deste grupo
            const seriesInGroup = await db.series
              .where({ playlistId: activePlaylist!.id, group: group.name })
              .limit(ITEMS_PER_GROUP)
              .toArray();

            // Carrega items não agrupados (singleton) deste grupo
            const ungroupedItems = await db.items
              .where({ playlistId: activePlaylist!.id, group: group.name, mediaKind })
              .filter((item) => !item.seriesId) // Apenas items sem seriesId
              .limit(ITEMS_PER_GROUP - seriesInGroup.length) // Limita para completar até ITEMS_PER_GROUP
              .toArray();

            const hasContent = seriesInGroup.length > 0 || ungroupedItems.length > 0;

            return hasContent
              ? {
                  group,
                  items: ungroupedItems,
                  series: seriesInGroup,
                  isSeries: true,
                  seriesLoadedCount: seriesInGroup.length,
                  itemsLoadedCount: ungroupedItems.length,
                  hasMoreSeries: seriesInGroup.length < totalSeriesCount,
                  hasMoreItems: ungroupedItems.length < totalItemsCount,
                }
              : null;
          })
        );
        return rowsLoaded.filter(Boolean) as Row[];
      }

      // Lógica normal para movies e live
      const rowsLoaded = await Promise.all(
        batch.map(async (group) => {
          const totalItemsCount = await db.items
            .where({ playlistId: activePlaylist!.id, group: group.name, mediaKind })
            .count();

          const items = await db.items
            .where({ playlistId: activePlaylist!.id, group: group.name, mediaKind })
            .limit(ITEMS_PER_GROUP)
            .toArray();

          return items.length > 0
            ? {
                group,
                items,
                itemsLoadedCount: items.length,
                hasMoreItems: items.length < totalItemsCount,
              }
            : null;
        })
      );
      return rowsLoaded.filter(Boolean) as Row[];
    },
    [activePlaylist]
  );

  // useLiveQuery para monitorar grupos reativamente
  const liveGroups = useLiveQuery(
    async () => {
      if (!activePlaylist) return [];
      const mediaKind: MediaKind =
        selectedNav === 'movies' ? 'movie' :
        selectedNav === 'series' ? 'series' : 'live';

      return await db.groups
        .where({ playlistId: activePlaylist.id, mediaKind })
        .toArray();
    },
    [activePlaylist?.id, selectedNav],
    [] // Default empty array while loading
  );

  // Sincroniza liveGroups → allGroupsRef
  useEffect(() => {
    // ✅ SEMPRE atualiza allGroupsRef (não faz early return em liveGroups.length === 0)
    // Fix race condition: permite que Home monte mesmo antes do useLiveQuery reagir
    if (!liveGroups) return; // Apenas se undefined (ainda carregando)

    // Deduplicate groups by id
    const seen = new Set<string>();
    const uniqueGroups = liveGroups.filter((g) => {
      if (seen.has(g.id)) return false;
      seen.add(g.id);
      return true;
    });

    // Update ref if groups actually changed
    const currentGroups = allGroupsRef.current[selectedNav];
    const groupsChanged = JSON.stringify(currentGroups.map(g => g.id)) !== JSON.stringify(uniqueGroups.map(g => g.id));

    if (groupsChanged) {
      console.log('[HOME DEBUG] Grupos sincronizados:', {
        before: currentGroups.length,
        after: uniqueGroups.length,
        nav: selectedNav
      });
      allGroupsRef.current[selectedNav] = uniqueGroups;

      // Trigger reload if we have new groups
      if (uniqueGroups.length > currentGroups.length) {
        console.log('[HOME DEBUG] Novos grupos detectados, triggering reload...');
        // Reset state to trigger loadRows
        nextIndexRef.current[selectedNav] = 0;
        hasMoreRef.current[selectedNav] = true;
        rowsCacheRef.current[selectedNav] = [];
        setRows([]);
        setLoading(true);
      }
    }
  }, [liveGroups, selectedNav]);

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

        // USE allGroupsRef (populated by liveGroups via useEffect)
        const allGroups = allGroupsRef.current[selectedNav];

        // ✅ Se ainda não há grupos, mantém loading e aguarda useLiveQuery
        // Fix race condition: não exibe tela vazia prematuramente
        if (allGroups.length === 0) {
          console.log('[HOME DEBUG] Aguardando grupos do useLiveQuery... (mantém loading)');
          // Mantém loading=true para indicar que está aguardando dados
          // O useLiveQuery vai notificar quando os grupos chegarem e re-executar este effect
          return;
        }
        console.log('[HOME DEBUG] Grupos recebidos, carregando rows:', allGroups.length);
        const startIndex = nextIndexRef.current[selectedNav];
        const batches: Row[] = [];
        let localNextIndex = startIndex;

        // carrega um ou mais lotes iniciais para garantir conteúdo visível
        for (let i = 0; i < INITIAL_BATCHES && localNextIndex < allGroups.length; i++) {
          const batch = await loadBatch(mediaKind, localNextIndex, allGroups);
          batches.push(...batch);
          localNextIndex = Math.min(localNextIndex + GROUP_BATCH_SIZE, allGroups.length);
        }

        // Deduplica rows por group.id
        const mergedRows = [...cachedRows, ...batches];
        const seenGroupIds = new Set<string>();
        const uniqueRows = mergedRows.filter((row) => {
          if (seenGroupIds.has(row.group.id)) return false;
          seenGroupIds.add(row.group.id);
          return true;
        });

        rowsCacheRef.current[selectedNav] = uniqueRows;
        nextIndexRef.current[selectedNav] = localNextIndex;
        hasMoreRef.current[selectedNav] = localNextIndex < allGroups.length;

        setRows(uniqueRows);
      } catch (error) {
        console.error('Erro ao carregar carrosseis:', error);
        setRows([]);
      } finally {
        setLoading(false);
      }
    }
    loadRows();
  }, [activePlaylist, selectedNav, loadBatch, liveGroups?.length]);

  const loadMoreGroups = useCallback(async () => {
    if (loadingMoreGroups) return;
    if (!hasMoreRef.current[selectedNav]) return;
    if (!activePlaylist) return;
    setLoadingMoreGroups(true);

    const mediaKind: MediaKind =
      selectedNav === 'movies' ? 'movie' : selectedNav === 'series' ? 'series' : 'live';
    const allGroups = allGroupsRef.current[selectedNav];
    const startIndex = nextIndexRef.current[selectedNav];

    const batch = await loadBatch(mediaKind, startIndex, allGroups);
    const newNextIndex = Math.min(startIndex + GROUP_BATCH_SIZE, allGroups.length);

    // Deduplica rows por group.id
    const mergedRows = [...rowsCacheRef.current[selectedNav], ...batch];
    const seenGroupIds = new Set<string>();
    const uniqueRows = mergedRows.filter((row) => {
      if (seenGroupIds.has(row.group.id)) return false;
      seenGroupIds.add(row.group.id);
      return true;
    });

    rowsCacheRef.current[selectedNav] = uniqueRows;
    nextIndexRef.current[selectedNav] = newNextIndex;
    hasMoreRef.current[selectedNav] = newNextIndex < allGroups.length;
    setRows(uniqueRows);
    setLoadingMoreGroups(false);
  }, [loadingMoreGroups, selectedNav, loadBatch]);

  // Carregar mais itens dentro de um carrossel específico (lazy loading horizontal)
  const loadMoreCarouselItems = useCallback(async (groupId: string) => {
    if (!activePlaylist) return;

    // Evita múltiplas chamadas simultâneas para o mesmo carrossel
    if (loadingCarousels.has(groupId)) return;

    const mediaKind: MediaKind =
      selectedNav === 'movies' ? 'movie' : selectedNav === 'series' ? 'series' : 'live';

    const currentRows = rowsCacheRef.current[selectedNav];
    const rowIndex = currentRows.findIndex((r) => r.group.id === groupId);
    if (rowIndex === -1) return;

    const row = currentRows[rowIndex];

    // Marca carrossel como loading
    setLoadingCarousels((prev) => new Set(prev).add(groupId));

    // Para séries: carrega mais séries ou items
    if (mediaKind === 'series' && row.isSeries) {
      if (!(db as any).series) {
        console.warn('[HOME DEBUG] Tabela "series" não disponível no Dexie. Pulando loadMore séries.');
        setLoadingCarousels((prev) => {
          const next = new Set(prev);
          next.delete(groupId);
          return next;
        });
        return;
      }

      // Carrega mais séries se houver (keyset pagination)
      const moreSeries = row.hasMoreSeries
        ? await (row.lastSeriesId
            ? db.series
                .where({ playlistId: activePlaylist.id, group: row.group.name })
                .and((s) => s.id > row.lastSeriesId!)
                .limit(ITEMS_LOAD_MORE)
                .toArray()
            : db.series
                .where({ playlistId: activePlaylist.id, group: row.group.name })
                .limit(ITEMS_LOAD_MORE)
                .toArray())
        : [];

      // Carrega mais items não agrupados se houver (keyset pagination)
      const moreItems = row.hasMoreItems
        ? await (row.lastItemId
            ? db.items
                .where({ playlistId: activePlaylist.id, group: row.group.name, mediaKind })
                .filter((item) => !item.seriesId && item.id > row.lastItemId!)
                .limit(ITEMS_LOAD_MORE)
                .toArray()
            : db.items
                .where({ playlistId: activePlaylist.id, group: row.group.name, mediaKind })
                .filter((item) => !item.seriesId)
                .limit(ITEMS_LOAD_MORE)
                .toArray())
        : [];

      // Atualiza a row com os novos itens
      const updatedRow: Row = {
        ...row,
        series: [...(row.series || []), ...moreSeries],
        items: [...row.items, ...moreItems],
        lastSeriesId: moreSeries.length > 0 ? moreSeries[moreSeries.length - 1].id : row.lastSeriesId,
        lastItemId: moreItems.length > 0 ? moreItems[moreItems.length - 1].id : row.lastItemId,
        hasMoreSeries: moreSeries.length === ITEMS_LOAD_MORE,
        hasMoreItems: moreItems.length === ITEMS_LOAD_MORE,
      };

      const updatedRows = [...currentRows];
      updatedRows[rowIndex] = updatedRow;

      rowsCacheRef.current[selectedNav] = updatedRows;
      setRows(updatedRows);

      // Remove do loading state
      setLoadingCarousels((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      return;
    }

    // Para movies e live: carrega mais items (keyset pagination)
    const moreItems = row.hasMoreItems
      ? await (row.lastItemId
          ? db.items
              .where({ playlistId: activePlaylist.id, group: row.group.name, mediaKind })
              .and((item) => item.id > row.lastItemId!)
              .limit(ITEMS_LOAD_MORE)
              .toArray()
          : db.items
              .where({ playlistId: activePlaylist.id, group: row.group.name, mediaKind })
              .limit(ITEMS_LOAD_MORE)
              .toArray())
      : [];

    if (moreItems.length === 0) {
      setLoadingCarousels((prev) => {
        const next = new Set(prev);
        next.delete(groupId);
        return next;
      });
      return;
    }

    const updatedRow: Row = {
      ...row,
      items: [...row.items, ...moreItems],
      lastItemId: moreItems.length > 0 ? moreItems[moreItems.length - 1].id : row.lastItemId,
      hasMoreItems: moreItems.length === ITEMS_LOAD_MORE,
    };

    const updatedRows = [...currentRows];
    updatedRows[rowIndex] = updatedRow;

    rowsCacheRef.current[selectedNav] = updatedRows;
    setRows(updatedRows);

    // Remove do loading state
    setLoadingCarousels((prev) => {
      const next = new Set(prev);
      next.delete(groupId);
      return next;
    });
  }, [activePlaylist, selectedNav, loadingCarousels]);

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

  // Infinite scroll vertical: detecta quando usuário chega perto do fim da página
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

  // Scroll listener horizontal para cada carrossel (lazy loading de itens)
  useEffect(() => {
    const carouselScrollHandlers = new Map<string, () => void>();

    rows.forEach((row) => {
      const carouselElement = document.getElementById(`row-${row.group.id}`);
      if (!carouselElement) return;

      const handleCarouselScroll = () => {
        const { scrollLeft, scrollWidth, clientWidth } = carouselElement;
        const scrollPercentage = (scrollLeft + clientWidth) / scrollWidth;

        // Se chegou a 70% do scroll horizontal, carrega mais
        if (scrollPercentage > 0.7) {
          const hasMore = row.hasMoreSeries || row.hasMoreItems;
          if (hasMore) {
            loadMoreCarouselItems(row.group.id);
          }
        }
      };

      carouselScrollHandlers.set(row.group.id, handleCarouselScroll);
      carouselElement.addEventListener('scroll', handleCarouselScroll);
    });

    return () => {
      carouselScrollHandlers.forEach((handler, groupId) => {
        const carouselElement = document.getElementById(`row-${groupId}`);
        if (carouselElement) {
          carouselElement.removeEventListener('scroll', handler);
        }
      });
    };
  }, [rows, loadMoreCarouselItems]);

  // Se o conteúdo não gera scroll (poucos carrosseis), pré-carrega mais grupos
  useEffect(() => {
    if (!contentRef.current) return;
    const { scrollHeight, clientHeight } = contentRef.current;
    if (scrollHeight <= clientHeight * 1.1 && hasMoreRef.current[selectedNav] && !loadingMoreGroups) {
      loadMoreGroups();
    }
  }, [rows.length, loadingMoreGroups, loadMoreGroups, selectedNav]);

  // Reset flags ao trocar aba
  useEffect(() => {
    setLoadingMoreGroups(false);
    setLoadingCarousels(new Set());
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
                {/* Renderiza séries agrupadas primeiro (se houver) */}
                {row.isSeries && row.series?.map((series) => (
                  <SeriesCard
                    key={series.id}
                    series={series}
                    onNavigate={(seriesId) => navigate(`/series/${seriesId}`)}
                  />
                ))}
                {/* Renderiza items individuais (ou não agrupados no caso de séries) */}
                {row.items.map((item) => (
                  <MediaCard key={item.id} item={item} groupName={row.group.name} onSelectItem={onSelectItem} />
                ))}
                {/* Loading indicator no final do carrossel */}
                {loadingCarousels.has(row.group.id) && (
                  <>
                    {Array.from({ length: 4 }).map((_, idx) => (
                      <div key={`skeleton-${idx}`} className={styles.skeletonPoster} />
                    ))}
                  </>
                )}
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
