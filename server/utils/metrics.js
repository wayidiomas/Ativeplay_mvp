/**
 * Métricas Prometheus para observabilidade
 */

import promClient from 'prom-client';

// Habilita métricas default (CPU, memória, event loop, GC, etc)
promClient.collectDefaultMetrics({
  timeout: 5000,
  prefix: 'ativeplay_',
});

// ===== Métricas Customizadas =====

/**
 * Counter: Total de parses por status
 */
export const parseCounter = new promClient.Counter({
  name: 'ativeplay_playlist_parses_total',
  help: 'Total de parses processados',
  labelNames: ['status'], // success, failed, cached, queued
});

/**
 * Histogram: Tempo de parse em segundos
 */
export const parseDuration = new promClient.Histogram({
  name: 'ativeplay_playlist_parse_duration_seconds',
  help: 'Tempo de parse em segundos',
  buckets: [5, 10, 30, 60, 120, 300, 600], // 5s até 10min
});

/**
 * Histogram: Tamanho de playlists em número de itens
 */
export const playlistSize = new promClient.Histogram({
  name: 'ativeplay_playlist_size_items',
  help: 'Número de itens na playlist',
  buckets: [100, 1000, 10000, 50000, 100000, 500000, 1000000],
});

/**
 * Gauge: Pico de memória durante parse (MB)
 */
export const parseMemoryPeak = new promClient.Gauge({
  name: 'ativeplay_playlist_parse_memory_peak_mb',
  help: 'Pico de memória durante parse (MB)',
});

/**
 * Gauge: Tamanho atual da fila de jobs
 */
export const queueSize = new promClient.Gauge({
  name: 'ativeplay_queue_size',
  help: 'Tamanho atual da fila de jobs',
  labelNames: ['state'], // waiting, active, completed, failed
});

/**
 * Gauge: Número de entries no cache
 */
export const cacheEntries = new promClient.Gauge({
  name: 'ativeplay_cache_entries',
  help: 'Número de playlists no cache',
});

/**
 * Gauge: Uso de disco do cache em MB
 */
export const cacheDiskUsage = new promClient.Gauge({
  name: 'ativeplay_cache_disk_usage_mb',
  help: 'Uso de disco do cache em MB',
});

/**
 * Counter: Rate limit hits
 */
export const rateLimitHits = new promClient.Counter({
  name: 'ativeplay_rate_limit_hits_total',
  help: 'Total de requests bloqueadas por rate limit',
  labelNames: ['endpoint'],
});

/**
 * Gauge: Conexões Redis ativas
 */
export const redisConnections = new promClient.Gauge({
  name: 'ativeplay_redis_connections',
  help: 'Número de conexões Redis ativas',
});

// ===== Funções Helper =====

/**
 * Atualiza métricas da fila
 */
export async function updateQueueMetrics(queue) {
  try {
    const counts = await queue.getJobCounts();
    queueSize.set({ state: 'waiting' }, counts.waiting || 0);
    queueSize.set({ state: 'active' }, counts.active || 0);
    queueSize.set({ state: 'completed' }, counts.completed || 0);
    queueSize.set({ state: 'failed' }, counts.failed || 0);
  } catch (error) {
    // Ignora erros (Redis pode estar offline)
  }
}

/**
 * Atualiza métricas do cache
 */
export function updateCacheMetrics(cacheIndex, diskUsageMB) {
  cacheEntries.set(cacheIndex.size || 0);
  cacheDiskUsage.set(diskUsageMB || 0);
}

/**
 * Registra parse completo
 */
export function recordParseComplete(durationSeconds, itemCount, memoryPeakMB) {
  parseCounter.inc({ status: 'success' });
  parseDuration.observe(durationSeconds);
  playlistSize.observe(itemCount);
  parseMemoryPeak.set(memoryPeakMB);
}

/**
 * Registra parse falhou
 */
export function recordParseFailed() {
  parseCounter.inc({ status: 'failed' });
}

/**
 * Registra cache hit
 */
export function recordCacheHit() {
  parseCounter.inc({ status: 'cached' });
}

/**
 * Registra job enfileirado
 */
export function recordJobQueued() {
  parseCounter.inc({ status: 'queued' });
}

/**
 * Registra rate limit hit
 */
export function recordRateLimitHit(endpoint) {
  rateLimitHits.inc({ endpoint });
}

/**
 * Exporta métricas (para endpoint /metrics)
 */
export async function getMetrics() {
  return await promClient.register.metrics();
}

/**
 * Retorna content type das métricas
 */
export function getMetricsContentType() {
  return promClient.register.contentType;
}
