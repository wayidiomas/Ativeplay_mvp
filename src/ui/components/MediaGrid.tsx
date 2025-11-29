/**
 * MediaGrid
 * Grid display of media items (movies, series, live channels)
 * NOW WITH VIRTUAL SCROLLING for memory optimization
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { db, type M3UItem, type M3UGroup } from '@core/db/schema';
import styles from './MediaGrid.module.css';

interface MediaGridProps {
  group: M3UGroup;
  onBack: () => void;
  onSelectItem: (item: M3UItem) => void;
}

const INITIAL_LOAD_LIMIT = 1000; // Load first 1000 items, render only visible
const ITEMS_PER_ROW = 5;
const ROW_HEIGHT = 260;

export function MediaGrid({ group, onBack, onSelectItem }: MediaGridProps) {
  const [allItems, setAllItems] = useState<M3UItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const parentRef = useRef<HTMLDivElement>(null);

  // Load items for the group - virtual scrolling loads all at once
  // but only renders visible items
  useEffect(() => {
    async function loadItems() {
      setLoading(true);
      try {
        // Get total count first
        const count = await db.items
          .where({ playlistId: group.playlistId, group: group.name })
          .count();

        setTotalCount(count);

        // Load initial batch (up to 1000 items)
        // For larger lists, we could implement progressive loading
        const limit = Math.min(count, INITIAL_LOAD_LIMIT);
        const loadedItems = await db.items
          .where({ playlistId: group.playlistId, group: group.name })
          .limit(limit)
          .toArray();

        setAllItems(loadedItems);
      } catch (error) {
        console.error('Erro ao carregar itens:', error);
        setAllItems([]);
        setTotalCount(0);
      } finally {
        setLoading(false);
      }
    }

    loadItems();
  }, [group]);

  const rowVirtualizer = useVirtualizer({
    count: Math.ceil(allItems.length / ITEMS_PER_ROW),
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 2, // Render 2 extra rows above/below viewport
  });

  // Focus helper for keyboard/remote
  const focusIndex = useCallback(
    (index: number) => {
      if (index < 0 || index >= allItems.length) return;
      const tryFocus = () => {
        const el = parentRef.current?.querySelector<HTMLButtonElement>(
          `[data-index="${index}"]`
        );
        if (el) {
          el.focus({ preventScroll: false });
          setFocusedIndex(index);
        }
      };
      // Ensure row is in view for virtualizer
      const row = Math.floor(index / ITEMS_PER_ROW);
      const offset = row * ROW_HEIGHT;
      parentRef.current?.scrollTo({ top: offset, behavior: 'smooth' });
      requestAnimationFrame(tryFocus);
    },
    [allItems.length]
  );

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        onBack();
        return;
      }

      if (parentRef.current && document.activeElement?.closest(`.${styles.grid}`)) {
        switch (e.key) {
          case 'ArrowUp':
            focusIndex(focusedIndex - ITEMS_PER_ROW);
            e.preventDefault();
            break;
          case 'ArrowDown':
            focusIndex(focusedIndex + ITEMS_PER_ROW);
            e.preventDefault();
            break;
          case 'ArrowLeft':
            focusIndex(focusedIndex - 1);
            e.preventDefault();
            break;
          case 'ArrowRight':
            focusIndex(focusedIndex + 1);
            e.preventDefault();
            break;
          case 'PageUp':
            focusIndex(focusedIndex - ITEMS_PER_ROW * 2);
            e.preventDefault();
            break;
          case 'PageDown':
            focusIndex(focusedIndex + ITEMS_PER_ROW * 2);
            e.preventDefault();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focusIndex, focusedIndex, onBack]);

  const getDisplayName = useCallback((item: M3UItem): string => {
    return item.title || item.name;
  }, []);

  // Auto-focus first card when items carregados
  useEffect(() => {
    if (!loading && allItems.length > 0) {
      focusIndex(0);
    }
  }, [loading, allItems.length, focusIndex]);

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
          {Array.from({ length: 12 }).map((_, idx) => (
            <div key={idx} className={styles.skeletonCard}>
              <div className={styles.skeletonPoster} />
              <div className={styles.skeletonBar} />
              <div className={styles.skeletonMeta} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (allItems.length === 0 && !loading) {
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
          <p className={styles.emptyText}>
            Esta categoria esta vazia
          </p>
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
          {totalCount} {totalCount === 1 ? 'item' : 'itens'}
          {totalCount > INITIAL_LOAD_LIMIT && (
            <span style={{ opacity: 0.7 }}> (mostrando {INITIAL_LOAD_LIMIT})</span>
          )}
        </span>
      </header>

      <div
        ref={parentRef}
        className={styles.grid}
        style={{
          height: '100%',
          overflow: 'auto',
        }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            // Each virtual row contains ITEMS_PER_ROW items
            const startIdx = virtualRow.index * ITEMS_PER_ROW;
            const rowItems = allItems.slice(startIdx, startIdx + ITEMS_PER_ROW);

            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: '20px',
                }}
              >
                {rowItems.map((item) => (
                  <button
                    key={item.id}
                    className={styles.card}
                    onClick={() => onSelectItem(item)}
                    data-index={startIdx + rowItems.indexOf(item)}
                    onFocus={(e) => {
                      // Auto scroll to keep focused card visible
                      e.currentTarget.scrollIntoView({
                        behavior: 'smooth',
                        block: 'nearest',
                        inline: 'nearest'
                      });
                      setFocusedIndex(startIdx + rowItems.indexOf(item));
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
                    <div className={styles.cardPlaceholder} style={item.logo ? { display: 'none' } : undefined}>
                      {item.mediaKind === 'live' ? 'O' : '#'}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default MediaGrid;
