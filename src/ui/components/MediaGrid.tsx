/**
 * MediaGrid
 * Grid display of media items with progressive loading
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type M3UItem, type M3UGroup } from '@core/db/schema';
import { usePlaylistStore } from '@store/playlistStore';
import { SkeletonCard } from '../shared';
import styles from './MediaGrid.module.css';

interface MediaGridProps {
  group: M3UGroup;
  onBack: () => void;
  onSelectItem: (item: M3UItem) => void;
}

const PAGE_SIZE = 120;

export function MediaGrid({ group, onBack, onSelectItem }: MediaGridProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  // Sincroniza ref com state
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const { cacheGroupItems, getGroupCache } = usePlaylistStore();

  // Check cache first for instant load on revisit (10x faster)
  const cachedItems = getGroupCache(group.playlistId, group.name);

  // Live query com limit dinâmico - atualiza automaticamente quando novos items chegam
  const items = useLiveQuery(
    () =>
      db.items
        .where({ playlistId: group.playlistId, group: group.name, mediaKind: group.mediaKind })
        .limit(visibleCount)
        .toArray(),
    [group.playlistId, group.name, group.mediaKind, visibleCount],
    cachedItems || [] // Use cache as fallback for instant display
  );

  // Cache items after they're loaded
  useEffect(() => {
    if (items && items.length > 0) {
      cacheGroupItems(group.playlistId, group.name, items);
    }
  }, [items, group.playlistId, group.name, cacheGroupItems]);

  const totalCount = useLiveQuery(
    () => db.items.where({ playlistId: group.playlistId, group: group.name, mediaKind: group.mediaKind }).count(),
    [group.playlistId, group.name, group.mediaKind],
    0
  );

  const loading = items === undefined;
  const hasMore = (items?.length || 0) < (totalCount || 0);

  // Debug log
  useEffect(() => {
    if (!loading && items) {
      console.log(`[MediaGrid] visibleCount=${visibleCount}, loaded=${items.length}, total=${totalCount}, hasMore=${hasMore}`);
    }
  }, [visibleCount, items?.length, totalCount, hasMore, loading]);

  // Reset visibleCount quando grupo muda
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
    setFocusedIndex(null);
  }, [group]);

  // Infinite scroll: aumenta visibleCount para carregar mais items
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const onScroll = () => {
      if (!hasMore || loadingMoreRef.current) return;
      const threshold = 300; // threshold de 300px do fim
      const scrollBottom = el.scrollTop + el.clientHeight;
      const isNearBottom = scrollBottom >= el.scrollHeight - threshold;

      if (isNearBottom) {
        console.log('[MediaGrid] Infinite scroll triggered');
        setLoadingMore(true);
        setVisibleCount((prev) => prev + PAGE_SIZE);
        // Debounce visual
        setTimeout(() => setLoadingMore(false), 200);
      }
    };

    el.addEventListener('scroll', onScroll);
    // Dispara um check inicial caso já esteja no fundo
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore]);

  // Pré-carrega mais itens se o conteúdo inicial não criar scroll
  useEffect(() => {
    if (!gridRef.current || loading || !items || loadingMore || !hasMore) return;

    const el = gridRef.current;
    const hasScroll = el.scrollHeight > el.clientHeight;

    // Se não tem scroll e ainda há mais itens, carrega mais
    // Garante que visibleCount está sincronizado com items.length antes de carregar mais
    // ou que items.length alcançou totalCount
    const isFullyLoaded = items.length >= (totalCount || 0);
    const queryCompleted = visibleCount <= items.length;

    if (!hasScroll && !isFullyLoaded && queryCompleted) {
      console.log('[MediaGrid] Auto-loading more items (no scroll detected)');
      setLoadingMore(true);
      setVisibleCount((prev) => prev + PAGE_SIZE);
      setTimeout(() => setLoadingMore(false), 150);
    }
  }, [items?.length, totalCount, hasMore, loading, loadingMore, visibleCount]);

  const focusIndex = useCallback(
    (index: number) => {
      if (!items || index < 0 || index >= items.length) return;
      const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-index=\"${index}\"]`);
      if (el) {
        el.focus({ preventScroll: false });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        setFocusedIndex(index);
      }
    },
    [items]
  );

  // Keyboard navigation for TV/remote
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        onBack();
        return;
      }

      if (gridRef.current && document.activeElement?.closest(`.${styles.grid}`)) {
        switch (e.key) {
          case 'ArrowUp':
            focusIndex((focusedIndex ?? 0) - 5);
            e.preventDefault();
            break;
          case 'ArrowDown':
            focusIndex((focusedIndex ?? 0) + 5);
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
            focusIndex((focusedIndex ?? 0) - 10);
            e.preventDefault();
            break;
          case 'PageDown':
            focusIndex((focusedIndex ?? 0) + 10);
            e.preventDefault();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown, { passive: false });
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusIndex, focusedIndex, onBack]);

  // Auto-focus primeiro card
  useEffect(() => {
    if (!loading && items && items.length > 0 && focusedIndex === null) {
      focusIndex(0);
    }
  }, [loading, items, focusIndex, focusedIndex]);

  // Wheel event listener com { passive: false } para permitir preventDefault
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // Previne scroll default do browser
      el.scrollBy({ top: e.deltaY });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const getDisplayName = useCallback((item: M3UItem): string => {
    return item.title || item.name;
  }, []);

  if (loading) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backButton} onClick={onBack} tabIndex={0}>
            {'<'}
          </button>
          <h1 className={styles.title}>{group.name}</h1>
        </header>
        <div className={styles.skeletonGrid}>
          <SkeletonCard count={12} />
        </div>
      </div>
    );
  }

  if (!loading && items && items.length === 0) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backButton} onClick={onBack} tabIndex={0}>
            {'<'}
          </button>
          <h1 className={styles.title}>{group.name}</h1>
        </header>
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>?</div>
          <h2 className={styles.emptyTitle}>Nenhum Item</h2>
          <p className={styles.emptyText}>Esta categoria está vazia</p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <button className={styles.backButton} onClick={onBack} autoFocus tabIndex={0}>
          {'<'}
        </button>
        <h1 className={styles.title}>{group.name}</h1>
        <span className={styles.itemCount}>
          {totalCount.toLocaleString()} {totalCount === 1 ? 'item' : 'itens'}
          {hasMore && <span style={{ opacity: 0.7 }}> (carregando mais)</span>}
        </span>
      </header>

      <div
        ref={gridRef}
        className={styles.grid}
        style={{
          height: '100%',
          overflow: 'auto',
        }}
      >
        {items?.map((item: M3UItem, idx: number) => (
          <button
            key={item.id}
            className={styles.card}
            onClick={() => onSelectItem(item)}
            data-index={idx}
            onFocus={(e) => {
              e.currentTarget.scrollIntoView({
                behavior: 'smooth',
                block: 'nearest',
                inline: 'nearest',
              });
              setFocusedIndex(idx);
            }}
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
              {item.mediaKind === 'live' ? 'TV' : '#'}
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
        ))}
      </div>

      {loadingMore && (
        <div className={styles.loadingMore}>
          <div className={styles.spinner} />
          <span>Carregando mais...</span>
        </div>
      )}
    </div>
  );
}

export default MediaGrid;
