/**
 * Browser Adapter
 * Implementa IPlayerAdapter usando HTML5 Video para desenvolvimento no browser
 */

import type { IPlayerAdapter } from './IPlayerAdapter';
import Hls from 'hls.js';
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
  private hls: Hls | null = null;
  private usingHls = false;
  private fallbackAttempted = false;
  private hlsRecoverAttempts = 0;
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
    this.video.crossOrigin = 'anonymous';
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

    // Se HLS.js estiver ativo, usa tracks do manifest
    if (this.hls) {
      const audioTracks = this.hls.audioTracks || [];
      this.tracks.audio = audioTracks.length
        ? audioTracks.map((t, idx) => ({
            index: idx,
            language: t.lang || 'und',
            label: t.name || `Áudio ${idx + 1}`,
            isDefault: idx === this.hls!.audioTrack,
          }))
        : [{ index: 0, language: 'und', label: 'Padrão', isDefault: true }];
      this.currentTracks.audioIndex = this.hls.audioTrack ?? 0;

      const subtitleTracks = this.hls.subtitleTracks || [];
      this.tracks.subtitle = subtitleTracks.length
        ? subtitleTracks.map((t, idx) => ({
            index: idx,
            language: t.lang || 'und',
            label: t.name || `Legenda ${idx + 1}`,
            isDefault: false,
          }))
        : [];
      this.currentTracks.subtitleIndex = this.hls.subtitleTrack ?? -1;
      this.currentTracks.subtitleEnabled = (this.hls.subtitleTrack ?? -1) >= 0;
    } else {
      // Fallback simples para MP4 / suporte nativo
      this.tracks.audio = [
        { index: 0, language: 'und', label: 'Padrão', isDefault: true },
      ];
      this.tracks.subtitle = [];
      this.currentTracks.audioIndex = 0;
      this.currentTracks.subtitleIndex = -1;
      this.currentTracks.subtitleEnabled = false;
    }

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

    // Limpa instancias anteriores
    this.destroyHls();
    this.usingHls = false;
    this.fallbackAttempted = false;
    this.hlsRecoverAttempts = 0;

    this.currentUrl = url;
    this.options = options;
    this.setState('loading');

    const isHls = url.toLowerCase().includes('.m3u8');
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const preferNative = /Safari/i.test(ua) && !/Chrome/i.test(ua); // usa nativo em Safari/iOS
    const isProbablyHls = isHls || url.toLowerCase().includes('m3u') || url.toLowerCase().includes('playlist') || url.toLowerCase().includes('chunklist');

    if (Hls.isSupported() && isProbablyHls && !preferNative) {
      this.hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 90,
      });
      this.usingHls = true;
      this.hls.attachMedia(this.video);
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[BrowserAdapter] HLS error', data);
        if (!data.fatal) return;

        // Tentativas leves de recuperação
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (this.hlsRecoverAttempts < 2) {
            this.hlsRecoverAttempts += 1;
            console.warn('[BrowserAdapter] HLS recover: restarting load');
            this.hls?.startLoad();
            return;
          }
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (this.hlsRecoverAttempts < 2) {
            this.hlsRecoverAttempts += 1;
            console.warn('[BrowserAdapter] HLS recover: media error');
            this.hls?.recoverMediaError();
            return;
          }
        }

        this.setState('error');
        this.emit('error', { code: 'HLS_FATAL', message: data.details });
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hlsRecoverAttempts = 0;
        this.loadTracks();
      });
      this.hls.loadSource(url);
    } else {
      // Uso nativo (Safari ou MP4/TS)
      this.video.src = url;
      this.video.load();
    }
  }

  async prepare(): Promise<void> {
    const video = this.video;
    if (!video) {
      throw new Error('Video element nao disponivel');
    }

    return new Promise((resolve, reject) => {
      let timeout = setTimeout(() => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        reject(new Error('Timeout ao preparar video'));
      }, 8000);

      const onCanPlay = () => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        clearTimeout(timeout);

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
        clearTimeout(timeout);
        const err = video.error;
        const message = err?.message || `Erro ao preparar video (code ${err?.code ?? 'n/a'})`;

        // Fallback: se não estamos usando HLS e há suporte, tenta HLS uma vez
        if (!this.usingHls && Hls.isSupported() && !this.fallbackAttempted) {
          this.fallbackAttempted = true;
          this.destroyHls();
          this.hls = new Hls({ lowLatencyMode: true, backBufferLength: 90 });
          this.usingHls = true;
          this.hls.attachMedia(video);
          this.hls.on(Hls.Events.MANIFEST_PARSED, () => this.loadTracks());
          this.hls.loadSource(this.currentUrl);

          // Re-armar listeners para novo fluxo
          video.addEventListener('canplay', onCanPlay);
          video.addEventListener('error', onError);
          timeout = setTimeout(() => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            reject(new Error('Timeout ao preparar video'));
          }, 8000);
          return;
        }

        reject(new Error(message));
      };

      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
    });
  }

  close(): void {
    this.destroyHls();
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
    if (this.hls && typeof this.hls.audioTrack === 'number') {
      this.hls.audioTrack = index;
    }
    this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
    console.log('[BrowserAdapter] Audio track changed to:', this.tracks.audio[index]);
  }

  setSubtitleTrack(index: number): void {
    this.currentTracks.subtitleIndex = index;
    this.currentTracks.subtitleEnabled = index >= 0;
    if (this.hls && typeof this.hls.subtitleTrack === 'number') {
      this.hls.subtitleTrack = index >= 0 ? index : -1;
    }
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

  setSubtitleStyle(): void {
    // Sem suporte nativo a customização de estilo no HTML5 básico (noop aqui).
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

  private destroyHls(): void {
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
  }
}

export default BrowserAdapter;
