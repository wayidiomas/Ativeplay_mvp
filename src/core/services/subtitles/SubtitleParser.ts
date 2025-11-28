/**
 * Subtitle Parser
 * Converte diferentes formatos de legenda (SRT, ASS, VTT) para um formato unificado
 */

import type { SubtitleCue, SubtitleFormat } from './types';

/**
 * Detecta o formato da legenda pelo conteudo
 */
export function detectFormat(content: string): SubtitleFormat {
  const trimmed = content.trim();

  // WebVTT sempre comeca com "WEBVTT"
  if (trimmed.startsWith('WEBVTT')) {
    return 'vtt';
  }

  // SRT: comeca com numero seguido de timestamp no formato HH:MM:SS,mmm
  if (/^\d+\s*\r?\n\d{1,2}:\d{2}:\d{2},\d{3}/.test(trimmed)) {
    return 'srt';
  }

  // ASS/SSA: contem [Script Info] ou [Events]
  if (trimmed.includes('[Script Info]') || trimmed.includes('[Events]')) {
    return 'ass';
  }

  return 'unknown';
}

/**
 * Parse SRT (SubRip) format
 *
 * Formato:
 * 1
 * 00:00:01,000 --> 00:00:04,000
 * Texto da legenda
 *
 * 2
 * ...
 */
export function parseSRT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.trim().split(/\r?\n\r?\n/);

  for (const block of blocks) {
    const lines = block.trim().split(/\r?\n/);
    if (lines.length < 3) continue;

    // Primeira linha: numero do cue (ignoramos)
    // Segunda linha: timestamp
    const timestampLine = lines[1];
    const timestampMatch = timestampLine.match(
      /(\d{1,2}:\d{2}:\d{2}[,.:]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.:]\d{3})/
    );

    if (!timestampMatch) continue;

    const startTime = parseSRTTime(timestampMatch[1]);
    const endTime = parseSRTTime(timestampMatch[2]);

    // Resto das linhas: texto
    const text = lines
      .slice(2)
      .join('\n')
      .trim()
      // Remove tags HTML basicas (mas mantem <i>, <b>)
      .replace(/<\/?font[^>]*>/gi, '')
      .replace(/\{[^}]*\}/g, ''); // Remove tags ASS se houver

    if (text) {
      cues.push({
        index: cues.length,
        startTime,
        endTime,
        text,
      });
    }
  }

  return cues;
}

/**
 * Parse WebVTT format
 *
 * Formato:
 * WEBVTT
 *
 * 00:00:01.000 --> 00:00:04.000
 * Texto da legenda
 */
export function parseVTT(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];

  // Remove header WEBVTT e metadados
  const lines = content.split(/\r?\n/);
  let i = 0;

  // Pula header
  while (i < lines.length && !lines[i].includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i].trim();

    // Procura linha de timestamp
    const timestampMatch = line.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{3})/
    );

    if (timestampMatch) {
      const startTime = parseVTTTime(timestampMatch[1]);
      const endTime = parseVTTTime(timestampMatch[2]);

      // Coleta linhas de texto ate linha vazia ou proximo timestamp
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() && !lines[i].includes('-->')) {
        textLines.push(lines[i].trim());
        i++;
      }

      const text = textLines.join('\n').trim();
      if (text) {
        cues.push({
          index: cues.length,
          startTime,
          endTime,
          text,
        });
      }
    } else {
      i++;
    }
  }

  return cues;
}

/**
 * Parse ASS/SSA format (basico - ignora formatacao avancada)
 *
 * Formato:
 * [Events]
 * Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
 * Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,Texto da legenda
 */
export function parseASS(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const lines = content.split(/\r?\n/);

  let inEvents = false;
  let formatLine: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // Encontra secao [Events]
    if (trimmed === '[Events]') {
      inEvents = true;
      continue;
    }

    // Sai da secao se encontrar outra
    if (trimmed.startsWith('[') && trimmed !== '[Events]') {
      inEvents = false;
      continue;
    }

    if (!inEvents) continue;

    // Linha de formato
    if (trimmed.startsWith('Format:')) {
      formatLine = trimmed
        .replace('Format:', '')
        .split(',')
        .map((s) => s.trim().toLowerCase());
      continue;
    }

    // Linha de dialogo
    if (trimmed.startsWith('Dialogue:')) {
      const values = trimmed.replace('Dialogue:', '').split(',');

      // Encontra indices no formato
      const startIdx = formatLine.indexOf('start');
      const endIdx = formatLine.indexOf('end');
      const textIdx = formatLine.indexOf('text');

      if (startIdx === -1 || endIdx === -1 || textIdx === -1) continue;

      const startTime = parseASSTime(values[startIdx]?.trim() || '');
      const endTime = parseASSTime(values[endIdx]?.trim() || '');

      // Texto pode conter virgulas, entao junta tudo apos textIdx
      const text = values
        .slice(textIdx)
        .join(',')
        .trim()
        // Remove tags ASS {\an8}, {\pos(x,y)}, etc
        .replace(/\{[^}]*\}/g, '')
        // Converte \N para quebra de linha
        .replace(/\\N/gi, '\n')
        .trim();

      if (text && startTime >= 0 && endTime >= 0) {
        cues.push({
          index: cues.length,
          startTime,
          endTime,
          text,
        });
      }
    }
  }

  // Ordena por tempo de inicio
  cues.sort((a, b) => a.startTime - b.startTime);

  return cues;
}

/**
 * Parse generico - detecta formato e converte
 */
export function parse(content: string): SubtitleCue[] {
  const format = detectFormat(content);

  switch (format) {
    case 'srt':
      return parseSRT(content);
    case 'vtt':
      return parseVTT(content);
    case 'ass':
      return parseASS(content);
    default:
      console.warn('[SubtitleParser] Formato desconhecido, tentando SRT...');
      return parseSRT(content);
  }
}

/**
 * Converte cues para formato WebVTT (string)
 */
export function toVTT(cues: SubtitleCue[]): string {
  let vtt = 'WEBVTT\n\n';

  for (const cue of cues) {
    vtt += `${msToVTTTime(cue.startTime)} --> ${msToVTTTime(cue.endTime)}\n`;
    vtt += `${escapeVTTText(cue.text)}\n\n`;
  }

  return vtt;
}

/**
 * Converte cues para Blob URL (para uso com <track>)
 */
export function toVTTBlobUrl(cues: SubtitleCue[]): string {
  const vttContent = toVTT(cues);
  const blob = new Blob([vttContent], { type: 'text/vtt' });
  return URL.createObjectURL(blob);
}

/**
 * Aplica offset de tempo aos cues (sincronizacao)
 */
export function applyOffset(cues: SubtitleCue[], offsetMs: number): SubtitleCue[] {
  return cues.map((cue) => ({
    ...cue,
    startTime: Math.max(0, cue.startTime + offsetMs),
    endTime: Math.max(0, cue.endTime + offsetMs),
  }));
}

/**
 * Filtra cues que se sobrepoem a um intervalo de tempo
 */
export function getCuesInRange(
  cues: SubtitleCue[],
  startMs: number,
  endMs: number
): SubtitleCue[] {
  return cues.filter(
    (cue) => cue.startTime < endMs && cue.endTime > startMs
  );
}

/**
 * Retorna cues ativos em um determinado tempo
 */
export function getActiveCues(cues: SubtitleCue[], currentTimeMs: number): SubtitleCue[] {
  return cues.filter(
    (cue) => cue.startTime <= currentTimeMs && currentTimeMs < cue.endTime
  );
}

// === Helpers de conversao de tempo ===

/**
 * Parse timestamp SRT: "00:00:01,000" ou "0:00:01,000"
 */
function parseSRTTime(time: string): number {
  // Normaliza separador de ms (pode ser , ou .)
  const normalized = time.replace(',', '.');
  return parseVTTTime(normalized);
}

/**
 * Parse timestamp VTT: "00:00:01.000" ou "0:00:01.000"
 */
function parseVTTTime(time: string): number {
  const parts = time.split(':');
  let hours = 0;
  let minutes = 0;
  let seconds = 0;

  if (parts.length === 3) {
    hours = parseInt(parts[0], 10);
    minutes = parseInt(parts[1], 10);
    seconds = parseFloat(parts[2].replace(',', '.'));
  } else if (parts.length === 2) {
    minutes = parseInt(parts[0], 10);
    seconds = parseFloat(parts[1].replace(',', '.'));
  }

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/**
 * Parse timestamp ASS: "0:00:01.00" (centesimos de segundo)
 */
function parseASSTime(time: string): number {
  const parts = time.split(':');
  if (parts.length !== 3) return -1;

  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseFloat(parts[2]);

  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/**
 * Converte milissegundos para formato VTT: "00:00:01.000"
 */
function msToVTTTime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const milliseconds = ms % 1000;

  return (
    `${hours.toString().padStart(2, '0')}:` +
    `${minutes.toString().padStart(2, '0')}:` +
    `${seconds.toString().padStart(2, '0')}.` +
    `${milliseconds.toString().padStart(3, '0')}`
  );
}

/**
 * Escape texto para VTT (mantendo tags permitidas)
 */
function escapeVTTText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Restaura tags permitidas: <i>, <b>, <u>
    .replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>');
}

// Exporta como objeto
const SubtitleParser = {
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
};

export default SubtitleParser;
