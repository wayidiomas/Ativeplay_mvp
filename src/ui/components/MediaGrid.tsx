/**
 * MediaGrid
 * Grid display of media items (movies, series, live channels)
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { db, type M3UItem, type M3UGroup } from '@core/db/schema';
import styles from './MediaGrid.module.css';

interface MediaGridProps {
  group: M3UGroup;
  onBack: () => void;
  onSelectItem: (item: M3UItem) => void;
}

const PAGE_SIZE = 60;

export function MediaGrid({ group, onBack, onSelectItem }: MediaGridProps) {
  const [items, setItems] = useState<M3UItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingMoreRef = useRef(false);

  // Load items for the group
  useEffect(() => {
    async function loadItems() {
      setLoading(true);
      try {
        const loadedItems = await db.items
          .where({ playlistId: group.playlistId, group: group.name })
          .offset(0)
          .limit(PAGE_SIZE)
          .toArray();

        setItems(loadedItems);
        setHasMore(loadedItems.length === PAGE_SIZE);
        setPage(1);
      } catch (error) {
        console.error('Erro ao carregar itens:', error);
        setItems([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    }

    loadItems();
  }, [group]);

  // Incremental load (infinite scroll)
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    try {
      const offset = page * PAGE_SIZE;
      const moreItems = await db.items
        .where({ playlistId: group.playlistId, group: group.name })
        .offset(offset)
        .limit(PAGE_SIZE)
        .toArray();

      setItems((prev) => [...prev, ...moreItems]);
      setHasMore(moreItems.length === PAGE_SIZE);
      setPage((prev) => prev + 1);
    } catch (error) {
      console.error('Erro ao carregar mais itens:', error);
      setHasMore(false);
    } finally {
      loadingMoreRef.current = false;
    }
  }, [group, hasMore, page]);

  // IntersectionObserver para disparar loadMore
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      },
      { root: null, rootMargin: '0px', threshold: 0.1 }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore]);

  // Keyboard navigation and scroll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Backspace') {
        onBack();
        return;
      }

      // Handle grid scroll with arrow keys
      const gridArea = document.querySelector(`.${styles.grid}`) as HTMLElement;
      if (gridArea && document.activeElement?.closest(`.${styles.grid}`)) {
        const scrollAmount = 200;
        switch (e.key) {
          case 'ArrowUp':
            gridArea.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
            e.preventDefault();
            break;
          case 'ArrowDown':
            gridArea.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            e.preventDefault();
            break;
          case 'PageUp':
            gridArea.scrollBy({ top: -gridArea.clientHeight, behavior: 'smooth' });
            e.preventDefault();
            break;
          case 'PageDown':
            gridArea.scrollBy({ top: gridArea.clientHeight, behavior: 'smooth' });
            e.preventDefault();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onBack]);

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
        <div className={styles.loading}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Carregando...</span>
        </div>
      </div>
    );
  }

  if (items.length === 0) {
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
          {items.length} {items.length === 1 ? 'item' : 'itens'}
        </span>
      </header>

      <div className={styles.grid}>
        {items.map((item) => (
          <button
            key={item.id}
            className={styles.card}
            onClick={() => onSelectItem(item)}
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
        <div ref={sentinelRef} className={styles.sentinel} aria-hidden />
      </div>
      {hasMore && (
        <div className={styles.loadingMore}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Carregando mais...</span>
        </div>
      )}
    </div>
  );
}

export default MediaGrid;
