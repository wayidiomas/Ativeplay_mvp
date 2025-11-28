/**
 * PlayerContainer
 * Fullscreen video player with controls for TV navigation
 */

import { useEffect, useCallback, useState, useRef } from 'react';
import { usePlayer } from '@player/hooks/usePlayer';
import type { AudioTrack, SubtitleTrack } from '@player/types';
import styles from './PlayerContainer.module.css';

interface PlayerContainerProps {
  url: string;
  title?: string;
  startPosition?: number;
  onClose?: () => void;
  onEnded?: () => void;
}

type MenuType = 'audio' | 'subtitle' | null;

export function PlayerContainer({
  url,
  title = '',
  startPosition = 0,
  onClose,
  onEnded,
}: PlayerContainerProps) {
  const {
    state,
    currentTime,
    duration,
    bufferedTime,
    audioTracks,
    subtitleTracks,
    currentAudioIndex,
    currentSubtitleIndex,
    open,
    play,
    pause,
    seekForward,
    seekBackward,
    setAudioTrack,
    setSubtitleTrack,
  } = usePlayer({ containerId: 'player-container' });

  const [controlsVisible, setControlsVisible] = useState(true);
  const [activeMenu, setActiveMenu] = useState<MenuType>(null);
  const hideControlsTimeout = useRef<ReturnType<typeof setTimeout>>();
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Open video on mount
  useEffect(() => {
    open(url, { startPosition, autoPlay: true });
  }, [url, startPosition, open]);

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

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      showControls();

      switch (e.key) {
        case 'Enter':
        case ' ':
          if (activeMenu === null) {
            if (state === 'playing') {
              pause();
            } else if (state === 'paused' || state === 'ready') {
              play();
            }
          }
          break;

        case 'ArrowLeft':
          if (activeMenu === null) {
            seekBackward(10000); // 10 seconds
          }
          break;

        case 'ArrowRight':
          if (activeMenu === null) {
            seekForward(10000); // 10 seconds
          }
          break;

        case 'ArrowUp':
          if (activeMenu === null) {
            seekForward(60000); // 1 minute
          }
          break;

        case 'ArrowDown':
          if (activeMenu === null) {
            seekBackward(60000); // 1 minute
          }
          break;

        case 'Escape':
        case 'Backspace':
          if (activeMenu) {
            setActiveMenu(null);
          } else if (onClose) {
            onClose();
          }
          break;

        // Samsung remote keys
        case 'MediaPlayPause':
          if (state === 'playing') {
            pause();
          } else {
            play();
          }
          break;

        case 'MediaPlay':
          play();
          break;

        case 'MediaPause':
          pause();
          break;

        case 'MediaRewind':
          seekBackward(30000);
          break;

        case 'MediaFastForward':
          seekForward(30000);
          break;

        // Keys for track selection
        case 'a':
        case 'A':
          setActiveMenu(activeMenu === 'audio' ? null : 'audio');
          break;

        case 's':
        case 'S':
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
    onClose,
  ]);

  // Calculate progress percentages
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedProgress = duration > 0 ? (bufferedTime / duration) * 100 : 0;

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
    return (
      <div className={styles.container} ref={containerRef}>
        <div id="player-container" className={styles.videoContainer} />
        <div className={styles.errorOverlay}>
          <div className={styles.errorIcon}>!</div>
          <h2 className={styles.errorTitle}>Erro na Reproducao</h2>
          <p className={styles.errorMessage}>
            Nao foi possivel reproduzir o video
          </p>
          <button
            className={styles.retryButton}
            onClick={() => open(url, { startPosition: currentTime })}
            autoFocus
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.container}
      ref={containerRef}
      onClick={showControls}
      onMouseMove={showControls}
    >
      <div id="player-container" className={styles.videoContainer} />

      {/* Controls Overlay */}
      <div
        className={`${styles.controlsOverlay} ${
          !controlsVisible ? styles.hidden : ''
        }`}
      >
        {/* Top Bar */}
        <div className={styles.topBar}>
          <h1 className={styles.title}>{title}</h1>
          <button
            className={styles.closeButton}
            onClick={onClose}
            tabIndex={controlsVisible ? 0 : -1}
          >
            X
          </button>
        </div>

        {/* Bottom Bar */}
        <div className={styles.bottomBar}>
          {/* Progress Bar */}
          <div className={styles.progressContainer}>
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
            </div>
            <div className={styles.timeInfo}>
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Control Buttons */}
          <div className={styles.controlsRow}>
            <button
              className={styles.controlButton}
              onClick={() => seekBackward(10000)}
              tabIndex={controlsVisible ? 0 : -1}
              title="Voltar 10s"
            >
              {'<<'}
            </button>

            <button
              className={`${styles.controlButton} ${styles.playPauseButton}`}
              onClick={() => (state === 'playing' ? pause() : play())}
              tabIndex={controlsVisible ? 0 : -1}
              autoFocus
            >
              {state === 'playing' ? '||' : '>'}
            </button>

            <button
              className={styles.controlButton}
              onClick={() => seekForward(10000)}
              tabIndex={controlsVisible ? 0 : -1}
              title="Avancar 10s"
            >
              {'>>'}
            </button>

            <button
              className={styles.controlButton}
              onClick={() => setActiveMenu(activeMenu === 'audio' ? null : 'audio')}
              tabIndex={controlsVisible ? 0 : -1}
              title="Audio"
            >
              A
            </button>

            <button
              className={styles.controlButton}
              onClick={() =>
                setActiveMenu(activeMenu === 'subtitle' ? null : 'subtitle')
              }
              tabIndex={controlsVisible ? 0 : -1}
              title="Legendas"
            >
              CC
            </button>
          </div>
        </div>

        {/* Audio Track Menu */}
        {activeMenu === 'audio' && audioTracks.length > 0 && (
          <div className={styles.trackMenu}>
            <div className={styles.trackMenuTitle}>Audio</div>
            {audioTracks.map((track: AudioTrack) => (
              <div
                key={track.index}
                className={`${styles.trackItem} ${
                  currentAudioIndex === track.index ? styles.active : ''
                }`}
                onClick={() => {
                  setAudioTrack(track.index);
                  setActiveMenu(null);
                }}
                tabIndex={0}
                role="button"
              >
                {track.label || track.language}
              </div>
            ))}
          </div>
        )}

        {/* Subtitle Track Menu */}
        {activeMenu === 'subtitle' && (
          <div className={styles.trackMenu}>
            <div className={styles.trackMenuTitle}>Legendas</div>
            <div
              className={`${styles.trackItem} ${
                currentSubtitleIndex === -1 ? styles.active : ''
              }`}
              onClick={() => {
                setSubtitleTrack(-1);
                setActiveMenu(null);
              }}
              tabIndex={0}
              role="button"
            >
              Desativado
            </div>
            {subtitleTracks.map((track: SubtitleTrack) => (
              <div
                key={track.index}
                className={`${styles.trackItem} ${
                  currentSubtitleIndex === track.index ? styles.active : ''
                }`}
                onClick={() => {
                  setSubtitleTrack(track.index);
                  setActiveMenu(null);
                }}
                tabIndex={0}
                role="button"
              >
                {track.label || track.language}
              </div>
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
  );
}

export default PlayerContainer;
