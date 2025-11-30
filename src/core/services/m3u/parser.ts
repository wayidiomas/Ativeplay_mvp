/**
 * M3U Parser - Frontend-Only Entry Point
 * FASE 4: Main orchestrator for local M3U parsing
 *
 * Flow:
 * 1. Streaming download + parse (streamParseM3U)
 * 2. Chunked processing with adaptive batch sizes (processBatches)
 * 3. Incremental series grouping (hash-based during streaming)
 * 4. Fuzzy merge final (singletons only)
 */

import { streamParseM3U } from './streamParser';
import { processBatches, type EarlyReadyCallback } from './batchProcessor';
import { mergeSeriesGroups } from './seriesGrouper';
import type { ParserProgress } from './types';

export type ProgressCallback = (progress: ParserProgress) => void;
export type { EarlyReadyCallback }; // ✅ FASE 7.1: Re-export para conveniência

/**
 * Parse M3U completamente no frontend
 * - Streaming download + parse
 * - Chunked processing com batch adaptativo
 * - Incremental series grouping (hash + fuzzy)
 * - Memory management (GC intervals)
 * - FASE 7.1: Early navigation após threshold
 *
 * @param url - URL do arquivo M3U
 * @param playlistId - ID único da playlist
 * @param onProgress - Callback de progresso (opcional)
 * @param onEarlyReady - Callback disparado ao atingir threshold (500 items) (opcional)
 * @returns Stats, groups e series da playlist
 */
export async function parseM3ULocal(
  url: string,
  playlistId: string,
  onProgress?: ProgressCallback,
  onEarlyReady?: EarlyReadyCallback
): Promise<{
  stats: {
    totalItems: number;
    liveCount: number;
    movieCount: number;
    seriesCount: number;
    unknownCount: number;
    groupCount: number;
  };
  groups: Array<{
    id: string;
    name: string;
    mediaKind: string;
    itemCount: number;
    logo?: string;
  }>;
  series: Array<{
    id: string;
    playlistId: string;
    name: string;
    logo: string;
    group: string;
    totalEpisodes: number;
    totalSeasons: number;
    firstSeason: number;
    lastSeason: number;
    firstEpisode: number;
    lastEpisode: number;
    createdAt: number;
  }>;
}> {
  console.log('[Parser] Iniciando parsing local de M3U:', url);

  // FASE 1: Downloading
  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Iniciando download...',
  });

  // FASE 2: Stream parsing + batch processing
  // Cria generator do stream parser
  const generator = streamParseM3U(url);

  // Processa em batches (com hash-based series grouping + early ready callback)
  const result = await processBatches(generator, playlistId, onProgress, onEarlyReady);

  console.log('[Parser] Batch processing completo:', {
    totalItems: result.stats.totalItems,
    seriesGroups: result.seriesGroups.length,
  });

  // FASE 3: Series classification
  onProgress?.({
    phase: 'classifying',
    current: 80,
    total: 100,
    percentage: 80,
    message: 'Agrupando séries...',
  });

  // Fuzzy merge de singletons (se houver series)
  let series: any[] = [];
  if (result.seriesGroups && result.seriesGroups.length > 0) {
    console.log('[Parser] Iniciando fuzzy merge de series groups...');
    series = await mergeSeriesGroups(result.seriesGroups, playlistId);
    console.log(`[Parser] ${series.length} séries finais criadas`);
  }

  // FASE 4: Complete
  onProgress?.({
    phase: 'complete',
    current: 100,
    total: 100,
    percentage: 100,
    message: 'Concluído!',
  });

  console.log('[Parser] ===== PARSING COMPLETO =====');
  console.log(`[Parser] Total Items: ${result.stats.totalItems}`);
  console.log(`[Parser] Movies: ${result.stats.movieCount}`);
  console.log(`[Parser] Series: ${result.stats.seriesCount} (${series.length} unique)`);
  console.log(`[Parser] Live: ${result.stats.liveCount}`);
  console.log(`[Parser] Groups: ${result.stats.groupCount}`);

  return {
    stats: result.stats,
    groups: result.groups,
    series,
  };
}

// Legacy export for backward compatibility
export async function fetchAndParseM3U(
  url: string,
  playlistId: string,
  onProgress?: ProgressCallback,
  onEarlyReady?: EarlyReadyCallback
): Promise<any> {
  return parseM3ULocal(url, playlistId, onProgress, onEarlyReady);
}

export default { parseM3ULocal, fetchAndParseM3U };
