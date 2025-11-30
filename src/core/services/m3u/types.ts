/**
 * M3U Types
 * Tipos para parsing e armazenamento de playlists M3U/M3U8
 */

export type MediaKind = 'live' | 'movie' | 'series' | 'unknown';

export interface M3URawItem {
  name: string;
  tvg: {
    id?: string;
    name?: string;
    logo?: string;
    url?: string;
  };
  group: {
    title: string;
  };
  url: string;
  raw: string;
}

export interface M3UParsedItem {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  mediaKind: MediaKind;
  // EPG
  epgId?: string;
  // Metadados extraidos
  parsedTitle: ParsedTitle;
}

export interface ParsedTitle {
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  quality?: string;
  language?: string;
  isMultiAudio?: boolean;
  isDubbed?: boolean;
  isSubbed?: boolean;
}

export interface M3UGroup {
  id: string;
  name: string;
  mediaKind: MediaKind;
  itemCount: number;
  logo?: string;
}

export interface M3UPlaylist {
  url: string;
  items: M3UParsedItem[];
  groups: M3UGroup[];
  stats: PlaylistStats;
}

export interface PlaylistStats {
  totalItems: number;
  liveCount: number;
  movieCount: number;
  seriesCount: number;
  unknownCount: number;
  groupCount: number;
}

// Parser progress
export interface ParserProgress {
  phase: 'downloading' | 'parsing' | 'classifying' | 'indexing' | 'early_ready' | 'complete' | 'error';
  current: number;
  total: number;
  percentage: number;
  message: string;
  // ✅ Stats parciais para early navigation
  stats?: {
    totalItems?: number;
    liveCount?: number;
    movieCount?: number;
    seriesCount?: number;
  };
}

// Worker messages
export interface WorkerParseRequest {
  type: 'parse';
  content: string;
  playlistId: string;
}

export interface WorkerParseResponse {
  type: 'progress' | 'complete' | 'error';
  progress?: ParserProgress;
  result?: M3UPlaylist;
  error?: string;
}

// Content classification patterns
export interface ClassificationPatterns {
  live: RegExp[];
  movie: RegExp[];
  series: RegExp[];
}

export const DEFAULT_CLASSIFICATION_PATTERNS: ClassificationPatterns = {
  live: [
    /\b(24\/7|24h|ao vivo|live|tv|canal|channel|news|sport|hd|fhd|uhd)\b/i,
    /^\[.*\]$/,
  ],
  movie: [
    /\b(filme|movie|filmes|movies)\b/i,
    /\(\d{4}\)/,
    /\b(4k|2160p|1080p|720p|bluray|webrip|hdrip|dvdrip|hdcam)\b/i,
  ],
  series: [
    /\b(serie|series|s\d{1,2}e\d{1,2}|season|temporada|episodio|episode)\b/i,
    /s\d{1,2}[\s.]?e\d{1,2}/i,
    /\d{1,2}x\d{1,2}/i,
  ],
};
