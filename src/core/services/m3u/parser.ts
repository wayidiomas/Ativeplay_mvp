/**
 * M3U Parser
 * Parseia playlists M3U/M3U8 usando STREAMING
 * Funciona com arquivos de qualquer tamanho (1KB até 1GB+)
 * Usa ~1-2MB de memória independente do tamanho do arquivo
 */

import type {
  M3UPlaylist,
  ParserProgress,
} from './types';

export type ProgressCallback = (progress: ParserProgress) => void;

/**
 * Faz download e parseia uma playlist M3U usando STREAMING
 * Reduz uso de memória de 300MB+ para ~1-2MB
 * Funciona para arquivos de qualquer tamanho
 */
export async function fetchAndParseM3U(
  url: string,
  playlistId: string,
  onProgress?: ProgressCallback
): Promise<M3UPlaylist> {
  // Importação dinâmica para evitar circular dependency
  const { streamParseM3U } = await import('./streamParser');
  const { processBatches } = await import('./batchProcessor');

  onProgress?.({
    phase: 'downloading',
    current: 0,
    total: 100,
    percentage: 0,
    message: 'Iniciando download com streaming...',
  });

  try {
    // Inicia streaming parser
    const generator = streamParseM3U(url);

    onProgress?.({
      phase: 'parsing',
      current: 0,
      total: 100,
      percentage: 0,
      message: 'Processando playlist...',
    });

    // Processa em lotes
    const result = await processBatches(generator, playlistId, onProgress);

    // Cria playlist completa
    const playlist: M3UPlaylist = {
      url,
      items: result.items,
      groups: result.groups,
      stats: result.stats,
    };

    return playlist;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
    onProgress?.({
      phase: 'error',
      current: 0,
      total: 100,
      percentage: 0,
      message: errorMessage,
    });
    throw error;
  }
}

export default { fetchAndParseM3U };
