/**
 * Browser Adapter
 * Implementa IPlayerAdapter usando HTML5 Video para desenvolvimento no browser
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

export class BrowserAdapter implements IPlayerAdapter {
  private video: HTMLVideoElement | null = null;
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
  private isBuffering: boolean = false;

  constructor(containerId?: string) {
    if (typeof window !== 'undefined') {
      this.createVideoElement(containerId);
    }
  }

  private createVideoElement(containerId?: string): void {
    this.video = document.createElement('video');
    this.video.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: black;
    `;
    this.video.setAttribute('playsinline', '');
    // Não adiciona 'controls' - usamos controles customizados do React

    const container = containerId
      ? document.getElementById(containerId)
      : document.body;

    if (container) {
      container.appendChild(this.video);
    }

    this.setupVideoListeners();
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

  private setupVideoListeners(): void {
    if (!this.video) return;

    this.video.addEventListener('loadstart', () => {
      this.setState('loading');
    });

    this.video.addEventListener('loadedmetadata', () => {
      this.loadTracks();
      this.emit('durationchange', { duration: this.video!.duration * 1000 });
    });

    this.video.addEventListener('canplay', () => {
      this.setState('ready');
    });

    this.video.addEventListener('play', () => {
      this.setState('playing');
    });

    this.video.addEventListener('pause', () => {
      if (!this.isBuffering) {
        this.setState('paused');
      }
    });

    this.video.addEventListener('waiting', () => {
      this.isBuffering = true;
      this.setState('buffering');
      this.emit('bufferingstart');
    });

    this.video.addEventListener('playing', () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.emit('bufferingend');
      }
      this.setState('playing');
    });

    this.video.addEventListener('timeupdate', () => {
      this.emit('timeupdate', { currentTime: this.video!.currentTime * 1000 });
    });

    this.video.addEventListener('ended', () => {
      this.setState('ended');
      this.emit('ended');
    });

    this.video.addEventListener('error', () => {
      this.setState('error');
      const error = this.video!.error;
      this.emit('error', {
        code: 'PLAYBACK_ERROR',
        message: error?.message || 'Erro de reproducao',
      });
    });
  }

  private loadTracks(): void {
    if (!this.video) return;

    // Simula tracks para desenvolvimento
    // No browser real, usaria MediaSource Extensions ou HLS.js
    this.tracks.audio = [
      { index: 0, language: 'por', label: 'Portugues', isDefault: true },
      { index: 1, language: 'eng', label: 'English', isDefault: false },
    ];

    this.tracks.subtitle = [
      { index: 0, language: 'por', label: 'Portugues', isDefault: false },
      { index: 1, language: 'eng', label: 'English', isDefault: false },
    ];

    this.tracks.video = [
      {
        index: 0,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
      },
    ];

    this.emit('trackschange', this.tracks);
  }

  // Lifecycle

  async open(url: string, options: PlayerOptions = {}): Promise<void> {
    if (!this.video) {
      throw new Error('Video element nao disponivel');
    }

    this.currentUrl = url;
    this.options = options;
    this.setState('loading');

    this.video.src = url;
    this.video.load();
  }

  async prepare(): Promise<void> {
    const video = this.video;
    if (!video) {
      throw new Error('Video element nao disponivel');
    }

    return new Promise((resolve, reject) => {
      const onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);

        if (this.options.startPosition) {
          video.currentTime = this.options.startPosition / 1000;
        }

        if (this.options.volume !== undefined) {
          video.volume = this.options.volume / 100;
        }

        if (this.options.muted !== undefined) {
          video.muted = this.options.muted;
        }

        if (this.options.autoPlay) {
          this.play();
        }

        resolve();
      };

      const onError = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        reject(new Error('Erro ao preparar video'));
      };

      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
    });
  }

  close(): void {
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.load();
    }
    this.setState('idle');
    this.tracks = { audio: [], subtitle: [], video: [] };
    this.currentTracks = { audioIndex: 0, subtitleIndex: -1, subtitleEnabled: false };
  }

  destroy(): void {
    this.close();
    if (this.video && this.video.parentNode) {
      this.video.parentNode.removeChild(this.video);
    }
    this.video = null;
    this.listeners.clear();
  }

  // Playback Controls

  play(): void {
    if (this.video) {
      this.video.play().catch((e) => {
        console.error('[BrowserAdapter] Error playing:', e);
      });
    }
  }

  pause(): void {
    if (this.video) {
      this.video.pause();
    }
  }

  stop(): void {
    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }
    this.setState('idle');
  }

  seek(position: number): void {
    if (this.video) {
      this.video.currentTime = position / 1000;
    }
  }

  seekForward(ms: number): void {
    if (this.video) {
      this.video.currentTime += ms / 1000;
    }
  }

  seekBackward(ms: number): void {
    if (this.video) {
      this.video.currentTime = Math.max(0, this.video.currentTime - ms / 1000);
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
    if (index < 0 || index >= this.tracks.audio.length) return;
    this.currentTracks.audioIndex = index;
    this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
    console.log('[BrowserAdapter] Audio track changed to:', this.tracks.audio[index]);
  }

  setSubtitleTrack(index: number): void {
    this.currentTracks.subtitleIndex = index;
    this.currentTracks.subtitleEnabled = index >= 0;
    this.emit('subtitletrackchange', {
      index,
      enabled: index >= 0,
      track: index >= 0 ? this.tracks.subtitle[index] : undefined,
    });
    console.log('[BrowserAdapter] Subtitle track changed to:', index >= 0 ? this.tracks.subtitle[index] : 'OFF');
  }

  setSubtitleEnabled(enabled: boolean): void {
    if (enabled && this.currentTracks.subtitleIndex >= 0) {
      this.setSubtitleTrack(this.currentTracks.subtitleIndex);
    } else if (!enabled) {
      this.setSubtitleTrack(-1);
    }
  }

  // State & Info

  getState(): PlayerState {
    return this.state;
  }

  getCurrentUrl(): string {
    return this.currentUrl;
  }

  getPlaybackInfo(): PlaybackInfo {
    if (!this.video) {
      return {
        currentTime: 0,
        duration: 0,
        bufferedTime: 0,
        playbackRate: 1,
        volume: 100,
        isMuted: false,
      };
    }

    const buffered = this.video.buffered;
    const bufferedTime =
      buffered.length > 0 ? buffered.end(buffered.length - 1) * 1000 : 0;

    return {
      currentTime: this.video.currentTime * 1000,
      duration: (this.video.duration || 0) * 1000,
      bufferedTime,
      playbackRate: this.video.playbackRate,
      volume: this.video.volume * 100,
      isMuted: this.video.muted,
    };
  }

  isPlaying(): boolean {
    return this.state === 'playing';
  }

  // Volume

  setVolume(volume: number): void {
    if (this.video) {
      this.video.volume = Math.max(0, Math.min(1, volume / 100));
    }
  }

  getVolume(): number {
    return this.video ? this.video.volume * 100 : 100;
  }

  setMuted(muted: boolean): void {
    if (this.video) {
      this.video.muted = muted;
    }
  }

  isMuted(): boolean {
    return this.video?.muted ?? false;
  }

  // Display

  setDisplayRect(rect: VideoRect): void {
    if (this.video) {
      this.video.style.left = `${rect.x}px`;
      this.video.style.top = `${rect.y}px`;
      this.video.style.width = `${rect.width}px`;
      this.video.style.height = `${rect.height}px`;
    }
  }

  setDisplayMethod(method: DisplayMethod): void {
    if (this.video) {
      this.video.style.objectFit =
        method === 'PLAYER_DISPLAY_MODE_LETTER_BOX' ? 'contain' : 'cover';
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
    if (this.video && this.isPlaying()) {
      this.video.pause();
    }
  }

  restore(): void {
    // Nada especifico
  }
}

export default BrowserAdapter;
