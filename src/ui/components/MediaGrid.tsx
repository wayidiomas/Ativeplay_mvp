/**
 * MediaGrid
 * Grid display of media items with progressive loading
 * Refactored for Premium/Netflix-like aesthetic (Big Poster Edition)
 *
 * FIX: Para séries, mostra grupos de séries (com episódios/temporadas)
 *      ao invés de episódios individuais
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type M3UItem, type M3UGroup, type Series } from '@core/db/schema';
import { usePlaylistStore } from '@store/playlistStore';
import { SkeletonCard } from '../shared';
import { MdArrowBack, MdSearchOff, MdTv } from 'react-icons/md';
import styles from './MediaGrid.module.css';

interface MediaGridProps {
  group: M3UGroup;
  onBack: () => void;
  onSelectItem: (item: M3UItem) => void;
}

const PAGE_SIZE = 120;
const MIN_CARD_WIDTH = 200; // menor para caber mais colunas
const CARD_GAP = 24;

export function MediaGrid({ group, onBack, onSelectItem }: MediaGridProps) {
  const navigate = useNavigate();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true); // ✅ FIX: Skeleton imediato
  const gridRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const cacheKey = `${group.playlistId}:${group.name}:${group.mediaKind}`;
  const isSeries = group.mediaKind === 'series'; // ✅ FIX: Detecta se é aba de séries

  // Sync ref with state
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const { cacheGroupItems, setMediaGridCache, getMediaGridCache } = usePlaylistStore();

  // Restore view state if cached
  useEffect(() => {
    const cachedView = getMediaGridCache(cacheKey);
    if (cachedView) {
      setVisibleCount(Math.max(PAGE_SIZE, cachedView.visibleCount));
      requestAnimationFrame(() => {
        if (gridRef.current) {
          gridRef.current.scrollTop = cachedView.scrollTop;
        }
      });
    } else {
      setVisibleCount(PAGE_SIZE);
    }
    setFocusedIndex(null);
    setIsInitialLoad(true); // ✅ FIX: Reset on group change
  }, [cacheKey, getMediaGridCache]);

  // ✅ FIX: Query separada para séries (tabela series)
  const seriesData = useLiveQuery(
    async () => {
      if (!isSeries) return [];
      return db.series
        .where({ playlistId: group.playlistId, group: group.name })
        .limit(visibleCount)
        .toArray();
    },
    [group.playlistId, group.name, visibleCount, isSeries],
    undefined // ✅ FIX: undefined para detectar loading
  );

  // Live query for items (non-series)
  const items = useLiveQuery(
    () => {
      if (isSeries) return []; // Séries usa query separada
      return db.items
        .where({ playlistId: group.playlistId, group: group.name, mediaKind: group.mediaKind })
        .limit(visibleCount)
        .toArray();
    },
    [group.playlistId, group.name, group.mediaKind, visibleCount, isSeries],
    undefined // ✅ FIX: undefined para detectar loading
  );

  // ✅ FIX: Marca loading completo quando dados chegam
  useEffect(() => {
    if (isSeries && seriesData !== undefined) {
      setIsInitialLoad(false);
    } else if (!isSeries && items !== undefined) {
      setIsInitialLoad(false);
    }
  }, [isSeries, seriesData, items]);

  // Cache items after load
  useEffect(() => {
    if (!isSeries && items && items.length > 0) {
      cacheGroupItems(group.playlistId, group.name, items);
    }
  }, [items, group.playlistId, group.name, cacheGroupItems, isSeries]);

  // Persist view state on unmount/change
  useEffect(() => {
    return () => {
      const scrollTop = gridRef.current?.scrollTop || 0;
      setMediaGridCache(cacheKey, { visibleCount, scrollTop });
    };
  }, [cacheKey, visibleCount, setMediaGridCache]);

  // ✅ FIX: Total count para séries ou items
  const totalCount = useLiveQuery(
    () => {
      if (isSeries) {
        return db.series.where({ playlistId: group.playlistId, group: group.name }).count();
      }
      return db.items.where({ playlistId: group.playlistId, group: group.name, mediaKind: group.mediaKind }).count();
    },
    [group.playlistId, group.name, group.mediaKind, isSeries],
    0
  );

  // ✅ FIX: Loading agora usa isInitialLoad para skeleton imediato
  const loading = isInitialLoad;
  const dataLength = isSeries ? (seriesData?.length || 0) : (items?.length || 0);
  const hasMore = dataLength < (totalCount || 0);

  // Calculate columns per row dynamically
  const [columnsPerRow, setColumnsPerRow] = useState(5);

  useEffect(() => {
    const updateLayout = () => {
      if (!gridRef.current) return;
      const containerWidth = gridRef.current.clientWidth - 48; // padding lateral
      // Calculate how many cards fit with min width + gap
      const cols = Math.floor((containerWidth + CARD_GAP) / (MIN_CARD_WIDTH + CARD_GAP)) || 1;

      setColumnsPerRow(cols);
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  // Reset on group change
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setFocusedIndex(null);
  }, [group]);

  // Infinite scroll
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const onScroll = () => {
      if (!hasMore || loadingMoreRef.current) return;
      const threshold = el.scrollHeight * 0.4; // Trigger earlier (40% remaining)
      const scrollBottom = el.scrollTop + el.clientHeight;

      if (scrollBottom >= el.scrollHeight - threshold) {
        setLoadingMore(true);
        setVisibleCount((prev) => prev + PAGE_SIZE);
        setTimeout(() => setLoadingMore(false), 200);
      }
    };

    el.addEventListener('scroll', onScroll);
    onScroll(); // Initial check
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore]);

  // Auto-load more if no scroll
  useEffect(() => {
    if (!gridRef.current || loading || loadingMore || !hasMore) return;
    if (dataLength === 0) return; // ✅ FIX: Aguarda dados carregarem
    const el = gridRef.current;
    const hasScroll = el.scrollHeight > el.clientHeight;
    const isFullyLoaded = dataLength >= (totalCount || 0);
    const queryCompleted = visibleCount <= dataLength;

    if (!hasScroll && !isFullyLoaded && queryCompleted) {
      setLoadingMore(true);
      setVisibleCount((prev) => prev + PAGE_SIZE);
      setTimeout(() => setLoadingMore(false), 150);
    }
  }, [dataLength, totalCount, hasMore, loading, loadingMore, visibleCount]);

  const focusIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= dataLength) return;
      const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`);
      if (el) {
        el.focus({ preventScroll: false });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        setFocusedIndex(index);
      }
    },
    [dataLength]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        onBack();
        return;
      }

      if (gridRef.current && document.activeElement?.closest(`.${styles.grid}`)) {
        switch (e.key) {
          case 'ArrowUp':
            focusIndex((focusedIndex ?? 0) - columnsPerRow);
            e.preventDefault();
            break;
          case 'ArrowDown':
            focusIndex((focusedIndex ?? 0) + columnsPerRow);
            e.preventDefault();
            break;
          case 'ArrowLeft':
            focusIndex((focusedIndex ?? 0) - 1);
            e.preventDefault();
            break;
          case 'ArrowRight':
            focusIndex((focusedIndex ?? 0) + 1);
            e.preventDefault();
            break;
          case 'PageUp':
            focusIndex((focusedIndex ?? 0) - (columnsPerRow * 3));
            e.preventDefault();
            break;
          case 'PageDown':
            focusIndex((focusedIndex ?? 0) + (columnsPerRow * 3));
            e.preventDefault();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusIndex, focusedIndex, onBack, columnsPerRow]);

  // Auto-focus first card
  useEffect(() => {
    if (!loading && dataLength > 0 && focusedIndex === null) {
      // Small delay to ensure render
      setTimeout(() => focusIndex(0), 50);
    }
  }, [loading, dataLength, focusIndex, focusedIndex]);

  const getDisplayName = useCallback((item: M3UItem): string => {
    return item.title || item.name;
  }, []);

  // ✅ FIX: Handler para navegar para página de série
  const handleSeriesClick = useCallback((series: Series) => {
    navigate(`/series/${series.id}`);
  }, [navigate]);

  // ✅ FIX: Skeleton mostrado imediatamente no loading
  if (loading) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backButton} onClick={onBack}>
            <MdArrowBack />
          </button>
          <h1 className={styles.title}>{group.name}</h1>
        </header>
        <div className={styles.skeletonGrid}>
          <SkeletonCard count={12} />
        </div>
      </div>
    );
  }

  // ✅ FIX: Empty state usa dataLength
  if (!loading && dataLength === 0) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backButton} onClick={onBack}>
            <MdArrowBack />
          </button>
          <h1 className={styles.title}>{group.name}</h1>
        </header>
        <div className={styles.emptyState}>
          <MdSearchOff className={styles.emptyIcon} />
          <h2 className={styles.emptyTitle}>Nenhum Item Encontrado</h2>
          <p className={styles.emptyText}>Esta categoria não possui conteúdo disponível no momento.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button
          className={styles.backButton}
          onClick={onBack}
          autoFocus
          tabIndex={0}
          aria-label="Voltar"
        >
          <MdArrowBack />
        </button>
        <h1 className={styles.title}>{group.name}</h1>
        <span className={styles.itemCount}>
          {totalCount.toLocaleString()} {totalCount === 1 ? 'título' : 'títulos'}
        </span>
      </header>

      <div ref={gridRef} className={styles.grid} style={{ height: '100%' }}>
        {/* ✅ FIX: Renderiza séries OU items dependendo do tipo */}
        {isSeries ? (
          // Renderiza cards de SÉRIES (agrupadas com episódios/temporadas)
          seriesData?.map((series, idx) => (
            <button
              key={series.id}
              className={styles.card}
              onClick={() => handleSeriesClick(series)}
              data-index={idx}
              onFocus={() => setFocusedIndex(idx)}
              onMouseEnter={() => setFocusedIndex(idx)}
              tabIndex={0}
            >
              {series.logo ? (
                <img
                  src={series.logo}
                  alt={series.name}
                  className={styles.cardPoster}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove(styles.hidden);
                  }}
                />
              ) : null}

              <div
                className={styles.cardPlaceholder}
                style={series.logo ? { display: 'none' } : undefined}
              >
                <MdTv size={32} />
              </div>

              <div className={styles.cardOverlay}>
                <div className={styles.cardTitle}>{series.name}</div>
                <div className={styles.cardMeta}>
                  {series.year && <span className={styles.cardYear}>{series.year}</span>}
                  {series.quality && <span className={styles.cardQuality}>{series.quality}</span>}
                  <span className={styles.cardYear}>
                    {series.totalSeasons} temp · {series.totalEpisodes} ep
                  </span>
                </div>
              </div>
            </button>
          ))
        ) : (
          // Renderiza cards de ITEMS (filmes/live)
          items?.map((item, idx) => (
            <button
              key={item.id}
              className={styles.card}
              onClick={() => onSelectItem(item)}
              data-index={idx}
              onFocus={() => setFocusedIndex(idx)}
              onMouseEnter={() => setFocusedIndex(idx)}
              tabIndex={0}
            >
              {item.logo ? (
                <img
                  src={item.logo}
                  alt={getDisplayName(item)}
                  className={styles.cardPoster}
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (e.target as HTMLImageElement).nextElementSibling?.classList.remove(styles.hidden);
                  }}
                />
              ) : null}

              <div
                className={styles.cardPlaceholder}
                style={item.logo ? { display: 'none' } : undefined}
              >
                {item.mediaKind === 'live' ? 'TV' : item.name.charAt(0).toUpperCase()}
              </div>

              <div className={styles.cardOverlay}>
                <div className={styles.cardTitle}>{getDisplayName(item)}</div>
                <div className={styles.cardMeta}>
                  {item.year && <span className={styles.cardYear}>{item.year}</span>}
                  {item.quality && <span className={styles.cardQuality}>{item.quality}</span>}
                  {item.season && item.episode && (
                    <span className={styles.cardYear}>
                      S{item.season.toString().padStart(2, '0')}E{item.episode.toString().padStart(2, '0')}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {loadingMore && (
        <div className={styles.loadingMore}>
          <div className={styles.spinner} />
          <span>Carregando mais títulos...</span>
        </div>
      )}
    </div>
  );
}

export default MediaGrid;
