/**
 * API Service - Rust Backend Client
 * Stateless frontend: all data comes from the backend API
 */

const API_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || 'http://localhost:3001';

// ============================================================================
// Types
// ============================================================================

export type MediaKind = 'live' | 'movie' | 'series' | 'unknown';

export interface PlaylistStats {
  totalItems: number;
  liveCount: number;
  movieCount: number;
  seriesCount: number;
  unknownCount: number;
  groupCount: number;
}

export interface PlaylistGroup {
  id: string;
  name: string;
  mediaKind: MediaKind;
  itemCount: number;
  logo?: string;
}

export interface PlaylistItem {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group: string;
  mediaKind: MediaKind;
  parsedTitle?: {
    title: string;
    year?: number;
    season?: number;
    episode?: number;
    quality?: string;
  };
  epgId?: string;
  seriesId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface SeriesInfo {
  id: string;
  name: string;
  logo?: string;
  group: string;
  totalEpisodes: number;
  totalSeasons: number;
  firstSeason: number;
  lastSeason: number;
  year?: number;
  quality?: string;
  seasonsData?: SeasonData[];
}

export interface SeasonData {
  seasonNumber: number;
  episodes: SeriesEpisode[];
}

export interface SeriesEpisode {
  itemId: string;
  season: number;
  episode: number;
  name: string;
  url: string;
}

export interface ParseResponse {
  status: 'parsing' | 'complete';
  hash: string;
  message?: string;
  stats?: PlaylistStats;
  groups?: PlaylistGroup[];
}

/**
 * Parse status for real-time progress tracking
 */
export interface ParseStatus {
  status: 'parsing' | 'building_groups' | 'building_series' | 'complete' | 'failed' | 'not_found';
  itemsParsed?: number;
  itemsTotal?: number;
  groupsCount?: number;
  seriesCount?: number;
  currentPhase?: string;
  error?: string;
  canNavigate: boolean;
  elapsedMs?: number;
}

export interface ValidateResponse {
  valid: boolean;
  hash: string;
  url?: string;
  stats?: PlaylistStats;
  expiresAt?: number;
  createdAt?: number;
}

export interface ItemsResponse {
  items: PlaylistItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface GroupsResponse {
  groups: PlaylistGroup[];
  total: number;
}

export interface SeriesResponse {
  series: SeriesInfo[];
  total: number;
}

export interface EpisodesResponse {
  episodes: PlaylistItem[];
  seriesName?: string;
  seasonsData?: SeasonData[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

// ============================================================================
// API Client
// ============================================================================

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_URL}${endpoint}`;

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new ApiError(response.status, error.error || `HTTP ${response.status}`);
    }

    return response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, `Network error: ${error instanceof Error ? error.message : 'Unknown'}`);
  }
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Parse a playlist URL - returns immediately with status "parsing"
 * Use getParseStatus() to poll for progress
 */
export async function parsePlaylist(url: string): Promise<ParseResponse> {
  return fetchApi<ParseResponse>('/api/playlist/parse', {
    method: 'POST',
    body: JSON.stringify({ url }),
  });
}

/**
 * Get real-time parsing status - poll this every 1 second during parsing
 */
export async function getParseStatus(hash: string): Promise<ParseStatus> {
  return fetchApi<ParseStatus>(`/api/playlist/${hash}/status`);
}

/**
 * Validate if a cached playlist is still valid
 */
export async function validateCache(hash: string): Promise<ValidateResponse> {
  return fetchApi<ValidateResponse>(`/api/playlist/${hash}/validate`);
}

/**
 * Get playlist stats
 */
export async function getStats(hash: string): Promise<{ hash: string; stats: PlaylistStats; createdAt: number; expiresAt: number }> {
  return fetchApi(`/api/playlist/${hash}/stats`);
}

/**
 * Get all groups for a playlist
 */
export async function getGroups(hash: string): Promise<GroupsResponse> {
  return fetchApi<GroupsResponse>(`/api/playlist/${hash}/groups`);
}

/**
 * Get all series for a playlist
 */
export async function getSeries(hash: string): Promise<SeriesResponse> {
  return fetchApi<SeriesResponse>(`/api/playlist/${hash}/series`);
}

/**
 * Get paginated items with optional filters
 */
export async function getItems(
  hash: string,
  options: {
    limit?: number;
    offset?: number;
    group?: string;
    mediaKind?: MediaKind;
  } = {}
): Promise<ItemsResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());
  if (options.group) params.set('group', options.group);
  if (options.mediaKind) params.set('media_kind', options.mediaKind);

  const query = params.toString();
  return fetchApi<ItemsResponse>(`/api/playlist/${hash}/items${query ? `?${query}` : ''}`);
}

/**
 * Get episodes for a series
 */
export async function getSeriesEpisodes(
  hash: string,
  seriesId: string,
  options: { limit?: number; offset?: number } = {}
): Promise<EpisodesResponse> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', options.limit.toString());
  if (options.offset) params.set('offset', options.offset.toString());

  const query = params.toString();
  return fetchApi<EpisodesResponse>(
    `/api/playlist/${hash}/series/${encodeURIComponent(seriesId)}/episodes${query ? `?${query}` : ''}`
  );
}

/**
 * Search items using PostgreSQL fuzzy search (pg_trgm)
 * Much faster than client-side filtering
 */
export interface SearchResponse {
  items: PlaylistItem[];
  query: string;
  total: number;
  limit: number;
}

export async function searchItems(
  hash: string,
  query: string,
  limit = 50
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, limit: limit.toString() });
  return fetchApi<SearchResponse>(`/api/playlist/${hash}/search?${params}`);
}

// ============================================================================
// Local Storage Helpers (only stores hash for auto-resume)
// ============================================================================

const STORAGE_KEY = 'ativeplay_playlist';

export interface StoredPlaylist {
  hash: string;
  url: string;
  name: string;
  stats: PlaylistStats;
  savedAt: number;
}

/**
 * Save playlist hash to localStorage for auto-resume
 */
export function savePlaylistToStorage(playlist: StoredPlaylist): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(playlist));
  } catch (e) {
    console.warn('[API] Failed to save to localStorage:', e);
  }
}

/**
 * Get stored playlist from localStorage
 */
export function getStoredPlaylist(): StoredPlaylist | null {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : null;
  } catch (e) {
    console.warn('[API] Failed to read from localStorage:', e);
    return null;
  }
}

/**
 * Clear stored playlist
 */
export function clearStoredPlaylist(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[API] Failed to clear localStorage:', e);
  }
}

// Export all
export default {
  parsePlaylist,
  getParseStatus,
  validateCache,
  getStats,
  getGroups,
  getSeries,
  getItems,
  getSeriesEpisodes,
  searchItems,
  savePlaylistToStorage,
  getStoredPlaylist,
  clearStoredPlaylist,
};
