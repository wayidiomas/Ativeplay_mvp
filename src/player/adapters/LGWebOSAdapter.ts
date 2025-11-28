/**
 * LG webOS Adapter
 * Implementa IPlayerAdapter usando HTML5 Video + Luna Service para LG TVs
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

// Tipos do Luna Service
interface LunaServiceRequest {
  method: string;
  parameters: Record<string, unknown>;
  onSuccess?: (response: unknown) => void;
  onFailure?: (error: unknown) => void;
}

interface WebOSAPI {
  platform: { tv: boolean };
  service: {
    request: (uri: string, params: LunaServiceRequest) => void;
  };
  deviceInfo: (callback: (info: { modelName: string; version: string }) => void) => void;
}

declare global {
  interface Window {
    webOS?: WebOSAPI;
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
    und: 'Indefinido',
  };
  return languageMap[code.toLowerCase()] || code;
}

export class LGWebOSAdapter implements IPlayerAdapter {
  private video: HTMLVideoElement | null = null;
  private webOS: WebOSAPI | null = null;
  private isWebOS: boolean = false;
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
  private mediaId: string | null = null;
  private isBuffering: boolean = false;

  constructor(containerId?: string) {
    if (typeof window !== 'undefined') {
      this.webOS = window.webOS || null;
      this.isWebOS = !!this.webOS;
      // Em webOS usamos Luna Service; no browser usamos HTML5 video.
      if (!this.isWebOS) {
        this.createVideoElement(containerId);
      }
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
      if (this.video) {
        this.emit('durationchange', { duration: this.video.duration * 1000 });
      }
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
      if (this.video) {
        this.emit('timeupdate', { currentTime: this.video.currentTime * 1000 });
      }
    });

    this.video.addEventListener('ended', () => {
      this.setState('ended');
      this.emit('ended');
    });

    this.video.addEventListener('error', () => {
      this.setState('error');
      const error = this.video?.error;
      this.emit('error', {
        code: 'PLAYBACK_ERROR',
        message: error?.message || 'Erro de reproducao',
      });
    });
  }

  private loadTracks(): void {
    // Use Luna Service to get tracks on real webOS
    if (this.webOS && this.mediaId) {
      this.loadTracksViaLuna();
    } else {
      this.loadTracksFromElement();
    }
    this.emit('trackschange', this.tracks);
  }

  private loadTracksFromElement(): void {
    if (!this.video) return;

    // Audio tracks (non-standard, Safari/Chromium TVs podem expor)
    const audioTracks: any = (this.video as any).audioTracks;
    if (audioTracks && audioTracks.length) {
      this.tracks.audio = Array.from(audioTracks).map((track: any, index: number) => ({
        index,
        language: track.language || 'und',
        label: track.label || parseLanguageCode(track.language || 'und') || `Audio ${index + 1}`,
        isDefault: track.enabled || index === 0,
      }));
      // Atualiza current audio conforme enabled
      const current = this.tracks.audio.find((_t, idx) => audioTracks[idx]?.enabled) || this.tracks.audio[0];
      if (current) this.currentTracks.audioIndex = current.index;
    } else {
      this.tracks.audio = [{ index: 0, language: 'und', label: 'Padrão', isDefault: true }];
      this.currentTracks.audioIndex = 0;
    }

    // Subtitle tracks (HTML5 textTracks)
    const textTracks = this.video.textTracks;
    if (textTracks && textTracks.length) {
      this.tracks.subtitle = Array.from(textTracks).map((track, index) => ({
        index,
        language: track.language || 'und',
        label: track.label || parseLanguageCode(track.language || 'und') || `Legenda ${index + 1}`,
        isDefault: track.mode === 'showing' || index === 0,
      }));
      const currentSub = this.tracks.subtitle.find((_t, idx) => textTracks[idx]?.mode === 'showing');
      if (currentSub) {
        this.currentTracks.subtitleIndex = currentSub.index;
        this.currentTracks.subtitleEnabled = true;
      } else {
        this.currentTracks.subtitleIndex = -1;
        this.currentTracks.subtitleEnabled = false;
      }
    } else {
      this.tracks.subtitle = [];
      this.currentTracks.subtitleIndex = -1;
      this.currentTracks.subtitleEnabled = false;
    }

    // Video track basic info
    this.tracks.video = [
      { index: 0, width: this.video.videoWidth, height: this.video.videoHeight },
    ];
  }

  private loadTracksViaLuna(): void {
    if (!this.webOS || !this.mediaId) return;

    this.webOS.service.request('luna://com.webos.media', {
      method: 'getTrackInfo',
      parameters: { mediaId: this.mediaId },
      onSuccess: (response: unknown) => {
        const data = response as {
          audioTrackList?: Array<{ language: string; codec?: string }>;
          subtitleTrackList?: Array<{ language: string }>;
        };

        if (data.audioTrackList) {
          this.tracks.audio = data.audioTrackList.map((track, index) => ({
            index,
            language: track.language,
            label: parseLanguageCode(track.language) || `Audio ${index + 1}`,
            codec: track.codec,
            isDefault: index === 0,
          }));
          this.currentTracks.audioIndex = 0;
        }

        if (data.subtitleTrackList) {
          this.tracks.subtitle = data.subtitleTrackList.map((track, index) => ({
            index,
            language: track.language,
            label: parseLanguageCode(track.language) || `Legenda ${index + 1}`,
            isDefault: false,
          }));
          this.currentTracks.subtitleIndex = -1;
          this.currentTracks.subtitleEnabled = false;
        }

        this.emit('trackschange', this.tracks);
      },
    });
  }

  private setTrackViaLuna(type: 'audio' | 'subtitle', index: number): void {
    if (!this.webOS || !this.mediaId) return;

    const method = type === 'audio' ? 'selectTrack' : 'setSubtitleEnable';
    const parameters: Record<string, unknown> = { mediaId: this.mediaId };

    if (type === 'audio') {
      parameters.type = 'audio';
      parameters.index = index;
    } else {
      parameters.enable = index >= 0;
      if (index >= 0) {
        parameters.index = index;
      }
    }

    this.webOS.service.request('luna://com.webos.media', {
      method,
      parameters,
      onSuccess: () => {
        if (type === 'audio') {
          this.currentTracks.audioIndex = index;
          this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
        } else {
          this.currentTracks.subtitleIndex = index;
          this.currentTracks.subtitleEnabled = index >= 0;
          this.emit('subtitletrackchange', {
            index,
            enabled: index >= 0,
            track: index >= 0 ? this.tracks.subtitle[index] : undefined,
          });
        }
      },
    });
  }

  // Lifecycle

  async open(url: string, options: PlayerOptions = {}): Promise<void> {
    this.currentUrl = url;
    this.options = options;
    this.setState('loading');

    if (this.isWebOS && this.webOS) {
      // Usa Luna Service para carregar mídia nativa
      return new Promise((resolve, reject) => {
        this.mediaId = `ativeplay-${Date.now()}`;
        this.webOS!.service.request('luna://com.webos.media', {
          method: 'load',
          parameters: {
            mediaId: this.mediaId,
            uri: url,
            type: 'media',
            options: {
              autoplay: false,
              mimetype: url.endsWith('.m3u8') ? 'application/x-mpegURL' : 'video/mp4',
            },
          },
          onSuccess: () => {
            this.setState('ready');
            resolve();
          },
          onFailure: (error) => {
            this.setState('error');
            reject(error);
          },
        });
      });
    }

    // Fallback: HTML5 video (browser/dev)
    if (!this.video) {
      throw new Error('Video element nao disponivel');
    }

    this.video.src = url;
    this.video.load();
  }

  async prepare(): Promise<void> {
    if (this.isWebOS && this.webOS && this.mediaId) {
      // Nada extra: load já prepara; aqui apenas aplica startPosition/autoPlay
      if (this.options.startPosition) {
        this.webOS.service.request('luna://com.webos.media', {
          method: 'seek',
          parameters: { mediaId: this.mediaId, position: this.options.startPosition },
        });
      }

      if (this.options.autoPlay) {
        this.play();
      }
      return;
    }

    if (!this.video) {
      throw new Error('Video element nao disponivel');
    }

    return new Promise((resolve, reject) => {
      const video = this.video!;

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
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.webOS.service.request('luna://com.webos.media', {
        method: 'unload',
        parameters: { mediaId: this.mediaId },
      });
    }

    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.load();
    }
    this.setState('idle');
    this.tracks = { audio: [], subtitle: [], video: [] };
    this.currentTracks = { audioIndex: 0, subtitleIndex: -1, subtitleEnabled: false };
    this.mediaId = null;
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
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.webOS.service.request('luna://com.webos.media', {
        method: 'play',
        parameters: { mediaId: this.mediaId },
        onSuccess: () => this.setState('playing'),
        onFailure: () => this.setState('error'),
      });
      return;
    }

    if (this.video) {
      this.video.play().catch((e) => {
        console.error('[LGWebOSAdapter] Error playing:', e);
      });
    }
  }

  pause(): void {
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.webOS.service.request('luna://com.webos.media', {
        method: 'pause',
        parameters: { mediaId: this.mediaId },
        onSuccess: () => this.setState('paused'),
      });
      return;
    }

    if (this.video) {
      this.video.pause();
    }
  }

  stop(): void {
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.webOS.service.request('luna://com.webos.media', {
        method: 'stop',
        parameters: { mediaId: this.mediaId },
        onSuccess: () => this.setState('idle'),
      });
      return;
    }

    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }
    this.setState('idle');
  }

  seek(position: number): void {
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.webOS.service.request('luna://com.webos.media', {
        method: 'seek',
        parameters: { mediaId: this.mediaId, position },
      });
      return;
    }

    if (this.video) {
      this.video.currentTime = position / 1000;
    }
  }

  seekForward(ms: number): void {
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.seek(ms);
      return;
    }
    if (this.video) {
      this.video.currentTime += ms / 1000;
    }
  }

  seekBackward(ms: number): void {
    if (this.isWebOS && this.webOS && this.mediaId) {
      this.seek(-ms);
      return;
    }
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

    if (this.webOS && this.mediaId) {
      this.setTrackViaLuna('audio', index);
    } else {
      // HTML5 audioTracks
      const audioTracks: any = (this.video as any)?.audioTracks;
      if (audioTracks && audioTracks.length) {
        Array.from(audioTracks).forEach((t: any, idx: number) => {
          t.enabled = idx === index;
        });
      }
      this.currentTracks.audioIndex = index;
      this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
    }
  }

  setSubtitleTrack(index: number): void {
    if (this.webOS && this.mediaId) {
      this.setTrackViaLuna('subtitle', index);
    } else {
      if (!this.video) return;
      const textTracks = this.video.textTracks;
      if (textTracks && textTracks.length) {
        Array.from(textTracks).forEach((t, idx) => {
          t.mode = idx === index ? 'showing' : 'hidden';
        });
      }
      this.currentTracks.subtitleIndex = index;
      this.currentTracks.subtitleEnabled = index >= 0;
      this.emit('subtitletrackchange', {
        index,
        enabled: index >= 0,
        track: index >= 0 ? this.tracks.subtitle[index] : undefined,
      });
    }
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
    if (this.isWebOS) {
      // Sem feedback contínuo; retorna parcial
      return {
        currentTime: 0,
        duration: 0,
        bufferedTime: 0,
        playbackRate: 1,
        volume: 100,
        isMuted: false,
      };
    }

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
    // Nada especifico para webOS
  }
}

export default LGWebOSAdapter;
