/**
 * usePlayer Hook
 * Hook React para controlar o player de video
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { IPlayerAdapter } from '../adapters/IPlayerAdapter';
import type {
  PlayerState,
  TrackInfo,
  CurrentTracks,
  PlaybackInfo,
  PlayerOptions,
  PlayerEvent,
  AudioTrack,
  SubtitleTrack,
} from '../types';
import { parseHlsManifest, type HlsManifestInfo } from '@core/services/hls/manifest';
import { createPlayer, destroyMainPlayer, type PlayerFactoryOptions } from '../PlayerFactory';

export interface UsePlayerOptions extends PlayerFactoryOptions {
  autoDestroy?: boolean;
}

export interface UsePlayerReturn {
  // State
  state: PlayerState;
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  bufferedTime: number;
  volume: number;
  isMuted: boolean;
  errorMessage: string | null;

  // Tracks
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  currentAudioIndex: number;
  currentSubtitleIndex: number;
  subtitleEnabled: boolean;

  // Actions
  open: (url: string, options?: PlayerOptions) => Promise<void>;
  play: () => void;
  pause: () => void;
  stop: () => void;
  seek: (position: number) => void;
  seekForward: (ms?: number) => void;
  seekBackward: (ms?: number) => void;
  setAudioTrack: (index: number) => void;
  setSubtitleTrack: (index: number) => void;
  toggleSubtitles: () => void;
  setSubtitleStyle: (style: {
    fontSize?: number;
    color?: 'white' | 'yellow' | 'red' | 'green' | 'cyan';
    position?: 'bottom' | 'top';
  }) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  close: () => void;

  // External tracks parsed from HLS manifest (if available)
  externalAudioTracks: HlsManifestInfo['audio'];
  externalSubtitleTracks: HlsManifestInfo['subtitles'];

  // Player instance
  player: IPlayerAdapter | null;
}

const DEFAULT_SEEK_STEP = 10000; // 10 seconds

/**
 * Detect if URL is an HLS stream (direct or via proxy)
 */
function isHlsUrl(url: string): boolean {
  const lower = url.toLowerCase();
  // Direct .m3u8 URL
  if (lower.endsWith('.m3u8') || lower.includes('.m3u8?')) {
    return true;
  }
  // Proxied HLS URL - check if original URL is m3u8
  if (lower.includes('/api/proxy/hls')) {
    const match = url.match(/[?&]url=([^&]+)/);
    if (match) {
      const decoded = decodeURIComponent(match[1]).toLowerCase();
      return decoded.endsWith('.m3u8') || decoded.includes('.m3u8?');
    }
  }
  return false;
}

export function usePlayer(options: UsePlayerOptions = {}): UsePlayerReturn {
  // Default autoDestroy to false to prevent accidental player destruction
  // when component unmounts due to state changes or navigation
  const { autoDestroy = false, ...factoryOptions } = options;

  const playerRef = useRef<IPlayerAdapter | null>(null);
  const [state, setState] = useState<PlayerState>('idle');
  const [playbackInfo, setPlaybackInfo] = useState<PlaybackInfo>({
    currentTime: 0,
    duration: 0,
    bufferedTime: 0,
    playbackRate: 1,
    volume: 100,
    isMuted: false,
  });
  const [tracks, setTracks] = useState<TrackInfo>({
    audio: [],
    subtitle: [],
    video: [],
  });
  const [currentTracks, setCurrentTracks] = useState<CurrentTracks>({
    audioIndex: 0,
    subtitleIndex: -1,
    subtitleEnabled: false,
  });
  const [externalTracks, setExternalTracks] = useState<HlsManifestInfo>({
    audio: [],
    subtitles: [],
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Initialize player
  useEffect(() => {
    playerRef.current = createPlayer(factoryOptions);

    const handleEvent = (event: PlayerEvent) => {
      switch (event.type) {
        case 'statechange':
          setState((event.data as { state: PlayerState }).state);
          break;

        case 'timeupdate':
          setPlaybackInfo((prev) => ({
            ...prev,
            currentTime: (event.data as { currentTime: number }).currentTime,
          }));
          break;

        case 'durationchange':
          setPlaybackInfo((prev) => ({
            ...prev,
            duration: (event.data as { duration: number }).duration,
          }));
          break;

        case 'trackschange':
          setTracks(event.data as TrackInfo);
          break;

        case 'audiotrackchange':
          setCurrentTracks((prev) => ({
            ...prev,
            audioIndex: (event.data as { index: number }).index,
          }));
          break;

        case 'subtitletrackchange': {
          const data = event.data as { index: number; enabled: boolean };
          setCurrentTracks((prev) => ({
            ...prev,
            subtitleIndex: data.index,
            subtitleEnabled: data.enabled,
          }));
          break;
        }

        case 'bufferingstart':
        case 'bufferingend':
          // Handled via state change
          break;

        case 'error': {
          const errorData = event.data as { code?: string; message?: string };
          setErrorMessage(errorData.message || 'Erro desconhecido');
          break;
        }
      }
    };

    playerRef.current.addEventListener(handleEvent);

    return () => {
      if (playerRef.current) {
        playerRef.current.removeEventListener(handleEvent);
        if (autoDestroy) {
          destroyMainPlayer();
        }
      }
    };
  }, []);

  // Actions
  const open = useCallback(async (url: string, playerOptions?: PlayerOptions) => {
    if (!playerRef.current) {
      console.error('[usePlayer] Player not initialized');
      setErrorMessage('Player não inicializado');
      setState('error');
      return;
    }

    setErrorMessage(null); // Clear previous errors

    try {
      await playerRef.current.open(url, playerOptions);

      // Check if open() already set error state (e.g., unsupported format)
      if (playerRef.current.getState() === 'error') {
        console.log('[usePlayer] open() resulted in error state, skipping prepare()');
        return;
      }

      await playerRef.current.prepare();

      // Se for manifest HLS, tenta parsear EXT-X-MEDIA para faixas externas
      // Suporta URLs diretas (.m3u8) e via proxy (/api/proxy/hls?url=...)
      if (isHlsUrl(url)) {
        try {
          // Usa a URL do proxy se disponível (evita CORS), senão a URL original
          const fetchUrl = url;
          const res = await fetch(fetchUrl);
          if (res.ok) {
            const text = await res.text();
            const parsed = parseHlsManifest(text);
            setExternalTracks(parsed);
          } else {
            setExternalTracks({ audio: [], subtitles: [] });
          }
        } catch (e) {
          console.warn('[usePlayer] Falha ao parsear manifest HLS:', e);
          setExternalTracks({ audio: [], subtitles: [] });
        }
      } else {
        setExternalTracks({ audio: [], subtitles: [] });
      }
    } catch (error) {
      console.error('[usePlayer] Error opening video:', error);
      // Error event should already be emitted by adapter, but ensure UI is updated
      if (playerRef.current && playerRef.current.getState() !== 'error') {
        setErrorMessage(error instanceof Error ? error.message : 'Erro ao abrir vídeo');
        setState('error');
      }
    }
  }, []);

  const play = useCallback(() => {
    playerRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const stop = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  const seek = useCallback((position: number) => {
    playerRef.current?.seek(position);
  }, []);

  const seekForward = useCallback((ms: number = DEFAULT_SEEK_STEP) => {
    playerRef.current?.seekForward(ms);
  }, []);

  const seekBackward = useCallback((ms: number = DEFAULT_SEEK_STEP) => {
    playerRef.current?.seekBackward(ms);
  }, []);

  const setAudioTrack = useCallback((index: number) => {
    playerRef.current?.setAudioTrack(index);
  }, []);

  const setSubtitleTrack = useCallback((index: number) => {
    playerRef.current?.setSubtitleTrack(index);
  }, []);

  const toggleSubtitles = useCallback(() => {
    if (!playerRef.current) return;

    if (currentTracks.subtitleEnabled) {
      playerRef.current.setSubtitleTrack(-1);
    } else if (tracks.subtitle.length > 0) {
      const index = currentTracks.subtitleIndex >= 0 ? currentTracks.subtitleIndex : 0;
      playerRef.current.setSubtitleTrack(index);
    }
  }, [currentTracks.subtitleEnabled, currentTracks.subtitleIndex, tracks.subtitle.length]);

  const setVolume = useCallback((volume: number) => {
    playerRef.current?.setVolume(volume);
    setPlaybackInfo((prev) => ({ ...prev, volume }));
  }, []);

  const setSubtitleStyle = useCallback(
    (style: {
      fontSize?: number;
      color?: 'white' | 'yellow' | 'red' | 'green' | 'cyan';
      position?: 'bottom' | 'top';
    }) => {
      if (playerRef.current?.setSubtitleStyle) {
        playerRef.current.setSubtitleStyle(style);
      }
    },
    []
  );

  const toggleMute = useCallback(() => {
    if (!playerRef.current) return;
    const newMuted = !playbackInfo.isMuted;
    playerRef.current.setMuted(newMuted);
    setPlaybackInfo((prev) => ({ ...prev, isMuted: newMuted }));
  }, [playbackInfo.isMuted]);

  const close = useCallback(() => {
    playerRef.current?.close();
    setState('idle');
    setErrorMessage(null);
    setPlaybackInfo({
      currentTime: 0,
      duration: 0,
      bufferedTime: 0,
      playbackRate: 1,
      volume: 100,
      isMuted: false,
    });
    setTracks({ audio: [], subtitle: [], video: [] });
    setCurrentTracks({ audioIndex: 0, subtitleIndex: -1, subtitleEnabled: false });
  }, []);

  return {
    // State
    state,
    isPlaying: state === 'playing',
    isBuffering: state === 'buffering',
    currentTime: playbackInfo.currentTime,
    duration: playbackInfo.duration,
    bufferedTime: playbackInfo.bufferedTime,
    volume: playbackInfo.volume,
    isMuted: playbackInfo.isMuted,
    errorMessage,

    // Tracks
    audioTracks: tracks.audio,
    subtitleTracks: tracks.subtitle,
    currentAudioIndex: currentTracks.audioIndex,
    currentSubtitleIndex: currentTracks.subtitleIndex,
    subtitleEnabled: currentTracks.subtitleEnabled,

    // Actions
    open,
    play,
    pause,
    stop,
    seek,
    seekForward,
    seekBackward,
    setAudioTrack,
    setSubtitleTrack,
    toggleSubtitles,
    setSubtitleStyle,
    setVolume,
    toggleMute,
    close,
    externalAudioTracks: externalTracks.audio,
    externalSubtitleTracks: externalTracks.subtitles,

    // Player instance
    player: playerRef.current,
  };
}

export default usePlayer;
