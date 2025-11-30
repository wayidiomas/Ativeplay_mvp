/**
 * Utility functions for M3U series name normalization and key generation
 * Used for hash-based series grouping during streaming
 */

/**
 * Normalizes series name for consistent grouping
 * Removes season/episode tags, years, quality tags, and special characters
 *
 * Examples:
 * - "Breaking Bad S01E01" → "breaking bad"
 * - "Breaking Bad (2008) 1080p" → "breaking bad"
 * - "Breaking Bad - Remastered [2024]" → "breaking bad remastered"
 */
export function normalizeSeriesName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+S\d{1,2}E\d{1,2}.*/i, '')  // Remove SxxExx and everything after
    .replace(/\s+\d{1,2}x\d{1,2}.*/i, '')   // Remove 1x01 and everything after
    .replace(/\(\d{4}\)/g, '')               // Remove (2024)
    .replace(/\[\d{4}\]/g, '')               // Remove [2024]
    .replace(/\b(1080p|720p|4k|hd|fhd|uhd|bluray|webrip|web-dl|hdtv|brrip|dvdrip)\b/gi, '')
    .replace(/[^\w\s]/g, '')                 // Remove special chars (keep only alphanumeric + spaces)
    .replace(/\s+/g, ' ')                    // Normalize multiple spaces to single
    .trim();
}

/**
 * Creates a unique hash-based series key from normalized name
 * Uses simple hash algorithm (djb2 variant) for consistent ID generation
 *
 * Example:
 * - "breaking bad" → "series_1a2b3c4d"
 */
export function createSeriesKey(normalized: string): string {
  // djb2 hash algorithm - simple but effective for string hashing
  const hash = normalized.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);

  // Convert to base36 for compact alphanumeric string
  return `series_${Math.abs(hash).toString(36)}`;
}
