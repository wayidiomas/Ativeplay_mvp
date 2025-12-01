/**
 * Player Types
 * Tipos para o sistema de reproducao de video
 */

// Estado do player
export type PlayerState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'ended'
  | 'error';

// Tipo de track
export type TrackType = 'audio' | 'subtitle' | 'video';

// Track de audio
export interface AudioTrack {
  index: number;
  language: string;
  label: string;
  codec?: string;
  channels?: number;
  isDefault?: boolean;
}

// Track de legenda
export interface SubtitleTrack {
  index: number;
  language: string;
  label: string;
  isDefault?: boolean;
  isForced?: boolean;
}

// Track de video
export interface VideoTrack {
  index: number;
  width?: number;
  height?: number;
  bitrate?: number;
  codec?: string;
}

// Informacoes de tracks disponiveis
export interface TrackInfo {
  audio: AudioTrack[];
  subtitle: SubtitleTrack[];
  video: VideoTrack[];
}

// Track selecionado atualmente
export interface CurrentTracks {
  audioIndex: number;
  subtitleIndex: number;
  subtitleEnabled: boolean;
}

// Informacoes de playback
export interface PlaybackInfo {
  currentTime: number; // ms
  duration: number; // ms
  bufferedTime: number; // ms
  playbackRate: number;
  volume: number;
  isMuted: boolean;
}

// Evento do player
export interface PlayerEvent {
  type: PlayerEventType;
  data?: unknown;
  timestamp: number;
}

export type PlayerEventType =
  | 'statechange'
  | 'timeupdate'
  | 'durationchange'
  | 'bufferingstart'
  | 'bufferingend'
  | 'trackschange'
  | 'audiotrackchange'
  | 'subtitletrackchange'
  | 'error'
  | 'ended';

// Callback de evento
export type PlayerEventCallback = (event: PlayerEvent) => void;

// Opcoes de inicializacao do player
export interface PlayerOptions {
  autoPlay?: boolean;
  startPosition?: number; // ms
  volume?: number;
  muted?: boolean;
  preferredAudioLanguage?: string;
  preferredSubtitleLanguage?: string;
  enableSubtitles?: boolean;
  // Hint for player regarding live vs VOD; falls back to URL heuristics if not provided.
  isLive?: boolean;
}

// Erro do player
export interface PlayerError {
  code: PlayerErrorCode;
  message: string;
  details?: unknown;
}

export type PlayerErrorCode =
  | 'MEDIA_NOT_SUPPORTED'
  | 'NETWORK_ERROR'
  | 'DECODE_ERROR'
  | 'DRM_ERROR'
  | 'PLAYBACK_ERROR'
  | 'UNKNOWN_ERROR';

// Configuracao de DRM (para uso futuro)
export interface DRMConfig {
  type: 'widevine' | 'playready' | 'fairplay';
  licenseUrl: string;
  headers?: Record<string, string>;
}

// Media info
export interface MediaInfo {
  url: string;
  title?: string;
  poster?: string;
  duration?: number;
  drm?: DRMConfig;
}

// Rect para posicionamento do video
export interface VideoRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Display method
export type DisplayMethod = 'PLAYER_DISPLAY_MODE_FULL_SCREEN' | 'PLAYER_DISPLAY_MODE_LETTER_BOX';
