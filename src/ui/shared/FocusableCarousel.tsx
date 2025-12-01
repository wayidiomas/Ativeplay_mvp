/**
 * FocusableCarousel - Horizontal carousel with spatial navigation support
 * Auto-scrolls horizontally when navigating with D-PAD
 */

import { useRef, useCallback } from 'react';
import {
  useFocusable,
  FocusContext,
} from '@noriginmedia/norigin-spatial-navigation';

interface FocusableCarouselProps {
  focusKey: string;
  children: React.ReactNode;
  className?: string;
  trackClassName?: string;
  onLoadMore?: () => void;
  scrollOffset?: number;
}

export function FocusableCarousel({
  focusKey,
  children,
  className = '',
  trackClassName = '',
  onLoadMore,
  scrollOffset = 250,
}: FocusableCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const handleArrowPress = useCallback((direction: string) => {
    if (!trackRef.current) return true;

    // Auto-scroll when navigating horizontally
    if (direction === 'right') {
      trackRef.current.scrollBy({ left: scrollOffset, behavior: 'smooth' });

      // Check if near end to load more
      const isNearEnd = trackRef.current.scrollLeft + trackRef.current.clientWidth + 400 >= trackRef.current.scrollWidth;
      if (isNearEnd && onLoadMore) {
        onLoadMore();
      }
    } else if (direction === 'left') {
      trackRef.current.scrollBy({ left: -scrollOffset, behavior: 'smooth' });
    }

    // Return true to allow default navigation
    return true;
  }, [scrollOffset, onLoadMore]);

  const { ref, focusKey: currentFocusKey } = useFocusable({
    focusKey,
    isFocusBoundary: false,
    focusBoundaryDirections: ['up', 'down'],
    onArrowPress: handleArrowPress,
    preferredChildFocusKey: undefined,
    saveLastFocusedChild: true,
  });

  return (
    <FocusContext.Provider value={currentFocusKey}>
      <div ref={ref} className={className}>
        <div
          ref={trackRef}
          className={trackClassName}
          style={{
            display: 'flex',
            overflowX: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
          }}
        >
          {children}
        </div>
      </div>
    </FocusContext.Provider>
  );
}

export default FocusableCarousel;
