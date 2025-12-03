/**
 * PlayerContainer
 * Fullscreen video player with controls for TV D-PAD navigation
 * Uses @noriginmedia/norigin-spatial-navigation for focus management
 */

import { useEffect, useCallback, useState, useRef, memo } from 'react';
import {
  useFocusable,
  FocusContext,
  setFocus,
} from '@noriginmedia/norigin-spatial-navigation';
import { usePlayer } from '@player/hooks/usePlayer';
import type { AudioTrack, SubtitleTrack } from '@player/types';
import { usePlaylistStore } from '@store/playlistStore';
import type { XtreamEpgEntry } from '@core/services/api/xtream';
import {
  MdPlayArrow,
  MdPause,
  MdReplay10,
  MdForward10,
  MdVolumeUp,
  MdSubtitles,
  MdClose,
  MdCheck,
  MdErrorOutline
} from 'react-icons/md';
import styles from './PlayerContainer.module.css';
import { EpgBar } from './EpgBar';

interface PlayerContainerProps {
  url: string;
  title?: string;
  startPosition?: number;
  isLive?: boolean;
  /** Xtream stream ID for EPG (only for live Xtream channels) */
  xtreamStreamId?: string;
  /** Whether the channel supports TV archive/catchup */
  hasTvArchive?: boolean;
  onClose?: () => void;
  onEnded?: () => void;
}

type MenuType = 'audio' | 'subtitle' | null;

// Control button IDs for navigation order
const CONTROL_BUTTONS = ['seek-back', 'play-pause', 'seek-forward', 'audio', 'subtitle'] as const;
type ControlButtonId = typeof CONTROL_BUTTONS[number];

/**
 * Detect container formats not natively supported by HTML5 video
 */
function getUnsupportedFormat(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.endsWith('.mkv') || lower.includes('.mkv?')) return 'MKV';
  if (lower.endsWith('.avi') || lower.includes('.avi?')) return 'AVI';
  if (lower.endsWith('.wmv') || lower.includes('.wmv?')) return 'WMV';
  if (lower.endsWith('.flv') || lower.includes('.flv?')) return 'FLV';
  return null;
}

// ============================================================================
// Focusable Control Button Component
// ============================================================================

interface ControlButtonProps {
  focusKey: string;
  onPress: () => void;
  onArrowPress: (direction: string) => boolean;
  icon: React.ReactNode;
  title: string;
  isPlayPause?: boolean;
  disabled?: boolean;
}

const ControlButton = memo(function ControlButton({
  focusKey,
  onPress,
  onArrowPress,
  icon,
  title,
  isPlayPause = false,
  disabled = false,
}: ControlButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress,
    focusable: !disabled,
  });

  return (
    <button
      ref={ref}
      className={`${styles.controlButton} ${isPlayPause ? styles.playPauseButton : ''} ${focused ? styles.focused : ''}`}
      onClick={onPress}
      tabIndex={-1}
      title={title}
      data-focused={focused}
    >
      {icon}
    </button>
  );
});

// ============================================================================
// Focusable Menu Item Component
// ============================================================================

interface MenuItemProps {
  focusKey: string;
  label: string;
  isActive: boolean;
  onSelect: () => void;
  onArrowPress: (direction: string) => boolean;
}

const MenuItem = memo(function MenuItem({
  focusKey,
  label,
  isActive,
  onSelect,
  onArrowPress,
}: MenuItemProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect,
    onArrowPress,
  });

  // Scroll into view when focused
  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'auto', block: 'nearest' });
    }
  }, [focused]);

  return (
    <div
      ref={ref}
      className={`${styles.trackItem} ${isActive ? styles.active : ''} ${focused ? styles.focused : ''}`}
      onClick={onSelect}
      tabIndex={-1}
      role="button"
      data-focused={focused}
    >
      <MdCheck className={styles.trackItemIcon} />
      {label}
    </div>
  );
});

// ============================================================================
// Close Button Component
// ============================================================================

interface CloseButtonProps {
  focusKey: string;
  onPress: () => void;
  onArrowPress: (direction: string) => boolean;
  disabled?: boolean;
}

const CloseButton = memo(function CloseButton({
  focusKey,
  onPress,
  onArrowPress,
  disabled = false,
}: CloseButtonProps) {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress,
    focusable: !disabled,
  });

  return (
    <button
      ref={ref}
      className={`${styles.closeButton} ${focused ? styles.focused : ''}`}
      onClick={onPress}
      tabIndex={-1}
      data-focused={focused}
    >
      <MdClose />
    </button>
  );
});

// ============================================================================
// Main Player Container
// ============================================================================

export function PlayerContainer({
  url,
  title = '',
  startPosition = 0,
  isLive = false,
  xtreamStreamId,
  hasTvArchive = false,
  onClose,
  onEnded,
}: PlayerContainerProps) {
  const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL;

  // Get Xtream client for TV Archive functionality
  const getXtreamClient = usePlaylistStore((s) => s.getXtreamClient);

  const buildStreamUrl = useCallback(
    (original: string) => {
      if (!BRIDGE_URL) return original;
      if (!/^https?:\/\//i.test(original)) return original;
      if (original.includes('/api/proxy/hls')) return original;

      // Extract referer (origin) from original URL for IPTV provider authentication
      let referer: string | undefined;
      try {
        const parsed = new URL(original);
        referer = parsed.origin;
      } catch {
        // Invalid URL, skip referer
      }

      const params = new URLSearchParams({ url: original });
      if (referer) params.set('referer', referer);
      return `${BRIDGE_URL}/api/proxy/hls?${params}`;
    },
    [BRIDGE_URL]
  );

  const {
    state,
    currentTime,
    duration,
    bufferedTime,
    audioTracks,
    subtitleTracks,
    currentAudioIndex,
    currentSubtitleIndex,
    errorMessage,
    open,
    play,
    pause,
    seek,
    seekForward,
    seekBackward,
    setAudioTrack,
    setSubtitleTrack,
    close,
  } = usePlayer({ containerId: 'player-container' });

  const [controlsVisible, setControlsVisible] = useState(true);
  const [activeMenu, setActiveMenu] = useState<MenuType>(null);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

  // Refs to avoid useEffect re-execution when functions change references
  const openRef = useRef(open);
  const buildStreamUrlRef = useRef(buildStreamUrl);
  openRef.current = open;
  buildStreamUrlRef.current = buildStreamUrl;

  // Player-level focus context (boundary to isolate from rest of app)
  const { focusKey: playerFocusKey } = useFocusable({
    focusKey: 'player-container',
    isFocusBoundary: true,
    saveLastFocusedChild: true,
  });

  // Format time (ms to MM:SS)
  const formatTime = useCallback((ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  // Show controls and reset hide timeout
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideControlsTimeout.current) {
      clearTimeout(hideControlsTimeout.current);
    }
    if (state === 'playing') {
      hideControlsTimeout.current = setTimeout(() => {
        setControlsVisible(false);
        setActiveMenu(null);
      }, 5000);
    }
  }, [state]);

  // Handle close
  const handleClose = useCallback(() => {
    close();
    onClose?.();
  }, [close, onClose]);

  // Handle TV Archive / Catchup - Watch from start of current program
  const handleWatchFromStart = useCallback(async (program: XtreamEpgEntry) => {
    if (!xtreamStreamId || !hasTvArchive) return;

    const client = getXtreamClient();
    if (!client) {
      console.error('[PlayerContainer] Xtream client not available for catchup');
      return;
    }

    try {
      // Calculate start timestamp and duration
      const startTime = Math.floor(new Date(program.start).getTime() / 1000);
      const endTime = Math.floor(new Date(program.end).getTime() / 1000);
      const durationMins = Math.ceil((endTime - startTime) / 60);

      console.log('[PlayerContainer] Fetching timeshift URL:', {
        streamId: xtreamStreamId,
        startTime,
        durationMins,
        programTitle: program.title,
      });

      const timeshiftUrl = await client.getTimeshiftUrl(
        parseInt(xtreamStreamId, 10),
        startTime,
        durationMins
      );

      // Switch to timeshift URL
      const streamUrl = buildStreamUrl(timeshiftUrl);
      console.log('[PlayerContainer] Switching to timeshift stream:', streamUrl.substring(0, 80));
      open(streamUrl, { startPosition: 0, autoPlay: true, isLive: false });

    } catch (err) {
      console.error('[PlayerContainer] Failed to get timeshift URL:', err);
    }
  }, [xtreamStreamId, hasTvArchive, getXtreamClient, buildStreamUrl, open]);

  // Open video on mount - only depend on url to avoid re-opening on prop changes
  // startPosition and isLive are captured at mount time via refs
  const startPositionRef = useRef(startPosition);
  const isLiveRef = useRef(isLive);

  useEffect(() => {
    console.log('[PlayerContainer] Opening video:', { url: url?.substring(0, 80), startPosition: startPositionRef.current, isLive: isLiveRef.current });
    const streamUrl = buildStreamUrlRef.current(url);
    openRef.current(streamUrl, { startPosition: startPositionRef.current, autoPlay: true, isLive: isLiveRef.current });
  }, [url]);

  // Ensure player is closed when component unmounts
  // Using empty deps array - close is stable (useCallback with [])
  useEffect(() => {
    return () => {
      console.log('[PlayerContainer] Cleanup: closing player');
      close();
    };
  }, []);

  // Handle ended event
  useEffect(() => {
    if (state === 'ended' && onEnded) {
      onEnded();
    }
  }, [state, onEnded]);

  // Auto-hide controls when playing
  useEffect(() => {
    if (state === 'playing') {
      hideControlsTimeout.current = setTimeout(() => {
        setControlsVisible(false);
        setActiveMenu(null);
      }, 5000);
    }
    return () => {
      if (hideControlsTimeout.current) {
        clearTimeout(hideControlsTimeout.current);
      }
    };
  }, [state]);

  // Set initial focus to play/pause button
  useEffect(() => {
    if (state === 'ready' || state === 'playing' || state === 'paused') {
      setFocus('player-play-pause');
    }
  }, [state === 'ready']);

  // ============================================================================
  // D-PAD Navigation Handlers
  // ============================================================================

  // Close button navigation: DOWN goes to play/pause
  const handleCloseArrowPress = useCallback((direction: string): boolean => {
    if (direction === 'down') {
      setFocus('player-play-pause');
      return false;
    }
    // Block all other directions
    return false;
  }, []);

  // Control buttons navigation: UP→close, LEFT/RIGHT→between buttons
  const handleControlArrowPress = useCallback((direction: string, buttonId: ControlButtonId): boolean => {
    showControls();

    if (direction === 'up') {
      // If menu is open, close it instead of navigating
      if (activeMenu) {
        setActiveMenu(null);
        return false;
      }
      // Navigate to close button
      setFocus('player-close');
      return false;
    }

    if (direction === 'down') {
      // If this button opens a menu, open it
      if (buttonId === 'audio' && audioTracks.length > 0) {
        setActiveMenu('audio');
        setTimeout(() => setFocus('player-audio-0'), 50);
        return false;
      }
      if (buttonId === 'subtitle') {
        setActiveMenu('subtitle');
        setTimeout(() => setFocus('player-subtitle-0'), 50);
        return false;
      }
      // Block at bottom for other buttons
      return false;
    }

    // Horizontal navigation between buttons
    const currentIndex = CONTROL_BUTTONS.indexOf(buttonId);

    if (direction === 'left') {
      if (currentIndex > 0) {
        setFocus(`player-${CONTROL_BUTTONS[currentIndex - 1]}`);
      }
      return false; // Block at first button
    }

    if (direction === 'right') {
      if (currentIndex < CONTROL_BUTTONS.length - 1) {
        setFocus(`player-${CONTROL_BUTTONS[currentIndex + 1]}`);
      }
      return false; // Block at last button
    }

    return false;
  }, [showControls, activeMenu, audioTracks.length]);

  // Menu item navigation: UP/DOWN between items, LEFT closes menu
  const handleMenuArrowPress = useCallback((
    direction: string,
    menuType: MenuType,
    index: number,
    totalItems: number
  ): boolean => {
    if (direction === 'up') {
      if (index > 0) {
        setFocus(`player-${menuType}-${index - 1}`);
      }
      return false; // Block at top
    }

    if (direction === 'down') {
      if (index < totalItems - 1) {
        setFocus(`player-${menuType}-${index + 1}`);
      }
      return false; // Block at bottom
    }

    if (direction === 'left' || direction === 'right') {
      // Close menu and return to control button
      setActiveMenu(null);
      setFocus(`player-${menuType}`);
      return false;
    }

    return false;
  }, []);

  // ============================================================================
  // Keyboard Handler (for webOS/Tizen Back keys and media keys)
  // ============================================================================

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      showControls();

      // webOS/Tizen Back button handling
      // - 'Back': Standard HbbTV/CE-HTML
      // - 'XF86Back': X11 style (some Tizen)
      // - keyCode 10009: Tizen TV
      // - keyCode 461: LG webOS
      if (
        e.key === 'Back' ||
        e.key === 'XF86Back' ||
        e.keyCode === 10009 ||
        e.keyCode === 461 ||
        e.key === 'Escape' ||
        e.key === 'Backspace'
      ) {
        e.preventDefault();
        if (activeMenu) {
          setActiveMenu(null);
        } else {
          handleClose();
        }
        return;
      }

      // Samsung/LG Media remote keys
      switch (e.key) {
        case 'MediaPlayPause':
          e.preventDefault();
          if (state === 'playing') {
            pause();
          } else {
            play();
          }
          break;

        case 'MediaPlay':
          e.preventDefault();
          play();
          break;

        case 'MediaPause':
          e.preventDefault();
          pause();
          break;

        case 'MediaRewind':
          e.preventDefault();
          seekBackward(30000);
          break;

        case 'MediaFastForward':
          e.preventDefault();
          seekForward(30000);
          break;

        // Color button shortcuts (common on TV remotes)
        case 'ColorF0Red':
          e.preventDefault();
          handleClose();
          break;

        case 'ColorF1Green':
          e.preventDefault();
          setActiveMenu(activeMenu === 'audio' ? null : 'audio');
          break;

        case 'ColorF2Yellow':
          e.preventDefault();
          setActiveMenu(activeMenu === 'subtitle' ? null : 'subtitle');
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    state,
    activeMenu,
    play,
    pause,
    seekForward,
    seekBackward,
    showControls,
    handleClose,
  ]);

  // Calculate progress percentages
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (bufferedTime / duration) * 100 : 0;

  const handleSeekClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (duration <= 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(Math.max(0, (e.clientX - rect.left) / rect.width), 1);
      const newPosition = ratio * duration;
      seek(newPosition);
    },
    [duration, seek]
  );

  // Render loading state
  if (state === 'loading' || state === 'idle') {
    return (
      <div className={styles.container} ref={containerRef}>
        <div id="player-container" className={styles.videoContainer} />
        <div className={styles.loadingOverlay}>
          <div className={styles.spinner} />
          <span className={styles.loadingText}>Carregando...</span>
        </div>
      </div>
    );
  }

  // Render error state
  if (state === 'error') {
    const unsupportedFormat = getUnsupportedFormat(url);
    const isFormatError = unsupportedFormat !== null ||
      (errorMessage?.includes('não suportado') ?? false);

    // Use errorMessage from player if available, fallback to heuristics
    const displayMessage = errorMessage || (
      isFormatError
        ? `O formato ${unsupportedFormat || 'de vídeo'} não é suportado pelo navegador. Reproduza diretamente na TV.`
        : 'Não foi possível reproduzir o vídeo'
    );

    const displayTitle = isFormatError ? 'Formato Não Suportado' : 'Erro na Reprodução';

    return (
      <div className={styles.container} ref={containerRef}>
        <div id="player-container" className={styles.videoContainer} />
        <div className={styles.errorOverlay}>
          <MdErrorOutline className={styles.errorIcon} />
          <h2 className={styles.errorTitle}>{displayTitle}</h2>
          <p className={styles.errorMessage}>{displayMessage}</p>
          {!isFormatError && (
            <button
              className={styles.retryButton}
              onClick={() => open(buildStreamUrl(url), { startPosition: currentTime, isLive })}
              autoFocus
            >
              Tentar Novamente
            </button>
          )}
          <button
            className={styles.retryButton}
            onClick={handleClose}
            style={{ marginTop: isFormatError ? 0 : '0.5rem' }}
            autoFocus={isFormatError}
          >
            Voltar
          </button>
        </div>
      </div>
    );
  }

  // Build audio menu items
  const audioMenuItems = audioTracks.map((track: AudioTrack, index: number) => ({
    key: `audio-${track.index}`,
    focusKey: `player-audio-${index}`,
    label: track.label || track.language || `Faixa ${index + 1}`,
    isActive: currentAudioIndex === track.index,
    trackIndex: track.index,
  }));

  // Build subtitle menu items (with "Disabled" option first)
  const subtitleMenuItems = [
    {
      key: 'subtitle-off',
      focusKey: 'player-subtitle-0',
      label: 'Desativado',
      isActive: currentSubtitleIndex === -1,
      trackIndex: -1,
    },
    ...subtitleTracks.map((track: SubtitleTrack, index: number) => ({
      key: `subtitle-${track.index}`,
      focusKey: `player-subtitle-${index + 1}`,
      label: track.label || track.language || `Legenda ${index + 1}`,
      isActive: currentSubtitleIndex === track.index,
      trackIndex: track.index,
    })),
  ];

  return (
    <FocusContext.Provider value={playerFocusKey}>
      <div
        ref={containerRef}
        className={styles.container}
        onClick={showControls}
        onMouseMove={showControls}
      >
        <div id="player-container" className={styles.videoContainer} />

        {/* Controls Overlay */}
        <div
          className={`${styles.controlsOverlay} ${!controlsVisible ? styles.hidden : ''}`}
        >
          {/* Top Bar */}
          <div className={styles.topBar}>
            <h1 className={styles.title}>{title}</h1>
            <CloseButton
              focusKey="player-close"
              onPress={handleClose}
              onArrowPress={handleCloseArrowPress}
              disabled={!controlsVisible}
            />
          </div>

          {/* EPG Bar - Only for live Xtream channels */}
          {isLive && xtreamStreamId && (
            <EpgBar
              streamId={xtreamStreamId}
              hasTvArchive={hasTvArchive}
              onWatchFromStart={handleWatchFromStart}
              visible={controlsVisible}
              onNavigateUp={() => setFocus('player-close')}
              onNavigateDown={() => setFocus('player-play-pause')}
            />
          )}

          {/* Bottom Bar */}
          <div className={styles.bottomBar}>
            {/* Progress Bar */}
            <div className={styles.progressContainer} onClick={handleSeekClick}>
              <div
                className={styles.progressBar}
                role="progressbar"
                aria-valuenow={progress}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className={styles.progressBuffered}
                  style={{ width: `${bufferedProgress}%` }}
                />
                <div
                  className={styles.progressFilled}
                  style={{ width: `${progress}%` }}
                />
                <div
                  className={styles.scrubber}
                  style={{ left: `${progress}%` }}
                />
              </div>
              <div className={styles.timeInfo}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Control Buttons */}
            <div className={styles.controlsRow}>
              <ControlButton
                focusKey="player-seek-back"
                onPress={() => seekBackward(10000)}
                onArrowPress={(dir) => handleControlArrowPress(dir, 'seek-back')}
                icon={<MdReplay10 />}
                title="Voltar 10s"
                disabled={!controlsVisible}
              />

              <ControlButton
                focusKey="player-play-pause"
                onPress={() => (state === 'playing' ? pause() : play())}
                onArrowPress={(dir) => handleControlArrowPress(dir, 'play-pause')}
                icon={state === 'playing' ? <MdPause /> : <MdPlayArrow />}
                title={state === 'playing' ? 'Pausar' : 'Reproduzir'}
                isPlayPause
                disabled={!controlsVisible}
              />

              <ControlButton
                focusKey="player-seek-forward"
                onPress={() => seekForward(10000)}
                onArrowPress={(dir) => handleControlArrowPress(dir, 'seek-forward')}
                icon={<MdForward10 />}
                title="Avançar 10s"
                disabled={!controlsVisible}
              />

              <ControlButton
                focusKey="player-audio"
                onPress={() => setActiveMenu(activeMenu === 'audio' ? null : 'audio')}
                onArrowPress={(dir) => handleControlArrowPress(dir, 'audio')}
                icon={<MdVolumeUp />}
                title="Áudio"
                disabled={!controlsVisible}
              />

              <ControlButton
                focusKey="player-subtitle"
                onPress={() => setActiveMenu(activeMenu === 'subtitle' ? null : 'subtitle')}
                onArrowPress={(dir) => handleControlArrowPress(dir, 'subtitle')}
                icon={<MdSubtitles />}
                title="Legendas"
                disabled={!controlsVisible}
              />
            </div>
          </div>

          {/* Audio Track Menu */}
          {activeMenu === 'audio' && audioMenuItems.length > 0 && (
            <div className={styles.trackMenu}>
              <div className={styles.trackMenuTitle}>Áudio</div>
              {audioMenuItems.map((item, index) => (
                <MenuItem
                  key={item.key}
                  focusKey={item.focusKey}
                  label={item.label}
                  isActive={item.isActive}
                  onSelect={() => {
                    setAudioTrack(item.trackIndex);
                    setActiveMenu(null);
                    setFocus('player-audio');
                  }}
                  onArrowPress={(dir) => handleMenuArrowPress(dir, 'audio', index, audioMenuItems.length)}
                />
              ))}
            </div>
          )}

          {/* Subtitle Track Menu */}
          {activeMenu === 'subtitle' && (
            <div className={styles.trackMenu}>
              <div className={styles.trackMenuTitle}>Legendas</div>
              {subtitleMenuItems.map((item, index) => (
                <MenuItem
                  key={item.key}
                  focusKey={item.focusKey}
                  label={item.label}
                  isActive={item.isActive}
                  onSelect={() => {
                    setSubtitleTrack(item.trackIndex);
                    setActiveMenu(null);
                    setFocus('player-subtitle');
                  }}
                  onArrowPress={(dir) => handleMenuArrowPress(dir, 'subtitle', index, subtitleMenuItems.length)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Buffering Indicator */}
        {state === 'buffering' && (
          <div className={styles.loadingOverlay}>
            <div className={styles.spinner} />
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
}

export default PlayerContainer;
