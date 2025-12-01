/**
 * VirtualizedCarousel - Horizontal virtualized carousel with spatial navigation
 *
 * Uses @tanstack/react-virtual to render only visible items.
 * Designed for TV remote D-PAD navigation with focus-based pagination.
 */

import { useRef, useState, useEffect, useCallback, memo } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';

// Configuration constants
const DEFAULT_CARD_WIDTH = 200;
const DEFAULT_CARD_GAP = 12;
const DEFAULT_OVERSCAN = 3;
const LOAD_MORE_THRESHOLD = 5;

export interface VirtualizedCarouselProps<T> {
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
  /** Card width in pixels */
  cardWidth?: number;
  /** Gap between cards in pixels */
  cardGap?: number;
  /** Container height */
  height?: number;
  /** Extra items to render outside viewport */
  overscan?: number;
  /** CSS class for container */
  className?: string;
}

/**
 * Wrapper component for virtualized items with focus support
 */
const VirtualizedCardWrapper = memo(function VirtualizedCardWrapper({
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

  // Scroll into view when focused (for vertical navigation between rows)
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

export function VirtualizedCarousel<T>({
  focusKey,
  items,
  hasMore,
  isLoading,
  onLoadMore,
  getItemKey,
  renderItem,
  onItemFocus,
  onItemSelect,
  cardWidth = DEFAULT_CARD_WIDTH,
  cardGap = DEFAULT_CARD_GAP,
  height = 280,
  overscan = DEFAULT_OVERSCAN,
  className = '',
}: VirtualizedCarouselProps<T>) {
  const parentRef = useRef<HTMLDivElement | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const loadTriggeredRef = useRef(false);

  // Initialize virtualizer for horizontal scrolling
  const virtualizer = useVirtualizer({
    horizontal: true,
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => cardWidth + cardGap,
    overscan,
  });

  // Handle arrow key navigation
  const handleArrowPress = useCallback(
    (direction: string) => {
      if (direction === 'right' && focusedIndex < items.length - 1) {
        const newIndex = focusedIndex + 1;
        const item = items[newIndex];
        if (item) {
          setFocus(`${focusKey}-item-${getItemKey(item)}`);
        }
        return false; // We handle navigation
      } else if (direction === 'left' && focusedIndex > 0) {
        const newIndex = focusedIndex - 1;
        const item = items[newIndex];
        if (item) {
          setFocus(`${focusKey}-item-${getItemKey(item)}`);
        }
        return false;
      }
      return true; // Allow up/down to escape carousel
    },
    [focusKey, focusedIndex, items, getItemKey]
  );

  // Compute preferred child focus key (first item)
  const preferredChildFocusKey = items.length > 0
    ? `${focusKey}-item-${getItemKey(items[0])}`
    : undefined;

  // Focus context for spatial navigation
  const { ref: focusContainerRef, focusKey: currentFocusKey } = useFocusable({
    focusKey,
    isFocusBoundary: false,
    focusBoundaryDirections: ['up', 'down'],
    onArrowPress: handleArrowPress,
    saveLastFocusedChild: true,
    preferredChildFocusKey,
  });

  // Handle item focus - update index, scroll, trigger load more
  const handleItemFocus = useCallback(
    (index: number) => {
      setFocusedIndex(index);

      // Scroll to focused item
      virtualizer.scrollToIndex(index, {
        align: 'center',
        behavior: 'smooth',
      });

      // Notify parent
      if (items[index] && onItemFocus) {
        onItemFocus(items[index], index);
      }

      // Check if we should load more
      const distanceFromEnd = items.length - index - 1;
      if (distanceFromEnd <= LOAD_MORE_THRESHOLD && hasMore && !isLoading && !loadTriggeredRef.current) {
        loadTriggeredRef.current = true;
        onLoadMore();
      }
    },
    [virtualizer, items, onItemFocus, hasMore, isLoading, onLoadMore]
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
        // Focus is managed by parent, just ensure virtualizer is at start
        virtualizer.scrollToIndex(0, { align: 'start' });
      }
    }
  }, [items.length > 0]);

  const virtualItems = virtualizer.getVirtualItems();

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
          height: `${height}px`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            width: `${virtualizer.getTotalSize()}px`,
            height: '100%',
            position: 'relative',
          }}
        >
          {virtualItems.map((virtualItem) => {
            const item = items[virtualItem.index];
            if (!item) return null;

            const itemFocusKey = `${focusKey}-item-${getItemKey(item)}`;
            const isFocused = virtualItem.index === focusedIndex;

            return (
              <div
                key={virtualItem.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: `${cardWidth}px`,
                  height: '100%',
                  transform: `translateX(${virtualItem.start}px)`,
                  paddingRight: `${cardGap}px`,
                  boxSizing: 'border-box',
                }}
              >
                <VirtualizedCardWrapper
                  focusKey={itemFocusKey}
                  index={virtualItem.index}
                  onFocused={handleItemFocus}
                  onSelect={
                    onItemSelect
                      ? () => onItemSelect(item, virtualItem.index)
                      : undefined
                  }
                >
                  {renderItem(item, virtualItem.index, itemFocusKey, isFocused)}
                </VirtualizedCardWrapper>
              </div>
            );
          })}
        </div>

        {/* Loading indicator at end */}
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              top: '50%',
              right: '20px',
              transform: 'translateY(-50%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
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
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
}

export default VirtualizedCarousel;
