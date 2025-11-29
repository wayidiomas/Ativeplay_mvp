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
const MAX_M3U_SIZE_MB = 500;
const FETCH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutos

// ===== Helper Functions (duplicado do index.js) =====

function hashPlaylist(url) {
  return crypto.createHash('sha1').update(url).digest('hex');
}

function normalizeSpaces(str = '') {
  return str.replace(/\s+/g, ' ').trim();
}

// Remove ruídos comuns de títulos (qualidade, idioma, tags de release)
function cleanTitleForGrouping(title = '') {
  return title
    .replace(/\b(4k|2160p|1080p|720p|480p|360p|uhd|fhd|hd|sd)\b/gi, '')
    .replace(/\b(hevc|x264|x265|h264|h265|web-?dl|webrip|bluray|bdrip|hdrip|dvdrip|cam|ts|hdcam)\b/gi, '')
    .replace(/\b(dub|dublado|dubbed|dual|multi|legendado|leg|sub|subbed|nacional|ptbr|pt-br)\b/gi, '')
    .replace(/[|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTitle(name) {
  const normalized = normalizeSpaces(name);

  // Regex variados para S/E
  const patterns = [
    /s(\d{1,2})e(\d{1,3})/i,
    /(\d{1,2})x(\d{1,3})/i,
    /temporada\s*(\d{1,2}).*epis[oó]dio\s*(\d{1,3})/i,
    /t(\d{1,2})[\s._-]*e(\d{1,3})/i,
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

  const yearMatch = normalized.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? parseInt(yearMatch[0], 10) : null;

  const cleaned = cleanTitleForGrouping(normalized);
  const titleNormalized = (cleaned || normalized)
    .replace(/\b(s|season|temporada)\s*\d{1,2}\b/gi, '')
    .replace(/\b(e|epis[oó]dio|episode)\s*\d{1,3}\b/gi, '')
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

function classify(name, group) {
  const lowerName = name.toLowerCase();
  const lowerGroup = group.toLowerCase();

  // Sinais fortes de série
  const isSeriesTitle =
    /s\d{1,2}e\d{1,3}/i.test(lowerName) ||
    /\d{1,2}x\d{1,3}/.test(lowerName) ||
    /\b(temporada|season|epis[oó]dio|episode|ep\.)\b/i.test(lowerName);
  const isSeriesGroup =
    /\b(series?|s[eé]ries|novelas?|doramas?|animes?)\b/i.test(lowerGroup) ||
    /\b(netflix|hbo|disney|amazon|paramount|apple|star)\b/i.test(lowerGroup);

  // Canais/loop 24h
  const isLoop = isLoop24h(lowerName, lowerGroup);
  const isSports = /\b(futebol|jogos|sports?|espn|premiere|sportv|copa|libertadores)\b/i.test(lowerGroup);
  const isNews = /\b(news|cnn|bandnews|globonews)\b/i.test(lowerGroup);
  const isLiveKeywords =
    /\b(live|ao vivo|tv|canal|canais?)\b/i.test(lowerGroup) ||
    /\b(live|ao vivo|tv)\b/i.test(lowerName);

  // Filmes
  const isMovieGroup =
    /\b(filmes?|movies?|cinema|vod)\b/i.test(lowerGroup) ||
    /\b(acao|terror|comedia|drama|ficcao|aventura|animacao|suspense|romance)\b/i.test(lowerGroup);
  const hasYearMovie = /\b(19|20)\d{2}\b/.test(lowerName);

  // Prioridade
  if (isLoop || isSports || isNews || isLiveKeywords) return 'live';
  if (isSeriesGroup || isSeriesTitle) return 'series';
  if (isMovieGroup || hasYearMovie) return 'movie';

  return 'unknown';
}

function generateItemId(url, index) {
  const hash = crypto.createHash('sha256').update(url).digest('hex');
  return `${hash.substring(0, 12)}_${index}`;
}

function generateGroupId(groupTitle, mediaKind) {
  const normalized = normalizeSpaces(groupTitle).toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `group_${normalized}_${mediaKind}`;
}

// Remove emojis/prefixos visuais e normaliza para dedupe de grupos
function normalizeGroupTitle(raw = '') {
  return normalizeSpaces(
    raw
      .replace(/^[^\w]+/u, '') // remove emoji/prefixo no início
      .replace(/[•◆★⭐⚽🎬🎥📺🎵]+/g, '')
      .replace(/\s{2,}/g, ' ')
  );
}

function isLoop24h(title = '', group = '') {
  const t = `${title} ${group}`.toLowerCase();
  return /\b24h\b/.test(t) || /\b24hrs?\b/.test(t) || /\b24 horas\b/.test(t);
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

async function parseM3UStream(url, options = {}, hashOverride, progressCb) {
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
          const groupTitleRaw = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
          const groupTitle = options.normalize
            ? normalizeGroupTitle(groupTitleRaw)
            : normalizeGroupTitle(groupTitleRaw);

          const mediaKind = classify(name, groupTitle);
          const parsedTitle = parseTitle(name);
          const seriesKey =
            mediaKind === 'series' && parsedTitle.titleNormalized
              ? parsedTitle.titleNormalized
              : null;

          const item = {
            id: generateItemId(trimmed, itemIndex++),
            name,
            url: trimmed,
            logo: tvgLogo,
            group: groupTitle,
            mediaKind,
            parsedTitle,
            seriesKey,
            epgId: tvgId,
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

          if (stats.totalItems % 500 === 0) {
            const pct = Math.min(80, Math.round(Math.log10(stats.totalItems + 10) * 20));
            progressCb?.({ phase: 'parsing', percentage: pct, processed: stats.totalItems });
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
          const groupTitleRaw = currentExtinf.attributes.get('group-title') || 'Sem Grupo';
          const groupTitle = options.normalize
            ? normalizeGroupTitle(groupTitleRaw)
            : normalizeGroupTitle(groupTitleRaw);

          const mediaKind = classify(name, groupTitle);
          const parsedTitle = parseTitle(name);
          const seriesKey =
            mediaKind === 'series' && parsedTitle.titleNormalized
              ? parsedTitle.titleNormalized
              : null;

          const item = {
            id: generateItemId(trimmed, itemIndex++),
            name,
            url: trimmed,
            logo: tvgLogo,
            group: groupTitle,
            mediaKind,
            parsedTitle,
            seriesKey,
            epgId: currentExtinf.attributes.get('tvg-id'),
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

    await renameAsync(tempFile, itemsFile);

    if (!foundHeader) {
      logger.warn('parse_no_header', { hash });
    }

    // ===== GERA ÍNDICE DE BYTE OFFSETS =====
    // Permite seek direto por linha (offset=225k → 50ms ao invés de 800ms)
    progressCb?.({ phase: 'indexing', percentage: 90, processed: stats.totalItems, total: stats.totalItems });

    try {
      const indexFile = `${itemsFile}.idx`;
      const offsets = [];

      const fileStream = createReadStream(itemsFile, { encoding: 'utf8' });
      const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

      let currentOffset = 0;
      for await (const line of rl) {
        offsets.push(currentOffset);
        currentOffset += Buffer.byteLength(line, 'utf8') + 1; // +1 for \n
      }

      rl.close();

      // Salva índice como JSON array
      await fs.writeFile(indexFile, JSON.stringify(offsets));

      const indexSizeMB = (offsets.length * 8) / 1024 / 1024; // 8 bytes por offset (number)
      logger.info('index_generated', {
        hash,
        lines: offsets.length,
        indexSizeMB: indexSizeMB.toFixed(2),
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

    // Serializa índice de séries de forma compacta (sem Maps)
    const seriesSummary = Array.from(seriesIndex.values()).map((entry) => ({
      key: entry.key,
      title: entry.title,
      logo: entry.logo,
      totalEpisodes: entry.totalEpisodes,
      seasons: Array.from(entry.seasons.values()),
    }));

    const duration = Date.now() - startTime;
    const memoryDelta = Math.round((process.memoryUsage().heapUsed - startMem) / 1024 / 1024);

    progressCb?.({ phase: 'parsed', percentage: 100, processed: stats.totalItems, total: stats.totalItems });

    logParseEnd(hash, duration, stats.totalItems, memoryDelta);

    return { stats, groups, seriesSummary, hash };
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
