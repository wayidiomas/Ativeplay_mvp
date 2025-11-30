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
import { processBatches } from './batchProcessor';
// import { mergeSeriesGroups } from './seriesGrouper'; // ✅ FASE 7.2: Opcional (fuzzy merge desabilitado)
import type { ParserProgress } from './types';
import { db } from '@core/db/schema'; // ✅ FASE 7.2: Busca series do DB

export type ProgressCallback = (progress: ParserProgress) => void;

/**
 * Parse M3U completamente no frontend
 * - Streaming download + parse
 * - Chunked processing com batch adaptativo
 * - Incremental series grouping (hash + fuzzy)
 * - Memory management (GC intervals)
 *
 * @param url - URL do arquivo M3U
 * @param playlistId - ID único da playlist
 * @param onProgress - Callback de progresso (opcional)
 * @returns Stats, groups e series da playlist
 */
export async function parseM3ULocal(
  url: string,
  playlistId: string,
  onProgress?: ProgressCallback
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

  // Processa em batches (com hash-based series grouping)
  const result = await processBatches(generator, playlistId, onProgress);

  console.log('[Parser] Batch processing completo:', {
    totalItems: result.stats.totalItems,
    seriesGroups: result.seriesGroups.length,
  });

  // ✅ FASE 7.2: Series já estão no DB (criadas durante streaming)
  // Busca series do DB ao invés de fazer fuzzy merge
  onProgress?.({
    phase: 'classifying',
    current: 90,
    total: 100,
    percentage: 90,
    message: 'Finalizando séries...',
  });

  console.log('[Parser] Buscando séries do DB (já criadas durante streaming)...');
  const series = await db.series.where('playlistId').equals(playlistId).toArray();
  console.log(`[Parser] ${series.length} séries encontradas no DB`);

  // ✅ OPCIONAL: Fuzzy merge apenas para cleanup de singletons (precisão extra)
  // Desabilitado por padrão - descomentar se precisar de precisão máxima
  // if (result.seriesGroups && result.seriesGroups.length > 0) {
  //   console.log('[Parser] Fuzzy merge opcional (singletons apenas)...');
  //   const singletons = result.seriesGroups.filter(g => g.episodeCount === 1);
  //   if (singletons.length > 0) {
  //     await mergeSeriesGroups(singletons, playlistId);
  //     console.log(`[Parser] ${singletons.length} singletons processados`);
  //   }
  // }

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
  onProgress?: ProgressCallback
): Promise<any> {
  return parseM3ULocal(url, playlistId, onProgress);
}

export default { parseM3ULocal, fetchAndParseM3U };
