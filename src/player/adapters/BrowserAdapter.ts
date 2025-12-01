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

const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL;

/**
 * Detect if URL is an IPTV live stream pattern (raw TS, not HLS)
 * Common patterns:
 * - /play/TOKEN/ts (Xtream Codes TS)
 * - /username/password/stream_id (Xtream Codes API)
 */
function isIptvTsStream(url: string): boolean {
  // Pattern: ends with /ts (not .ts file extension)
  if (/\/ts(\?|$)/i.test(url)) return true;
  // Pattern: numeric Xtream Codes path /digits/digits/digits (no extension)
  if (/\/\d+\/\d+\/\d+(\?|$)/.test(url)) return true;
  // Query param indicating TS output
  if (url.includes('output=ts')) return true;
  return false;
}

/**
 * Heuristic to detect live streams (HLS) when mediaKind is not explicitly provided.
 * Matches common IPTV/live patterns; VOD .m3u8 URLs usually carry file-like names.
 */
function isLikelyLiveHls(url: string): boolean {
  const lower = url.toLowerCase();
  const liveHints = /(live|channel|stream|tv|iptv|24\/7|ao ?vivo)/i;
  const vodHints = /(vod|movie|filme|episode|episodio|series|season|s0?\d|e0?\d)/i;
  // No explicit extension or clear live hints: treat as live to be safer with buffering
  const hasFileName = /\.[a-z0-9]{2,4}(\?|$)/i.test(lower);
  if (liveHints.test(lower)) return true;
  if (vodHints.test(lower)) return false;
  return !hasFileName;
}

/**
 * Detect container formats not natively supported by HTML5 video
 * MKV and AVI require transcoding or native player (webOS Luna Service)
 */
function isUnsupportedContainer(url: string): { unsupported: boolean; format: string | null } {
  const lower = url.toLowerCase();
  if (lower.endsWith('.mkv') || lower.includes('.mkv?')) {
    return { unsupported: true, format: 'MKV' };
  }
  if (lower.endsWith('.avi') || lower.includes('.avi?')) {
    return { unsupported: true, format: 'AVI' };
  }
  if (lower.endsWith('.wmv') || lower.includes('.wmv?')) {
    return { unsupported: true, format: 'WMV' };
  }
  if (lower.endsWith('.flv') || lower.includes('.flv?')) {
    return { unsupported: true, format: 'FLV' };
  }
  return { unsupported: false, format: null };
}

export class BrowserAdapter implements IPlayerAdapter {
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
  private usingHls = false;
  private fallbackAttempted = false;
  private nativeFallbackDone = false;
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

  private async peekContentType(url: string): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    try {
      // Usa proxy para URLs externas no HEAD request também
      const proxiedUrl = this.proxifyUrl(url);
      const resp = await fetch(proxiedUrl, { method: 'HEAD', signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) return null;
      return resp.headers.get('content-type');
    } catch {
      clearTimeout(timeout);
      return null;
    }
  }

  private setupVideoListeners(): void {
    if (!this.video) return;

    this.video.addEventListener('loadstart', () => {
      console.log('[BrowserAdapter] loadstart event fired');
      this.setState('loading');
    });

    this.video.addEventListener('loadedmetadata', () => {
      console.log('[BrowserAdapter] loadedmetadata event fired, duration:', this.video!.duration);
      this.loadTracks();
      this.emit('durationchange', { duration: this.video!.duration * 1000 });
    });

    this.video.addEventListener('canplay', () => {
      console.log('[BrowserAdapter] canplay event fired');
      this.setState('ready');
    });

    this.video.addEventListener('play', () => {
      this.setState('playing');
    });

    this.video.addEventListener('pause', () => {
      // Don't set paused state if we're buffering or if it's a live stream
      // (live stream pause handling is done separately with auto-resume)
      if (!this.isBuffering && !this.options.isLive) {
        this.setState('paused');
      }
    });

    this.video.addEventListener('waiting', () => {
      this.isBuffering = true;
      this.setState('buffering');
      this.emit('bufferingstart');
    });

    // Handle stalled event - browser is trying to fetch but data is not forthcoming
    this.video.addEventListener('stalled', () => {
      console.log('[BrowserAdapter] Video stalled, attempting recovery...');
      if (this.options.isLive && this.hls) {
        // For live streams, try to restart loading
        this.hls.startLoad();
      }
    });

    this.video.addEventListener('playing', () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.emit('bufferingend');
      }
      this.setState('playing');
    });

    // Auto-resume for live streams when paused unexpectedly
    this.video.addEventListener('pause', () => {
      if (this.options.isLive && !this.isBuffering) {
        // Live stream paused unexpectedly - try to resume after a short delay
        console.log('[BrowserAdapter] Live stream paused unexpectedly, attempting resume...');
        setTimeout(() => {
          if (this.video && this.video.paused && this.options.isLive) {
            this.video.play().catch(e => {
              console.warn('[BrowserAdapter] Auto-resume failed:', e);
            });
          }
        }, 1000);
      }
    });

    this.video.addEventListener('timeupdate', () => {
      this.emit('timeupdate', { currentTime: this.video!.currentTime * 1000 });
    });

    this.video.addEventListener('ended', () => {
      // Live streams should not trigger 'ended' - they may fire this event
      // due to buffer gaps, EOS markers, or manifest reloads
      if (this.options.isLive) {
        console.log('[BrowserAdapter] Ignoring ended event for live stream');
        return;
      }
      this.setState('ended');
      this.emit('ended');
    });

    this.video.addEventListener('error', () => {
      const error = this.video!.error;
      console.error('[BrowserAdapter] error event fired:', error?.code, error?.message);
      this.setState('error');
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

  private proxifyUrl(url: string, referer?: string): string {
    // Always try to proxy to avoid CORS. If BRIDGE_URL is not set, use same-origin.
    const base = BRIDGE_URL || `${window.location.protocol}//${window.location.host}`;
    if (!/^https?:\/\//i.test(url)) return url;
    if (url.includes('/api/proxy/hls')) return url;
    const params = new URLSearchParams({ url });
    if (referer) params.set('referer', referer);
    return `${base}/api/proxy/hls?${params}`;
  }

  private buildHlsConfig(isLive: boolean, proxyUrl: (url: string, referer?: string) => string, referer?: string) {
    const loader = class ProxyLoader extends Hls.DefaultConfig.loader {
      load(context: any, config: any, callbacks: any) {
        // Proxy external URLs that aren't already proxied
        if (context.url && !context.url.includes('/api/proxy/hls') && /^https?:\/\//i.test(context.url)) {
          context.url = proxyUrl(context.url, referer);
          console.log('[BrowserAdapter] HLS proxied:', context.url.substring(0, 100));
        }
        super.load(context, config, callbacks);
      }
    };

    if (isLive) {
      return {
        // Live stability: avoid aggressive low-latency, keep a comfortable buffer
        lowLatencyMode: false,
        maxBufferLength: 60,
        maxMaxBufferLength: 120,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        liveDurationInfinity: true,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 1000,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 1000,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 1000,
        loader,
      };
    }

    // VOD/DVR defaults: keep conservative buffer without forcing live-specific options
    return {
      lowLatencyMode: false,
      backBufferLength: 120,
      loader,
    };
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
    this.nativeFallbackDone = false;
    this.hlsRecoverAttempts = 0;

    // Extract referer from URL origin for IPTV providers that require it
    let referer: string | undefined;
    try {
      const parsed = new URL(url);
      referer = parsed.origin;
    } catch {
      // Invalid URL, no referer
    }

    this.currentUrl = this.proxifyUrl(url, referer);
    this.options = options;
    this.setState('loading');

    // Check for unsupported container formats (MKV, AVI, WMV, FLV)
    // These require transcoding or native player (webOS Luna Service)
    const containerCheck = isUnsupportedContainer(url);
    if (containerCheck.unsupported) {
      console.warn(`[BrowserAdapter] Formato ${containerCheck.format} não suportado pelo browser`);
      this.setState('error');
      this.emit('error', {
        code: 'UNSUPPORTED_FORMAT',
        message: `Formato ${containerCheck.format} não é suportado pelo navegador. Use a TV para reproduzir.`,
        format: containerCheck.format,
      });
      // THROW instead of return so caller knows to not call prepare()
      throw new Error(`Formato ${containerCheck.format} não suportado`);
    }

    const hasExtension = /\.[a-z0-9]{2,4}(\?|$)/i.test(url);
    let contentType: string | null = null;
    if (!hasExtension) {
      contentType = await this.peekContentType(this.currentUrl);
    }

    // Detect IPTV TS streams (should NOT use HLS.js)
    const isIptvTs = isIptvTsStream(url) || (contentType ? /mp2t/i.test(contentType) : false);
    const isLiveStream = options.isLive ?? (isIptvTs || isLikelyLiveHls(url));

    const isHls = url.toLowerCase().includes('.m3u8') || (contentType ? /mpegurl/i.test(contentType) : false);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const preferNative = /Safari/i.test(ua) && !/Chrome/i.test(ua); // usa nativo em Safari/iOS
    const isProbablyHls =
      !isIptvTs && // Don't use HLS.js for raw TS streams
      (isHls ||
      url.toLowerCase().includes('m3u') ||
      url.toLowerCase().includes('playlist') ||
      url.toLowerCase().includes('chunklist') ||
      (!hasExtension && !preferNative)); // sem extensão: tenta HLS primeiro fora do Safari

    if (Hls.isSupported() && isProbablyHls && !preferNative) {
      console.log('[BrowserAdapter] Using HLS.js to load:', this.currentUrl.substring(0, 100));

      // Custom loader to proxy all HLS sub-requests (playlists, segments)
      // This fixes the issue where relative URLs in manifests get resolved against proxy URL
      const proxyUrl = this.proxifyUrl.bind(this);

      const hlsConfig = this.buildHlsConfig(isLiveStream, proxyUrl, referer);
      this.hls = new Hls(hlsConfig);
      this.usingHls = true;
      this.hls.attachMedia(this.video);
      this.hls.on(Hls.Events.ERROR, (_event, data) => {
        console.error('[BrowserAdapter] HLS error', data);
        if (!data.fatal) return;

        // Live streams need more retry attempts due to transient network issues
        const maxAttempts = this.options.isLive ? 10 : 3;
        const backoffMs = Math.min(1000 * Math.pow(2, this.hlsRecoverAttempts), 30000);

        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (this.hlsRecoverAttempts < maxAttempts) {
            this.hlsRecoverAttempts++;
            console.log(`[BrowserAdapter] Network error recovery attempt ${this.hlsRecoverAttempts}/${maxAttempts}, backoff ${backoffMs}ms`);
            setTimeout(() => this.hls?.startLoad(), backoffMs);
            return;
          }
        }

        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (this.hlsRecoverAttempts < maxAttempts) {
            this.hlsRecoverAttempts++;
            console.log(`[BrowserAdapter] Media error recovery attempt ${this.hlsRecoverAttempts}/${maxAttempts}, backoff ${backoffMs}ms`);
            setTimeout(() => this.hls?.recoverMediaError(), backoffMs);
            return;
          }
        }

        // All recovery attempts exhausted
        console.error(`[BrowserAdapter] HLS fatal error after ${this.hlsRecoverAttempts} attempts:`, data.details);
        this.setState('error');
        this.emit('error', { code: 'HLS_FATAL', message: data.details });
      });
      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hlsRecoverAttempts = 0;
        this.loadTracks();
      });

      // Usa proxy para URLs externas (evita CORS)
      console.log('[BrowserAdapter] Loading HLS:', this.currentUrl !== url ? 'via proxy' : 'direct');
      this.hls.loadSource(this.currentUrl);
    } else {
      // Uso nativo (Safari ou MP4/TS/IPTV) - Usa proxy para URLs externas
      if (isIptvTs) {
        console.log('[BrowserAdapter] Loading IPTV TS stream:', this.currentUrl !== url ? 'via proxy' : 'direct', this.currentUrl.substring(0, 100));
      } else {
        console.log('[BrowserAdapter] Loading native:', this.currentUrl !== url ? 'via proxy' : 'direct', this.currentUrl.substring(0, 100));
      }
      this.video.src = this.currentUrl;
      this.video.load();
    }
  }

  async prepare(): Promise<void> {
    const video = this.video;
    if (!video) {
      throw new Error('Video element nao disponivel');
    }

    console.log('[BrowserAdapter] prepare() called, current state:', this.state, 'src:', video.src?.substring(0, 100));

    return new Promise((resolve, reject) => {
      // Live streams may take longer to start due to manifest parsing and buffer loading
      const prepTimeoutMs = this.options.isLive ? 45000 : 15000;

      let timeout = setTimeout(() => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        reject(new Error('Timeout ao preparar video'));
      }, prepTimeoutMs);

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

        // Provide user-friendly error messages based on error code
        let message: string;
        if (err) {
          switch (err.code) {
            case MediaError.MEDIA_ERR_ABORTED:
              message = 'Reprodução cancelada';
              break;
            case MediaError.MEDIA_ERR_NETWORK:
              message = 'Erro de rede ao carregar o vídeo. Verifique sua conexão.';
              break;
            case MediaError.MEDIA_ERR_DECODE:
              message = 'Erro ao decodificar o vídeo. Formato possivelmente corrompido.';
              break;
            case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
              message = 'Formato de vídeo não suportado pelo navegador. Tente em uma TV LG WebOS.';
              break;
            default:
              message = err.message || `Erro desconhecido (code ${err.code})`;
          }
        } else {
          message = 'Erro desconhecido ao preparar vídeo';
        }

        console.warn('[BrowserAdapter] Video error:', err?.code, message);

        // Emit error event with user-friendly message
        this.setState('error');
        this.emit('error', {
          code: err?.code ? `MEDIA_ERR_${err.code}` : 'UNKNOWN',
          message,
        });

        // Fallback: se não estamos usando HLS e há suporte, tenta HLS uma vez
        // Caso estejamos em Hls e houver erro fatal, tentamos recarregar uma vez
        if (this.usingHls && this.hls && !this.fallbackAttempted) {
          this.fallbackAttempted = true;
          this.hlsRecoverAttempts = 0;
          this.hls.stopLoad();
          this.hls.startLoad(0);
          // Re-armar listeners para novo fluxo
          video.addEventListener('canplay', onCanPlay);
          video.addEventListener('error', onError);
          timeout = setTimeout(() => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            reject(new Error('Timeout ao preparar video'));
          }, prepTimeoutMs);
          return;
        }

        // Se HLS seguir falhando, força fallback nativo (útil para URLs sem extensão)
        if (this.usingHls && !this.nativeFallbackDone) {
          this.nativeFallbackDone = true;
          this.destroyHls();
          this.usingHls = false;
          this.hlsRecoverAttempts = 0;
          // Usa proxy também no fallback nativo
          const proxiedUrl = this.proxifyUrl(this.currentUrl);
          console.log('[BrowserAdapter] Fallback to native:', proxiedUrl !== this.currentUrl ? 'via proxy' : 'direct');
          this.video!.src = proxiedUrl;
          this.video!.load();
          video.addEventListener('canplay', onCanPlay);
          video.addEventListener('error', onError);
          timeout = setTimeout(() => {
            video.removeEventListener('canplay', onCanPlay);
            video.removeEventListener('error', onError);
            reject(new Error('Timeout ao preparar video'));
          }, prepTimeoutMs);
          return;
        }

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
          }, prepTimeoutMs);
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
