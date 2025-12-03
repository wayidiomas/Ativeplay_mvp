/**
 * LG webOS Adapter
 * Implementa IPlayerAdapter usando HTML5 Video + HLS.js para LG TVs
 * HLS.js fornece APIs próprias para seleção de faixas de áudio e legenda
 * que funcionam independentemente do browser (resolve limitação do webOS)
 */

import Hls from 'hls.js';
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

// Proxy URL for CORS/mixed-content bypass
const BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL;

// Tipos do Luna Service para player nativo do webOS
interface LunaServiceParams {
  method?: string;
  parameters?: Record<string, unknown>;
  onSuccess?: (response: LunaMediaResponse) => void;
  onFailure?: (error: LunaError) => void;
  onComplete?: (response: LunaMediaResponse) => void;
  subscribe?: boolean;
}

interface LunaError {
  errorCode?: number;
  errorText?: string;
}

interface LunaMediaResponse {
  returnValue: boolean;
  mediaId?: string;
  state?: string;
  currentTime?: number;
  duration?: number;
  bufferRange?: string;
  sourceInfo?: {
    container?: string;
    numPrograms?: number;
    seekable?: boolean;
    programInfo?: Array<{
      numAudioTracks?: number;
      numSubtitleTracks?: number;
      audioTrackInfo?: Array<{
        language?: string;
        codec?: string;
      }>;
    }>;
  };
  videoInfo?: {
    width?: number;
    height?: number;
    codec?: string;
    frameRate?: number;
  };
  audioInfo?: {
    sampleRate?: number;
    channels?: number;
  };
  error?: {
    errorCode?: number;
    errorText?: string;
  };
  errorCode?: number;
  errorText?: string;
}

interface WebOSAPI {
  platform: { tv: boolean };
  service: {
    request: (uri: string, params: LunaServiceParams) => { cancel: () => void };
  };
  deviceInfo: (callback: (info: { modelName: string; version: string }) => void) => void;
}

// AudioTrackList não é padrão em todos os browsers
interface AudioTrack {
  enabled: boolean;
  id: string;
  kind: string;
  label: string;
  language: string;
}

interface AudioTrackList {
  length: number;
  [index: number]: AudioTrack;
}

declare global {
  interface Window {
    webOS?: WebOSAPI;
  }
}

function parseLanguageCode(code: string): string {
  const languageMap: Record<string, string> = {
    por: 'Português',
    pt: 'Português',
    'pt-br': 'Português (BR)',
    'pt-BR': 'Português (BR)',
    eng: 'English',
    en: 'English',
    spa: 'Español',
    es: 'Español',
    jpn: 'Japanese',
    ja: 'Japanese',
    kor: 'Korean',
    ko: 'Korean',
    fra: 'Français',
    fr: 'Français',
    deu: 'Deutsch',
    de: 'Deutsch',
    ita: 'Italiano',
    it: 'Italiano',
    rus: 'Русский',
    ru: 'Русский',
    zho: '中文',
    zh: '中文',
    und: 'Indefinido',
  };
  return languageMap[code.toLowerCase()] || code;
}

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
 * Detecta se a URL é um stream HLS
 */
function isHlsUrl(url: string): boolean {
  const originalUrl = extractOriginalUrl(url);
  const lower = originalUrl.toLowerCase();
  return lower.includes('.m3u8') || lower.includes('format=m3u8') || lower.includes('output=m3u8');
}

/**
 * Detect if URL is an IPTV live stream pattern (raw TS, not HLS)
 * VOD URLs have file extensions (.m3u8, .mp4, .mkv) and should NOT match
 * VOD URLs with /movie/, /series/, /vod/ paths should NOT match
 *
 * Xtream Codes patterns:
 * - Live TS:   /live/{user}/{pass}/{stream_id}.ts    → IS a TS stream
 * - Live HLS:  /live/{user}/{pass}/{stream_id}.m3u8  → NOT a TS stream (use HLS.js)
 * - Live raw:  /live/{user}/{pass}/{stream_id}       → IS a TS stream (no extension)
 * - VOD:       /movie/{user}/{pass}/{id}.{ext}       → NOT a TS stream
 * - Series:    /series/{user}/{pass}/{id}.{ext}      → NOT a TS stream
 */
function isIptvTsStream(url: string): boolean {
  const originalUrl = extractOriginalUrl(url);

  // Xtream live HLS (.m3u8) is NOT a raw TS stream - should use HLS.js
  if (/\/live\/[^/]+\/[^/]+\/\d+\.m3u8(\?|$)/i.test(originalUrl)) {
    return false;
  }

  // Xtream live URLs ending in .ts or without extension ARE TS streams
  if (/\/live\/[^/]+\/[^/]+\/\d+(\.ts)?(\?|$)/i.test(originalUrl)) {
    return true;
  }

  // Xtream VOD/Series URLs are NOT raw TS streams (they have container files)
  if (/\/(movie|series)\/[^/]+\/[^/]+\/\d+\.[a-z0-9]+(\?|$)/i.test(originalUrl)) {
    return false;
  }

  // If URL has a file extension other than .ts, it's NOT a raw TS stream
  // (e.g., .mp4, .mkv, .m3u8 are not raw TS)
  if (/\.(mp4|mkv|avi|wmv|flv|m3u8|webm|mov)(\?|$)/i.test(originalUrl)) {
    return false;
  }

  // If URL contains VOD path indicators, it's NOT a raw TS stream
  if (/(\/movie\/|\/vod\/|\/episode\/|\/filme\/)/i.test(originalUrl)) {
    return false;
  }

  // Pattern: ends with .ts (TS file extension) - common for IPTV
  if (/\.ts(\?|$)/i.test(originalUrl)) return true;

  // Pattern: ends with /ts (not .ts file extension)
  if (/\/ts(\?|$)/i.test(originalUrl)) return true;

  // Pattern: numeric Xtream Codes path /digits/digits/digits (no extension)
  // This typically matches live IPTV streams like /live/123/456/789
  if (/\/\d+\/\d+\/\d+(\?|$)/.test(originalUrl)) return true;

  // Query param indicating TS output
  if (originalUrl.includes('output=ts')) return true;

  // Pattern: /play/TOKEN format (common IPTV pattern for live channels)
  // TOKEN is typically base64 or alphanumeric, at least 20 chars to avoid false positives
  // Examples: /play/ABC123... (Globo, SBT, Record live channels)
  if (/\/play\/[a-zA-Z0-9+/=_-]{20,}(\?|$)/i.test(originalUrl)) return true;

  // Pattern: /live/ path without extension (common IPTV live pattern)
  // But NOT if it's followed by /series/ or /movie/ (which would be Xtream VOD)
  if (/\/live\/[^/]+\/[^/]+\/\d+(\?|$)/i.test(originalUrl)) return true;

  return false;
}

/**
 * Heuristic to detect live streams when mediaKind is not explicitly provided.
 *
 * Xtream Codes detection:
 * - /live/{user}/{pass}/{id}    → LIVE
 * - /movie/{user}/{pass}/{id}   → VOD (not live)
 * - /series/{user}/{pass}/{id}  → VOD (not live, it's episode playback)
 */
function isLikelyLiveHls(url: string): boolean {
  const originalUrl = extractOriginalUrl(url);
  const lower = originalUrl.toLowerCase();

  // Xtream Codes: /live/ path = definitely live
  if (/\/live\/[^/]+\/[^/]+\/\d+/i.test(originalUrl)) {
    return true;
  }

  // Xtream Codes: /movie/ or /series/ path = definitely VOD
  if (/\/(movie|series)\/[^/]+\/[^/]+\/\d+/i.test(originalUrl)) {
    return false;
  }

  // Generic live hints
  const liveHints = /(live|channel|stream|tv|iptv|24\/7|ao ?vivo)/i;
  // Generic VOD hints
  const vodHints = /(vod|movie|filme|episode|episodio|series|season|s0?\d|e0?\d)/i;
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

// ============================================================================
// Xtream Codes URL Detection
// ============================================================================

/**
 * Xtream URL patterns:
 * - Live (TS):  {server}/live/{user}/{pass}/{stream_id}.ts
 * - Live (HLS): {server}/live/{user}/{pass}/{stream_id}.m3u8
 * - Live (raw): {server}/live/{user}/{pass}/{stream_id} (no extension)
 * - VOD:        {server}/movie/{user}/{pass}/{stream_id}.{ext}
 * - Series:     {server}/series/{user}/{pass}/{episode_id}.{ext}
 */
type XtreamMediaType = 'live' | 'vod' | 'series' | null;

interface XtreamUrlInfo {
  isXtream: boolean;
  mediaType: XtreamMediaType;
  streamId: string | null;
  extension: string | null;
  isHls: boolean; // True if live stream is served as HLS (.m3u8)
}

/**
 * Detect if URL is an Xtream Codes streaming URL
 * Returns detailed info about the stream type
 */
function parseXtreamUrl(url: string): XtreamUrlInfo {
  const originalUrl = extractOriginalUrl(url);

  // Pattern: /live/{user}/{pass}/{stream_id}.m3u8 (HLS variant)
  const liveHlsMatch = originalUrl.match(/\/live\/[^/]+\/[^/]+\/(\d+)\.m3u8(\?|$)/i);
  if (liveHlsMatch) {
    return {
      isXtream: true,
      mediaType: 'live',
      streamId: liveHlsMatch[1],
      extension: 'm3u8',
      isHls: true,
    };
  }

  // Pattern: /live/{user}/{pass}/{stream_id}.ts or /live/{user}/{pass}/{stream_id} (no ext)
  const liveTsMatch = originalUrl.match(/\/live\/[^/]+\/[^/]+\/(\d+)(\.ts)?(\?|$)/i);
  if (liveTsMatch) {
    return {
      isXtream: true,
      mediaType: 'live',
      streamId: liveTsMatch[1],
      extension: 'ts',
      isHls: false,
    };
  }

  // Pattern: /movie/{user}/{pass}/{stream_id}.{ext}
  const vodMatch = originalUrl.match(/\/movie\/[^/]+\/[^/]+\/(\d+)\.([a-z0-9]+)(\?|$)/i);
  if (vodMatch) {
    return {
      isXtream: true,
      mediaType: 'vod',
      streamId: vodMatch[1],
      extension: vodMatch[2].toLowerCase(),
      isHls: false,
    };
  }

  // Pattern: /series/{user}/{pass}/{episode_id}.{ext}
  const seriesMatch = originalUrl.match(/\/series\/[^/]+\/[^/]+\/(\d+)\.([a-z0-9]+)(\?|$)/i);
  if (seriesMatch) {
    return {
      isXtream: true,
      mediaType: 'series',
      streamId: seriesMatch[1],
      extension: seriesMatch[2].toLowerCase(),
      isHls: false,
    };
  }

  return {
    isXtream: false,
    mediaType: null,
    streamId: null,
    extension: null,
    isHls: false,
  };
}

// Note: The following helper functions are available but not currently used elsewhere.
// They could be exported if other components need Xtream URL detection.
// For now, only parseXtreamUrl() is used internally by the adapter.

// function isXtreamUrl(url: string): boolean {
//   return parseXtreamUrl(url).isXtream;
// }
// function isXtreamLiveUrl(url: string): boolean {
//   const info = parseXtreamUrl(url);
//   return info.isXtream && info.mediaType === 'live';
// }
// function isXtreamVodUrl(url: string): boolean {
//   const info = parseXtreamUrl(url);
//   return info.isXtream && (info.mediaType === 'vod' || info.mediaType === 'series');
// }

export class LGWebOSAdapter implements IPlayerAdapter {
  private video: HTMLVideoElement | null = null;
  private hls: Hls | null = null;
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
  private isBuffering: boolean = false;
  private usingHls: boolean = false;
  private hlsRecoverAttempts: number = 0;
  private bufferingRecoveryTimeout: ReturnType<typeof setTimeout> | null = null;

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
  private isRecovering: boolean = false; // Flag to ignore errors during recovery

  // Live edge monitoring
  private liveEdgeMonitorInterval: ReturnType<typeof setInterval> | null = null;

  // VOD direct playback fallback
  private triedDirectFallback: boolean = false;

  // Luna Service (native webOS player) for unsupported formats
  private usingLunaService: boolean = false;
  private lunaMediaId: string | null = null;
  private lunaSubscription: { cancel: () => void } | null = null;
  private lunaDuration: number = 0;
  private lunaCurrentTime: number = 0;

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
      this.webOS = window.webOS || null;
      this.isWebOS = !!this.webOS;
      this.createVideoElement(containerId);

      if (this.isWebOS) {
        console.log('[LGWebOSAdapter] Running on webOS with HLS.js for track selection');
      }
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

  /**
   * Proxify URL to bypass CORS/mixed-content on TVs
   */
  private proxifyUrl(url: string, referer?: string): string {
    if (!BRIDGE_URL) return url;
    if (!/^https?:\/\//i.test(url)) return url;
    if (url.includes('/api/proxy/hls')) return url;
    const params = new URLSearchParams({ url });
    if (referer) params.set('referer', referer);
    return `${BRIDGE_URL}/api/proxy/hls?${params}`;
  }

  private buildHlsConfig(isLive: boolean, proxyUrl: (url: string, referer?: string) => string, referer?: string) {
    const loader = class ProxyLoader extends Hls.DefaultConfig.loader {
      load(context: any, config: any, callbacks: any) {
        // Proxy external URLs that aren't already proxied
        if (context.url && !context.url.includes('/api/proxy/hls') && /^https?:\/\//i.test(context.url)) {
          context.url = proxyUrl(context.url, referer);
          console.log('[LGWebOSAdapter] HLS proxied:', context.url.substring(0, 80));
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
      // Live: keep buffer around ~20-30s and recover quickly on stalls
      return {
        enableWebVTT: true,
        enableIMSC1: true,
        enableCEA708Captions: true,
        renderTextTracksNatively: true,
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

    return {
      enableWebVTT: true,
      enableIMSC1: true,
      enableCEA708Captions: true,
      renderTextTracksNatively: true,
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

  private setupVideoListeners(): void {
    if (!this.video) return;

    this.video.addEventListener('loadstart', () => {
      this.setState('loading');
    });

    this.video.addEventListener('loadedmetadata', () => {
      // Para HLS, as tracks são carregadas via eventos do HLS.js
      if (!this.usingHls) {
        this.loadTracksFromElement();
      }
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

      // If buffer stays empty, force HLS to reload a segment and drop quality
      if (this.bufferingRecoveryTimeout) {
        clearTimeout(this.bufferingRecoveryTimeout);
      }
      this.bufferingRecoveryTimeout = setTimeout(() => {
        if (this.isBuffering && this.hls) {
          console.warn('[LGWebOSAdapter] Buffering >3s, attempting HLS recovery');
          // Drop to lowest quality to recover faster
          if (typeof this.hls.nextAutoLevel === 'number') {
            this.hls.nextAutoLevel = 0;
          }
          if (this.options.isLive) {
            // For live: use startLoad(-1) to jump to live edge instead of resuming from stale position
            console.log('[LGWebOSAdapter] Jumping to live edge');
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
      console.log('[LGWebOSAdapter] Video stalled, attempting recovery...');
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
        console.log('[LGWebOSAdapter] Live stream paused unexpectedly, attempting resume...');
        setTimeout(() => {
          if (this.video && this.video.paused && this.options.isLive) {
            this.video.play().catch(e => {
              console.warn('[LGWebOSAdapter] Auto-resume failed:', e);
            });
          }
        }, 1000);
      }
    });

    this.video.addEventListener('timeupdate', () => {
      if (this.video) {
        this.emit('timeupdate', { currentTime: this.video.currentTime * 1000 });
      }
    });

    this.video.addEventListener('ended', () => {
      // Live streams should not trigger 'ended' - they may fire this event
      // due to buffer gaps, EOS markers, or manifest reloads
      if (this.options.isLive) {
        console.log('[LGWebOSAdapter] Ignoring ended event for live stream');
        return;
      }
      this.setState('ended');
      this.emit('ended');
    });

    this.video.addEventListener('error', () => {
      // If using HLS.js, let it handle errors with its own fallback mechanism
      // Don't emit error here - HLS.js error handler will take care of it
      if (this.usingHls) {
        console.log('[LGWebOSAdapter] Video error while using HLS.js - letting HLS.js handle it');
        return;
      }

      // Ignore errors during recovery process (e.g., when src is cleared for reconnection)
      if (this.isRecovering) {
        console.log('[LGWebOSAdapter] Ignoring video error during recovery');
        return;
      }

      const error = this.video?.error;
      const errorCode = error?.code;

      // Map MediaError codes to readable messages
      let errorMessage = 'Erro de reproducao';
      let errorType = 'PLAYBACK_ERROR';

      switch (errorCode) {
        case MediaError.MEDIA_ERR_ABORTED:
          errorMessage = 'Reproducao cancelada pelo usuario';
          errorType = 'ABORTED';
          break;
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = 'Erro de rede ao carregar o video';
          errorType = 'NETWORK_ERROR';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = 'Erro ao decodificar o video';
          errorType = 'DECODE_ERROR';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Formato de video nao suportado';
          errorType = 'FORMAT_NOT_SUPPORTED';
          break;
      }

      console.error('[LGWebOSAdapter] Video error:', {
        code: errorCode,
        type: errorType,
        message: error?.message,
        url: this.currentUrl,
        usingHls: this.usingHls,
      });

      this.setState('error');
      this.emit('error', {
        code: errorType,
        message: errorMessage,
        details: error?.message,
      });
    });
  }

  /**
   * Setup HLS.js event listeners for track management
   */
  private setupHlsListeners(): void {
    if (!this.hls) return;

    // Audio tracks loaded
    this.hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
      console.log('[LGWebOSAdapter] HLS audio tracks updated:', data.audioTracks.length);
      this.tracks.audio = data.audioTracks.map((track, index) => ({
        index,
        language: track.lang || 'und',
        label: track.name || parseLanguageCode(track.lang || 'und') || `Audio ${index + 1}`,
        isDefault: track.default || index === 0,
      }));
      this.currentTracks.audioIndex = this.hls?.audioTrack ?? 0;
      this.emit('trackschange', this.tracks);
    });

    // Subtitle tracks loaded
    this.hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (_event, data) => {
      console.log('[LGWebOSAdapter] HLS subtitle tracks updated:', data.subtitleTracks.length);
      this.tracks.subtitle = data.subtitleTracks.map((track, index) => ({
        index,
        language: track.lang || 'und',
        label: track.name || parseLanguageCode(track.lang || 'und') || `Legenda ${index + 1}`,
        isDefault: track.default || false,
      }));
      // HLS.js subtitleTrack = -1 means disabled
      const currentSubTrack = this.hls?.subtitleTrack ?? -1;
      this.currentTracks.subtitleIndex = currentSubTrack;
      this.currentTracks.subtitleEnabled = currentSubTrack >= 0;
      this.emit('trackschange', this.tracks);
    });

    // Audio track switched
    this.hls.on(Hls.Events.AUDIO_TRACK_SWITCHED, (_event, data) => {
      console.log('[LGWebOSAdapter] HLS audio track switched to:', data.id);
      this.currentTracks.audioIndex = data.id;
      this.emit('audiotrackchange', { index: data.id, track: this.tracks.audio[data.id] });
    });

    // Subtitle track switched
    this.hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (_event, data) => {
      console.log('[LGWebOSAdapter] HLS subtitle track switched to:', data.id);
      this.currentTracks.subtitleIndex = data.id;
      this.currentTracks.subtitleEnabled = data.id >= 0;
      this.emit('subtitletrackchange', {
        index: data.id,
        enabled: data.id >= 0,
        track: data.id >= 0 ? this.tracks.subtitle[data.id] : undefined,
      });
    });

    // Manifest parsed - get initial track info
    this.hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      console.log('[LGWebOSAdapter] HLS manifest parsed:', {
        audioTracks: data.audioTracks,
        subtitles: data.subtitleTracks,
        levels: data.levels.length,
      });

      // Set video track info from levels
      if (data.levels.length > 0) {
        this.tracks.video = data.levels.map((level, index) => ({
          index,
          width: level.width,
          height: level.height,
          bitrate: level.bitrate,
        }));
      }
    });

    // Error handling with retry logic and full restart
    this.hls.on(Hls.Events.ERROR, (_event, data) => {
      console.error('[LGWebOSAdapter] HLS error:', data.type, data.details);
      if (!data.fatal) return;

      const now = Date.now();

      // Track consecutive fatal errors for full restart decision
      if (now - this.hlsLastFatalErrorTime > LGWebOSAdapter.HLS_FATAL_ERROR_WINDOW_MS) {
        this.hlsConsecutiveFatalErrors = 0;
      }
      this.hlsLastFatalErrorTime = now;
      this.hlsConsecutiveFatalErrors++;

      // Check if full restart is needed (3+ fatal errors in 60s window)
      if (this.hlsConsecutiveFatalErrors >= LGWebOSAdapter.HLS_FATAL_ERRORS_BEFORE_RESTART) {
        if (this.hlsFullRestartAttempts < LGWebOSAdapter.HLS_MAX_FULL_RESTARTS) {
          console.log(`[LGWebOSAdapter] Triggering full HLS restart (attempt ${this.hlsFullRestartAttempts + 1}/${LGWebOSAdapter.HLS_MAX_FULL_RESTARTS})`);
          this.performFullHlsRestart();
          return;
        } else {
          console.error('[LGWebOSAdapter] Max full HLS restarts exhausted');
          this.setState('error');
          this.emit('error', {
            code: 'HLS_ERROR',
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
          console.log(`[LGWebOSAdapter] Network error recovery attempt ${this.hlsRecoverAttempts}/${maxAttempts}, backoff ${backoffMs}ms`);
          setTimeout(() => this.hls?.startLoad(), backoffMs);
          return;
        }
      }

      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (this.hlsRecoverAttempts < maxAttempts) {
          this.hlsRecoverAttempts++;
          console.log(`[LGWebOSAdapter] Media error recovery attempt ${this.hlsRecoverAttempts}/${maxAttempts}, backoff ${backoffMs}ms`);
          setTimeout(() => this.hls?.recoverMediaError(), backoffMs);
          return;
        }
      }

      // All recovery attempts exhausted - count as fatal for restart tracking
      this.hlsConsecutiveFatalErrors++;
      console.error(`[LGWebOSAdapter] HLS fatal error after ${this.hlsRecoverAttempts} attempts:`, data.details);

      // For VOD content, try falling back to direct playback
      // This handles cases where the content isn't actually HLS (e.g., direct MP4)
      if (!this.options.isLive && !this.triedDirectFallback) {
        console.log('[LGWebOSAdapter] VOD HLS failed, attempting direct playback fallback');
        this.tryDirectPlaybackFallback();
        return;
      }

      this.setState('error');
      this.emit('error', {
        code: 'HLS_ERROR',
        message: `HLS error: ${data.details}`,
      });
    });
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
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.usingHls = false;

    // Clear video element
    this.video.src = '';
    this.video.load();

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 500));

    console.log('[LGWebOSAdapter] Recreating HLS instance...');

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
    this.setupHlsListeners();
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

    console.log('[LGWebOSAdapter] Full HLS restart completed');
  }

  /**
   * Try direct playback as fallback when HLS.js fails for VOD content
   * This handles cases where the content isn't actually HLS (e.g., direct MP4/MKV)
   */
  private tryDirectPlaybackFallback(): void {
    if (!this.video || this.triedDirectFallback) return;

    this.triedDirectFallback = true;
    const savedUrl = this.currentUrl;

    console.log('[LGWebOSAdapter] Attempting direct playback fallback for:', savedUrl.substring(0, 100));

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
      console.error('[LGWebOSAdapter] Direct playback fallback also failed');
      this.setState('error');
      this.emit('error', {
        code: 'PLAYBACK_ERROR',
        message: 'Conteudo nao suportado - formato de video incompativel',
      });
    };

    const onCanPlay = () => {
      this.video?.removeEventListener('error', onError);
      this.video?.removeEventListener('canplay', onCanPlay);
      console.log('[LGWebOSAdapter] Direct playback fallback successful');
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

  /**
   * Start monitoring for frozen TS streams
   */
  private startTsRecoveryMonitor(): void {
    if (this.tsRecoveryInterval) return;

    this.lastPlaybackTime = this.video?.currentTime ?? 0;
    this.frozenCheckCount = 0;

    this.tsRecoveryInterval = setInterval(() => {
      this.checkTsFrozen();
    }, LGWebOSAdapter.TS_CHECK_INTERVAL_MS);

    console.log('[LGWebOSAdapter] TS recovery monitor started');
  }

  /**
   * Stop TS recovery monitor
   */
  private stopTsRecoveryMonitor(): void {
    if (this.tsRecoveryInterval) {
      clearInterval(this.tsRecoveryInterval);
      this.tsRecoveryInterval = null;
    }
  }

  /**
   * Check if TS stream is frozen
   */
  private checkTsFrozen(): void {
    if (!this.video || !this.isRawTsStream) return;
    if (this.video.paused || this.state !== 'playing') {
      // Reset detection when not actively playing
      this.frozenCheckCount = 0;
      this.lastPlaybackTime = this.video.currentTime;
      return;
    }

    const currentTime = this.video.currentTime;
    const timeProgressed = Math.abs(currentTime - this.lastPlaybackTime) > 0.1;

    if (!timeProgressed) {
      this.frozenCheckCount++;
      const frozenSeconds = this.frozenCheckCount * (LGWebOSAdapter.TS_CHECK_INTERVAL_MS / 1000);
      console.log(`[LGWebOSAdapter] TS stream stall detected: ${frozenSeconds}s`);

      if (this.frozenCheckCount >= LGWebOSAdapter.TS_FROZEN_THRESHOLD) {
        this.handleTsFrozen();
      }
    } else {
      // Stream is healthy, reset counters
      this.frozenCheckCount = 0;
      this.tsRecoveryAttempts = 0;
    }

    this.lastPlaybackTime = currentTime;
  }

  /**
   * Handle frozen TS stream - attempt reconnection
   */
  private async handleTsFrozen(): Promise<void> {
    if (this.tsRecoveryAttempts >= LGWebOSAdapter.TS_MAX_RECOVERY_ATTEMPTS) {
      console.error('[LGWebOSAdapter] Max TS reconnect attempts reached');
      this.setState('error');
      this.emit('error', {
        code: 'NETWORK_ERROR',
        message: 'Stream de video falhou apos multiplas tentativas',
      });
      return;
    }

    this.tsRecoveryAttempts++;
    const backoffMs = LGWebOSAdapter.TS_RECOVERY_BACKOFF_BASE *
      Math.pow(2, this.tsRecoveryAttempts - 1);

    console.log(`[LGWebOSAdapter] TS reconnect attempt ${this.tsRecoveryAttempts}/${LGWebOSAdapter.TS_MAX_RECOVERY_ATTEMPTS}, backoff ${backoffMs}ms`);

    this.emit('bufferingstart');
    this.setState('buffering');
    this.frozenCheckCount = 0;

    // Set recovery flag to ignore errors during src clearing
    this.isRecovering = true;

    // Clear current source
    if (this.video) {
      this.video.src = '';
      this.video.load();
    }

    // Wait for backoff period
    await new Promise(resolve => setTimeout(resolve, backoffMs));

    // Reconnect
    if (this.video && this.currentUrl) {
      this.video.src = this.currentUrl;
      this.video.load();

      try {
        await this.video.play();
        console.log('[LGWebOSAdapter] TS stream reconnected successfully');
        this.lastPlaybackTime = this.video.currentTime;
      } catch (e) {
        console.warn('[LGWebOSAdapter] TS reconnect play failed:', e);
      }
    }

    // Clear recovery flag
    this.isRecovering = false;
  }

  // ============================================================================
  // Live Edge Monitoring
  // ============================================================================

  /**
   * Start monitoring live edge drift
   */
  private startLiveEdgeMonitor(): void {
    if (this.liveEdgeMonitorInterval || !this.options.isLive || !this.usingHls) return;

    this.liveEdgeMonitorInterval = setInterval(() => {
      this.checkLiveEdgeDrift();
    }, LGWebOSAdapter.LIVE_EDGE_CHECK_INTERVAL_MS);

    console.log('[LGWebOSAdapter] Live edge monitor started');
  }

  /**
   * Stop live edge monitor
   */
  private stopLiveEdgeMonitor(): void {
    if (this.liveEdgeMonitorInterval) {
      clearInterval(this.liveEdgeMonitorInterval);
      this.liveEdgeMonitorInterval = null;
    }
  }

  /**
   * Check if player has drifted too far from live edge
   */
  private checkLiveEdgeDrift(): void {
    if (!this.hls || !this.video || !this.options.isLive) return;
    if (this.video.paused || this.state !== 'playing') return;

    // Get latency from HLS.js (distance from live edge in seconds)
    const latency = this.hls.latency;

    if (latency !== undefined && latency !== null && latency > LGWebOSAdapter.LIVE_EDGE_MAX_DRIFT_SECONDS) {
      console.log(`[LGWebOSAdapter] Live edge drift detected: ${latency.toFixed(1)}s behind`);
      this.repositionToLiveEdge();
    }
  }

  /**
   * Reposition playback to live edge
   */
  private repositionToLiveEdge(): void {
    if (!this.hls || !this.video) return;

    console.log('[LGWebOSAdapter] Repositioning to live edge...');

    // Method 1: Use HLS.js liveSyncPosition
    const liveSyncPos = this.hls.liveSyncPosition;
    if (liveSyncPos !== undefined && liveSyncPos !== null && liveSyncPos > 0) {
      this.video.currentTime = liveSyncPos;
      console.log(`[LGWebOSAdapter] Repositioned to liveSyncPosition: ${liveSyncPos.toFixed(1)}s`);
      return;
    }

    // Method 2: Force HLS.js to reload from live edge
    console.log('[LGWebOSAdapter] Reloading from live edge');
    this.hls.startLoad(-1);
  }

  // ============================================================================
  // Luna Service (Native webOS Player) for unsupported formats (MKV, AVI, etc.)
  // ============================================================================

  /**
   * Try to play using Luna Service (native webOS media player)
   * This supports more formats than HTML5 video including MKV, AVI, WMV, FLV
   */
  private async tryLunaServicePlayback(url: string): Promise<boolean> {
    if (!this.isWebOS || !this.webOS) {
      console.log('[LGWebOSAdapter] Luna Service not available (not webOS)');
      return false;
    }

    console.log('[LGWebOSAdapter] Attempting Luna Service playback for:', url.substring(0, 100));

    return new Promise((resolve) => {
      try {
        // Hide HTML5 video element when using Luna Service
        if (this.video) {
          this.video.style.display = 'none';
        }

        // Load media via Luna Service
        this.webOS!.service.request('luna://com.webos.media', {
          method: 'load',
          parameters: {
            uri: url,
            type: 'media',
            payload: {
              option: {
                appId: 'com.ativeplay.app',
                windowId: '',
              },
            },
          },
          onSuccess: (response: LunaMediaResponse) => {
            if (response.returnValue && response.mediaId) {
              console.log('[LGWebOSAdapter] Luna Service media loaded:', response.mediaId);
              this.lunaMediaId = response.mediaId;
              this.usingLunaService = true;

              // Subscribe to media state changes
              this.subscribeLunaMediaState(response.mediaId);

              // Start playback
              this.lunaPlay();

              resolve(true);
            } else {
              console.error('[LGWebOSAdapter] Luna Service load failed:', response);
              this.showVideoElement();
              resolve(false);
            }
          },
          onFailure: (error: LunaError) => {
            console.error('[LGWebOSAdapter] Luna Service load error:', error);
            this.showVideoElement();
            resolve(false);
          },
        });
      } catch (e) {
        console.error('[LGWebOSAdapter] Luna Service exception:', e);
        this.showVideoElement();
        resolve(false);
      }
    });
  }

  /**
   * Subscribe to Luna Service media state updates
   */
  private subscribeLunaMediaState(mediaId: string): void {
    if (!this.webOS) return;

    this.lunaSubscription = this.webOS.service.request('luna://com.webos.media', {
      method: 'subscribe',
      parameters: {
        mediaId,
        subscribe: true,
      },
      onSuccess: (response: LunaMediaResponse) => {
        this.handleLunaStateChange(response);
      },
      onFailure: (error: LunaError) => {
        console.error('[LGWebOSAdapter] Luna subscribe error:', error);
      },
      subscribe: true,
    });
  }

  /**
   * Handle Luna Service state change events
   * Luna API returns state as object properties, e.g. { playing: {...} }, { paused: {...} }
   */
  private handleLunaStateChange(response: LunaMediaResponse): void {
    // Detect which state property is present
    const stateKeys = ['playing', 'paused', 'buffering', 'loading', 'idle', 'stopped', 'endOfStream', 'loadCompleted'];
    const detectedState = stateKeys.find(key => key in response);

    console.log('[LGWebOSAdapter] Luna state:', detectedState || 'update', response);

    // Update duration from sourceInfo or direct property
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sourceInfo = response.sourceInfo as any;
    if (sourceInfo?.duration !== undefined) {
      this.lunaDuration = sourceInfo.duration / 1000; // Convert ms to seconds
      this.emit('durationchange', { duration: this.lunaDuration });
    } else if (response.duration !== undefined) {
      this.lunaDuration = response.duration;
      this.emit('durationchange', { duration: response.duration });
    }

    // Update current time - Luna returns { currentTime: { currentTime: number } } in ms
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const currentTimeData = (response as any).currentTime;
    if (currentTimeData?.currentTime !== undefined) {
      this.lunaCurrentTime = currentTimeData.currentTime / 1000; // Convert ms to seconds
      this.emit('timeupdate', { currentTime: this.lunaCurrentTime });
    } else if (typeof response.currentTime === 'number') {
      this.lunaCurrentTime = response.currentTime;
      this.emit('timeupdate', { currentTime: response.currentTime });
    }

    // Handle state changes based on detected property
    if ('loadCompleted' in response) {
      // loadCompleted means ready to play - emit duration if available
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loadData = (response as any).loadCompleted;
      if (loadData?.duration !== undefined) {
        this.lunaDuration = loadData.duration / 1000;
        this.emit('durationchange', { duration: this.lunaDuration });
      }
    }

    if ('playing' in response) {
      this.setState('playing');
      this.emit('bufferingend');
    } else if ('paused' in response) {
      this.setState('paused');
    } else if ('buffering' in response) {
      this.setState('buffering');
      this.emit('bufferingstart');
    } else if ('loading' in response || 'load' in response) {
      this.setState('loading');
    } else if ('stopped' in response || 'idle' in response) {
      this.setState('idle');
    } else if ('endOfStream' in response) {
      this.setState('ended');
      this.emit('ended');
    }

    // Also check response.state for backward compatibility
    if (response.state) {
      switch (response.state) {
        case 'load':
          this.setState('loading');
          break;
        case 'buffering':
          this.setState('buffering');
          this.emit('bufferingstart');
          break;
        case 'playing':
          this.setState('playing');
          this.emit('bufferingend');
          break;
        case 'paused':
          this.setState('paused');
          break;
        case 'stopped':
        case 'idle':
          this.setState('idle');
          break;
        case 'endOfStream':
          this.setState('ended');
          this.emit('ended');
          break;
      }
    }

    // Handle source info for tracks
    if (response.sourceInfo?.programInfo?.[0]) {
      const program = response.sourceInfo.programInfo[0];
      if (program.audioTrackInfo) {
        this.tracks.audio = program.audioTrackInfo.map((track, index) => ({
          index,
          language: track.language || 'und',
          label: track.language ? parseLanguageCode(track.language) : `Audio ${index + 1}`,
          isDefault: index === 0,
        }));
        this.emit('trackschange', this.tracks);
      }
    }

    // Handle video info
    if (response.videoInfo) {
      this.tracks.video = [{
        index: 0,
        width: response.videoInfo.width || 0,
        height: response.videoInfo.height || 0,
      }];
    }

    // Handle errors
    if (response.error || response.errorCode) {
      const errorMsg = response.error?.errorText || response.errorText || 'Erro de reproducao';
      console.error('[LGWebOSAdapter] Luna playback error:', response);
      this.setState('error');
      this.emit('error', {
        code: 'LUNA_PLAYBACK_ERROR',
        message: errorMsg,
      });
    }
  }

  /**
   * Show HTML5 video element (when not using Luna)
   */
  private showVideoElement(): void {
    if (this.video) {
      this.video.style.display = '';
    }
    this.usingLunaService = false;
  }

  /**
   * Play via Luna Service
   */
  private lunaPlay(): void {
    if (!this.webOS || !this.lunaMediaId) return;

    this.webOS.service.request('luna://com.webos.media', {
      method: 'play',
      parameters: {
        mediaId: this.lunaMediaId,
      },
      onSuccess: () => {
        console.log('[LGWebOSAdapter] Luna play success');
      },
      onFailure: (error: LunaError) => {
        console.error('[LGWebOSAdapter] Luna play error:', error);
      },
    });
  }

  /**
   * Pause via Luna Service
   */
  private lunaPause(): void {
    if (!this.webOS || !this.lunaMediaId) return;

    this.webOS.service.request('luna://com.webos.media', {
      method: 'pause',
      parameters: {
        mediaId: this.lunaMediaId,
      },
      onSuccess: () => {
        console.log('[LGWebOSAdapter] Luna pause success');
      },
      onFailure: (error: LunaError) => {
        console.error('[LGWebOSAdapter] Luna pause error:', error);
      },
    });
  }

  /**
   * Seek via Luna Service
   */
  private lunaSeek(positionMs: number): void {
    if (!this.webOS || !this.lunaMediaId) return;

    this.webOS.service.request('luna://com.webos.media', {
      method: 'seek',
      parameters: {
        mediaId: this.lunaMediaId,
        position: positionMs,
      },
      onSuccess: () => {
        console.log('[LGWebOSAdapter] Luna seek success');
      },
      onFailure: (error: LunaError) => {
        console.error('[LGWebOSAdapter] Luna seek error:', error);
      },
    });
  }

  /**
   * Unload/close Luna Service media
   */
  private lunaUnload(): void {
    // Cancel subscription first
    if (this.lunaSubscription) {
      this.lunaSubscription.cancel();
      this.lunaSubscription = null;
    }

    if (!this.webOS || !this.lunaMediaId) {
      this.usingLunaService = false;
      return;
    }

    this.webOS.service.request('luna://com.webos.media', {
      method: 'unload',
      parameters: {
        mediaId: this.lunaMediaId,
      },
      onSuccess: () => {
        console.log('[LGWebOSAdapter] Luna unload success');
      },
      onFailure: (error: LunaError) => {
        console.error('[LGWebOSAdapter] Luna unload error:', error);
      },
    });

    this.lunaMediaId = null;
    this.usingLunaService = false;
    this.lunaDuration = 0;
    this.lunaCurrentTime = 0;

    // Show HTML5 video element again
    this.showVideoElement();
  }

  /**
   * Set audio track via Luna Service
   */
  private lunaSetAudioTrack(index: number): void {
    if (!this.webOS || !this.lunaMediaId) return;

    this.webOS.service.request('luna://com.webos.media', {
      method: 'selectTrack',
      parameters: {
        mediaId: this.lunaMediaId,
        type: 'audio',
        index,
      },
      onSuccess: () => {
        console.log('[LGWebOSAdapter] Luna audio track changed to:', index);
        this.currentTracks.audioIndex = index;
        this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
      },
      onFailure: (error: LunaError) => {
        console.error('[LGWebOSAdapter] Luna audio track change error:', error);
      },
    });
  }

  private loadTracksFromElement(): void {
    if (!this.video) return;

    // Audio tracks (fallback for non-HLS)
    const audioTracks = (this.video as HTMLVideoElement & { audioTracks?: AudioTrackList }).audioTracks;
    if (audioTracks && audioTracks.length) {
      this.tracks.audio = Array.from(audioTracks).map((track, index) => ({
        index,
        language: track.language || 'und',
        label: track.label || parseLanguageCode(track.language || 'und') || `Audio ${index + 1}`,
        isDefault: track.enabled || index === 0,
      }));
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

    this.emit('trackschange', this.tracks);
  }

  // Lifecycle

  async open(url: string, options: PlayerOptions = {}): Promise<void> {
    console.log('[LGWebOSAdapter] open() called with:', {
      url: url?.substring(0, 100),
      isLive: options.isLive,
      hasUrl: !!url,
    });

    this.options = options;

    // Check for unsupported container formats (MKV, AVI, WMV, FLV)
    // These require transcoding or native player (webOS Luna Service)
    const containerCheck = isUnsupportedContainer(url);
    if (containerCheck.unsupported) {
      console.warn(`[LGWebOSAdapter] Formato ${containerCheck.format} não suportado pelo HTML5 video`);

      // On webOS, try Luna Service (native player) which supports more formats
      if (this.isWebOS) {
        console.log(`[LGWebOSAdapter] Tentando Luna Service para formato ${containerCheck.format}`);
        this.setState('loading');

        // Extract referer from original URL
        let referer: string | undefined;
        try {
          const parsed = new URL(url);
          referer = parsed.origin;
        } catch {
          // Invalid URL, skip referer
        }

        // Proxify URL to bypass CORS/mixed-content
        const streamUrl = this.proxifyUrl(url, referer);
        this.currentUrl = streamUrl;
        this.options = options;

        // Try Luna Service playback
        const lunaSuccess = await this.tryLunaServicePlayback(streamUrl);
        if (lunaSuccess) {
          console.log(`[LGWebOSAdapter] Luna Service iniciou reprodução de ${containerCheck.format}`);
          return; // Luna Service is handling playback
        }

        // Luna Service failed, show error
        console.error('[LGWebOSAdapter] Luna Service também falhou para este formato');
      }

      // Not webOS or Luna Service failed
      this.setState('error');
      this.emit('error', {
        code: 'UNSUPPORTED_FORMAT',
        message: `Formato ${containerCheck.format} não é suportado. Use um formato compatível (MP4, HLS).`,
        format: containerCheck.format,
      });
      throw new Error(`Formato ${containerCheck.format} não suportado`);
    }

    this.setState('loading');

    // Stop any running monitors
    this.stopTsRecoveryMonitor();
    this.stopLiveEdgeMonitor();

    // Ensure HTML5 video element is visible (might be hidden from previous Luna Service playback)
    // Close any active Luna session first
    if (this.usingLunaService) {
      this.lunaUnload();
    }
    this.showVideoElement();

    // Clean up previous HLS instance
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.usingHls = false;
    this.isRawTsStream = false;
    this.triedDirectFallback = false;

    // Reset all recovery counters
    this.hlsRecoverAttempts = 0;
    this.hlsFullRestartAttempts = 0;
    this.hlsConsecutiveFatalErrors = 0;
    this.hlsLastFatalErrorTime = 0;
    this.frozenCheckCount = 0;
    this.tsRecoveryAttempts = 0;
    this.lastPlaybackTime = 0;
    this.isRecovering = false;

    // Extract referer from original URL
    let referer: string | undefined;
    try {
      const parsed = new URL(url);
      referer = parsed.origin;
    } catch {
      // Invalid URL, skip referer
    }

    // Proxify URL to bypass CORS/mixed-content
    const streamUrl = this.proxifyUrl(url, referer);
    this.currentUrl = streamUrl;

    if (!this.video) {
      throw new Error('Video element nao disponivel');
    }

    // Detect IPTV TS streams - should NOT use HLS.js
    // Note: detection functions now extract original URL from proxified URLs
    const originalUrl = extractOriginalUrl(url);
    const xtreamInfo = parseXtreamUrl(url);
    const isIptvTs = isIptvTsStream(url);
    const isLiveStream = this.options.isLive ?? (isIptvTs || isLikelyLiveHls(url));
    const isHls = isHlsUrl(url);

    console.log('[LGWebOSAdapter] Stream detection:', {
      originalUrl: originalUrl?.substring(0, 100),
      isXtream: xtreamInfo.isXtream,
      xtreamMediaType: xtreamInfo.mediaType,
      xtreamExtension: xtreamInfo.extension,
      xtreamIsHls: xtreamInfo.isHls, // Xtream live served as HLS (.m3u8)
      isIptvTs,
      isLiveStream,
      isHls,
      hlsSupported: Hls.isSupported(),
    });

    // Use HLS.js for HLS streams (provides track selection APIs)
    // But NOT for raw IPTV TS streams
    // This includes Xtream Live HLS (.m3u8) streams
    if (!isIptvTs && isHls && Hls.isSupported()) {
      if (xtreamInfo.isXtream && xtreamInfo.isHls) {
        console.log('[LGWebOSAdapter] Loading Xtream Live HLS stream via HLS.js:', streamUrl.substring(0, 100));
      } else {
        console.log('[LGWebOSAdapter] Using HLS.js for stream:', streamUrl.substring(0, 100));
      }
      this.usingHls = true;

      // Create custom loader to proxy all HLS sub-requests (playlists, segments)
      const proxyUrl = this.proxifyUrl.bind(this);

      const hlsConfig = this.buildHlsConfig(isLiveStream, proxyUrl, referer);
      this.hls = new Hls(hlsConfig);

      this.setupHlsListeners();
      this.hls.attachMedia(this.video);
      this.hls.loadSource(streamUrl);
      // Start live edge monitor for HLS live streams
      if (isLiveStream) {
        this.startLiveEdgeMonitor();
      }
    } else if (!isIptvTs && isHlsUrl(url) && this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS support (Safari, some Smart TVs)
      console.log('[LGWebOSAdapter] Using native HLS support:', streamUrl.substring(0, 100));
      this.video.src = streamUrl;
      this.video.load();
    } else {
      // Direct playback for non-HLS streams (including IPTV TS and Xtream VOD)
      if (isIptvTs) {
        // Xtream Live or generic IPTV TS stream
        if (xtreamInfo.isXtream && xtreamInfo.mediaType === 'live') {
          console.log('[LGWebOSAdapter] Loading Xtream Live stream:', streamUrl.substring(0, 100));
        } else {
          console.log('[LGWebOSAdapter] Loading IPTV TS stream:', streamUrl.substring(0, 100));
        }
        this.isRawTsStream = true;
        // Start TS recovery monitor for live IPTV streams
        if (isLiveStream) {
          this.startTsRecoveryMonitor();
        }
      } else if (xtreamInfo.isXtream && (xtreamInfo.mediaType === 'vod' || xtreamInfo.mediaType === 'series')) {
        // Xtream VOD (movie or series episode) - direct playback
        console.log(`[LGWebOSAdapter] Loading Xtream ${xtreamInfo.mediaType === 'vod' ? 'VOD' : 'Series'} (${xtreamInfo.extension}):`, streamUrl.substring(0, 100));
      } else {
        console.log('[LGWebOSAdapter] Using HTML5 video for stream:', streamUrl.substring(0, 100));
      }
      this.video.src = streamUrl;
      this.video.load();
    }
  }

  async prepare(): Promise<void> {
    if (!this.video) {
      throw new Error('Video element nao disponivel');
    }

    return new Promise((resolve, reject) => {
      const video = this.video!;
      // Live streams may take longer to start due to manifest parsing and buffer loading
      const prepTimeoutMs = this.options.isLive ? 45000 : 15000;

      const timeout = setTimeout(() => {
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        reject(new Error('Timeout ao preparar video'));
      }, prepTimeoutMs);

      const onCanPlay = () => {
        clearTimeout(timeout);
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
        clearTimeout(timeout);
        video.removeEventListener('canplay', onCanPlay);
        video.removeEventListener('error', onError);
        reject(new Error('Erro ao preparar video'));
      };

      video.addEventListener('canplay', onCanPlay);
      video.addEventListener('error', onError);
    });
  }

  close(): void {
    // Clear all timers and intervals
    if (this.bufferingRecoveryTimeout) {
      clearTimeout(this.bufferingRecoveryTimeout);
      this.bufferingRecoveryTimeout = null;
    }
    this.stopTsRecoveryMonitor();
    this.stopLiveEdgeMonitor();

    // Close Luna Service if active
    if (this.usingLunaService) {
      this.lunaUnload();
    }

    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    this.usingHls = false;

    if (this.video) {
      this.video.pause();
      this.video.src = '';
      this.video.load();
    }

    // Reset all state
    this.setState('idle');
    this.tracks = { audio: [], subtitle: [], video: [] };
    this.currentTracks = { audioIndex: 0, subtitleIndex: -1, subtitleEnabled: false };

    // Reset recovery counters
    this.hlsRecoverAttempts = 0;
    this.hlsFullRestartAttempts = 0;
    this.hlsConsecutiveFatalErrors = 0;
    this.hlsLastFatalErrorTime = 0;
    this.frozenCheckCount = 0;
    this.tsRecoveryAttempts = 0;
    this.isRawTsStream = false;
    this.triedDirectFallback = false;
    this.lastPlaybackTime = 0;
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
    if (this.usingLunaService) {
      this.lunaPlay();
      return;
    }
    if (this.video) {
      this.video.play().catch((e) => {
        console.error('[LGWebOSAdapter] Error playing:', e);
      });
    }
  }

  pause(): void {
    if (this.usingLunaService) {
      this.lunaPause();
      return;
    }
    if (this.video) {
      this.video.pause();
    }
  }

  stop(): void {
    if (this.usingLunaService) {
      this.lunaUnload();
      this.setState('idle');
      return;
    }
    if (this.video) {
      this.video.pause();
      this.video.currentTime = 0;
    }
    this.setState('idle');
  }

  seek(position: number): void {
    if (this.usingLunaService) {
      this.lunaSeek(position);
      return;
    }
    if (this.video) {
      this.video.currentTime = position / 1000;
    }
  }

  seekForward(ms: number): void {
    if (this.usingLunaService) {
      this.lunaSeek(this.lunaCurrentTime + ms);
      return;
    }
    if (this.video) {
      this.video.currentTime += ms / 1000;
    }
  }

  seekBackward(ms: number): void {
    if (this.usingLunaService) {
      this.lunaSeek(Math.max(0, this.lunaCurrentTime - ms));
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

    if (this.usingLunaService) {
      this.lunaSetAudioTrack(index);
      return;
    }

    if (this.usingHls && this.hls) {
      // Use HLS.js API for audio track switching
      console.log('[LGWebOSAdapter] Switching HLS audio track to:', index);
      this.hls.audioTrack = index;
    } else {
      // HTML5 audioTracks fallback
      const audioTracks = (this.video as HTMLVideoElement & { audioTracks?: AudioTrackList })?.audioTracks;
      if (audioTracks && audioTracks.length) {
        for (let i = 0; i < audioTracks.length; i++) {
          audioTracks[i].enabled = i === index;
        }
      }
      this.currentTracks.audioIndex = index;
      this.emit('audiotrackchange', { index, track: this.tracks.audio[index] });
    }
  }

  setSubtitleTrack(index: number): void {
    if (this.usingHls && this.hls) {
      // Use HLS.js API for subtitle track switching
      console.log('[LGWebOSAdapter] Switching HLS subtitle track to:', index);
      this.hls.subtitleTrack = index;
      // Also control visibility
      this.hls.subtitleDisplay = index >= 0;
    } else {
      // HTML5 textTracks fallback
      if (!this.video) return;
      const textTracks = this.video.textTracks;
      if (textTracks && textTracks.length) {
        for (let i = 0; i < textTracks.length; i++) {
          textTracks[i].mode = i === index ? 'showing' : 'hidden';
        }
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
    if (this.usingHls && this.hls) {
      this.hls.subtitleDisplay = enabled;
      if (!enabled) {
        this.hls.subtitleTrack = -1;
      } else if (this.currentTracks.subtitleIndex >= 0) {
        this.hls.subtitleTrack = this.currentTracks.subtitleIndex;
      } else if (this.tracks.subtitle.length > 0) {
        this.hls.subtitleTrack = 0;
      }
    } else {
      if (enabled && this.currentTracks.subtitleIndex >= 0) {
        this.setSubtitleTrack(this.currentTracks.subtitleIndex);
      } else if (!enabled) {
        this.setSubtitleTrack(-1);
      }
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
    // Luna Service playback info
    if (this.usingLunaService) {
      return {
        currentTime: this.lunaCurrentTime,
        duration: this.lunaDuration,
        bufferedTime: 0, // Luna doesn't provide this
        playbackRate: 1,
        volume: 100, // Luna uses system volume
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

  /**
   * Get HLS.js instance for advanced control (if using HLS)
   */
  getHlsInstance(): Hls | null {
    return this.hls;
  }

  /**
   * Check if currently using HLS.js
   */
  isUsingHls(): boolean {
    return this.usingHls;
  }

  /**
   * Check if currently using Luna Service (native webOS player)
   */
  isUsingLunaService(): boolean {
    return this.usingLunaService;
  }
}

export default LGWebOSAdapter;
