import styles from './SkeletonLoader.module.css';

export interface SkeletonLoaderProps {
  variant?: 'card' | 'text' | 'avatar' | 'bar';
  count?: number;
  width?: string;
  height?: string;
  className?: string;
}

export function SkeletonLoader({
  variant = 'card',
  count = 1,
  width,
  height,
  className,
}: SkeletonLoaderProps) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (variant === 'card') {
    return (
      <>
        {items.map((i) => (
          <div key={i} className={`${styles.skeletonCard} ${className || ''}`}>
            <div className={styles.skeletonPoster} />
            <div className={styles.skeletonTitle} />
            <div className={styles.skeletonMeta} />
          </div>
        ))}
      </>
    );
  }

  if (variant === 'text') {
    return (
      <>
        {items.map((i) => (
          <div
            key={i}
            className={`${styles.skeletonText} ${className || ''}`}
            style={{ width: width || '100%', height: height || '1em' }}
          />
        ))}
      </>
    );
  }

  if (variant === 'avatar') {
    return (
      <>
        {items.map((i) => (
          <div
            key={i}
            className={`${styles.skeletonAvatar} ${className || ''}`}
            style={{ width: width || '48px', height: height || '48px' }}
          />
        ))}
      </>
    );
  }

  if (variant === 'bar') {
    return (
      <>
        {items.map((i) => (
          <div
            key={i}
            className={`${styles.skeletonBar} ${className || ''}`}
            style={{ width: width || '100%', height: height || '8px' }}
          />
        ))}
      </>
    );
  }

  return null;
}

// Exports individuais para conveniência
export function SkeletonCard(props: Omit<SkeletonLoaderProps, 'variant'>) {
  return <SkeletonLoader {...props} variant="card" />;
}

export function SkeletonText(props: Omit<SkeletonLoaderProps, 'variant'>) {
  return <SkeletonLoader {...props} variant="text" />;
}

export function SkeletonAvatar(props: Omit<SkeletonLoaderProps, 'variant'>) {
  return <SkeletonLoader {...props} variant="avatar" />;
}

export function SkeletonBar(props: Omit<SkeletonLoaderProps, 'variant'>) {
  return <SkeletonLoader {...props} variant="bar" />;
}
