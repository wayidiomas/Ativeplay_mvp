/**
 * Subtitles Module
 * Sistema de legendas do AtivePlay
 *
 * Funcionalidades:
 * - Parse de formatos SRT, VTT, ASS
 * - Renderizacao customizada para Smart TVs
 * - Sincronizacao manual (offset)
 */

// Types
export * from './types';

// Parser
export { default as SubtitleParser } from './SubtitleParser';
export {
  detectFormat,
  parse,
  parseSRT,
  parseVTT,
  parseASS,
  toVTT,
  toVTTBlobUrl,
  applyOffset,
  getCuesInRange,
  getActiveCues,
} from './SubtitleParser';

// Renderer
export {
  SubtitleRenderer,
  shouldUseCustomRenderer,
  createSubtitleRenderer,
} from './SubtitleRenderer';
