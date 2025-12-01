/**
 * VirtualizedGrid - Vertical virtualized grid with spatial navigation
 *
 * Uses @tanstack/react-virtual to render only visible rows.
 * Designed for TV remote D-PAD navigation with focus-based pagination.
 */

import { useRef, useState, useEffect, useCallback, memo, useMemo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';

// Configuration constants
const DEFAULT_CARD_WIDTH = 200;
const DEFAULT_CARD_HEIGHT = 280;
const DEFAULT_CARD_GAP = 16;
const DEFAULT_OVERSCAN = 2;
const LOAD_MORE_THRESHOLD = 2; // Rows from end to trigger load

export interface VirtualizedGridProps<T> {
  /** Unique focus key for spatial navigation */
  focusKey: string;
  /** Array of items to render */
  items: T[];
  /** Whether more items can be loaded */
  hasMore: boolean;
  /** Loading state to prevent duplicate fetches */
  isLoading: boolean;
  /** Callback to load more items */
  onLoadMore: () => void;
  /** Function to extract unique key from item */
  getItemKey: (item: T) => string;
  /** Render function for each item */
  renderItem: (
    item: T,
    index: number,
    focusKey: string,
    isFocused: boolean
  ) => React.ReactNode;
  /** Callback when an item receives focus */
  onItemFocus?: (item: T, index: number) => void;
  /** Callback when an item is selected (Enter pressed) */
  onItemSelect?: (item: T, index: number) => void;
  /** Number of columns in the grid */
  columnCount?: number;
  /** Card width in pixels */
  cardWidth?: number;
  /** Card height in pixels */
  cardHeight?: number;
  /** Gap between cards in pixels */
  cardGap?: number;
  /** Extra rows to render outside viewport */
  overscan?: number;
  /** CSS class for container */
  className?: string;
}

/**
 * Wrapper component for grid items with focus support
 */
const GridItemWrapper = memo(function GridItemWrapper({
  focusKey,
  index,
  onFocused,
  onSelect,
  children,
}: {
  focusKey: string;
  index: number;
  onFocused: (index: number) => void;
  onSelect?: () => void;
  children: React.ReactNode;
}) {
  const { ref, focused, focusSelf } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onFocus: () => onFocused(index),
  });

  // Scroll into view when focused
  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [focused]);

  // Handle click - focus first, then select
  const handleClick = useCallback(() => {
    focusSelf();
    if (onSelect) {
      onSelect();
    }
  }, [focusSelf, onSelect]);

  return (
    <div
      ref={ref}
      data-focused={focused}
      data-index={index}
      style={{ height: '100%', outline: 'none', cursor: 'pointer' }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
    >
      {children}
    </div>
  );
});

export function VirtualizedGrid<T>({
  focusKey,
  items,
  hasMore,
  isLoading,
  onLoadMore,
  getItemKey,
  renderItem,
  onItemFocus,
  onItemSelect,
  columnCount = 5,
  cardWidth = DEFAULT_CARD_WIDTH,
  cardHeight = DEFAULT_CARD_HEIGHT,
  cardGap = DEFAULT_CARD_GAP,
  overscan = DEFAULT_OVERSCAN,
  className = '',
}: VirtualizedGridProps<T>) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const loadTriggeredRef = useRef(false);

  // Calculate row data
  const rowCount = Math.ceil(items.length / columnCount);
  const rowHeight = cardHeight + cardGap;

  // Initialize virtualizer for vertical scrolling (by rows)
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => rowHeight,
    overscan,
  });

  // Calculate grid navigation
  const calculateNavigation = useCallback(
    (direction: string): number | null => {
      const currentCol = focusedIndex % columnCount;

      switch (direction) {
        case 'right':
          if (currentCol < columnCount - 1 && focusedIndex < items.length - 1) {
            return focusedIndex + 1;
          }
          return null;

        case 'left':
          if (currentCol > 0) {
            return focusedIndex - 1;
          }
          return null;

        case 'down':
          const downIndex = focusedIndex + columnCount;
          if (downIndex < items.length) {
            return downIndex;
          }
          return null;

        case 'up':
          const upIndex = focusedIndex - columnCount;
          if (upIndex >= 0) {
            return upIndex;
          }
          return null;

        default:
          return null;
      }
    },
    [focusedIndex, columnCount, items.length]
  );

  // Handle arrow key navigation
  const handleArrowPress = useCallback(
    (direction: string) => {
      const newIndex = calculateNavigation(direction);

      if (newIndex !== null) {
        const item = items[newIndex];
        if (item) {
          setFocus(`${focusKey}-item-${getItemKey(item)}`);
        }
        return false; // We handle navigation
      }

      return true; // Allow escape from grid
    },
    [focusKey, calculateNavigation, items, getItemKey]
  );

  // Focus context for spatial navigation
  const { ref: focusContainerRef, focusKey: currentFocusKey } = useFocusable({
    focusKey,
    isFocusBoundary: false,
    focusBoundaryDirections: ['up', 'down', 'left', 'right'],
    onArrowPress: handleArrowPress,
    saveLastFocusedChild: true,
  });

  // Handle item focus - update index, scroll, trigger load more
  const handleItemFocus = useCallback(
    (index: number) => {
      setFocusedIndex(index);

      // Calculate which row this item is in
      const rowIndex = Math.floor(index / columnCount);

      // Scroll to row
      virtualizer.scrollToIndex(rowIndex, {
        align: 'center',
        behavior: 'smooth',
      });

      // Notify parent
      if (items[index] && onItemFocus) {
        onItemFocus(items[index], index);
      }

      // Check if we should load more (within LOAD_MORE_THRESHOLD rows of end)
      const rowsFromEnd = rowCount - rowIndex - 1;
      if (rowsFromEnd <= LOAD_MORE_THRESHOLD && hasMore && !isLoading && !loadTriggeredRef.current) {
        loadTriggeredRef.current = true;
        onLoadMore();
      }
    },
    [virtualizer, items, onItemFocus, hasMore, isLoading, onLoadMore, columnCount, rowCount]
  );

  // Reset load trigger when items change
  useEffect(() => {
    if (!isLoading) {
      loadTriggeredRef.current = false;
    }
  }, [items.length, isLoading]);

  // Set initial focus on first item
  useEffect(() => {
    if (items.length > 0 && focusedIndex === 0) {
      const firstItem = items[0];
      if (firstItem) {
        virtualizer.scrollToIndex(0, { align: 'start' });
      }
    }
  }, [items.length > 0]);

  const virtualRows = virtualizer.getVirtualItems();

  // Memoize grid width calculation
  const gridWidth = useMemo(() => {
    return columnCount * cardWidth + (columnCount - 1) * cardGap;
  }, [columnCount, cardWidth, cardGap]);

  if (items.length === 0) {
    return null;
  }

  return (
    <FocusContext.Provider value={currentFocusKey}>
      <div
        ref={(el) => {
          // Combine refs
          if (focusContainerRef && typeof focusContainerRef === 'object') {
            (focusContainerRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
          }
          parentRef.current = el;
        }}
        className={className}
        style={{
          width: '100%',
          height: '100%',
          overflow: 'auto',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: `${gridWidth}px`,
            position: 'relative',
            margin: '0 auto', // Center the grid
          }}
        >
          {virtualRows.map((virtualRow) => {
            // Calculate which items are in this row
            const rowStartIndex = virtualRow.index * columnCount;
            const rowItems = items.slice(rowStartIndex, rowStartIndex + columnCount);

            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${cardHeight}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'flex',
                  gap: `${cardGap}px`,
                }}
              >
                {rowItems.map((item, colIndex) => {
                  const itemIndex = rowStartIndex + colIndex;
                  const itemFocusKey = `${focusKey}-item-${getItemKey(item)}`;
                  const isFocused = itemIndex === focusedIndex;

                  return (
                    <div
                      key={getItemKey(item)}
                      style={{
                        width: `${cardWidth}px`,
                        height: '100%',
                      }}
                    >
                      <GridItemWrapper
                        focusKey={itemFocusKey}
                        index={itemIndex}
                        onFocused={handleItemFocus}
                        onSelect={
                          onItemSelect
                            ? () => onItemSelect(item, itemIndex)
                            : undefined
                        }
                      >
                        {renderItem(item, itemIndex, itemFocusKey, isFocused)}
                      </GridItemWrapper>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Loading indicator at bottom */}
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              bottom: '20px',
              left: '50%',
              transform: 'translateX(-50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '10px',
              color: '#fff',
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                border: '3px solid rgba(255, 255, 255, 0.3)',
                borderTop: '3px solid #fff',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
              }}
            />
            <span>Carregando mais...</span>
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
}

export default VirtualizedGrid;
