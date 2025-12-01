/**
 * useFocusedPagination Hook
 *
 * Triggers pagination based on focused item index instead of scroll position.
 * Designed for TV navigation where IntersectionObserver doesn't work with D-PAD.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

// Configuration constants
const DEFAULT_THRESHOLD = 5;      // Load when N items from end
const DEBOUNCE_MS = 150;          // Debounce rapid navigation

export interface UseFocusedPaginationOptions {
  /** Current number of loaded items */
  totalItems: number;
  /** Whether more items are available */
  hasMore: boolean;
  /** Prevent duplicate fetches */
  isLoading: boolean;
  /** Function to load more items */
  loadMore: () => void;
  /** How many items from end to trigger load (default: 5) */
  threshold?: number;
  /** Number of columns for grid layout (1 for horizontal lists) */
  columnCount?: number;
}

export interface UseFocusedPaginationReturn {
  /** Call this when an item receives focus */
  onItemFocused: (index: number) => void;
  /** Current focused item index */
  focusedIndex: number;
  /** Set focused index programmatically */
  setFocusedIndex: (index: number) => void;
  /** Whether we're in the loading threshold zone */
  isNearEnd: boolean;
}

/**
 * Hook that manages pagination based on focus position
 *
 * @example
 * ```tsx
 * const { onItemFocused, isNearEnd } = useFocusedPagination({
 *   totalItems: items.length,
 *   hasMore,
 *   isLoading,
 *   loadMore: () => fetchMoreItems(),
 *   threshold: 5,
 * });
 *
 * // In your card component:
 * <Card onFocus={() => onItemFocused(index)} />
 * ```
 */
export function useFocusedPagination({
  totalItems,
  hasMore,
  isLoading,
  loadMore,
  threshold = DEFAULT_THRESHOLD,
  columnCount: _columnCount = 1,
}: UseFocusedPaginationOptions): UseFocusedPaginationReturn {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const loadTriggeredRef = useRef(false);
  const lastLoadTimeRef = useRef<number>(0);

  // Calculate if we're near the end
  const itemsRemaining = totalItems - focusedIndex - 1;
  const isNearEnd = itemsRemaining <= threshold;

  // Reset load trigger when items are added
  useEffect(() => {
    if (!isLoading && loadTriggeredRef.current) {
      // Items loaded, reset trigger
      loadTriggeredRef.current = false;
    }
  }, [totalItems, isLoading]);

  // Handle item focus with debounce
  const onItemFocused = useCallback((index: number) => {
    setFocusedIndex(index);

    // Check if we should load more
    const now = Date.now();
    const timeSinceLastLoad = now - lastLoadTimeRef.current;

    // Debounce rapid navigation
    if (timeSinceLastLoad < DEBOUNCE_MS) {
      return;
    }

    const remaining = totalItems - index - 1;
    const shouldLoad = remaining <= threshold && hasMore && !isLoading && !loadTriggeredRef.current;

    if (shouldLoad) {
      loadTriggeredRef.current = true;
      lastLoadTimeRef.current = now;
      loadMore();
    }
  }, [totalItems, threshold, hasMore, isLoading, loadMore]);

  return {
    onItemFocused,
    focusedIndex,
    setFocusedIndex,
    isNearEnd,
  };
}

/**
 * Calculate navigation for grid layouts
 */
export function calculateGridNavigation(
  currentIndex: number,
  direction: 'up' | 'down' | 'left' | 'right',
  totalItems: number,
  columnCount: number
): number | null {
  let newIndex: number | null = null;

  switch (direction) {
    case 'right':
      // Can move right if not at end of row and not at last item
      if ((currentIndex + 1) % columnCount !== 0 && currentIndex < totalItems - 1) {
        newIndex = currentIndex + 1;
      }
      break;

    case 'left':
      // Can move left if not at start of row
      if (currentIndex % columnCount !== 0) {
        newIndex = currentIndex - 1;
      }
      break;

    case 'down':
      // Can move down if there's a row below
      if (currentIndex + columnCount < totalItems) {
        newIndex = currentIndex + columnCount;
      }
      break;

    case 'up':
      // Can move up if there's a row above
      if (currentIndex - columnCount >= 0) {
        newIndex = currentIndex - columnCount;
      }
      break;
  }

  return newIndex;
}

export default useFocusedPagination;
