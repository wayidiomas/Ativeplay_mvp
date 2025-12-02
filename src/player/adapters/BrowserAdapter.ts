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
 * Extract original URL from a proxified URL (e.g., /api/proxy/hls?url=...)
 * Returns the original URL if found, otherwise returns the input URL
 */
function extractOriginalUrl(url: string): string {
  if (url.includes('/api/proxy/hls?')) {
    try {
      const urlObj = new URL(url);
      const originalUrl = urlObj.searchParams.get('url');
      if (originalUrl) {
        return originalUrl;
      }
    } catch {
      // Invalid URL, return as-is
    }
  }
  return url;
}

/**
 * Detect if URL is an IPTV live stream pattern (raw TS, not HLS)
 * VOD URLs have file extensions (.m3u8, .mp4, .mkv) and should NOT match
 * VOD URLs with /movie/, /series/, /vod/ paths should NOT match
 */
function isIptvTsStream(url: string): boolean {
  const originalUrl = extractOriginalUrl(url);

  // If URL has a file extension, it's NOT a raw TS stream (it's VOD or HLS)
  if (/\.[a-z0-9]{2,4}(\?|$)/i.test(originalUrl)) return false;

  // If URL contains VOD path indicators, it's NOT a raw TS stream
  // This handles Xtream Codes VOD URLs like /movie/123/456/789 or /series/123/456/789
  if (/(\/movie\/|\/series\/|\/vod\/|\/episode\/|\/filme\/)/i.test(originalUrl)) return false;

  // Pattern: ends with /ts (not .ts file extension)
  if (/\/ts(\?|$)/i.test(originalUrl)) return true;
  // Pattern: numeric Xtream Codes path /digits/digits/digits (no extension)
  // This typically matches live IPTV streams like /live/123/456/789
  if (/\/\d+\/\d+\/\d+(\?|$)/.test(originalUrl)) return true;
  // Query param indicating TS output
  if (originalUrl.includes('output=ts')) return true;
  return false;
}

/**
 * Heuristic to detect live streams (HLS) when mediaKind is not explicitly provided.
 * Matches common IPTV/live patterns; VOD .m3u8 URLs usually carry file-like names.
 */
function isLikelyLiveHls(url: string): boolean {
  const originalUrl = extractOriginalUrl(url);
  const lower = originalUrl.toLowerCase();
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
  const originalUrl = extractOriginalUrl(url);
  const lower = originalUrl.toLowerCase();
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
  private bufferingRecoveryTimeout: ReturnType<typeof setTimeout> | null = null;
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

  // HLS full restart tracking
  private hlsFullRestartAttempts: number = 0;
  private hlsConsecutiveFatalErrors: number = 0;
  private hlsLastFatalErrorTime: number = 0;

  // Raw TS stream recovery
  private tsRecoveryInterval: ReturnType<typeof setInterval> | null = null;
  private lastPlaybackTime: number = 0;
  private frozenCheckCount: number = 0;
  private tsRecoveryAttempts: number = 0;
  private isRawTsStream: boolean = false;

  // Live edge monitoring
  private liveEdgeMonitorInterval: ReturnType<typeof setInterval> | null = null;

  // Constants
  private static readonly HLS_FATAL_ERROR_WINDOW_MS = 60000;
  private static readonly HLS_FATAL_ERRORS_BEFORE_RESTART = 3;
  private static readonly HLS_MAX_FULL_RESTARTS = 2;
  private static readonly TS_CHECK_INTERVAL_MS = 5000;
  private static readonly TS_FROZEN_THRESHOLD = 3;
  private static readonly TS_MAX_RECOVERY_ATTEMPTS = 5;
  private static readonly TS_RECOVERY_BACKOFF_BASE = 2000;
  private static readonly LIVE_EDGE_CHECK_INTERVAL_MS = 30000;
  private static readonly LIVE_EDGE_MAX_DRIFT_SECONDS = 30;

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

      // If buffer does not recover quickly, force HLS to reload a segment/lower quality
      if (this.bufferingRecoveryTimeout) {
        clearTimeout(this.bufferingRecoveryTimeout);
      }
      this.bufferingRecoveryTimeout = setTimeout(() => {
        if (this.isBuffering && this.hls) {
          console.warn('[BrowserAdapter] Buffering >3s, attempting HLS recovery');
          // Drop to lowest quality to recover faster
          if (typeof this.hls.nextAutoLevel === 'number') {
            this.hls.nextAutoLevel = 0;
          }
          if (this.options.isLive) {
            // For live: use startLoad(-1) to jump to live edge instead of resuming from stale position
            console.log('[BrowserAdapter] Jumping to live edge');
            this.hls.startLoad(-1);
          } else {
            // For VOD: resume from current position
            this.hls.startLoad();
          }
        }
      }, 3000);
    });

    // Handle stalled event - browser is trying to fetch but data is not forthcoming
    this.video.addEventListener('stalled', () => {
      console.log('[BrowserAdapter] Video stalled, attempting recovery...');
      if (this.options.isLive && this.hls) {
        // For live streams, jump to live edge to recover
        this.hls.startLoad(-1);
      }
    });

    this.video.addEventListener('playing', () => {
      if (this.isBuffering) {
        this.isBuffering = false;
        this.emit('bufferingend');
      }
      if (this.bufferingRecoveryTimeout) {
        clearTimeout(this.bufferingRecoveryTimeout);
        this.bufferingRecoveryTimeout = null;
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
      // If using HLS.js, let it handle errors with its own fallback mechanism
      if (this.usingHls) {
        console.log('[BrowserAdapter] Video error while using HLS.js - letting HLS.js handle it');
        return;
      }

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

    // Buffer hole tolerance - more tolerant for IPTV streams
    const bufferHoleConfig = {
      maxBufferHole: 0.5,           // Allow 500ms gaps (default: 0.5)
      maxFragLookUpTolerance: 0.5,  // Tolerance for fragment matching
      nudgeOffset: 0.2,             // Larger nudge to skip past holes
      nudgeMaxRetry: 5,             // More nudge attempts before failing
    };

    if (isLive) {
      // Live: keep a steady ~20-30s buffer and retry fast on stalls
      return {
        lowLatencyMode: false,
        maxBufferLength: 24,
        maxMaxBufferLength: 48,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 8,
        liveDurationInfinity: true,
        maxStarvationDelay: 3,
        maxLoadingDelay: 3,
        maxLiveSyncPlaybackRate: 1.05,
        capLevelOnFPSDrop: true,
        capLevelToPlayerSize: true,
        highBufferWatchdogPeriod: 2,
        manifestLoadingMaxRetry: 6,
        manifestLoadingRetryDelay: 800,
        levelLoadingMaxRetry: 6,
        levelLoadingRetryDelay: 800,
        fragLoadingMaxRetry: 6,
        fragLoadingRetryDelay: 800,
        ...bufferHoleConfig,
        loader,
      };
    }

    // VOD/DVR: slightly larger cushion but avoid runaway buffering
    return {
      lowLatencyMode: false,
      maxBufferLength: 40,
      maxMaxBufferLength: 80,
      backBufferLength: 120,
      capLevelOnFPSDrop: true,
      capLevelToPlayerSize: true,
      highBufferWatchdogPeriod: 2,
      ...bufferHoleConfig,
      loader,
    };
  }

  /**
   * Perform full HLS restart - destroy and recreate HLS instance
   */
  private async performFullHlsRestart(): Promise<void> {
    if (!this.video) return;

    this.hlsFullRestartAttempts++;
    this.hlsConsecutiveFatalErrors = 0;
    this.hlsRecoverAttempts = 0;

    const savedUrl = this.currentUrl;
    const savedOptions = { ...this.options };
    const savedPosition = this.options.isLive ? undefined : this.video.currentTime;

    this.emit('bufferingstart');
    this.setState('buffering');

    // Destroy current HLS instance completely
    this.destroyHls();
    this.usingHls = false;

    // Clear video element
    this.video.src = '';
    this.video.load();

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[BrowserAdapter] Recreating HLS instance...');

    // Extract referer
    let referer: string | undefined;
    try {
      const parsed = new URL(savedUrl);
      referer = parsed.origin;
    } catch {
      // Invalid URL
    }

    const isLiveStream = savedOptions.isLive ?? isLikelyLiveHls(savedUrl);
    const proxyUrl = this.proxifyUrl.bind(this);
    const hlsConfig = this.buildHlsConfig(isLiveStream, proxyUrl, referer);

    this.hls = new Hls(hlsConfig);
    this.usingHls = true;
    this.setupHlsErrorHandler();
    this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
      this.hlsRecoverAttempts = 0;
      this.loadTracks();
    });
    this.hls.attachMedia(this.video);
    this.hls.loadSource(savedUrl);

    // For VOD, restore position after manifest parsed
    if (savedPosition !== undefined && savedPosition > 0) {
      this.hls.once(Hls.Events.MANIFEST_PARSED, () => {
        if (this.video && savedPosition > 0) {
          this.video.currentTime = savedPosition;
        }
      });
    }

    // Restart live edge monitor if needed
    if (isLiveStream) {
      this.startLiveEdgeMonitor();
    }

    console.log('[BrowserAdapter] Full HLS restart completed');
  }

  /**
   * Setup HLS error handler with full restart logic
   */
  private setupHlsErrorHandler(): void {
    if (!this.hls) return;

    this.hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error('[BrowserAdapter] HLS error', data);
      if (!data.fatal) return;

      const now = Date.now();

      // Track consecutive fatal errors for full restart decision
      if (now - this.hlsLastFatalErrorTime > BrowserAdapter.HLS_FATAL_ERROR_WINDOW_MS) {
        this.hlsConsecutiveFatalErrors = 0;
      }
      this.hlsLastFatalErrorTime = now;
      this.hlsConsecutiveFatalErrors++;

      // Check if full restart is needed (3+ fatal errors in 60s window)
      if (this.hlsConsecutiveFatalErrors >= BrowserAdapter.HLS_FATAL_ERRORS_BEFORE_RESTART) {
        if (this.hlsFullRestartAttempts < BrowserAdapter.HLS_MAX_FULL_RESTARTS) {
          console.log(`[BrowserAdapter] Triggering full HLS restart (attempt ${this.hlsFullRestartAttempts + 1}/${BrowserAdapter.HLS_MAX_FULL_RESTARTS})`);
          this.performFullHlsRestart();
          return;
        } else {
          console.error('[BrowserAdapter] Max full HLS restarts exhausted');
          this.setState('error');
          this.emit('error', {
            code: 'HLS_FATAL',
            message: 'Stream HLS falhou apos multiplas reinicializacoes',
          });
          return;
        }
      }

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
      this.hlsConsecutiveFatalErrors++;
      console.error(`[BrowserAdapter] HLS fatal error after ${this.hlsRecoverAttempts} attempts:`, data.details);

      // For VOD content, try falling back to direct playback
      // This handles cases where the content isn't actually HLS (e.g., direct MP4)
      if (!this.options.isLive && !this.fallbackAttempted) {
        console.log('[BrowserAdapter] VOD HLS failed, attempting direct playback fallback');
        this.tryDirectPlaybackFallback();
        return;
      }

      this.setState('error');
      this.emit('error', { code: 'HLS_FATAL', message: data.details });
    });
  }

  /**
   * Try direct playback as fallback when HLS.js fails for VOD content
   * This handles cases where the content isn't actually HLS (e.g., direct MP4)
   */
  private tryDirectPlaybackFallback(): void {
    if (!this.video || this.fallbackAttempted) return;

    this.fallbackAttempted = true;
    const savedUrl = this.currentUrl;

    console.log('[BrowserAdapter] Attempting direct playback fallback for:', savedUrl.substring(0, 100));

    // Destroy HLS instance
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.usingHls = false;

    // Reset counters
    this.hlsRecoverAttempts = 0;
    this.hlsConsecutiveFatalErrors = 0;
    this.hlsFullRestartAttempts = 0;

    // Try direct playback
    this.video.src = savedUrl;
    this.video.load();

    // Setup one-time error handler for fallback
    const onError = () => {
      this.video?.removeEventListener('error', onError);
      this.video?.removeEventListener('canplay', onCanPlay);
      console.error('[BrowserAdapter] Direct playback fallback also failed');
      this.setState('error');
      this.emit('error', {
        code: 'PLAYBACK_ERROR',
        message: 'Conteudo nao suportado - formato de video incompativel',
      });
    };

    const onCanPlay = () => {
      this.video?.removeEventListener('error', onError);
      this.video?.removeEventListener('canplay', onCanPlay);
      console.log('[BrowserAdapter] Direct playback fallback successful');
      this.setState('ready');
      if (this.options.autoPlay) {
        this.play();
      }
    };

    this.video.addEventListener('error', onError);
    this.video.addEventListener('canplay', onCanPlay);
  }

  // ============================================================================
  // Raw TS Stream Recovery (frozen picture detection)
  // ============================================================================

  private startTsRecoveryMonitor(): void {
    if (this.tsRecoveryInterval) return;

    this.lastPlaybackTime = this.video?.currentTime ?? 0;
    this.frozenCheckCount = 0;

    this.tsRecoveryInterval = setInterval(() => {
      this.checkTsFrozen();
    }, BrowserAdapter.TS_CHECK_INTERVAL_MS);

    console.log('[BrowserAdapter] TS recovery monitor started');
  }

  private stopTsRecoveryMonitor(): void {
    if (this.tsRecoveryInterval) {
      clearInterval(this.tsRecoveryInterval);
      this.tsRecoveryInterval = null;
    }
  }

  private checkTsFrozen(): void {
    if (!this.video || !this.isRawTsStream) return;
    if (this.video.paused || this.state !== 'playing') {
      this.frozenCheckCount = 0;
      this.lastPlaybackTime = this.video.currentTime;
      return;
    }

    const currentTime = this.video.currentTime;
    const timeProgressed = Math.abs(currentTime - this.lastPlaybackTime) > 0.1;

    if (!timeProgressed) {
      this.frozenCheckCount++;
      const frozenSeconds = this.frozenCheckCount * (BrowserAdapter.TS_CHECK_INTERVAL_MS / 1000);
      console.log(`[BrowserAdapter] TS stream stall detected: ${frozenSeconds}s`);

      if (this.frozenCheckCount >= BrowserAdapter.TS_FROZEN_THRESHOLD) {
        this.handleTsFrozen();
      }
    } else {
      this.frozenCheckCount = 0;
      this.tsRecoveryAttempts = 0;
    }

    this.lastPlaybackTime = currentTime;
  }

  private async handleTsFrozen(): Promise<void> {
    if (this.tsRecoveryAttempts >= BrowserAdapter.TS_MAX_RECOVERY_ATTEMPTS) {
      console.error('[BrowserAdapter] Max TS reconnect attempts reached');
      this.setState('error');
      this.emit('error', {
        code: 'NETWORK_ERROR',
        message: 'Stream de video falhou apos multiplas tentativas',
      });
      return;
    }

    this.tsRecoveryAttempts++;
    const backoffMs = BrowserAdapter.TS_RECOVERY_BACKOFF_BASE *
      Math.pow(2, this.tsRecoveryAttempts - 1);

    console.log(`[BrowserAdapter] TS reconnect attempt ${this.tsRecoveryAttempts}/${BrowserAdapter.TS_MAX_RECOVERY_ATTEMPTS}, backoff ${backoffMs}ms`);

    this.emit('bufferingstart');
    this.setState('buffering');
    this.frozenCheckCount = 0;

    if (this.video) {
      this.video.src = '';
      this.video.load();
    }

    await new Promise(resolve => setTimeout(resolve, backoffMs));

    if (this.video && this.currentUrl) {
      this.video.src = this.currentUrl;
      this.video.load();

      try {
        await this.video.play();
        console.log('[BrowserAdapter] TS stream reconnected successfully');
        this.lastPlaybackTime = this.video.currentTime;
      } catch (e) {
        console.warn('[BrowserAdapter] TS reconnect play failed:', e);
      }
    }
  }

  // ============================================================================
  // Live Edge Monitoring
  // ============================================================================

  private startLiveEdgeMonitor(): void {
    if (this.liveEdgeMonitorInterval || !this.options.isLive || !this.usingHls) return;

    this.liveEdgeMonitorInterval = setInterval(() => {
      this.checkLiveEdgeDrift();
    }, BrowserAdapter.LIVE_EDGE_CHECK_INTERVAL_MS);

    console.log('[BrowserAdapter] Live edge monitor started');
  }

  private stopLiveEdgeMonitor(): void {
    if (this.liveEdgeMonitorInterval) {
      clearInterval(this.liveEdgeMonitorInterval);
      this.liveEdgeMonitorInterval = null;
    }
  }

  private checkLiveEdgeDrift(): void {
    if (!this.hls || !this.video || !this.options.isLive) return;
    if (this.video.paused || this.state !== 'playing') return;

    const latency = this.hls.latency;

    if (latency !== undefined && latency !== null && latency > BrowserAdapter.LIVE_EDGE_MAX_DRIFT_SECONDS) {
      console.log(`[BrowserAdapter] Live edge drift detected: ${latency.toFixed(1)}s behind`);
      this.repositionToLiveEdge();
    }
  }

  private repositionToLiveEdge(): void {
    if (!this.hls || !this.video) return;

    console.log('[BrowserAdapter] Repositioning to live edge...');

    const liveSyncPos = this.hls.liveSyncPosition;
    if (liveSyncPos !== undefined && liveSyncPos !== null && liveSyncPos > 0) {
      this.video.currentTime = liveSyncPos;
      console.log(`[BrowserAdapter] Repositioned to liveSyncPosition: ${liveSyncPos.toFixed(1)}s`);
      return;
    }

    console.log('[BrowserAdapter] Reloading from live edge');
    this.hls.startLoad(-1);
  }

  // Lifecycle

  async open(url: string, options: PlayerOptions = {}): Promise<void> {
    if (!this.video) {
      throw new Error('Video element nao disponivel');
    }

    // Stop any existing monitors
    this.stopTsRecoveryMonitor();
    this.stopLiveEdgeMonitor();

    // Limpa instancias anteriores
    this.destroyHls();
    this.usingHls = false;
    this.fallbackAttempted = false;
    this.nativeFallbackDone = false;
    this.hlsRecoverAttempts = 0;

    // Reset recovery counters
    this.hlsFullRestartAttempts = 0;
    this.hlsConsecutiveFatalErrors = 0;
    this.hlsLastFatalErrorTime = 0;
    this.tsRecoveryAttempts = 0;
    this.frozenCheckCount = 0;
    this.lastPlaybackTime = 0;
    this.isRawTsStream = false;

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

    // Extract original URL from proxified URL for proper format detection
    const originalUrl = extractOriginalUrl(url);
    const originalLower = originalUrl.toLowerCase();

    const hasExtension = /\.[a-z0-9]{2,4}(\?|$)/i.test(originalUrl);
    let contentType: string | null = null;
    if (!hasExtension) {
      contentType = await this.peekContentType(this.currentUrl);
    }

    // Detect IPTV TS streams (should NOT use HLS.js)
    const isIptvTs = isIptvTsStream(url) || (contentType ? /mp2t/i.test(contentType) : false);
    const isLiveStream = options.isLive ?? (isIptvTs || isLikelyLiveHls(url));

    const isHls = originalLower.includes('.m3u8') || (contentType ? /mpegurl/i.test(contentType) : false);
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const preferNative = /Safari/i.test(ua) && !/Chrome/i.test(ua); // usa nativo em Safari/iOS
    const isProbablyHls =
      !isIptvTs && // Don't use HLS.js for raw TS streams
      (isHls ||
      originalLower.includes('m3u') ||
      originalLower.includes('playlist') ||
      originalLower.includes('chunklist'));

    if (Hls.isSupported() && isProbablyHls && !preferNative) {
      console.log('[BrowserAdapter] Using HLS.js to load:', this.currentUrl.substring(0, 100));

      // Custom loader to proxy all HLS sub-requests (playlists, segments)
      // This fixes the issue where relative URLs in manifests get resolved against proxy URL
      const proxyUrl = this.proxifyUrl.bind(this);

      const hlsConfig = this.buildHlsConfig(isLiveStream, proxyUrl, referer);
      this.hls = new Hls(hlsConfig);
      this.usingHls = true;
      this.hls.attachMedia(this.video);

      // Setup HLS error handler with full restart logic
      this.setupHlsErrorHandler();

      this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
        this.hlsRecoverAttempts = 0;
        this.loadTracks();
      });

      // Usa proxy para URLs externas (evita CORS)
      console.log('[BrowserAdapter] Loading HLS:', this.currentUrl !== url ? 'via proxy' : 'direct');
      this.hls.loadSource(this.currentUrl);

      // Start live edge monitor for HLS live streams
      if (isLiveStream) {
        this.startLiveEdgeMonitor();
      }
    } else {
      // Uso nativo (Safari ou MP4/TS/IPTV) - Usa proxy para URLs externas
      if (isIptvTs) {
        console.log('[BrowserAdapter] Loading IPTV TS stream:', this.currentUrl !== url ? 'via proxy' : 'direct', this.currentUrl.substring(0, 100));
        // Mark as raw TS stream and start frozen picture detection
        this.isRawTsStream = true;
        this.startTsRecoveryMonitor();
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
    // Stop all monitors
    this.stopTsRecoveryMonitor();
    this.stopLiveEdgeMonitor();

    if (this.bufferingRecoveryTimeout) {
      clearTimeout(this.bufferingRecoveryTimeout);
      this.bufferingRecoveryTimeout = null;
    }
    this.destroyHls();
    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.load();
    }
    this.setState('idle');
    this.tracks = { audio: [], subtitle: [], video: [] };
    this.currentTracks = { audioIndex: 0, subtitleIndex: -1, subtitleEnabled: false };

    // Reset recovery counters
    this.frozenCheckCount = 0;
    this.tsRecoveryAttempts = 0;
    this.hlsFullRestartAttempts = 0;
    this.hlsConsecutiveFatalErrors = 0;
    this.isRawTsStream = false;
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
