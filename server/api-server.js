/**
 * AtivePlay API Server (Worker Pool Architecture)
 * API leve que enfileira jobs de parsing no Redis/BullMQ
 * Worker separado processa os jobs (worker.js)
 */

import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { createHash, randomBytes } from 'crypto';
import { networkInterfaces } from 'os';
import { createWriteStream, createReadStream, promises as fs } from 'fs';
import path from 'path';
import readline from 'readline';
import rateLimit from 'express-rate-limit';
import { finished } from 'stream/promises';

// Worker Pool imports
import { cacheIndex } from './services/cacheIndex.js';
import {
  parseQueue,
  isRedisConnected,
  getProcessingLock,
  setProcessingLock,
  getQueueStats,
  redisConnection,
} from './queue.js';
import { logger, logCacheHit, logCacheMiss, logJobQueued } from './utils/logger.js';
import {
  getMetrics,
  getMetricsContentType,
  recordCacheHit,
  recordJobQueued,
  recordRateLimitHit,
  updateQueueMetrics,
  updateCacheMetrics,
} from './utils/metrics.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Parsing/cache config
const PARSE_CACHE_TTL_MS = parseInt(process.env.PARSE_CACHE_TTL_MS || '600000', 10); // 10min
const MAX_M3U_SIZE_MB = parseInt(process.env.MAX_M3U_SIZE_MB || '200', 10); // limite de Content-Length
const MAX_ITEMS_PAGE = parseInt(process.env.MAX_ITEMS_PAGE || '5000', 10);
const FETCH_TIMEOUT_MS = parseInt(process.env.FETCH_TIMEOUT_MS || '300000', 10); // 300s (5min) - para servidores IPTV lentos
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10); // Retry com backoff
const USER_AGENT = process.env.USER_AGENT || 'AtivePlay-Server/1.0';
const CACHE_DIR = process.env.PARSE_CACHE_DIR || path.join(process.cwd(), '.parse-cache');

await fs.mkdir(CACHE_DIR, { recursive: true });

/**
 * Detecta IP local da máquina na rede
 */
function getLocalIP() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Pula endereços internos e não IPv4
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

function hashPlaylist(url) {
  return createHash('sha1').update(url).digest('hex');
}

function isHttpUrl(urlString) {
  try {
    const parsed = new URL(urlString);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function normalizeSpaces(value = '') {
  return value.replace(/\s+/g, ' ').trim();
}

function generateItemId(url, index) {
  const hash = url.split('').reduce((acc, char) => ((acc << 5) - acc + char.charCodeAt(0)) | 0, 0);
  return `item_${Math.abs(hash)}_${index}`;
}

function generateGroupId(name, mediaKind) {
  const safeName = name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  return `group_${safeName}_${mediaKind}`;
}

// Regras de classificação (espelhadas do client)
const GROUP_PATTERNS = {
  live: [
    /\b(canais?|channels?|tv|live|24\/7|sports?|news|ao vivo|abertos?)\b/i,
    /\b(globo|sbt|record|band|redetv|cultura)\b/i,
  ],
  movie: [
    /\b(filmes?|movies?|cinema|lancamentos?|lançamentos?)\b/i,
    /\bvod\b/i,
    /\b(acao|terror|comedia|drama|ficcao|aventura|animacao|suspense|romance)\b/i,
    /\b(dublado|legendado|dual|nacional)\b/i,
    /\b(4k|uhd|fhd|hd)\s*(filmes?|movies?)?\b/i,
    /[:\|]\s*(filmes?|movies?|vod)/i,
    /\|\s*br\s*\|\s*(filmes?|movies?|vod)/i,
    /\[\s*br\s*\]\s*(filmes?|movies?|vod)/i,
  ],
  series: [
    /\b(series?|shows?|novelas?|animes?|doramas?|k-?dramas?)\b/i,
    /\b(netflix|hbo|amazon|disney|apple|paramount|star)\b/i,
    /\btemporadas?\b/i,
    /s[eé]ries?/i,
    /[:\|]\s*s[eé]ries?/i,
    /\|\s*br\s*\|\s*s[eé]ries?/i,
    /\[\s*br\s*\]\s*s[eé]ries?/i,
  ],
};

const TITLE_PATTERNS = {
  live: [/\b(24\/7|24h|live|ao vivo)\b/i],
  movie: [
    /\(\d{4}\)/,
    /\[\d{4}\]/,
    /\b(20[0-2]\d|19\d{2})\b/,
    /\b(4k|2160p|1080p|720p|480p|bluray|webrip|hdrip|dvdrip|hdcam|web-dl|bdrip|hdts|hd-ts|cam|hdcam)\b/i,
    /\b(dublado|dual|leg|legendado|nacional|dub|sub)\b/i,
    /\b(acao|terror|comedia|drama|suspense|romance|aventura|animacao|ficcao)\b/i,
  ],
  series: [
    /s\d{1,2}[\s._-]?e\d{1,2}/i,
    /\b\d{1,2}x\d{1,2}\b/i,
    /\bT\d{1,2}[\s._-]?E\d{1,2}\b/i,
    /\btemporada\s*\d+/i,
    /\bepisodio\s*\d+/i,
    /\bseason\s*\d+/i,
    /\bepisode\s*\d+/i,
    /\bcap[ií]tulo\s*\d+/i,
    /\bep\.?\s*\d+/i,
  ],
};

const TITLE_EXTRACTORS = {
  year: /[\(\[](\d{4})[\)\]]/,
  yearStandalone: /\b(19|20)\d{2}\b/,
  season: /(?:s|season|temporada)[\s._-]?(\d{1,2})/i,
  episode: /(?:e|episode|episodio)[\s._-]?(\d{1,3})/i,
  seasonEpisode: /s(\d{1,2})[\s._-]?e(\d{1,3})/i,
  altSeasonEpisode: /(\d{1,2})x(\d{1,3})/i,
  quality: /\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|sd)\b/i,
  multiAudio: /\b(dual|multi|dublado\s*e\s*legendado)\b/i,
  dubbed: /\b(dub|dublado|dubbed|nacional)\b/i,
  subbed: /\b(leg|legendado|subbed|sub)\b/i,
  language: /\b(pt|por|ptbr|pt-br|en|eng|es|esp|fr|fra|de|deu|it|ita|ja|jpn)\b/i,
};

function classifyByGroup(group) {
  if (!group) return 'unknown';
  const lowerGroup = group.toLowerCase();
  for (const pattern of GROUP_PATTERNS.series) if (pattern.test(lowerGroup)) return 'series';
  for (const pattern of GROUP_PATTERNS.movie) if (pattern.test(lowerGroup)) return 'movie';
  for (const pattern of GROUP_PATTERNS.live) if (pattern.test(lowerGroup)) return 'live';
  return 'unknown';
}

function classifyByTitle(name) {
  if (!name) return 'unknown';
  for (const pattern of TITLE_PATTERNS.series) if (pattern.test(name)) return 'series';
  let movieScore = 0;
  for (const pattern of TITLE_PATTERNS.movie) if (pattern.test(name)) movieScore++;
  if (movieScore >= 1) return 'movie';
  for (const pattern of TITLE_PATTERNS.live) if (pattern.test(name)) return 'live';
  return 'unknown';
}

function classify(name, group) {
  const groupKind = classifyByGroup(group);
  if (groupKind !== 'unknown') return groupKind;
  return classifyByTitle(name);
}

function cleanTitle(title) {
  return title
    .replace(/[\[\(][^\]\)]*[\]\)]/g, '')
    .replace(/\b(4k|2160p|1080p|720p|480p|360p|hd|fhd|uhd|sd)\b/gi, '')
    .replace(/\b(aac|ac3|dts|x264|x265|hevc|h264|h265|webdl|web-dl|bluray|bdrip|webrip|hdrip|dvdrip|hdcam)\b/gi, '')
    .replace(/\b(dub|dublado|dubbed|leg|legendado|subbed|sub|dual|multi|nacional)\b/gi, '')
    .replace(/[|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\-_]+$/, '')
    .trim();
}

/**
 * Faz fetch com retry e backoff exponencial
 * Útil para contornar rate limiting (429) e timeouts temporários
 */
async function fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // Cria novo signal de timeout para cada tentativa
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (attempt > 0) {
        console.log(`[Fetch] Sucesso após retry ${attempt}/${retries}`);
      }

      // Se 429 (rate limit), tenta novamente com backoff
      if (response.status === 429 && attempt < retries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000); // Max 10s
        console.log(`[Fetch] Rate limited (429). Retry ${attempt + 1}/${retries} em ${backoffMs}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }

      return response;
    } catch (error) {
      lastError = error;

      // Se timeout ou erro de rede, tenta novamente
      if (attempt < retries) {
        const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
        console.log(`[Fetch] Erro: ${error.message}. Retry ${attempt + 1}/${retries} em ${backoffMs}ms`);
        await new Promise(resolve => setTimeout(resolve, backoffMs));
        continue;
      }
    }
  }

  // Todas as tentativas falharam
  throw lastError;
}

function parseTitle(name) {
  let title = name;
  let year;
  let season;
  let episode;
  let quality;
  let language;
  const isMultiAudio = TITLE_EXTRACTORS.multiAudio.test(name);
  const isDubbed = TITLE_EXTRACTORS.dubbed.test(name);
  const isSubbed = TITLE_EXTRACTORS.subbed.test(name);

  const yearMatch = name.match(TITLE_EXTRACTORS.year);
  if (yearMatch) {
    year = parseInt(yearMatch[1], 10);
    title = title.replace(yearMatch[0], '').trim();
  } else {
    const yearStandalone = name.match(TITLE_EXTRACTORS.yearStandalone);
    if (yearStandalone) {
      const potentialYear = parseInt(yearStandalone[0], 10);
      if (potentialYear >= 1900 && potentialYear <= new Date().getFullYear() + 1) {
        year = potentialYear;
      }
    }
  }

  const seMatch = name.match(TITLE_EXTRACTORS.seasonEpisode);
  if (seMatch) {
    season = parseInt(seMatch[1], 10);
    episode = parseInt(seMatch[2], 10);
    title = title.replace(seMatch[0], '').trim();
  } else {
    const altMatch = name.match(TITLE_EXTRACTORS.altSeasonEpisode);
    if (altMatch) {
      season = parseInt(altMatch[1], 10);
      episode = parseInt(altMatch[2], 10);
      title = title.replace(altMatch[0], '').trim();
    } else {
      const seasonMatch = name.match(TITLE_EXTRACTORS.season);
      if (seasonMatch) season = parseInt(seasonMatch[1], 10);
      const episodeMatch = name.match(TITLE_EXTRACTORS.episode);
      if (episodeMatch) episode = parseInt(episodeMatch[1], 10);
    }
  }

  const qualityMatch = name.match(TITLE_EXTRACTORS.quality);
  if (qualityMatch) {
    quality = qualityMatch[1].toUpperCase();
    title = title.replace(qualityMatch[0], '').trim();
  }

  const langMatch = name.match(TITLE_EXTRACTORS.language);
  if (langMatch) language = langMatch[1].toUpperCase();

  title = cleanTitle(title);

  return {
    title,
    year,
    season,
    episode,
    quality,
    language,
    isMultiAudio,
    isDubbed,
    isSubbed,
  };
}

function parseExtinf(line) {
  if (!line.startsWith('#EXTINF:')) return null;
  const content = line.substring(8);
  const firstComma = content.indexOf(',');
  if (firstComma === -1) return null;
  const header = content.substring(0, firstComma);
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

async function parseM3UStream(url, options = {}, hashOverride) {
  const hash = hashOverride || hashPlaylist(url);
  const itemsFile = path.join(CACHE_DIR, `${hash}.ndjson`);
  const tempFile = `${itemsFile}.tmp`;

  console.log('[Parse] Iniciando parse', {
    url,
    hash,
    normalize: !!options.normalize,
    removeDuplicates: options.removeDuplicates !== false,
  });

  // fetchWithRetry já cria signal de timeout internamente
  const response = await fetchWithRetry(url, {
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    // Mensagens de erro mais amigáveis
    if (response.status === 404) {
      throw new Error('Playlist não encontrada (404). Verifique se a URL está correta.');
    }
    if (response.status === 403) {
      throw new Error('Acesso negado (403). A playlist pode exigir autenticação.');
    }
    if (response.status === 429) {
      throw new Error('Muitas requisições (429). Servidor do M3U está limitando acessos. Tente novamente em alguns minutos.');
    }
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
    if (contentLength) {
      const sizeMb = parseInt(contentLength, 10) / (1024 * 1024);
      if (sizeMb > MAX_M3U_SIZE_MB) {
        throw new Error(`Playlist muito grande: ${sizeMb.toFixed(1)}MB (limite ${MAX_M3U_SIZE_MB}MB)`);
      }
  }

  if (!response.body) {
    throw new Error('Response body não disponível');
  }

  const writer = createWriteStream(tempFile, { encoding: 'utf8' });
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
  const seenUrls = options.removeDuplicates === false ? null : new Set();

  try {
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
          if (seenUrls && seenUrls.has(trimmed)) {
            currentExtinf = null;
            continue;
          }

          const nameRaw = currentExtinf.title;
          const name = options.normalize ? normalizeSpaces(nameRaw) : nameRaw;
          const tvgId = currentExtinf.attributes.get('tvg-id');
          const tvgLogo = currentExtinf.attributes.get('tvg-logo');
          const groupTitleRaw = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
          const groupTitle = options.normalize ? normalizeSpaces(groupTitleRaw) : groupTitleRaw;

          const mediaKind = classify(name, groupTitle);
          const parsedTitle = parseTitle(name);

          const item = {
            id: generateItemId(trimmed, itemIndex++),
            name,
            url: trimmed,
            logo: tvgLogo,
            group: groupTitle,
            mediaKind,
            parsedTitle,
            epgId: tvgId,
          };

          writer.write(`${JSON.stringify(item)}\n`);
          if (seenUrls) seenUrls.add(trimmed);

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
              break;
            default:
              stats.unknownCount++;
          }

          const groupId = generateGroupId(groupTitle, mediaKind);
          const existingGroup = groupsMap.get(groupId);
          if (existingGroup) {
            existingGroup.itemCount++;
          } else {
            groupsMap.set(groupId, {
              id: groupId,
              name: groupTitle,
              mediaKind,
              itemCount: 1,
              logo: tvgLogo,
            });
          }

          currentExtinf = null;
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (currentExtinf && trimmed.startsWith('http')) {
        if (!(seenUrls && seenUrls.has(trimmed))) {
          const nameRaw = currentExtinf.title;
          const name = options.normalize ? normalizeSpaces(nameRaw) : nameRaw;
          const tvgId = currentExtinf.attributes.get('tvg-id');
          const tvgLogo = currentExtinf.attributes.get('tvg-logo');
          const groupTitleRaw = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
          const groupTitle = options.normalize ? normalizeSpaces(groupTitleRaw) : groupTitleRaw;
          const mediaKind = classify(name, groupTitle);
          const parsedTitle = parseTitle(name);
          const item = {
            id: generateItemId(trimmed, itemIndex++),
            name,
            url: trimmed,
            logo: tvgLogo,
            group: groupTitle,
            mediaKind,
            parsedTitle,
            epgId: tvgId,
          };
          writer.write(`${JSON.stringify(item)}\n`);
          if (seenUrls) seenUrls.add(trimmed);
        }
      }
    }

    if (!foundHeader) {
      throw new Error('Formato de playlist inválido (falta #EXTM3U)');
    }

    const groups = Array.from(groupsMap.values());
    stats.groupCount = groups.length;

    writer.end();
    await finished(writer);
    await fs.rename(tempFile, itemsFile);

    console.log('[Parse] Finalizado', {
      hash,
      totalItems: stats.totalItems,
      groups: stats.groupCount,
      file: itemsFile,
    });

    return { itemsFile, groups, stats, hash };
  } catch (error) {
    writer.destroy();
    await fs.rm(tempFile, { force: true }).catch(() => {});
    throw error;
  }
}

// Cache-First: sem jobs em memória, usa cacheIndex (disco) que sobrevive a restarts

// Sessões em Redis (TTL)
const SESSION_TTL_SECONDS = 15 * 60; // 15 minutos
const SESSION_PREFIX = 'session:';

async function createSession(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  await redisConnection.set(
    key,
    JSON.stringify({
      url: null,
      createdAt: Date.now(),
    }),
    'EX',
    SESSION_TTL_SECONDS
  );
}

async function setSessionUrl(sessionId, url) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  const value = await redisConnection.get(key);
  if (!value) return false;
  const session = JSON.parse(value);
  session.url = url;
  await redisConnection.set(key, JSON.stringify(session), 'EX', SESSION_TTL_SECONDS);
  return true;
}

async function getSession(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  const value = await redisConnection.get(key);
  return value ? JSON.parse(value) : null;
}

async function deleteSession(sessionId) {
  const key = `${SESSION_PREFIX}${sessionId}`;
  await redisConnection.del(key);
}

app.use(cors());
app.use(express.json());

// ===== Rate Limiting =====

/**
 * Rate limiter para /api/playlist/parse
 * Anônimo: 5 requests/min | Autenticado: 20 requests/min
 */
const parseRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5, // 5 requests por minuto
  message: { error: 'Limite de requests excedido. Aguarde 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // TODO: Se implementar auth, usar req.user?.id
    return req.ip || 'unknown';
  },
  handler: (req, res) => {
    recordRateLimitHit('/api/playlist/parse');
    res.status(429).json({
      error: 'Limite de requests excedido. Aguarde 1 minuto.',
      retryAfter: 60,
    });
  },
});

// ===== Health Check & Metrics =====

app.get('/', async (req, res) => {
  const redisOk = await isRedisConnected();
  const queueStats = await getQueueStats();

  res.json({
    service: 'AtivePlay API Server',
    version: '2.0.0',
    architecture: 'Worker Pool',
    status: redisOk ? 'online' : 'degraded',
    redis: redisOk,
    queue: queueStats,
    cache: {
      entries: cacheIndex.size,
    },
    activeSessions: sessions.size,
  });
});

/**
 * GET /health - Health check avançado
 */
app.get('/health', async (req, res) => {
  const mem = process.memoryUsage();
  const redisOk = await isRedisConnected();
  const queueStats = await getQueueStats();

  const health = {
    status: redisOk ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime()),
    memory: {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    },
    queue: queueStats,
    redis: redisOk,
    cache: {
      entries: cacheIndex.size,
    },
  };

  // Atualiza métricas
  updateQueueMetrics(parseQueue);

  // Mesmo se Redis estiver indisponível, responder 200 para não derrubar healthcheck
  res.json(health);
});

/**
 * GET /metrics - Prometheus metrics
 */
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', getMetricsContentType());
    const metrics = await getMetrics();
    res.end(metrics);
  } catch (error) {
    logger.error('metrics_error', error);
    res.status(500).end();
  }
});

/**
 * POST /api/playlist/parse
 * Worker Pool Architecture:
 * - Cache hit → retorna imediatamente
 * - Cache miss → enfileira job e retorna jobId para polling
 * - Dedupe: se hash já está processando, retorna jobId existente
 */
app.post('/api/playlist/parse', parseRateLimiter, async (req, res) => {
  try {
    const { url, options = {} } = req.body || {};

    if (!url || typeof url !== 'string' || !isHttpUrl(url)) {
      return res.status(400).json({ success: false, error: 'URL inválida' });
    }

    const hash = hashPlaylist(url);

    // 1. Cache hit → retorna imediatamente
    const cached = await cacheIndex.get(hash);
    if (cached) {
      const itemsPath = path.join(CACHE_DIR, `${hash}.ndjson`);
      try {
        await fs.access(itemsPath);
        logCacheHit(hash, cached.stats?.totalItems || 0);
        recordCacheHit();

        return res.json({
          success: true,
          cached: true,
          hash,
          data: {
            stats: cached.stats,
            groups: cached.groups,
          },
        });
      } catch (error) {
        logger.warn('cache_inconsistent', { hash });
        await cacheIndex.delete(hash);
      }
    }

    // 2. Verifica se JÁ está sendo processado (dedupe por hash)
    const activeJobId = await getProcessingLock(hash);
    if (activeJobId) {
      logger.info('parse_already_processing', { hash, jobId: activeJobId });

      return res.json({
        success: true,
        queued: true,
        jobId: activeJobId,
        hash,
        message: 'Esta playlist já está sendo processada. Use o jobId para acompanhar o progresso.',
      });
    }

    // 3. Cache miss: enfileira job
    logCacheMiss(hash);

    const job = await parseQueue.add('parse-m3u', {
      url,
      hash,
      options: {
        normalize: options.normalize !== false,
        removeDuplicates: options.removeDuplicates !== false,
      },
    });

    // Marca hash como "em processamento" (atomic SETNX)
    const lockSet = await setProcessingLock(hash, job.id);

    if (!lockSet) {
      // Race condition: outro job já está processando este hash
      // Remove job duplicado que acabamos de criar
      await job.remove();

      // Retorna jobId do job que está realmente processando
      const activeJobId = await getProcessingLock(hash);
      logger.info('parse_race_condition_detected', { hash, duplicateJobId: job.id, activeJobId });

      return res.json({
        success: true,
        queued: true,
        jobId: activeJobId,
        hash,
        message: 'Esta playlist já está sendo processada. Use o jobId para acompanhar o progresso.',
      });
    }

    logJobQueued(job.id, hash);
    recordJobQueued();

    return res.json({
      success: true,
      queued: true,
      jobId: job.id,
      hash,
      message: 'Playlist enfileirada para processamento. Use GET /api/jobs/:jobId para acompanhar.',
    });

  } catch (error) {
    logger.error('parse_endpoint_error', error);

    res.status(500).json({
      success: false,
      error: 'Erro ao processar request. Tente novamente.',
    });
  }
});

/**
 * GET /api/jobs/:jobId
 * Polling endpoint para acompanhar status de job
 * Estados: waiting, active, completed, failed, delayed
 */
app.get('/api/jobs/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await parseQueue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job não encontrado',
        message: 'Job pode ter expirado ou não existe.',
      });
    }

    const state = await job.getState();

    // Job completado
    if (state === 'completed') {
      const result = job.returnvalue;

      return res.json({
        status: 'completed',
        jobId: job.id,
        data: {
          hash: result.hash,
          stats: result.stats,
          groups: result.groups,
        },
        duration: job.finishedOn - job.processedOn,
        completedAt: job.finishedOn,
      });
    }

    // Job falhou
    if (state === 'failed') {
      return res.json({
        status: 'failed',
        jobId: job.id,
        error: job.failedReason || 'Erro desconhecido',
        attempts: job.attemptsMade,
        failedAt: job.failedOn,
      });
    }

    // Job em processamento/aguardando
    const queuePosition = state === 'waiting' ? await getQueuePosition(job) : null;

    return res.json({
      status: state, // waiting, active, delayed
      jobId: job.id,
      progress: job.progress || 0,
      queuePosition,
      createdAt: job.timestamp,
    });

  } catch (error) {
    logger.error('jobs_endpoint_error', error, { jobId: req.params.jobId });

    res.status(500).json({
      error: 'Erro ao buscar status do job',
    });
  }
});

/**
 * Helper: Calcula posição na fila
 */
async function getQueuePosition(job) {
  try {
    const waiting = await parseQueue.getWaiting();
    const index = waiting.findIndex(j => j.id === job.id);
    return index === -1 ? null : index + 1;
  } catch (error) {
    return null;
  }
}


/**
 * Helper: Lê items do NDJSON usando índice (rápido) ou readline (fallback)
 * @param {string} itemsPath - Caminho do arquivo .ndjson
 * @param {number} offset - Linha inicial
 * @param {number} limit - Quantidade de linhas a ler
 * @returns {Promise<Array>} Items parseados
 */
async function readItemsWithIndex(itemsPath, offset, limit) {
  const indexPath = `${itemsPath}.idx`;

  // Tenta usar índice para seek direto (RÁPIDO: 50ms para offset=225k)
  try {
    const indexData = await fs.readFile(indexPath, 'utf8');
    const offsets = JSON.parse(indexData);

    // ✅ VALIDAÇÕES
    if (!Array.isArray(offsets)) {
      throw new Error('Índice inválido: não é array');
    }

    if (offsets.length === 0) {
      throw new Error('Índice vazio');
    }

    if (offsets[0] !== 0) {
      throw new Error('Índice corrompido: primeiro offset deve ser 0');
    }

    // Calcula byte range
    const startByte = offsets[offset];
    const endByte = offsets[Math.min(offset + limit, offsets.length - 1)] || offsets[offsets.length - 1];

    if (startByte === undefined) {
      // Offset maior que total de linhas
      return [];
    }

    // ✅ BUFFER DINÂMICO baseado no tamanho médio das linhas
    const avgLineSize = Math.ceil((endByte - startByte) / limit);
    const bufferMargin = Math.max(5000, avgLineSize * 2); // Margem dinâmica
    const bytesToRead = endByte - startByte + bufferMargin;

    // Lê apenas os bytes necessários (seek direto!)
    const fileHandle = await fs.open(itemsPath, 'r');
    const buffer = Buffer.allocUnsafe(bytesToRead);
    const { bytesRead } = await fileHandle.read(buffer, 0, bytesToRead, startByte);
    await fileHandle.close();

    // ✅ Parse com bytesRead real
    const content = buffer.toString('utf8', 0, bytesRead);
    const lines = content.split('\n').filter(Boolean);
    const items = [];

    for (let i = 0; i < Math.min(limit, lines.length); i++) {
      try {
        items.push(JSON.parse(lines[i]));
      } catch (parseError) {
        console.warn('[Items] JSON inválido na linha', i, parseError.message);
        // Continua para próxima linha
      }
    }

    console.log('[Items] Usando índice (RÁPIDO)', { offset, limit, returned: items.length });
    return items;

  } catch (indexError) {
    // Fallback: usa readline (LENTO: 800ms para offset=225k)
    console.log('[Items] Índice não encontrado, usando readline (LENTO)', { offset });

    const fileStream = createReadStream(itemsPath, { encoding: 'utf8' });
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    const items = [];
    let index = 0;

    for await (const line of rl) {
      if (index >= offset && items.length < limit) {
        try {
          items.push(JSON.parse(line));
        } catch (error) {
          console.warn('[Items] Linha inválida no cache, pulando');
        }
      }
      index++;
      if (items.length >= limit) break;
    }

    rl.close();
    return items;
  }
}

/**
 * GET /api/playlist/items/:hash
 * Retorna itens paginados de uma playlist já parseada
 */
app.get('/api/playlist/items/:hash', async (req, res) => {
  const { hash } = req.params;
  const cached = await cacheIndex.get(hash);

  if (!cached) {
    return res.status(404).json({ error: 'Playlist não encontrada ou cache expirado' });
  }

  const limit = Math.min(parseInt(req.query.limit || `${MAX_ITEMS_PAGE}`, 10), MAX_ITEMS_PAGE);
  const offset = parseInt(req.query.offset || '0', 10);

  try {
    const itemsPath = path.join(CACHE_DIR, `${hash}.ndjson`);
    const items = await readItemsWithIndex(itemsPath, offset, limit);

    console.log('[Items] Página servida', { hash, offset, limit, returned: items.length, total: cached.stats?.totalItems });

    res.json({
      items,
      total: cached.stats?.totalItems || 0,
      limit,
      offset,
    });
  } catch (error) {
    console.error('[Items] Erro ao ler cache:', error);
    res.status(500).json({ error: 'Erro ao ler cache de itens' });
  }
});

/**
 * GET /api/playlist/items/:hash/partial
 * Retorna apenas os primeiros N items de uma playlist (para early navigation)
 * Usado para carregar mínimo viável antes de navegar para /home
 */
app.get('/api/playlist/items/:hash/partial', async (req, res) => {
  const { hash } = req.params;
  const cached = await cacheIndex.get(hash);

  if (!cached) {
    return res.status(404).json({ error: 'Playlist não encontrada ou cache expirado' });
  }

  // Limite máximo de 5000 items, padrão 1000
  const limit = Math.min(parseInt(req.query.limit || '1000', 10), 5000);

  try {
    const itemsPath = path.join(CACHE_DIR, `${hash}.ndjson`);
    const items = await readItemsWithIndex(itemsPath, 0, limit); // offset=0 para partial

    console.log('[Items Partial] Primeiros items servidos', {
      hash,
      limit,
      returned: items.length,
      total: cached.stats?.totalItems || 0
    });

    res.json({
      items,
      total: cached.stats?.totalItems || 0,
      loaded: items.length,
      partial: true,
    });
  } catch (error) {
    console.error('[Items Partial] Erro ao ler cache:', error);
    res.status(500).json({ error: 'Erro ao ler cache de itens' });
  }
});

/**
 * POST /session/create
 * Cria nova sessão e retorna QR code + sessionId
 */
app.post('/session/create', async (req, res) => {
  try {
    const sessionId = randomBytes(6).toString('hex'); // 12 caracteres
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutos

    // URL que será aberta no celular
    // Em produção usa BASE_URL (Render), em dev usa IP local
    const localIP = getLocalIP();
    const baseUrl = process.env.BASE_URL || `http://${localIP}:${PORT}`;
    const mobileUrl = `${baseUrl}/s/${sessionId}`;

    // Cria sessão em Redis
    await createSession(sessionId);

    // Gera QR code como Data URL
    const qrDataUrl = await QRCode.toDataURL(mobileUrl, {
      width: 300,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#FFFFFF',
      },
    });

    console.log(`[Session] Criada: ${sessionId} (expira em 5min)`);

    res.json({
      sessionId,
      qrDataUrl,
      mobileUrl,
      expiresAt,
    });
  } catch (error) {
    console.error('[Session] Erro ao criar:', error);
    res.status(500).json({ error: 'Erro ao criar sessão' });
  }
});

/**
 * GET /session/:id/poll
 * TV consulta periodicamente se recebeu URL
 */
app.get('/session/:id/poll', (req, res) => {
  const { id } = req.params;
  // Poll síncrono usando Redis
  getSession(id).then((session) => {
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada ou expirada' });
    }

    if (session.url) {
      console.log(`[Session] URL recebida pela TV: ${id}`);
      const url = session.url;
      deleteSession(id).catch(() => {});
      return res.json({ url, received: true });
    }

    return res.json({ url: null, received: false });
  }).catch((error) => {
    logger.error('session_poll_error', error, { id });
    res.status(500).json({ error: 'Erro ao buscar sessão' });
  });
});

/**
 * POST /session/:id/send
 * Celular envia URL da playlist
 */
app.post('/session/:id/send', (req, res) => {
  const { id } = req.params;
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'URL inválida' });
  }

  getSession(id).then(async (session) => {
    if (!session) {
      return res.status(404).json({ error: 'Sessão não encontrada ou expirada' });
    }

    await setSessionUrl(id, url);
    console.log(`[Session] URL enviada pelo celular: ${id}`);
    res.json({ success: true, message: 'URL enviada com sucesso!' });
  }).catch((error) => {
    logger.error('session_send_error', error, { id });
    res.status(500).json({ error: 'Erro ao enviar URL' });
  });
});

/**
 * GET /s/:id
 * Página mobile para enviar URL
 */
app.get('/s/:id', (req, res) => {
  const { id } = req.params;
  getSession(id).then((session) => {
    if (!session) {
      return res.send(`
      <!DOCTYPE html>
      <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>AtivePlay - Sessão Expirada</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
            color: white;
            text-align: center;
          }
          .container {
            max-width: 400px;
          }
          h1 { font-size: 3em; margin: 0; }
          p { font-size: 1.2em; opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⏰</h1>
          <p>Sessão expirada ou inválida</p>
          <p style="font-size: 0.9em;">Escaneie novamente o QR code na TV</p>
        </div>
      </body>
      </html>
    `);
  }

    res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AtivePlay - Enviar Playlist</title>
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 20px;
        }
        .container {
          background: white;
          border-radius: 20px;
          padding: 30px;
          max-width: 400px;
          width: 100%;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .logo {
          text-align: center;
          margin-bottom: 24px;
        }
        .logo h1 {
          color: #667eea;
          font-size: 2em;
          margin-bottom: 8px;
        }
        .logo p {
          color: #666;
          font-size: 0.9em;
        }
        label {
          display: block;
          color: #333;
          font-weight: 600;
          margin-bottom: 8px;
        }
        input {
          width: 100%;
          padding: 14px;
          border: 2px solid #e0e0e0;
          border-radius: 10px;
          font-size: 16px;
          transition: border-color 0.3s;
        }
        input:focus {
          outline: none;
          border-color: #667eea;
        }
        button {
          width: 100%;
          padding: 16px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          border: none;
          border-radius: 10px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
          margin-top: 16px;
          transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover {
          transform: translateY(-2px);
          box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
        }
        button:active {
          transform: translateY(0);
        }
        button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
          transform: none;
        }
        .status {
          margin-top: 16px;
          padding: 12px;
          border-radius: 10px;
          text-align: center;
          font-weight: 500;
          display: none;
        }
        .status.success {
          background: #d4edda;
          color: #155724;
          display: block;
        }
        .status.error {
          background: #f8d7da;
          color: #721c24;
          display: block;
        }
        .hint {
          margin-top: 16px;
          padding: 12px;
          background: #f8f9fa;
          border-radius: 10px;
          font-size: 0.85em;
          color: #666;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">
          <h1>📺 AtivePlay</h1>
          <p>Envie sua playlist para a TV</p>
        </div>

        <form id="playlistForm">
          <label for="url">URL da Playlist M3U</label>
          <input
            type="url"
            id="url"
            name="url"
            placeholder="https://exemplo.com/playlist.m3u"
            required
            autocomplete="off"
            autocapitalize="off"
          />

          <button type="submit" id="submitBtn">
            Enviar para TV
          </button>
        </form>

        <div id="status" class="status"></div>

        <div class="hint">
          💡 Cole a URL da sua playlist IPTV e envie para sua TV
        </div>
      </div>

      <script>
        const form = document.getElementById('playlistForm');
        const input = document.getElementById('url');
        const submitBtn = document.getElementById('submitBtn');
        const status = document.getElementById('status');

        form.addEventListener('submit', async (e) => {
          e.preventDefault();

          const url = input.value.trim();
          if (!url) return;

          // Desabilita form
          submitBtn.disabled = true;
          submitBtn.textContent = 'Enviando...';
          status.className = 'status';
          status.style.display = 'none';

          try {
            const response = await fetch('/session/${id}/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ url }),
            });

            const data = await response.json();

            if (response.ok) {
              status.className = 'status success';
              status.textContent = '✅ ' + data.message;
              submitBtn.textContent = '✓ Enviado!';
              input.value = '';

              // Reabilita após 2s
              setTimeout(() => {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Enviar outra URL';
              }, 2000);
            } else {
              throw new Error(data.error || 'Erro ao enviar');
            }
          } catch (error) {
            status.className = 'status error';
            status.textContent = '❌ ' + error.message;
            submitBtn.disabled = false;
            submitBtn.textContent = 'Tentar novamente';
          }
        });
      </script>
    </body>
    </html>
  `);
  });
});

app.listen(PORT, async () => {
  const localIP = getLocalIP();
  console.log(`🚀 AtivePlay Bridge rodando na porta ${PORT}`);
  console.log(`📱 URL local: http://${localIP}:${PORT}`);
  console.log(`📱 URL base: ${process.env.BASE_URL || `http://${localIP}:${PORT}`}`);

  // Carrega índice do cache ao iniciar (sobrevive a server restarts)
  await cacheIndex.load();
  console.log(`📦 Cache: ${cacheIndex.size} playlists disponíveis`);
});
