/**
 * EpgBar - Electronic Program Guide bar for live TV channels
 * Shows current program with progress and next programs
 * Supports D-PAD navigation for TV remotes
 */

import { useEffect, useState, useCallback, memo } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { MdLiveTv, MdSchedule, MdHistory, MdKeyboardArrowUp, MdKeyboardArrowDown } from 'react-icons/md';
import { usePlaylistStore } from '@store/playlistStore';
import type { XtreamEpgEntry } from '@core/services/api/xtream';
import styles from './EpgBar.module.css';

interface EpgBarProps {
  /** Xtream stream ID for fetching EPG */
  streamId: string;
  /** Whether the channel supports TV archive/catchup */
  hasTvArchive?: boolean;
  /** Callback when user wants to watch from start (catchup) */
  onWatchFromStart?: (program: XtreamEpgEntry) => void;
  /** Whether controls are visible (to sync animation) */
  visible?: boolean;
  /** Callback when EPG navigation goes up (to return focus to player controls) */
  onNavigateUp?: () => void;
  /** Callback when EPG navigation goes down */
  onNavigateDown?: () => void;
}

interface CurrentProgram extends XtreamEpgEntry {
  progress: number; // 0-100
  remainingMinutes: number;
}

/**
 * Calculate progress percentage for a program
 */
function calculateProgress(start: string, end: string): { progress: number; remainingMinutes: number } {
  const now = Date.now();
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();

  if (now < startTime) {
    return { progress: 0, remainingMinutes: Math.ceil((endTime - startTime) / 60000) };
  }

  if (now > endTime) {
    return { progress: 100, remainingMinutes: 0 };
  }

  const total = endTime - startTime;
  const elapsed = now - startTime;
  const progress = Math.min(100, Math.max(0, (elapsed / total) * 100));
  const remainingMinutes = Math.ceil((endTime - now) / 60000);

  return { progress, remainingMinutes };
}

/**
 * Format time from ISO string to HH:MM
 */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '--:--';
  }
}

// ============================================================================
// Focusable Catchup Button Component
// ============================================================================

interface CatchupButtonProps {
  focusKey: string;
  onPress: () => void;
  onArrowPress: (direction: string) => boolean;
  disabled?: boolean;
}

const CatchupButton = memo(function CatchupButton({
  focusKey,
  onPress,
  onArrowPress,
  disabled = false,
}: CatchupButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress,
    focusable: !disabled,
  });

  return (
    <button
      ref={ref}
      className={`${styles.catchupButton} ${focused ? styles.focused : ''}`}
      onClick={onPress}
      tabIndex={-1}
      title="Assistir do início"
      data-focused={focused}
    >
      <MdHistory />
      <span>Do Início</span>
    </button>
  );
});

// ============================================================================
// Focusable EPG Toggle Button
// ============================================================================

interface EpgToggleButtonProps {
  focusKey: string;
  expanded: boolean;
  onPress: () => void;
  onArrowPress: (direction: string) => boolean;
  disabled?: boolean;
}

const EpgToggleButton = memo(function EpgToggleButton({
  focusKey,
  expanded,
  onPress,
  onArrowPress,
  disabled = false,
}: EpgToggleButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress,
    focusable: !disabled,
  });

  return (
    <button
      ref={ref}
      className={`${styles.epgToggle} ${focused ? styles.focused : ''}`}
      onClick={onPress}
      tabIndex={-1}
      title={expanded ? 'Ocultar programação' : 'Ver programação'}
      data-focused={focused}
    >
      {expanded ? <MdKeyboardArrowDown /> : <MdKeyboardArrowUp />}
      <span>Programação</span>
    </button>
  );
});

// ============================================================================
// Main EPG Bar Component
// ============================================================================

export const EpgBar = memo(function EpgBar({
  streamId,
  hasTvArchive = false,
  onWatchFromStart,
  visible = true,
  onNavigateUp,
  onNavigateDown,
}: EpgBarProps) {
  const isXtream = usePlaylistStore((s) => s.isXtream);
  const getXtreamClient = usePlaylistStore((s) => s.getXtreamClient);

  const [currentProgram, setCurrentProgram] = useState<CurrentProgram | null>(null);
  const [nextPrograms, setNextPrograms] = useState<XtreamEpgEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  // Fetch EPG data
  const fetchEpg = useCallback(async () => {
    if (!isXtream() || !streamId) {
      setLoading(false);
      return;
    }

    const client = getXtreamClient();
    if (!client) {
      setError('Cliente Xtream não disponível');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await client.getEpg(streamId, 5); // Get 5 programs
      const listings = response.listings;

      if (!listings || listings.length === 0) {
        setCurrentProgram(null);
        setNextPrograms([]);
        setLoading(false);
        return;
      }

      // Find current program (first one where now is between start and end)
      const now = Date.now();
      let currentIdx = listings.findIndex((p) => {
        const start = new Date(p.start).getTime();
        const end = new Date(p.end).getTime();
        return now >= start && now <= end;
      });

      // If no current program found, use first one
      if (currentIdx === -1) {
        currentIdx = 0;
      }

      const current = listings[currentIdx];
      const { progress, remainingMinutes } = calculateProgress(current.start, current.end);

      setCurrentProgram({
        ...current,
        progress,
        remainingMinutes,
      });

      // Next programs are the ones after current
      setNextPrograms(listings.slice(currentIdx + 1, currentIdx + 3));

    } catch (err) {
      console.error('[EpgBar] Failed to fetch EPG:', err);
      setError('Falha ao carregar programação');
    } finally {
      setLoading(false);
    }
  }, [isXtream, getXtreamClient, streamId]);

  // Fetch EPG on mount and every 60 seconds
  useEffect(() => {
    fetchEpg();

    const interval = setInterval(() => {
      fetchEpg();
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [fetchEpg]);

  // Update progress every 30 seconds
  useEffect(() => {
    if (!currentProgram) return;

    const interval = setInterval(() => {
      const { progress, remainingMinutes } = calculateProgress(
        currentProgram.start,
        currentProgram.end
      );

      setCurrentProgram((prev) => prev ? { ...prev, progress, remainingMinutes } : null);

      // If program ended, refetch EPG
      if (progress >= 100) {
        fetchEpg();
      }
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [currentProgram?.start, currentProgram?.end, fetchEpg]);

  // D-PAD Navigation for EPG Toggle Button
  const handleToggleArrowPress = useCallback((direction: string): boolean => {
    if (direction === 'up') {
      onNavigateUp?.();
      return false; // Block default behavior
    }
    if (direction === 'down') {
      if (expanded && hasTvArchive && currentProgram?.hasArchive) {
        // Navigate to catchup button if available
        return true; // Allow default navigation
      }
      onNavigateDown?.();
      return false;
    }
    return false; // Block left/right at edges
  }, [onNavigateUp, onNavigateDown, expanded, hasTvArchive, currentProgram?.hasArchive]);

  // D-PAD Navigation for Catchup Button
  const handleCatchupArrowPress = useCallback((direction: string): boolean => {
    if (direction === 'up') {
      // Navigate back to toggle
      return true; // Allow default navigation
    }
    if (direction === 'down') {
      onNavigateDown?.();
      return false;
    }
    return false; // Block left/right
  }, [onNavigateDown]);

  // Toggle expanded state
  const handleToggleExpanded = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  // Handle watch from start
  const handleWatchFromStart = useCallback(() => {
    if (currentProgram && onWatchFromStart) {
      onWatchFromStart(currentProgram);
    }
  }, [currentProgram, onWatchFromStart]);

  // Don't render if not Xtream or no stream ID
  if (!isXtream() || !streamId) {
    return null;
  }

  // Loading state - show minimal bar
  if (loading && !currentProgram) {
    return (
      <div className={`${styles.epgBar} ${!visible ? styles.hidden : ''}`}>
        <div className={styles.loading}>
          <MdLiveTv className={styles.liveIcon} />
          <span>Carregando programação...</span>
        </div>
      </div>
    );
  }

  // No EPG data - show toggle button only
  if (!currentProgram && !loading) {
    return null;
  }

  // Error state - silent fail
  if (error && !currentProgram) {
    return null;
  }

  return (
    <div className={`${styles.epgBar} ${!visible ? styles.hidden : ''} ${expanded ? styles.expanded : ''}`}>
      {/* Compact View - Always visible */}
      <div className={styles.compactView}>
        <div className={styles.nowPlaying}>
          <MdLiveTv className={styles.liveIcon} />
          <span className={styles.nowLabel}>AO VIVO</span>
        </div>

        {currentProgram && (
          <div className={styles.compactInfo}>
            <span className={styles.compactTitle}>{currentProgram.title}</span>
            <span className={styles.compactTime}>
              {formatTime(currentProgram.start)} - {formatTime(currentProgram.end)}
            </span>
            {/* Mini Progress Bar */}
            <div className={styles.miniProgress}>
              <div
                className={styles.miniProgressBar}
                style={{ width: `${currentProgram.progress}%` }}
              />
            </div>
          </div>
        )}

        <EpgToggleButton
          focusKey="epg-toggle"
          expanded={expanded}
          onPress={handleToggleExpanded}
          onArrowPress={handleToggleArrowPress}
          disabled={!visible}
        />
      </div>

      {/* Expanded View - Details */}
      {expanded && currentProgram && (
        <div className={styles.expandedView}>
          <div className={styles.currentProgram}>
            <div className={styles.programHeader}>
              <span className={styles.programLabel}>AGORA</span>
              <span className={styles.remaining}>
                {currentProgram.remainingMinutes} min restantes
              </span>
            </div>

            <div className={styles.programTitle}>{currentProgram.title}</div>

            <div className={styles.programTime}>
              <MdSchedule className={styles.timeIcon} />
              <span>{formatTime(currentProgram.start)} - {formatTime(currentProgram.end)}</span>
            </div>

            {currentProgram.description && (
              <div className={styles.programDescription}>
                {currentProgram.description}
              </div>
            )}

            {/* Full Progress Bar */}
            <div className={styles.progressContainer}>
              <div
                className={styles.progressBar}
                style={{ width: `${currentProgram.progress}%` }}
              />
            </div>

            {/* Watch from Start Button (if TV Archive available) */}
            {hasTvArchive && currentProgram.hasArchive && onWatchFromStart && (
              <CatchupButton
                focusKey="epg-catchup"
                onPress={handleWatchFromStart}
                onArrowPress={handleCatchupArrowPress}
                disabled={!visible}
              />
            )}
          </div>

          {/* Next Programs */}
          {nextPrograms.length > 0 && (
            <div className={styles.nextPrograms}>
              <div className={styles.nextLabel}>A SEGUIR</div>
              {nextPrograms.map((program, idx) => (
                <div key={program.id || idx} className={styles.nextProgram}>
                  <span className={styles.nextTime}>{formatTime(program.start)}</span>
                  <span className={styles.nextTitle}>{program.title}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default EpgBar;
