/**
 * Device Detection & Adaptive Batch Configuration
 * FASE 2: Detecta tipo de device e retorna configurações otimizadas
 *
 * Smart TVs: Batch sizes menores + GC mais frequente (memória limitada)
 * Browsers: Batch sizes maiores + GC menos frequente (memória abundante)
 * Mobile: Configuração intermediária
 */

export type DeviceType = 'smarttv' | 'browser' | 'mobile';

export interface BatchConfig {
  itemBatchSize: number;      // Items per bulkPut (100-1000)
  gcInterval: number;          // Batches before forcing GC (5-10)
  seriesChunkSize: number;     // Series grouping chunk size
  maxConcurrentFetches: number; // Max parallel fetches
}

/**
 * Detecta tipo de device baseado no User-Agent
 * @returns DeviceType ('smarttv', 'browser', ou 'mobile')
 */
export function detectDeviceType(): DeviceType {
  const ua = navigator.userAgent;

  // Smart TV detection (LG WebOS, Samsung Tizen, Sony BRAVIA, etc)
  if (
    ua.includes('WebOS') ||         // LG webOS
    ua.includes('Web0S') ||          // LG webOS (typo variant)
    ua.includes('Tizen') ||          // Samsung Tizen
    ua.includes('NetCast') ||        // LG NetCast (older)
    ua.includes('SmartTV') ||        // Generic Smart TV
    ua.includes('BRAVIA') ||         // Sony BRAVIA
    ua.includes('HbbTV') ||          // Hybrid broadcast broadband TV
    /\bTV\b/.test(ua)                // Generic TV marker
  ) {
    return 'smarttv';
  }

  // Mobile detection (smartphones, but NOT tablets)
  if (
    /Android|iPhone|iPod/i.test(ua) &&
    !/Tablet|iPad/i.test(ua)  // Tablets use browser config (more RAM)
  ) {
    return 'mobile';
  }

  // Default: Desktop/Laptop browser
  return 'browser';
}

/**
 * Obtém informações de memória JavaScript disponível
 * Funciona apenas em Chrome/Edge (performance.memory API)
 *
 * @returns Memória disponível e total (em MB), ou null se não suportado
 */
export function getMemoryInfo(): {
  available: number;  // MB livres
  total: number;      // MB totais
  used: number;       // MB usados
} | null {
  // Chrome/Edge only - performance.memory
  if ('memory' in performance) {
    const mem = (performance as any).memory;
    return {
      available: (mem.jsHeapSizeLimit - mem.usedJSHeapSize) / 1024 / 1024,
      total: mem.jsHeapSizeLimit / 1024 / 1024,
      used: mem.usedJSHeapSize / 1024 / 1024,
    };
  }
  return null;
}

/**
 * Retorna configuração de batch otimizada para o device
 * Ajusta dinamicamente baseado em memória disponível (se disponível)
 *
 * @param deviceType - Tipo de device (opcional, auto-detecta se omitido)
 * @returns BatchConfig com parâmetros otimizados
 */
export function getBatchConfig(deviceType?: DeviceType): BatchConfig {
  const type = deviceType || detectDeviceType();

  const configs: Record<DeviceType, BatchConfig> = {
    // Smart TV: MUITO conservador (512MB-1GB RAM típico)
    smarttv: {
      itemBatchSize: 250,          // Menor batch = menos memória por ciclo
      gcInterval: 5,               // GC a cada 5 batches (~1250 items)
      seriesChunkSize: 10000,      // Processa series em chunks menores
      maxConcurrentFetches: 2,     // Limita fetches paralelos
    },

    // Mobile: Intermediário (2-4GB RAM típico)
    mobile: {
      itemBatchSize: 400,
      gcInterval: 8,               // GC a cada 8 batches (~3200 items)
      seriesChunkSize: 20000,
      maxConcurrentFetches: 3,
    },

    // Desktop/Browser: Agressivo (8GB+ RAM típico)
    browser: {
      itemBatchSize: 1000,         // Batch grande = menos DB writes
      gcInterval: 10,              // GC a cada 10 batches (~10000 items)
      seriesChunkSize: 50000,      // Processa tudo de uma vez
      maxConcurrentFetches: 5,     // Max paralelismo
    },
  };

  const config = { ...configs[type] };

  // ✅ AJUSTE DINÂMICO: Reduz batch se memória estiver baixa
  const memInfo = getMemoryInfo();
  if (memInfo) {
    console.log(
      `[Device] Memória: ${memInfo.used.toFixed(0)}MB usados / ${memInfo.total.toFixed(0)}MB total (${memInfo.available.toFixed(0)}MB livres)`
    );

    // Se memória disponível < 200MB: modo emergency (reduz batch pela metade)
    if (memInfo.available < 200) {
      console.warn(
        `[Device] ⚠️ Memória baixa (${memInfo.available.toFixed(0)}MB), reduzindo batch size e aumentando GC`
      );
      config.itemBatchSize = Math.floor(config.itemBatchSize / 2);
      config.gcInterval = Math.max(3, Math.floor(config.gcInterval / 2)); // Min 3
    }

    // Se memória disponível < 100MB: modo critical (reduz ainda mais)
    else if (memInfo.available < 100) {
      console.error(
        `[Device] 🚨 MEMÓRIA CRÍTICA (${memInfo.available.toFixed(0)}MB), batch mínimo`
      );
      config.itemBatchSize = 100;  // Mínimo absoluto
      config.gcInterval = 3;        // GC a cada 3 batches
      config.maxConcurrentFetches = 1; // Serial fetching
    }
  }

  console.log(`[Device] Tipo: ${type.toUpperCase()}, Config:`, config);

  return config;
}

/**
 * Força garbage collection se disponível
 * NOTA: Requer flag --expose-gc no Node.js ou Chrome DevTools "Enable GC"
 */
export function forceGC(): void {
  if (globalThis.gc) {
    globalThis.gc();
    console.log('[Device] Garbage collection forçado');
  }
}
