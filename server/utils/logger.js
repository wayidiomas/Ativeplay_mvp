/**
 * Logger estruturado para logs em JSON
 * Facilita análise e debugging em produção
 */

class Logger {
  constructor(service = 'ativeplay') {
    this.service = service;
  }

  /**
   * Formata memória em MB
   */
  getMemory() {
    const mem = process.memoryUsage();
    return {
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      heapPercent: Math.round((mem.heapUsed / mem.heapTotal) * 100),
    };
  }

  /**
   * Log genérico
   */
  log(level, event, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      service: this.service,
      level,
      event,
      pid: process.pid,
      ...data,
    };

    // Em desenvolvimento, adiciona memória em todos os logs
    if (process.env.NODE_ENV !== 'production') {
      logEntry.memory = this.getMemory();
    }

    console.log(JSON.stringify(logEntry));
  }

  /**
   * Log de informação
   */
  info(event, data = {}) {
    this.log('info', event, data);
  }

  /**
   * Log de erro
   */
  error(event, error, data = {}) {
    this.log('error', event, {
      ...data,
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
  }

  /**
   * Log de warning
   */
  warn(event, data = {}) {
    this.log('warn', event, data);
  }

  /**
   * Log de debug
   */
  debug(event, data = {}) {
    if (process.env.NODE_ENV !== 'production') {
      this.log('debug', event, data);
    }
  }

  /**
   * Log de métricas (com memória sempre)
   */
  metrics(event, data = {}) {
    this.log('metrics', event, {
      ...data,
      memory: this.getMemory(),
    });
  }
}

// Singleton
export const logger = new Logger('ativeplay');

// Logs específicos para eventos comuns
export function logParseStart(hash, url) {
  logger.info('parse_start', {
    hash,
    url: url.substring(0, 100), // Trunca URL longa
    startMemory: logger.getMemory(),
  });
}

export function logParseEnd(hash, duration, itemCount, memoryDelta) {
  logger.info('parse_end', {
    hash,
    duration,
    itemCount,
    memoryDelta,
    endMemory: logger.getMemory(),
  });
}

export function logParseError(hash, error, duration) {
  logger.error('parse_error', error, {
    hash,
    duration,
  });
}

export function logCacheHit(hash, itemCount) {
  logger.info('cache_hit', {
    hash,
    itemCount,
  });
}

export function logCacheMiss(hash) {
  logger.info('cache_miss', {
    hash,
  });
}

export function logJobQueued(jobId, hash) {
  logger.info('job_queued', {
    jobId,
    hash,
  });
}

export function logJobCompleted(jobId, duration) {
  logger.info('job_completed', {
    jobId,
    duration,
  });
}

export function logJobFailed(jobId, error) {
  logger.error('job_failed', error, {
    jobId,
  });
}

export function logHealthCheck(data) {
  logger.metrics('health_check', data);
}
