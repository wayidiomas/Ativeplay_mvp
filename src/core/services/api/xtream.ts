/**
 * Xtream Codes API Client
 * Calls the backend proxy routes for Xtream playlists
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
  rating?: string;
  epgChannelId?: string;
}

export interface XtreamVodInfo {
  info?: {
    tmdbId?: string;
    name?: string;
    title?: string;
    year?: string;
    coverBig?: string;
    movieImage?: string;
    releasedate?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    durationSecs?: number;
    duration?: string;
    rating?: string;
  };
  movieData?: XtreamStreamItem;
}

export interface XtreamSeriesInfo {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    rating?: string;
    backdropPath?: string[];
  };
  seasons?: XtreamSeason[];
  episodes?: Record<string, XtreamEpisode[]>;
}

export interface XtreamSeason {
  seasonNumber: number;
  name?: string;
  cover?: string;
}

export interface XtreamEpisode {
  id: string;
  episodeNum: number;
  title: string;
  containerExtension: string;
  info?: {
    plot?: string;
    durationSecs?: number;
    movieImage?: string;
  };
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
