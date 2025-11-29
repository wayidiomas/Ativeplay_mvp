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
import { createWriteStream, rename } from 'fs';
import { promisify } from 'util';

const renameAsync = promisify(rename);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MAX_M3U_SIZE_MB = 500;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

// ===== Helper Functions (duplicado do index.js) =====

function hashPlaylist(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function normalizeSpaces(str) {
  return str.replace(/\s+/g, ' ').trim();
}

function classify(name, group) {
  const lowerName = name.toLowerCase();
  const lowerGroup = group.toLowerCase();

  if (
    lowerGroup.includes('live') ||
    lowerGroup.includes('canais') ||
    lowerGroup.includes('tv') ||
    lowerName.match(/\b(ao vivo|live|hd|fhd|4k|canal)\b/i)
  ) {
    return 'live';
  }

  if (
    lowerGroup.includes('filme') ||
    lowerGroup.includes('movie') ||
    lowerName.match(/\b(filme|movie|cinema)\b/i)
  ) {
    return 'movie';
  }

  if (
    lowerGroup.includes('serie') ||
    lowerGroup.includes('novela') ||
    lowerGroup.includes('dorama') ||
    lowerName.match(/s\d{1,2}e\d{1,2}/i) ||
    lowerName.match(/\b(temporada|episódio|season|episode)\b/i)
  ) {
    return 'series';
  }

  return 'unknown';
}

function parseTitle(name) {
  const seasonMatch = name.match(/s(\d{1,2})e(\d{1,2})/i);
  if (seasonMatch) {
    return {
      season: parseInt(seasonMatch[1], 10),
      episode: parseInt(seasonMatch[2], 10),
      hasEpisode: true,
    };
  }
  return { season: null, episode: null, hasEpisode: false };
}

function generateItemId(url, index) {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  return `${hash.substring(0, 12)}_${index}`;
}

function generateGroupId(groupTitle, mediaKind) {
  const normalized = groupTitle.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `group_${normalized}_${mediaKind}`;
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

async function parseM3UStream(url, options = {}, hashOverride) {
  const hash = hashOverride || hashPlaylist(url);
  const itemsFile = path.join(CACHE_DIR, `${hash}.ndjson`);
  const tempFile = `${itemsFile}.tmp`;

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
        if (!seenUrls || !seenUrls.has(trimmed)) {
          const nameRaw = currentExtinf.title;
          const name = options.normalize ? normalizeSpaces(nameRaw) : nameRaw;
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
            epgId: currentExtinf.attributes.get('tvg-id'),
          };

          writer.write(`${JSON.stringify(item)}\n`);
          stats.totalItems++;
        }
      }
    }

    writer.end();
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    await renameAsync(tempFile, itemsFile);

    if (!foundHeader) {
      logger.warn('parse_no_header', { hash });
    }

    stats.groupCount = groupsMap.size;
    const groups = Array.from(groupsMap.values());

    const duration = Date.now() - startTime;
    const memoryDelta = Math.round((process.memoryUsage().heapUsed - startMem) / 1024 / 1024);

    logParseEnd(hash, duration, stats.totalItems, memoryDelta);

    return { stats, groups, hash };
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
      const parsed = await parseM3UStream(url, options, hash);

      // Salva no cache (disco + índice)
      await cacheIndex.set(hash, {
        url,
        stats: parsed.stats,
        groups: parsed.groups,
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
