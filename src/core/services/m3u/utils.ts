/**
 * Utility functions for M3U series name normalization and key generation
 * Used for hash-based series grouping during streaming
 *
 * FASE OPTIMIZAÇÃO: Adiciona normalização, validação e hash otimizado
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
    .replace(/\s+T\d{1,2}E\d{1,2}.*/i, '')  // Remove TxxExx (PT-BR)
    .replace(/\(\d{4}\)/g, '')               // Remove (2024)
    .replace(/\[\d{4}\]/g, '')               // Remove [2024]
    .replace(/\b(1080p|720p|4k|hd|fhd|uhd|bluray|webrip|web-dl|hdtv|brrip|dvdrip)\b/gi, '')
    .replace(/[^\w\s]/g, '')                 // Remove special chars (keep only alphanumeric + spaces)
    .replace(/\s+/g, ' ')                    // Normalize multiple spaces to single
    // Remove artigos comuns (reduz colisões)
    .replace(/^(the|o|a|os|as|el|la|los|las)\s+/i, '')
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

/**
 * Normaliza nome de grupo para busca consistente
 * Remove emojis, normaliza espaços e uppercase
 *
 * Examples:
 * - "⭐ SERIES 24H" → "SERIES 24H"
 * - "  Filmes | Netflix  " → "FILMES | NETFLIX"
 *
 * Otimização: Permite busca case-insensitive O(1) com índice
 */
export function normalizeGroup(group: string): string {
  return group
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')              // Normaliza múltiplos espaços
    .replace(/[⭐★•◆◇□■▪▫♦♢]/g, '');   // Remove emojis comuns
}

/**
 * Normaliza título para busca case-insensitive
 * Simplesmente converte para uppercase
 *
 * Otimização: Permite índice [playlistId+titleNormalized] para busca rápida
 */
export function normalizeTitle(title: string): string {
  return title.toUpperCase();
}

/**
 * Valida se URL é um stream válido
 * Verifica protocolo, host e extensões comuns
 *
 * Examples:
 * - "http://server.com/play/user/pass/123.mp4" → true
 * - "http://server.com/play/user/pass/123/ts" → true
 * - "ftp://invalid.com/file.avi" → false
 * - "not-a-url" → false
 *
 * Otimização: Evita inserir URLs inválidas no DB
 */
export function isValidStreamURL(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Aceitar apenas http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // URL deve ter host válido
    if (!parsed.hostname || parsed.hostname.length === 0) {
      return false;
    }

    // Verificar extensões/padrões comuns de stream
    const urlLower = url.toLowerCase();
    const validPatterns = [
      '.m3u8',
      '.ts',
      '.mp4',
      '.mkv',
      '.avi',
      '.flv',
      '.mov',
      '/play/',
      '/live/',
      '/movie/',
      '/series/',
      '/stream/',
    ];

    return validPatterns.some(pattern => urlLower.includes(pattern));
  } catch {
    return false;
  }
}

/**
 * Gera hash simples de URL para dedupe ultra-rápida
 * Usa mesmo algoritmo djb2 do createSeriesKey
 *
 * Otimização: Permite índice [playlistId+urlHash] para dedupe O(1)
 */
export function hashURL(url: string): string {
  const hash = url.split('').reduce((acc, char) => {
    return ((acc << 5) - acc) + char.charCodeAt(0);
  }, 0);
  return Math.abs(hash).toString(36);
}
