/**
 * FocusableCard - Card wrapper with spatial navigation support
 * Used for TV remote D-PAD navigation
 */

import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { useEffect } from 'react';

interface FocusableCardProps {
  children: React.ReactNode;
  focusKey: string;
  onSelect: () => void;
  className?: string;
  focusedClassName?: string;
  scrollIntoView?: boolean;
}

export function FocusableCard({
  children,
  focusKey,
  onSelect,
  className = '',
  focusedClassName = 'focused',
  scrollIntoView = true,
}: FocusableCardProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
  });

  // Auto-scroll into view when focused
  useEffect(() => {
    if (focused && scrollIntoView && ref.current) {
      ref.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest',
      });
    }
  }, [focused, scrollIntoView, ref]);

  return (
    <div
      ref={ref}
      className={`${className} ${focused ? focusedClassName : ''}`}
      onClick={onSelect}
      onKeyDown={(e) => e.key === 'Enter' && onSelect()}
      role="button"
      tabIndex={0}
      data-focused={focused}
    >
      {children}
    </div>
  );
}

export default FocusableCard;
