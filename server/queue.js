/**
 * BullMQ Queue Setup
 * Fila de jobs para processamento de playlists M3U
 */

import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { logger } from './utils/logger.js';

// ===== Configuração Redis =====

/**
 * Conexão Redis (Railway fornece REDIS_URL automaticamente)
 * Formato: redis://user:password@host:port
 */
const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL || 'redis://localhost:6379';

export const redisConnection = new Redis(REDIS_URL, {
  maxRetriesPerRequest: null, // BullMQ requer null
  enableReadyCheck: false,
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    logger.warn('redis_retry', { attempt: times, delay });
    return delay;
  },
});

redisConnection.on('connect', () => {
  logger.info('redis_connected', { url: REDIS_URL.replace(/:[^:@]+@/, ':****@') });
});

redisConnection.on('error', (error) => {
  logger.error('redis_error', error);
});

redisConnection.on('ready', () => {
  logger.info('redis_ready');
});

// ===== BullMQ Queue =====

/**
 * Fila de processamento de playlists M3U
 */
export const parseQueue = new Queue('parse-m3u', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3, // Tenta até 3x em caso de falha
    backoff: {
      type: 'exponential',
      delay: 5000, // 5s, 10s, 20s
    },
    removeOnComplete: {
      age: 24 * 60 * 60, // Remove jobs completados após 24h
      count: 1000, // Mantém no máximo 1000 jobs completados
    },
    removeOnFail: {
      age: 7 * 24 * 60 * 60, // Remove jobs falhados após 7 dias
    },
  },
});

parseQueue.on('error', (error) => {
  logger.error('queue_error', error);
});

// ===== Helper Functions =====

/**
 * Verifica se Redis está conectado
 */
export async function isRedisConnected() {
  try {
    const pong = await redisConnection.ping();
    return pong === 'PONG';
  } catch (error) {
    return false;
  }
}

/**
 * Obtém lock de processamento para um hash
 * Retorna jobId se já está sendo processado, null caso contrário
 */
export async function getProcessingLock(hash) {
  try {
    const lockKey = `processing:${hash}`;
    const existingJobId = await redisConnection.get(lockKey);
    return existingJobId;
  } catch (error) {
    logger.error('get_lock_error', error, { hash });
    return null;
  }
}

/**
 * Define lock de processamento para um hash (atomic SETNX)
 * TTL de 30 minutos (playlists grandes)
 * Retorna true se lock foi setado, false se já existia
 */
export async function setProcessingLock(hash, jobId) {
  try {
    const lockKey = `processing:${hash}`;
    // NX = Set if Not Exists (atomic operation para evitar race condition)
    const result = await redisConnection.set(lockKey, jobId, 'EX', 1800, 'NX'); // 30 minutos

    if (result === 'OK') {
      logger.debug('lock_set', { hash, jobId });
      return true;
    } else {
      logger.warn('lock_already_exists', { hash, jobId });
      return false;
    }
  } catch (error) {
    logger.error('set_lock_error', error, { hash, jobId });
    return false;
  }
}

/**
 * Remove lock de processamento
 */
export async function removeProcessingLock(hash) {
  try {
    const lockKey = `processing:${hash}`;
    await redisConnection.del(lockKey);
    logger.debug('lock_removed', { hash });
    return true;
  } catch (error) {
    logger.error('remove_lock_error', error, { hash });
    return false;
  }
}

/**
 * Obtém estatísticas da fila
 */
export async function getQueueStats() {
  try {
    const counts = await parseQueue.getJobCounts();
    return {
      waiting: counts.waiting || 0,
      active: counts.active || 0,
      completed: counts.completed || 0,
      failed: counts.failed || 0,
      delayed: counts.delayed || 0,
      paused: counts.paused || 0,
    };
  } catch (error) {
    logger.error('queue_stats_error', error);
    return {
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    };
  }
}

/**
 * Limpa jobs antigos (manutenção)
 */
export async function cleanOldJobs() {
  try {
    // Remove jobs completados com mais de 24h
    const completedRemoved = await parseQueue.clean(24 * 60 * 60 * 1000, 1000, 'completed');

    // Remove jobs falhados com mais de 7 dias
    const failedRemoved = await parseQueue.clean(7 * 24 * 60 * 60 * 1000, 1000, 'failed');

    logger.info('jobs_cleaned', {
      completedRemoved: completedRemoved.length,
      failedRemoved: failedRemoved.length,
    });

    return {
      completedRemoved: completedRemoved.length,
      failedRemoved: failedRemoved.length,
    };
  } catch (error) {
    logger.error('clean_jobs_error', error);
    return { completedRemoved: 0, failedRemoved: 0 };
  }
}

// Limpa jobs antigos 1x por dia
setInterval(cleanOldJobs, 24 * 60 * 60 * 1000);

logger.info('queue_initialized', {
  redisUrl: REDIS_URL.replace(/:[^:@]+@/, ':****@'),
});
