/**
 * MediaGrid
 * Grid display of media items with progressive loading
 * Refactored for Premium/Netflix-like aesthetic (Big Poster Edition)
 */

import { useEffect, useState, useRef, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type M3UItem, type M3UGroup } from '@core/db/schema';
import { usePlaylistStore } from '@store/playlistStore';
import { SkeletonCard } from '../shared';
import { MdArrowBack, MdSearchOff } from 'react-icons/md';
import styles from './MediaGrid.module.css';

interface MediaGridProps {
  group: M3UGroup;
  onBack: () => void;
  onSelectItem: (item: M3UItem) => void;
}

const PAGE_SIZE = 120;
const MIN_CARD_WIDTH = 200; // menor para caber mais colunas
const CARD_GAP = 24;
const ASPECT_RATIO = 1.5; // 2:3 ratio

export function MediaGrid({ group, onBack, onSelectItem }: MediaGridProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);
  const cacheKey = `${group.playlistId}:${group.name}:${group.mediaKind}`;

  // Sync ref with state
  useEffect(() => {
    loadingMoreRef.current = loadingMore;
  }, [loadingMore]);

  const { cacheGroupItems, getGroupCache, setMediaGridCache, getMediaGridCache } = usePlaylistStore();

  // Check cache first
  const cachedItems = getGroupCache(group.playlistId, group.name);

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
  }, [cacheKey, getMediaGridCache]);

  // Live query with dynamic limit
  const items = useLiveQuery(
    () =>
      db.items
        .where({ playlistId: group.playlistId, group: group.name, mediaKind: group.mediaKind })
        .limit(visibleCount)
        .toArray(),
    [group.playlistId, group.name, group.mediaKind, visibleCount],
    cachedItems || []
  );

  // Cache items after load
  useEffect(() => {
    if (items && items.length > 0) {
      cacheGroupItems(group.playlistId, group.name, items);
    }
  }, [items, group.playlistId, group.name, cacheGroupItems]);

  // Persist view state on unmount/change
  useEffect(() => {
    return () => {
      const scrollTop = gridRef.current?.scrollTop || 0;
      setMediaGridCache(cacheKey, { visibleCount, scrollTop });
    };
  }, [cacheKey, visibleCount, setMediaGridCache]);

  const totalCount = useLiveQuery(
    () => db.items.where({ playlistId: group.playlistId, group: group.name, mediaKind: group.mediaKind }).count(),
    [group.playlistId, group.name, group.mediaKind],
    0
  );

  const loading = items === undefined;
  const hasMore = (items?.length || 0) < (totalCount || 0);

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
    if (!gridRef.current || loading || !items || loadingMore || !hasMore) return;
    const el = gridRef.current;
    const hasScroll = el.scrollHeight > el.clientHeight;
    const isFullyLoaded = items.length >= (totalCount || 0);
    const queryCompleted = visibleCount <= items.length;

    if (!hasScroll && !isFullyLoaded && queryCompleted) {
      setLoadingMore(true);
      setVisibleCount((prev) => prev + PAGE_SIZE);
      setTimeout(() => setLoadingMore(false), 150);
    }
  }, [items?.length, totalCount, hasMore, loading, loadingMore, visibleCount]);

  const focusIndex = useCallback(
    (index: number) => {
      if (!items || index < 0 || index >= items.length) return;
      const el = gridRef.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`);
      if (el) {
        el.focus({ preventScroll: false });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
        setFocusedIndex(index);
      }
    },
    [items]
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
    if (!loading && items && items.length > 0 && focusedIndex === null) {
      // Small delay to ensure render
      setTimeout(() => focusIndex(0), 50);
    }
  }, [loading, items, focusIndex, focusedIndex]);

  const getDisplayName = useCallback((item: M3UItem): string => {
    return item.title || item.name;
  }, []);

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

  if (!loading && items && items.length === 0) {
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
        {items?.map((item, idx) => (
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
        ))}
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
