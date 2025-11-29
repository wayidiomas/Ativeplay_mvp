/**
 * Worker Pool para Processamento de Playlists M3U
 * Processa jobs da fila com concorrência limitada (max 2 simultâneos)
 */

import { Worker } from 'bullmq';
import { readdir } from 'fs/promises';
import { redisConnection, parseQueue, removeProcessingLock } from './queue.js';
import { cacheIndex } from './services/cacheIndex.js';
import { logger, logParseStart, logParseEnd, logParseError, logJobCompleted, logJobFailed } from './utils/logger.js';
import { recordParseComplete, recordParseFailed, updateQueueMetrics } from './utils/metrics.js';
import path from 'path';
import { fileURLToPath } from 'url';

// ===== Path Setup =====

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_DIR = path.join(__dirname, '.parse-cache');

// ===== Import Parse Logic =====

// Importa funções de parsing do index.js (será movido depois)
// Por enquanto, vou duplicar as funções essenciais aqui

import crypto from 'crypto';
import { createWriteStream, rename, createReadStream } from 'fs';
import { promises as fs } from 'fs';
import readline from 'readline';
import { promisify } from 'util';

const renameAsync = promisify(rename);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MAX_M3U_SIZE_MB = 1000;
const FETCH_TIMEOUT_MS = 30 * 60 * 1000; // 15 minutos (aumentado para playlists grandes)

// ===== Helper Functions (duplicado do index.js) =====

function hashPlaylist(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function normalizeSpaces(str = '') {
  return str.replace(/\s+/g, ' ').trim();
}

// ===== PRE-COMPILED REGEX PATTERNS (FASE 1 OPTIMIZATION) =====
// Evita recompilação de regex em cada chamada (3M+ operações economizadas)

const REGEX_QUALITY = /\b(4k|2160p|1080p|720p|480p|360p|uhd|fhd|hd|sd)\b/gi;
const REGEX_CODEC = /\b(hevc|x264|x265|h264|h265|web-?dl|webrip|bluray|bdrip|hdrip|dvdrip|cam|ts|hdcam)\b/gi;
const REGEX_LANG = /\b(dub|dublado|dubbed|dual|multi|legendado|leg|sub|subbed|nacional|ptbr|pt-br)\b/gi;
const REGEX_PIPES = /[|]+/g;
const REGEX_MULTI_SPACE = /\s+/g;

// parseTitle patterns (pre-compiled)
const REGEX_SEASON_EPISODE_1 = /s(\d{1,2})e(\d{1,3})/i;
const REGEX_SEASON_EPISODE_2 = /(\d{1,2})x(\d{1,3})/i;
const REGEX_SEASON_EPISODE_3 = /temporada\s*(\d{1,2}).*epis[oó]dio\s*(\d{1,3})/i;
const REGEX_SEASON_EPISODE_4 = /t(\d{1,2})[\s._-]*e(\d{1,3})/i;
const REGEX_YEAR = /\b(19|20)\d{2}\b/;
const REGEX_SEASON_WORD = /\b(s|season|temporada)\s*\d{1,2}\b/gi;
const REGEX_EPISODE_WORD = /\b(e|epis[oó]dio|episode)\s*\d{1,3}\b/gi;

// normalizeGroupTitle patterns (pre-compiled)
const REGEX_EMOJI_PREFIX = /^[^\w]+/u;
const REGEX_EMOJIS = /[•◆★⭐⚽🎬🎥📺🎵]+/g;
const REGEX_24H = /\b24h(rs)?\b/gi;
const REGEX_TRAILING_NUMBER = /\b\d{2}\b$/g;
const REGEX_NACIONAL_SUFFIX = /:\s*nacional\s*\d{0,2}$/gi;

// Remove ruídos comuns de títulos (qualidade, idioma, tags de release)
function cleanTitleForGrouping(title = '') {
  return title
    .replace(REGEX_QUALITY, '')
    .replace(REGEX_CODEC, '')
    .replace(REGEX_LANG, '')
    .replace(REGEX_PIPES, ' ')
    .replace(REGEX_MULTI_SPACE, ' ')
    .trim();
}

function parseTitle(name) {
  const normalized = normalizeSpaces(name);

  // ✅ OTIMIZADO: Usa regex pré-compiladas
  const patterns = [
    REGEX_SEASON_EPISODE_1,
    REGEX_SEASON_EPISODE_2,
    REGEX_SEASON_EPISODE_3,
    REGEX_SEASON_EPISODE_4,
  ];

  let season = null;
  let episode = null;
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m) {
      season = parseInt(m[1], 10);
      episode = parseInt(m[2], 10);
      break;
    }
  }

  const yearMatch = normalized.match(REGEX_YEAR);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

  const cleaned = cleanTitleForGrouping(normalized);
  const titleNormalized = (cleaned || normalized)
    .replace(REGEX_SEASON_WORD, '')
    .replace(REGEX_EPISODE_WORD, '')
    .trim()
    .toLowerCase();

  return {
    season,
    episode,
    hasEpisode: season !== null && episode !== null,
    year,
    titleNormalized,
  };
}

// Cache for classify() results (LRU-like with max size)
const classifyCache = new Map();
const MAX_CLASSIFY_CACHE = 50000; // Limit cache size to avoid memory issues

function classify(name, group) {
  // Check cache first
  const cacheKey = `${name}|${group}`;
  if (classifyCache.has(cacheKey)) {
    return classifyCache.get(cacheKey);
  }

  const lowerName = name.toLowerCase();
  const lowerGroup = group.toLowerCase();

  // ===================================================================
  // PRIORITY 1: GROUP-TITLE PREFIX (Primary Classification System)
  // ===================================================================
  // Baseado na análise do M3U real: prefixos no group-title são o sistema primário de classificação

  // 1.1. LIVE - Star prefix (⭐)
  // Todos os grupos começando com "⭐" são canais ao vivo
  if (group.startsWith('⭐')) {
    classifyCache.set(cacheKey, 'live');
    return 'live';
  }

  // 1.2. SERIES - "S • " prefix
  // Grupos como "S • Netflix", "S • Legendados", etc.
  if (group.startsWith('S • ')) {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 1.3. SERIES - "Series | " prefix
  // Formato alternativo: "Series | Netflix", "Series | Legendadas", etc.
  if (group.startsWith('Series | ')) {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 1.4. SERIES - Exact match "Novelas"
  // Telenovelas brasileiras
  if (group === 'Novelas') {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 1.5. FILMS - "F • " prefix
  // Grupos como "F • Legendados", "F • Amazon Prime Video", etc.
  if (group.startsWith('F • ')) {
    classifyCache.set(cacheKey, 'movie');
    return 'movie';
  }

  // 1.6. FILMS - "Filmes | " prefix
  // Formato alternativo: "Filmes | Drama", "Filmes | Comedia", etc.
  if (group.startsWith('Filmes | ')) {
    classifyCache.set(cacheKey, 'movie');
    return 'movie';
  }

  // ===================================================================
  // PRIORITY 2: ITEM NAME PATTERNS (Secondary Classification)
  // ===================================================================
  // Apenas se group-title não matched acima

  // 2.1. 24h Loop Channels - "24H • " prefix in NAME
  // Items como "24H • 18 Outra Vez", "24H • 220 Volts", etc.
  if (name.startsWith('24H • ')) {
    classifyCache.set(cacheKey, 'live');
    return 'live';
  }

  // 2.2. Canais 24h com numeração sequencial
  // Ex: "CINE CATASTROFE 01", "DOIS HOMENS E MEIO 01"
  const is24hChannel =
    /\b24h(rs)?\b/i.test(lowerGroup) &&
    /\s\d{1,2}$/.test(name);

  // 2.3. Canais de TV com qualidade no nome
  // Ex: "A&E FHD", "AMC HD", "AXN SD", "CANAL SONY FHD [ALT]"
  const isTVChannel =
    /\b(FHD|HD|SD)\b/i.test(name) ||
    /\[ALT\]/i.test(name);

  // Se é canal (24h ou TV), classifica como 'live'
  if (is24hChannel || isTVChannel) {
    classifyCache.set(cacheKey, 'live');
    return 'live';
  }

  // 2.4. Series Episodes - SxxExx pattern
  const isSeriesTitle =
    /s\d{1,2}e\d{1,3}/i.test(lowerName) ||
    /\d{1,2}x\d{1,3}/.test(lowerName) ||
    /\b(temporada|season|epis[oó]dio|episode|ep\.)\b/i.test(lowerName);

  if (isSeriesTitle) {
    classifyCache.set(cacheKey, 'series');
    return 'series';
  }

  // 2.5. Movies with Year - (19xx) or (20xx) in name
  const hasYearMovie = /\b(19|20)\d{2}\b/.test(lowerName);
  if (hasYearMovie) {
    classifyCache.set(cacheKey, 'movie');
    return 'movie';
  }

  // ===================================================================
  // PRIORITY 3: KEYWORD FALLBACK (Last Resort)
  // ===================================================================
  // Apenas se nenhum pattern acima matched

  const isSeriesGroup =
    /\b(series?|s[eé]ries|novelas?|doramas?|animes?)\b/i.test(lowerGroup) ||
    /\b(netflix|hbo|disney|amazon|paramount|apple|star)\b/i.test(lowerGroup);

  const isLoop = isLoop24h(lowerName, lowerGroup);
  const isSports = /\b(futebol|jogos|sports?|espn|premiere|sportv|copa|libertadores)\b/i.test(lowerGroup);
  const isNews = /\b(news|cnn|bandnews|globonews)\b/i.test(lowerGroup);
  const isLiveKeywords =
    /\b(live|ao vivo|tv|canal|canais?)\b/i.test(lowerGroup) ||
    /\b(live|ao vivo|tv)\b/i.test(lowerName);

  const isMovieGroup =
    /\b(filmes?|movies?|cinema|vod)\b/i.test(lowerGroup) ||
    /\b(acao|terror|comedia|drama|ficcao|aventura|animacao|suspense|romance)\b/i.test(lowerGroup);

  // Priority for fallback
  let result;
  if (isSports || isNews || isLiveKeywords || isLoop) result = 'live';
  else if (isSeriesGroup) result = 'series';
  else if (isMovieGroup) result = 'movie';
  else result = 'unknown';

  // Cache result (with size limit)
  if (classifyCache.size >= MAX_CLASSIFY_CACHE) {
    // Remove oldest entry (first key)
    const firstKey = classifyCache.keys().next().value;
    classifyCache.delete(firstKey);
  }
  classifyCache.set(cacheKey, result);

  return result;
}

function generateItemId(url, index, tvgName = '') {
  const base = tvgName || url;
  const hash = crypto.createHash('sha256').update(base).digest('hex');
  return `${hash.substring(0, 12)}_${index}`;
}

function generateGroupId(groupTitle, mediaKind) {
  const normalized = normalizeSpaces(groupTitle).toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `group_${normalized}_${mediaKind}`;
}

// Remove emojis/prefixos visuais e normaliza para dedupe de grupos
function normalizeGroupTitle(raw = '') {
  const normalized = normalizeSpaces(
    raw
      .replace(REGEX_EMOJI_PREFIX, '') // remove emoji/prefixo no início
      .replace(REGEX_EMOJIS, '')
      .replace(REGEX_MULTI_SPACE, ' ')
  );
  // Remove sufixos de numeração e 24HRS para dedupe de canais
  return normalized
    .replace(REGEX_24H, '')
    .replace(REGEX_TRAILING_NUMBER, '') // CINE COMEDIA 01
    .replace(REGEX_NACIONAL_SUFFIX, '') // NACIONAL 01
    .replace(REGEX_MULTI_SPACE, ' ')
    .trim();
}

function isLoop24h(title = '', group = '') {
  const combined = `${title} ${group}`.toLowerCase();

  // ✅ Exceção: Se group-title contém FILMES ou SERIES, não é loop 24H
  if (/\b(filmes?|movies?|s[eé]ries?|novelas?|desenhos?)\b/i.test(group)) {
    return false;
  }

  return /\b24h\b/.test(combined) || /\b24hrs?\b/.test(combined) || /\b24 horas\b/.test(combined);
}

function parseExtinf(line) {
  const content = line.substring(8);
  const firstComma = content.indexOf(',');
  if (firstComma === -1) return null;
  const header = content.substring(0, firstComma).trim();
  const title = content.substring(firstComma + 1).trim();
  const durationMatch = header.match(/^-?\d+/);
  const duration = durationMatch ? parseInt(durationMatch[0], 10) : -1;
  const attributes = new Map();
  const attrRegex = /(\w+(?:-\w+)*)="([^"]*)"/g;
  let match;
  while ((match = attrRegex.exec(header)) !== null) {
    attributes.set(match[1], match[2]);
  }
  return { duration, attributes, title };
}

// Infer media kind using URL path hints (common in cdnp.xyz: /series/... or /movie/...)
function mediaKindFromUrl(url = '') {
  const lower = url.toLowerCase();
  if (lower.includes('/series/')) return 'series';
  if (lower.includes('/movie/')) return 'movie';
  if (lower.includes('/live/') || lower.includes('/stream/') || lower.includes('/channel/')) return 'live';
  return null;
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;

      if (error.name === 'AbortError') {
        throw new Error(`Timeout após ${FETCH_TIMEOUT_MS / 1000}s ao baixar playlist`);
      }

      logger.warn('fetch_retry', { attempt: i + 1, error: error.message, url: url.substring(0, 100) });
      await new Promise(resolve => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

// Helper: Save partial meta.json during parsing (early navigation support)
// ✅ OPTIMIZED: Only saves aggregated stats instead of full 400MB seriesIndex
async function savePartialMeta(hash, url, stats, groups, seriesIndex, status = 'in_progress') {
  try {
    const metaFile = path.join(CACHE_DIR, `${hash}.meta.json`);

    // ✅ Calculate lightweight series statistics (replaces 400MB seriesIndex)
    const seriesStats = {
      totalSeries: seriesIndex.size,
      totalEpisodes: Array.from(seriesIndex.values())
        .reduce((sum, s) => sum + s.totalEpisodes, 0),
      avgEpisodesPerSeries: seriesIndex.size > 0
        ? Math.round(Array.from(seriesIndex.values())
            .reduce((sum, s) => sum + s.totalEpisodes, 0) / seriesIndex.size)
        : 0,
    };

    const partialMeta = {
      hash,
      url,
      stats: { ...stats, groupCount: groups.size },
      groups: Array.from(groups.values()),
      seriesStats, // ✅ Only ~100 bytes vs 400MB
      parsingStatus: status, // "in_progress" or "completed"
      createdAt: Date.now(),
      expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000),
    };

    // ✅ Atomic write to prevent corruption on crashes
    const tempFile = `${metaFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(partialMeta, null, 2));
    await fs.rename(tempFile, metaFile);

    const sizeKB = (JSON.stringify(partialMeta).length / 1024).toFixed(1);
    logger.debug('partial_meta_saved', { hash, sizeKB, status });
  } catch (error) {
    logger.warn('partial_meta_failed', { hash, error: error.message });
  }
}

// ===== Series Grouping Helpers (Levenshtein Similarity) =====

/**
 * Calcula a distância de Levenshtein entre duas strings
 * Retorna o número de operações (inserção, deleção, substituição) necessárias
 */
function levenshteinDistance(s1, s2) {
  const len1 = s1.length;
  const len2 = s2.length;

  // ✅ OTIMIZADO: Usa apenas 2 arrays ao invés de matriz completa
  // Space complexity: O(min(len1, len2)) ao invés de O(len1 × len2)
  let prevRow = new Array(len2 + 1);
  let currRow = new Array(len2 + 1);

  // Inicializa primeira linha (0 a len2)
  for (let j = 0; j <= len2; j++) {
    prevRow[j] = j;
  }

  // Calcula cada linha baseado na anterior
  for (let i = 1; i <= len1; i++) {
    currRow[0] = i;
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,         // deletion
        currRow[j - 1] + 1,     // insertion
        prevRow[j - 1] + cost   // substitution
      );
    }
    // Swap: currRow vira prevRow para próxima iteração
    [prevRow, currRow] = [currRow, prevRow];
  }

  return prevRow[len2];
}

/**
 * Normaliza nome para comparação
 * Remove pontuação e sufixos de idioma
 */
function normalize(name) {
  return name
    .toLowerCase()
    .replace(/\s+(pt-br|pt|br)$/i, '')  // Remove APENAS sufixos de idioma
    .replace(/[^a-z0-9\s]/g, '')        // Remove pontuação
    .replace(/\s+/g, ' ')               // Normaliza múltiplos espaços
    .trim();
}

/**
 * Calcula similaridade entre dois nomes (0-1)
 * 1 = idênticos, 0 = completamente diferentes
 */
function calculateSimilarity(name1, name2) {
  const n1 = normalize(name1);
  const n2 = normalize(name2);

  if (n1 === n2) return 1.0;

  const distance = levenshteinDistance(n1, n2);
  const maxLen = Math.max(n1.length, n2.length);

  if (maxLen === 0) return 0;

  return 1 - (distance / maxLen);
}

/**
 * Agrupa items por similaridade de nome usando Levenshtein OTIMIZADO
 * Threshold padrão: 0.85 (85% de similaridade = mesma série)
 *
 * OTIMIZAÇÕES:
 * 1. Indexação por primeira palavra (reduz comparações em 10-50x)
 * 2. Threshold adaptativo (exact match primeiro, depois fuzzy)
 * 3. Cache de normalizações
 * 4. Early exit após N comparações sem match
 */
function groupBySimilarity(items, threshold = 0.85) {
  const groups = new Map();

  // ✅ OTIMIZAÇÃO 1: Índice por primeira palavra
  // Agrupa candidatos por primeira palavra para reduzir comparações
  const indexByFirstWord = new Map();

  // ✅ OTIMIZAÇÃO 2: Cache de normalizações
  const normalizedCache = new Map();

  function getNormalized(name) {
    if (normalizedCache.has(name)) {
      return normalizedCache.get(name);
    }
    const normalized = name
      .toLowerCase()
      .replace(/\[.*?\]/g, '')  // Remove [tags]
      .replace(/\(.*?\)/g, '')  // Remove (ano/qualidade)
      .trim();
    normalizedCache.set(name, normalized);
    return normalized;
  }

  function getFirstWord(name) {
    return name.split(/\s+/)[0] || '';
  }

  // Primeira passada: agrupamento exato por nome normalizado (RÁPIDO: O(n))
  for (const item of items) {
    const baseName = getNormalized(item.name);

    if (groups.has(baseName)) {
      groups.get(baseName).push(item);
    } else {
      groups.set(baseName, [item]);

      // Indexa por primeira palavra para fuzzy matching posterior
      const firstWord = getFirstWord(baseName);
      if (!indexByFirstWord.has(firstWord)) {
        indexByFirstWord.set(firstWord, []);
      }
      indexByFirstWord.get(firstWord).push(baseName);
    }
  }

  // Segunda passada: fuzzy matching apenas para grupos únicos (LENTO mas reduzido)
  // Só roda se threshold < 1.0 (permite fuzzy)
  if (threshold < 1.0 && groups.size > 1) {
    const singletonGroups = Array.from(groups.entries())
      .filter(([_, episodes]) => episodes.length === 1);

    // Limita fuzzy matching se houver muitos singletons (evita O(n²))
    const MAX_FUZZY_ITEMS = 5000;
    if (singletonGroups.length > MAX_FUZZY_ITEMS) {
      logger.warn('series_grouping_fuzzy_skipped', {
        singletons: singletonGroups.length,
        reason: `Excede limite de ${MAX_FUZZY_ITEMS} para fuzzy matching`
      });
    } else {
      const mergedGroups = new Map();

      for (const [groupKey, episodes] of singletonGroups) {
        if (mergedGroups.has(groupKey)) continue; // Já foi mesclado

        const firstWord = getFirstWord(groupKey);

        // ✅ OTIMIZAÇÃO 3: Só compara com grupos que têm mesma primeira palavra
        const candidates = indexByFirstWord.get(firstWord) || [];
        const MAX_COMPARISONS = 50; // Early exit após N comparações
        let comparisonCount = 0;

        for (const candidateKey of candidates) {
          if (candidateKey === groupKey) continue;
          if (mergedGroups.has(candidateKey)) continue;

          comparisonCount++;
          if (comparisonCount > MAX_COMPARISONS) break; // Early exit

          const similarity = calculateSimilarity(groupKey, candidateKey);
          if (similarity >= threshold) {
            // Mescla: adiciona episodes do grupo atual ao candidato
            const targetEpisodes = groups.get(candidateKey) || [];
            targetEpisodes.push(...episodes);
            groups.set(candidateKey, targetEpisodes);

            // Marca como mesclado
            mergedGroups.set(groupKey, candidateKey);
            groups.delete(groupKey);
            break;
          }
        }
      }

      logger.debug('series_grouping_fuzzy_complete', {
        before: groups.size + mergedGroups.size,
        after: groups.size,
        merged: mergedGroups.size
      });
    }
  }

  // Limpa cache para liberar memória
  normalizedCache.clear();

  return groups;
}

async function parseM3UStream(url, options = {}, hashOverride, progressCb) {
  const hash = hashOverride || hashPlaylist(url);
  const itemsFile = path.join(CACHE_DIR, `${hash}.ndjson`);

  logParseStart(hash, url);
  const startTime = Date.now();
  const startMem = process.memoryUsage().heapUsed;

  const response = await fetchWithRetry(url, {
    headers: { 'User-Agent': USER_AGENT },
  });

  if (!response.ok) {
    if (response.status === 404) throw new Error('Playlist não encontrada (404)');
    if (response.status === 403) throw new Error('Acesso negado (403)');
    if (response.status === 429) throw new Error('Muitas requisições (429)');
    throw new Error(`HTTP ${response.status}`);
  }

  const contentLength = response.headers.get('content-length');
  if (contentLength) {
    const sizeMb = parseInt(contentLength, 10) / (1024 * 1024);
    if (sizeMb > MAX_M3U_SIZE_MB) {
      throw new Error(`Playlist muito grande: ${sizeMb.toFixed(1)}MB`);
    }
  }

  if (!response.body) throw new Error('Response body não disponível');

  // Escreve diretamente no arquivo final para permitir pré-visualização durante o parsing
  const writer = createWriteStream(itemsFile, { encoding: 'utf8' });
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let currentExtinf = null;
  let itemIndex = 0;
  let foundHeader = false;
  const groupsMap = new Map();
  const stats = {
    totalItems: 0,
    liveCount: 0,
    movieCount: 0,
    seriesCount: 0,
    unknownCount: 0,
    groupCount: 0,
  };
  // Índice incremental de séries (franquia → temporadas → contagem de episódios)
  const seriesIndex = new Map();

  try {
    progressCb?.({ phase: 'parsing', percentage: 5, processed: 0 });

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed === '#EXTM3U') {
          foundHeader = true;
          continue;
        }
        if (trimmed.startsWith('#') && !trimmed.startsWith('#EXTINF:')) continue;
        if (trimmed.startsWith('#EXTINF:')) {
          currentExtinf = parseExtinf(trimmed);
          continue;
        }

        if (currentExtinf && trimmed.startsWith('http')) {
          // Dedup desabilitado no servidor (movido para cliente)
          // if (seenUrls && seenUrls.has(trimmed)) {
          //   currentExtinf = null;
          //   continue;
          // }

          const nameRaw = currentExtinf.title;
          const name = options.normalize ? normalizeSpaces(nameRaw) : nameRaw;
          const tvgId = currentExtinf.attributes.get('tvg-id');
          const tvgLogo = currentExtinf.attributes.get('tvg-logo');
          const xuiId = currentExtinf.attributes.get('xui-id');
          const groupTitleRaw = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
          // ✅ FIX: Remove duplicate normalizeGroupTitle call (FASE 1 optimization #1)
          const groupTitle = normalizeGroupTitle(groupTitleRaw);

          // Primeiro tenta inferir pelo path (cdnp.xyz usa /series/ e /movie/)
          const inferredKind = mediaKindFromUrl(trimmed);
          const mediaKind = inferredKind || classify(name, groupTitle);
          const parsedTitle = parseTitle(name);
          const seriesKey =
            mediaKind === 'series' && parsedTitle.titleNormalized
              ? parsedTitle.titleNormalized
              : null;

          // ✅ Declara groupId ANTES de usar
          const groupId = generateGroupId(groupTitle, mediaKind);

          const item = {
            id: generateItemId(trimmed, itemIndex++, tvgId || xuiId || name),
            name,
            url: trimmed,
            // Mantém logo original do item; não força logo canônico
            logo: tvgLogo || '',
            group: groupTitle,
            mediaKind,
            parsedTitle,
            seriesKey,
            epgId: tvgId,
            xuiId,
          };

          writer.write(`${JSON.stringify(item)}\n`);
          // Dedup desabilitado no servidor
          // if (seenUrls) seenUrls.add(trimmed);

          stats.totalItems++;
          switch (mediaKind) {
            case 'live':
              stats.liveCount++;
              break;
            case 'movie':
              stats.movieCount++;
              break;
            case 'series':
              stats.seriesCount++;
              // Agrupamento incremental por série/temporada
              if (seriesKey) {
                const entry = seriesIndex.get(seriesKey) || {
                  key: seriesKey,
                  title: parsedTitle.titleNormalized || name.toLowerCase(),
                  seasons: new Map(),
                  logo: tvgLogo,
                  totalEpisodes: 0,
                };
                const seasonNumber = parsedTitle.season || 0;
                const season = entry.seasons.get(seasonNumber) || { season: seasonNumber, episodes: 0 };
                season.episodes += 1;
                entry.seasons.set(seasonNumber, season);
                entry.totalEpisodes += 1;
                if (!entry.logo && tvgLogo) entry.logo = tvgLogo;
                seriesIndex.set(seriesKey, entry);
              }
              break;
            default:
              stats.unknownCount++;
          }

          // ✅ groupId já declarado acima (linha 474)
          const existingGroup = groupsMap.get(groupId);
          if (existingGroup) {
            existingGroup.itemCount++;
            // Apenas guarda logo se ainda vazio, sem trocar logos existentes
            if (!existingGroup.logo && tvgLogo) {
              existingGroup.logo = tvgLogo;
            }
          } else {
            groupsMap.set(groupId, {
              id: groupId,
              name: groupTitle,
              mediaKind,
              itemCount: 1,
              logo: tvgLogo || '',
            });
          }

          if (stats.totalItems % 500 === 0) {
            const pct = Math.min(80, Math.round(Math.log10(stats.totalItems + 10) * 20));
            progressCb?.({ phase: 'parsing', percentage: pct, processed: stats.totalItems });
          }

          // Flush incremental: save partial meta every 1000 items (early navigation)
          if (stats.totalItems % 1000 === 0) {
            await savePartialMeta(hash, url, stats, groupsMap, seriesIndex, 'in_progress');
            logger.debug('partial_meta_saved', { hash, items: stats.totalItems });
          }

          currentExtinf = null;
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (currentExtinf && trimmed.startsWith('http')) {
        // Dedup desabilitado no servidor (movido para cliente)
        // if (!seenUrls || !seenUrls.has(trimmed)) {
        if (true) { // Sempre processa (dedup no cliente)
          const nameRaw = currentExtinf.title;
          const name = options.normalize ? normalizeSpaces(nameRaw) : nameRaw;
          const tvgLogo = currentExtinf.attributes.get('tvg-logo');
          const xuiId = currentExtinf.attributes.get('xui-id');
          const tvgId = currentExtinf.attributes.get('tvg-id');
          const groupTitleRaw = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
          // ✅ FIX: Remove duplicate normalizeGroupTitle call (FASE 1 optimization #1)
          const groupTitle = normalizeGroupTitle(groupTitleRaw);

          const inferredKind = mediaKindFromUrl(trimmed);
          const mediaKind = inferredKind || classify(name, groupTitle);
          const parsedTitle = parseTitle(name);
          const seriesKey =
            mediaKind === 'series' && parsedTitle.titleNormalized
              ? parsedTitle.titleNormalized
              : null;

          // ✅ Declara groupId ANTES de usar (buffer final)
          const groupId = generateGroupId(groupTitle, mediaKind);

          const item = {
            id: generateItemId(trimmed, itemIndex++, tvgId || xuiId || name),
            name,
            url: trimmed,
            logo: groupsMap.get(groupId)?.logo || tvgLogo || '',
            group: groupTitle,
            mediaKind,
            parsedTitle,
            seriesKey,
            epgId: currentExtinf.attributes.get('tvg-id'),
            xuiId,
          };

          writer.write(`${JSON.stringify(item)}\n`);
          stats.totalItems++;
          if (mediaKind === 'series' && seriesKey) {
            const entry = seriesIndex.get(seriesKey) || {
              key: seriesKey,
              title: parsedTitle.titleNormalized || name.toLowerCase(),
              seasons: new Map(),
              logo: tvgLogo,
              totalEpisodes: 0,
            };
            const seasonNumber = parsedTitle.season || 0;
            const season = entry.seasons.get(seasonNumber) || { season: seasonNumber, episodes: 0 };
            season.episodes += 1;
            entry.seasons.set(seasonNumber, season);
            entry.totalEpisodes += 1;
            if (!entry.logo && tvgLogo) entry.logo = tvgLogo;
            seriesIndex.set(seriesKey, entry);
          }
        }
      }
    }

    writer.end();
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    if (!foundHeader) {
      logger.warn('parse_no_header', { hash });
    }

    // ===== FASE 2 OPTIMIZATION: Combina indexação + coleta de séries em 1 passada =====
    // Antes: 2 loops (1.7GB I/O), Depois: 1 loop (850MB I/O) = 2x mais rápido
    progressCb?.({ phase: 'indexing', percentage: 90, processed: stats.totalItems, total: stats.totalItems });

    const itemsWithoutPattern = [];
    let lineCount = 0;

    try {
      const indexFile = `${itemsFile}.idx`;
      const offsetWriter = createWriteStream(indexFile, { encoding: 'utf8' });
      const fileStream = createReadStream(itemsFile, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let currentOffset = 0;

      // ✅ SINGLE PASS: Gera índice E coleta séries sem padrão simultaneamente
      for await (const line of rl) {
        // 1. Escreve offset para índice
        offsetWriter.write(`${currentOffset}\n`);
        currentOffset += Buffer.byteLength(line, 'utf8') + 1; // +1 for \n
        lineCount++;

        // 2. Coleta séries sem padrão (se aplicável)
        if (line.trim()) {
          try {
            const item = JSON.parse(line);
            if (item.mediaKind === 'series' && !item.seriesKey) {
              itemsWithoutPattern.push(item);
            }
          } catch (parseError) {
            // Skip linha corrompida
          }
        }
      }

      rl.close();

      // Aguarda finalização do stream de índice
      await new Promise((resolve, reject) => {
        offsetWriter.end(resolve);
        offsetWriter.on('error', reject);
      });

      const indexSizeMB = (lineCount * 8) / 1024 / 1024;
      logger.info('index_and_series_collected', {
        hash,
        lines: lineCount,
        indexSizeMB: indexSizeMB.toFixed(2),
        seriesWithoutPattern: itemsWithoutPattern.length
      });
    } catch (indexError) {
      // Índice é opcional - se falhar, continua funcionando com readline
      logger.warn('index_generation_failed', {
        hash,
        error: indexError.message,
      });
    }

    stats.groupCount = groupsMap.size;
    const groups = Array.from(groupsMap.values());

    // ===== AGRUPAMENTO DE SÉRIES SEM PADRÃO (Levenshtein) =====
    logger.info('series_grouping_start', { hash });

    try {

      logger.info('series_without_pattern_collected', {
        hash,
        count: itemsWithoutPattern.length
      });

      // Agrupa por similaridade (Levenshtein) se houver items
      if (itemsWithoutPattern.length > 0) {
        const seriesGroups = groupBySimilarity(itemsWithoutPattern, 0.85);

        logger.info('series_grouping_complete', {
          hash,
          originalCount: itemsWithoutPattern.length,
          groupedCount: seriesGroups.size
        });

        // Atualiza seriesIndex com grupos encontrados
        for (const [groupKey, episodes] of seriesGroups.entries()) {
          const entry = seriesIndex.get(groupKey) || {
            key: groupKey,
            title: groupKey,
            seasons: new Map(),
            logo: episodes[0]?.logo || '',
            totalEpisodes: 0,
          };
          entry.totalEpisodes += episodes.length;
          seriesIndex.set(groupKey, entry);
        }

        logger.info('series_index_updated', {
          hash,
          totalSeriesInIndex: seriesIndex.size
        });
      }

      // ✅ OTIMIZADO: Liberar memória após agrupamento de séries
      // Força GC para liberar ~100-150MB após pico de memória
      if (itemsWithoutPattern.length > 0) {
        itemsWithoutPattern.length = 0;  // Clear array
        if (global.gc) {
          const memBefore = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          global.gc();
          const memAfter = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
          logger.debug('gc_forced', {
            phase: 'after_series_grouping',
            memBeforeMB: memBefore,
            memAfterMB: memAfter,
            freedMB: memBefore - memAfter
          });
        }
      }
    } catch (groupError) {
      logger.warn('series_grouping_failed', {
        hash,
        error: groupError.message
      });
      // Continua sem agrupar séries sem padrão
    }

    // ✅ Calculate lightweight series statistics (no need to serialize 400MB)
    const seriesStats = {
      totalSeries: seriesIndex.size,
      totalEpisodes: Array.from(seriesIndex.values())
        .reduce((sum, s) => sum + s.totalEpisodes, 0),
      avgEpisodesPerSeries: seriesIndex.size > 0
        ? Math.round(Array.from(seriesIndex.values())
            .reduce((sum, s) => sum + s.totalEpisodes, 0) / seriesIndex.size)
        : 0,
    };

    // Final flush: save complete meta with status "completed"
    await savePartialMeta(hash, url, stats, groupsMap, seriesIndex, 'completed');

    const duration = Date.now() - startTime;
    const memoryDelta = Math.round((process.memoryUsage().heapUsed - startMem) / 1024 / 1024);

    progressCb?.({ phase: 'parsed', percentage: 100, processed: stats.totalItems, total: stats.totalItems });

    logParseEnd(hash, duration, stats.totalItems, memoryDelta);

    return { stats, groups, seriesStats, hash };
  } catch (error) {
    writer.end();
    throw error;
  }
}

// ===== Worker =====

logger.info('worker_starting', {
  pid: process.pid,
  cacheDir: CACHE_DIR,
});

/**
 * Worker BullMQ com concurrency=2
 * Máximo 2 parses simultâneos = 620 MB RAM peak
 */
const worker = new Worker(
  'parse-m3u',
  async (job) => {
    const { url, hash, options } = job.data;

    logger.info('job_processing', {
      jobId: job.id,
      hash,
      attempt: job.attemptsMade + 1,
    });

    const startTime = Date.now();

    try {
      // Processa M3U
      const parsed = await parseM3UStream(url, options, hash, (progress) => {
        job.updateProgress(progress).catch(() => {});
      });

      // Salva no cache (disco + índice)
      await cacheIndex.set(hash, {
        url,
        stats: parsed.stats,
        groups: parsed.groups,
        seriesIndex: parsed.seriesSummary,
        createdAt: Date.now(),
        expiresAt: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 dias
      });

      // Remove lock de processamento
      await removeProcessingLock(hash);

      const duration = Date.now() - startTime;
      const durationSeconds = duration / 1000;

      logJobCompleted(job.id, duration);

      // Métricas
      const memoryPeakMB = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      recordParseComplete(durationSeconds, parsed.stats.totalItems, memoryPeakMB);

      // Força GC se disponível (--expose-gc)
      if (global.gc) {
        global.gc();
        logger.debug('gc_forced', { jobId: job.id });
      }

      return {
        hash,
        stats: parsed.stats,
        groups: parsed.groups,
        duration,
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      logJobFailed(job.id, error);
      recordParseFailed();

      // Remove lock mesmo em caso de erro
      await removeProcessingLock(hash);

      throw error; // BullMQ vai retentar
    }
  },
  {
    connection: redisConnection,
    concurrency: 2, // ⭐ MÁXIMO 2 parses simultâneos
    limiter: {
      max: 10, // Máximo 10 jobs por...
      duration: 60000, // ...1 minuto (rate limiting)
    },
  }
);

// ===== Event Handlers =====

worker.on('completed', (job) => {
  logger.info('worker_job_completed', {
    jobId: job.id,
    duration: job.finishedOn - job.processedOn,
    returnValue: job.returnvalue?.hash,
  });
});

worker.on('failed', (job, error) => {
  logger.error('worker_job_failed', error, {
    jobId: job?.id,
    attempt: job?.attemptsMade,
    maxAttempts: job?.opts?.attempts,
  });
});

worker.on('error', (error) => {
  logger.error('worker_error', error);
});

worker.on('active', (job) => {
  logger.debug('worker_job_active', {
    jobId: job.id,
    hash: job.data.hash,
  });
});

// ===== Health Monitoring =====

setInterval(async () => {
  const mem = process.memoryUsage();
  const queueStats = await parseQueue.getJobCounts();

  logger.metrics('worker_health_check', {
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    queue: queueStats,
    activeJobs: queueStats.active || 0,
  });

  // Alerta se heap > 80%
  const heapPercent = (mem.heapUsed / mem.heapTotal) * 100;
  if (heapPercent > 80) {
    logger.warn('worker_high_memory', { heapPercent });

    if (global.gc) {
      global.gc();
      logger.info('worker_gc_forced', { heapPercentBefore: heapPercent });
    }
  }

  // Atualiza métricas
  updateQueueMetrics(parseQueue);
}, 30000); // A cada 30s

logger.info('worker_ready', {
  concurrency: 2,
  pid: process.pid,
});
