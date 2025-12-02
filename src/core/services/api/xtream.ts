/**
 * Xtream Codes API Client
 * Calls the backend proxy routes for Xtream playlists
 *
 * Normalization features (inspired by @iptv/xtream-api):
 * - Cast/Genre as arrays instead of comma-separated strings
 * - Rating as number (0-10 scale) instead of string
 * - Timestamps as ISO8601 strings
 * - Auto-generated seasons from episodes when missing
 */

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// ============================================================================
// Types
// ============================================================================

export interface XtreamCategory {
  id: string;
  name: string;
  parentId?: number;
}

export interface XtreamStreamItem {
  id: string;
  name: string;
  logo?: string;
  categoryId?: string;
  mediaType: 'live' | 'vod' | 'series';
  extension?: string;
  /** Normalized rating as number (0-10 scale) */
  rating?: number;
  epgChannelId?: string;
  /** ISO8601 timestamp when added */
  addedAt?: string;
  /** Whether channel has TV archive/catchup support (live only) */
  tvArchive?: boolean;
  /** TV archive duration in days (live only) */
  tvArchiveDuration?: number;
}

// ============================================================================
// Normalized VOD Info (inspired by @iptv/xtream-api)
// ============================================================================

export interface XtreamVodInfo {
  id: string;
  name: string;
  title?: string;
  originalName?: string;
  year?: string;
  releaseDate?: string;
  cover?: string;
  backdrop?: string[];
  plot?: string;
  /** Cast as array instead of comma-separated string */
  cast: string[];
  /** Directors as array */
  directors: string[];
  /** Genres as array instead of comma-separated string */
  genres: string[];
  /** Rating as number (0-10 scale) */
  rating?: number;
  /** Duration in seconds */
  durationSecs?: number;
  tmdbId?: string;
  youtubeTrailer?: string;
  containerExtension?: string;
  /** Stream ID for playback URL generation */
  streamId: number;
}

// ============================================================================
// Normalized Series Info (inspired by @iptv/xtream-api)
// ============================================================================

export interface XtreamSeriesInfo {
  id: string;
  name: string;
  cover?: string;
  backdrop?: string[];
  plot?: string;
  /** Cast as array */
  cast: string[];
  /** Directors as array */
  directors: string[];
  /** Genres as array */
  genres: string[];
  /** Rating as number (0-10 scale) */
  rating?: number;
  releaseDate?: string;
  youtubeTrailer?: string;
  /** Seasons (auto-generated from episodes if empty) */
  seasons: XtreamSeason[];
  /** Episodes grouped by season number */
  episodes: Record<string, XtreamEpisode[]>;
}

export interface XtreamSeason {
  seasonNumber: number;
  name?: string;
  cover?: string;
  episodeCount?: number;
  airDate?: string;
}

export interface XtreamEpisode {
  id: string;
  episodeNum: number;
  title: string;
  containerExtension: string;
  season?: number;
  plot?: string;
  /** Duration in seconds */
  durationSecs?: number;
  cover?: string;
  /** Rating as number */
  rating?: number;
  /** ISO8601 timestamp when added */
  addedAt?: string;
}

export interface XtreamPlaylistInfo {
  id: string;
  name: string;
  server: string;
  username: string;
  sourceType: 'xtream';
  expiresAt?: number;
  maxConnections?: number;
  isTrial?: boolean;
}

export interface CategoriesResponse {
  total: number;
  categories: XtreamCategory[];
}

export interface StreamsResponse {
  total: number;
  items: XtreamStreamItem[];
}

export interface PlayUrlResponse {
  url: string;
}

// ============================================================================
// EPG Types (inspired by @iptv/xtream-api)
// ============================================================================

export interface XtreamEpgEntry {
  id: string;
  title: string;
  description?: string;
  /** Start time as ISO8601 */
  start: string;
  /** End time as ISO8601 */
  end: string;
  /** Whether this program has archive available */
  hasArchive?: boolean;
}

export interface XtreamEpgResponse {
  streamId: string;
  listings: XtreamEpgEntry[];
}

export interface XtreamTimeshiftUrlResponse {
  url: string;
}

export interface XtreamEpgUrlResponse {
  url: string;
}

// ============================================================================
// API Error
// ============================================================================

class XtreamApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'XtreamApiError';
  }
}

// ============================================================================
// Xtream API Client Class
// ============================================================================

export class XtreamAPI {
  private playlistId: string;

  constructor(playlistId: string) {
    this.playlistId = playlistId;
  }

  private async fetch<T>(endpoint: string): Promise<T> {
    const url = `${API_URL}/api/xtream/${this.playlistId}${endpoint}`;

    try {
      const res = await fetch(url, {
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Unknown error' }));
        throw new XtreamApiError(res.status, error.error || `HTTP ${res.status}`);
      }

      return res.json();
    } catch (error) {
      if (error instanceof XtreamApiError) throw error;
      throw new XtreamApiError(0, `Network error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }
  }

  // -------------------------------------------------------------------------
  // Playlist Info
  // -------------------------------------------------------------------------

  async getInfo(): Promise<XtreamPlaylistInfo> {
    return this.fetch('/info');
  }

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------

  async getLiveCategories(): Promise<XtreamCategory[]> {
    const res = await this.fetch<CategoriesResponse>('/categories/live');
    return res.categories;
  }

  async getVodCategories(): Promise<XtreamCategory[]> {
    const res = await this.fetch<CategoriesResponse>('/categories/vod');
    return res.categories;
  }

  async getSeriesCategories(): Promise<XtreamCategory[]> {
    const res = await this.fetch<CategoriesResponse>('/categories/series');
    return res.categories;
  }

  // -------------------------------------------------------------------------
  // Streams
  // -------------------------------------------------------------------------

  async getLiveStreams(categoryId?: string): Promise<XtreamStreamItem[]> {
    const query = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : '';
    const res = await this.fetch<StreamsResponse>(`/streams/live${query}`);
    return res.items;
  }

  async getVodStreams(categoryId?: string): Promise<XtreamStreamItem[]> {
    const query = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : '';
    const res = await this.fetch<StreamsResponse>(`/streams/vod${query}`);
    return res.items;
  }

  async getSeries(categoryId?: string): Promise<XtreamStreamItem[]> {
    const query = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : '';
    const res = await this.fetch<StreamsResponse>(`/streams/series${query}`);
    return res.items;
  }

  // -------------------------------------------------------------------------
  // Details
  // -------------------------------------------------------------------------

  async getVodInfo(vodId: string): Promise<XtreamVodInfo> {
    return this.fetch(`/vod/${encodeURIComponent(vodId)}`);
  }

  async getSeriesInfo(seriesId: string): Promise<XtreamSeriesInfo> {
    return this.fetch(`/series/${encodeURIComponent(seriesId)}`);
  }

  // -------------------------------------------------------------------------
  // Play URL
  // -------------------------------------------------------------------------

  async getPlayUrl(
    streamId: number,
    mediaType: 'live' | 'vod' | 'series',
    extension?: string
  ): Promise<string> {
    const params = new URLSearchParams({
      stream_id: streamId.toString(),
      media_type: mediaType,
    });
    if (extension) {
      params.set('extension', extension);
    }
    const res = await this.fetch<PlayUrlResponse>(`/play-url?${params}`);
    return res.url;
  }

  // -------------------------------------------------------------------------
  // EPG (Electronic Program Guide)
  // -------------------------------------------------------------------------

  /**
   * Get short EPG for a live channel (next ~4 hours)
   * @param streamId The live stream ID
   * @param limit Optional limit on number of entries
   */
  async getEpg(streamId: string, limit?: number): Promise<XtreamEpgResponse> {
    const query = limit ? `?limit=${limit}` : '';
    return this.fetch(`/epg/${encodeURIComponent(streamId)}${query}`);
  }

  /**
   * Get the XMLTV EPG URL for the playlist
   * Can be used with external EPG parsers
   */
  async getEpgUrl(): Promise<string> {
    const res = await this.fetch<XtreamEpgUrlResponse>('/epg-url');
    return res.url;
  }

  // -------------------------------------------------------------------------
  // Timeshift / TV Archive
  // -------------------------------------------------------------------------

  /**
   * Generate a timeshift URL for catching up on live TV
   * @param streamId The live stream ID
   * @param start Unix timestamp of when the program started
   * @param duration Duration in minutes to watch
   */
  async getTimeshiftUrl(
    streamId: number,
    start: number,
    duration: number
  ): Promise<string> {
    const params = new URLSearchParams({
      stream_id: streamId.toString(),
      start: start.toString(),
      duration: duration.toString(),
    });
    const res = await this.fetch<XtreamTimeshiftUrlResponse>(`/timeshift-url?${params}`);
    return res.url;
  }
}

// ============================================================================
// Factory function
// ============================================================================

export function createXtreamClient(playlistId: string): XtreamAPI {
  return new XtreamAPI(playlistId);
}

// ============================================================================
// Normalization helpers (convert Xtream data to common format)
// ============================================================================

import type { PlaylistItem, PlaylistGroup, MediaKind } from './index';

/**
 * Convert Xtream categories to PlaylistGroup format
 */
export function normalizeXtreamCategories(
  categories: XtreamCategory[],
  mediaKind: MediaKind
): PlaylistGroup[] {
  return categories.map((cat) => ({
    id: cat.id,
    name: cat.name,
    mediaKind,
    itemCount: 0, // Will be filled when loading streams
    logo: undefined,
  }));
}

/**
 * Convert Xtream streams to PlaylistItem format
 */
export function normalizeXtreamStreams(
  streams: XtreamStreamItem[],
  mediaType: 'live' | 'vod' | 'series'
): PlaylistItem[] {
  const mediaKindMap: Record<string, MediaKind> = {
    live: 'live',
    vod: 'movie',
    series: 'series',
  };

  return streams.map((s) => ({
    id: s.id,
    name: s.name,
    url: '', // URL will be fetched via getPlayUrl when needed
    logo: s.logo,
    group: s.categoryId || 'Uncategorized',
    mediaKind: mediaKindMap[mediaType] || 'unknown',
    // Xtream-specific fields
    xtreamId: parseInt(s.id, 10),
    xtreamExtension: s.extension,
    xtreamMediaType: mediaType,
  }));
}

export default {
  XtreamAPI,
  createXtreamClient,
  normalizeXtreamCategories,
  normalizeXtreamStreams,
};
