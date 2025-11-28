/**
 * Samsung AVPlay Adapter
 * Implementa IPlayerAdapter usando a API webapis.avplay do Samsung Tizen
 */

import type { IPlayerAdapter } from './IPlayerAdapter';
import type {
  PlayerState,
  TrackInfo,
  CurrentTracks,
  PlaybackInfo,
  PlayerOptions,
  PlayerEventCallback,
  VideoRect,
  DisplayMethod,
  PlayerEvent,
} from '../types';

// Tipos do Samsung AVPlay API
interface AVPlayTrackInfo {
  AUDIO: Array<{
    index: number;
    language: string;
    extra_info: string;
  }>;
  TEXT: Array<{
    index: number;
    language: string;
    extra_info: string;
  }>;
  VIDEO: Array<{
    index: number;
    extra_info: string;
  }>;
}

interface AVPlayAPI {
  open(url: string): void;
  close(): void;
  play(): void;
  pause(): void;
  stop(): void;
  jumpForward(ms: number): void;
  jumpBackward(ms: number): void;
  seekTo(ms: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  getState(): string;
  getTotalTrackInfo(): AVPlayTrackInfo;
  setSelectTrack(type: string, index: number): void;
  setListener(listener: AVPlayListener): void;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: string): void;
  prepareAsync(success: () => void, error: (e: Error) => void): void;
  setStreamingProperty(property: string, value: string): void;
  suspend(): void;
  restore(): void;
}

interface AVPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (time: number) => void;
  onevent?: (eventType: string, eventData: string) => void;
  onerror?: (error: string) => void;
  onstreamcompleted?: () => void;
  onsubtitlechange?: (duration: number, text: string) => void;
}

declare global {
  interface Window {
    webapis?: {
      avplay: AVPlayAPI;
    };
  }
}

function mapAVPlayState(state: string): PlayerState {
  switch (state) {
    case 'NONE':
    case 'IDLE':
      return 'idle';
    case 'READY':
      return 'ready';
    case 'PLAYING':
      return 'playing';
    case 'PAUSED':
      return 'paused';
    default:
      return 'idle';
  }
}

function parseLanguageCode(code: string): string {
  const languageMap: Record<string, string> = {
    por: 'Portugues',
    pt: 'Portugues',
    'pt-br': 'Portugues (BR)',
    eng: 'English',
    en: 'English',
    spa: 'Espanol',
    es: 'Espanol',
    fra: 'Francais',
    fr: 'Francais',
    deu: 'Deutsch',
    de: 'Deutsch',
    ita: 'Italiano',
    it: 'Italiano',
    jpn: 'Japones',
    ja: 'Japones',
    und: 'Indefinido',
  };
  return languageMap[code.toLowerCase()] || code;
}

export class SamsungAVPlayAdapter implements IPlayerAdapter {
  private avplay: AVPlayAPI | null = null;
  private state: PlayerState = 'idle';
  private currentUrl: string = '';
  private options: PlayerOptions = {};
  private listeners: Set<PlayerEventCallback> = new Set();
  private tracks: TrackInfo = { audio: [], subtitle: [], video: [] };
  private currentTracks: CurrentTracks = {
    audioIndex: 0,
    subtitleIndex: -1,
    subtitleEnabled: false,
  };
  private volume: number = 100;
  private muted: boolean = false;

  constructor() {
    if (typeof window !== 'undefined' && window.webapis?.avplay) {
      this.avplay = window.webapis.avplay;
    }
  }

  private emit(type: PlayerEvent['type'], data?: unknown): void {
    const event: PlayerEvent = {
      type,
      data,
      timestamp: Date.now(),
    };
    this.listeners.forEach((cb) => cb(event));
  }

  private setState(newState: PlayerState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('statechange', { state: newState });
    }
  }

  private setupListeners(): void {
    if (!this.avplay) return;

    this.avplay.setListener({
      onbufferingstart: () => {
        this.setState('buffering');
        this.emit('bufferingstart');
      },
      onbufferingcomplete: () => {
        if (this.state === 'buffering') {
          this.setState('playing');
        }
        this.emit('bufferingend');
      },
      onbufferingprogress: (percent: number) => {
        this.emit('bufferingend', { percent });
      },
      oncurrentplaytime: (time: number) => {
        this.emit('timeupdate', { currentTime: time });
      },
      onstreamcompleted: () => {
        this.setState('ended');
        this.emit('ended');
      },
      onerror: (error: string) => {
        this.setState('error');
        this.emit('error', {
          code: 'PLAYBACK_ERROR',
          message: error,
        });
      },
      onsubtitlechange: (_duration: number, text: string) => {
        this.emit('subtitletrackchange', { text });
      },
    });
  }

  private loadTracks(): void {
    if (!this.avplay) return;

    try {
      const trackInfo = this.avplay.getTotalTrackInfo();

      // Audio tracks
      this.tracks.audio = trackInfo.AUDIO.map((track) => ({
        index: track.index,
        language: track.language,
        label: parseLanguageCode(track.language) || track.extra_info || `Audio ${track.index + 1}`,
        isDefault: track.index === 0,
      }));

      // Subtitle tracks
      this.tracks.subtitle = trackInfo.TEXT.map((track) => ({
        index: track.index,
        language: track.language,
        label: parseLanguageCode(track.language) || track.extra_info || `Legenda ${track.index + 1}`,
        isDefault: false,
      }));

      // Video tracks
      this.tracks.video = trackInfo.VIDEO.map((track) => {
        const info = track.extra_info;
        const resolution = info.match(/(\d+)x(\d+)/);
        return {
          index: track.index,
          width: resolution ? parseInt(resolution[1]) : undefined,
          height: resolution ? parseInt(resolution[2]) : undefined,
        };
      });

      this.emit('trackschange', this.tracks);
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error loading tracks:', e);
    }
  }

  // Lifecycle

  async open(url: string, options: PlayerOptions = {}): Promise<void> {
    if (!this.avplay) {
      throw new Error('AVPlay API nao disponivel');
    }

    this.currentUrl = url;
    this.options = options;
    this.setState('loading');

    try {
      this.avplay.open(url);
      this.setupListeners();

      // Configura propriedades de streaming
      if (url.includes('.m3u8')) {
        this.avplay.setStreamingProperty('ADAPTIVE_INFO', 'BITRATES=5000000');
      }
    } catch (e) {
      this.setState('error');
      throw e;
    }
  }

  async prepare(): Promise<void> {
    if (!this.avplay) {
      throw new Error('AVPlay API nao disponivel');
    }

    return new Promise((resolve, reject) => {
      this.avplay!.prepareAsync(
        () => {
          this.setState('ready');

          // Ajusta para tela cheia por padrão
          try {
            const width = typeof window !== 'undefined' ? window.innerWidth : 1920;
            const height = typeof window !== 'undefined' ? window.innerHeight : 1080;
            this.setDisplayRect({ x: 0, y: 0, width, height });
            this.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
          } catch (e) {
            console.warn('[SamsungAVPlayAdapter] display setup skipped:', e);
          }

          this.loadTracks();

          // Aplica opcoes
          if (this.options.startPosition) {
            this.avplay!.seekTo(this.options.startPosition);
          }

          // Seleciona tracks preferidas
          if (this.options.preferredAudioLanguage && this.tracks.audio.length > 0) {
            const preferredAudio = this.tracks.audio.find(
              (t) => t.language === this.options.preferredAudioLanguage
            );
            if (preferredAudio) {
              this.setAudioTrack(preferredAudio.index);
            }
          }

          if (this.options.enableSubtitles && this.tracks.subtitle.length > 0) {
            if (this.options.preferredSubtitleLanguage) {
              const preferredSub = this.tracks.subtitle.find(
                (t) => t.language === this.options.preferredSubtitleLanguage
              );
              if (preferredSub) {
                this.setSubtitleTrack(preferredSub.index);
              }
            } else {
              this.setSubtitleTrack(0);
            }
          }

          if (this.options.autoPlay) {
            this.play();
          }

          resolve();
        },
        (error) => {
          this.setState('error');
          reject(error);
        }
      );
    });
  }

  close(): void {
    if (this.avplay) {
      try {
        this.avplay.close();
      } catch (e) {
        console.error('[SamsungAVPlayAdapter] Error closing:', e);
      }
    }
    this.setState('idle');
    this.tracks = { audio: [], subtitle: [], video: [] };
    this.currentTracks = { audioIndex: 0, subtitleIndex: -1, subtitleEnabled: false };
  }

  destroy(): void {
    this.close();
    this.listeners.clear();
    this.avplay = null;
  }

  // Playback Controls

  play(): void {
    if (!this.avplay) return;
    try {
      this.avplay.play();
      this.setState('playing');
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error playing:', e);
    }
  }

  pause(): void {
    if (!this.avplay) return;
    try {
      this.avplay.pause();
      this.setState('paused');
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error pausing:', e);
    }
  }

  stop(): void {
    if (!this.avplay) return;
    try {
      this.avplay.stop();
      this.setState('idle');
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error stopping:', e);
    }
  }

  seek(position: number): void {
    if (!this.avplay) return;
    try {
      this.avplay.seekTo(position);
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error seeking:', e);
    }
  }

  seekForward(ms: number): void {
    if (!this.avplay) return;
    try {
      this.avplay.jumpForward(ms);
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error seeking forward:', e);
    }
  }

  seekBackward(ms: number): void {
    if (!this.avplay) return;
    try {
      this.avplay.jumpBackward(ms);
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error seeking backward:', e);
    }
  }

  // Track Management

  getTracks(): TrackInfo {
    return { ...this.tracks };
  }

  getCurrentTracks(): CurrentTracks {
    return { ...this.currentTracks };
  }

  setAudioTrack(index: number): void {
    if (!this.avplay) return;
    if (index < 0 || index >= this.tracks.audio.length) return;

    try {
      this.avplay.setSelectTrack('AUDIO', index);
      this.currentTracks.audioIndex = index;
      this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error setting audio track:', e);
    }
  }

  setSubtitleTrack(index: number): void {
    if (!this.avplay) return;

    if (index < 0) {
      // Desativa legendas
      this.currentTracks.subtitleIndex = -1;
      this.currentTracks.subtitleEnabled = false;
      this.emit('subtitletrackchange', { index: -1, enabled: false });
      return;
    }

    if (index >= this.tracks.subtitle.length) return;

    try {
      this.avplay.setSelectTrack('TEXT', index);
      this.currentTracks.subtitleIndex = index;
      this.currentTracks.subtitleEnabled = true;
      this.emit('subtitletrackchange', {
        index,
        enabled: true,
        track: this.tracks.subtitle[index],
      });
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error setting subtitle track:', e);
    }
  }

  setSubtitleEnabled(enabled: boolean): void {
    if (enabled && this.currentTracks.subtitleIndex >= 0) {
      this.setSubtitleTrack(this.currentTracks.subtitleIndex);
    } else if (!enabled) {
      this.currentTracks.subtitleEnabled = false;
      this.emit('subtitletrackchange', { enabled: false });
    }
  }

  // State & Info

  getState(): PlayerState {
    if (this.avplay) {
      try {
        const avState = this.avplay.getState();
        return mapAVPlayState(avState);
      } catch {
        return this.state;
      }
    }
    return this.state;
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  getPlaybackInfo(): PlaybackInfo {
    if (!this.avplay) {
      return {
        currentTime: 0,
        duration: 0,
        bufferedTime: 0,
        playbackRate: 1,
        volume: this.volume,
        isMuted: this.muted,
      };
    }

    try {
      return {
        currentTime: this.avplay.getCurrentTime(),
        duration: this.avplay.getDuration(),
        bufferedTime: 0, // AVPlay nao expoe isso diretamente
        playbackRate: 1,
        volume: this.volume,
        isMuted: this.muted,
      };
    } catch {
      return {
        currentTime: 0,
        duration: 0,
        bufferedTime: 0,
        playbackRate: 1,
        volume: this.volume,
        isMuted: this.muted,
      };
    }
  }

  isPlaying(): boolean {
    return this.getState() === 'playing';
  }

  // Volume

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(100, volume));
    // Samsung Tizen usa o volume do sistema
    // Implementacao depende de tizen.tvaudiocontrol
  }

  getVolume(): number {
    return this.volume;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Samsung Tizen usa o mute do sistema
  }

  isMuted(): boolean {
    return this.muted;
  }

  // Display

  setDisplayRect(rect: VideoRect): void {
    if (!this.avplay) return;
    try {
      this.avplay.setDisplayRect(rect.x, rect.y, rect.width, rect.height);
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error setting display rect:', e);
    }
  }

  setDisplayMethod(method: DisplayMethod): void {
    if (!this.avplay) return;
    try {
      this.avplay.setDisplayMethod(method);
    } catch (e) {
      console.error('[SamsungAVPlayAdapter] Error setting display method:', e);
    }
  }

  // Events

  addEventListener(callback: PlayerEventCallback): void {
    this.listeners.add(callback);
  }

  removeEventListener(callback: PlayerEventCallback): void {
    this.listeners.delete(callback);
  }

  // Platform-specific

  suspend(): void {
    if (this.avplay) {
      try {
        this.avplay.suspend();
      } catch (e) {
        console.error('[SamsungAVPlayAdapter] Error suspending:', e);
      }
    }
  }

  restore(): void {
    if (this.avplay) {
      try {
        this.avplay.restore();
      } catch (e) {
        console.error('[SamsungAVPlayAdapter] Error restoring:', e);
      }
    }
  }
}

export default SamsungAVPlayAdapter;
