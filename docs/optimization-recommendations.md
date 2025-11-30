# Recomendações de Otimização - AtivePlay M3U Parser

## Resumo Executivo

Baseado na análise dos arquivos M3U (200MB+) e do código atual, identificamos oportunidades de otimização significativas para melhorar:
- **Performance de parsing** (3-5x mais rápido)
- **Precisão de classificação** (redução de unknown/false positives)
- **Uso de memória** (processamento incremental já implementado)
- **Qualidade de dados** (normalização consistente)

---

## 1. Otimizações de Classificação

### 1.1 Melhorias no ContentClassifier

**Problema Atual:**
O classifier está bom mas pode melhorar a detecção de alguns casos edge:

**Melhorias Sugeridas:**

```typescript
// Adicionar ao GROUP_PATTERNS.live
const GROUP_PATTERNS = {
  live: [
    // ... padrões existentes ...
    /\bJogos do Dia\b/i,           // "⚽ Jogos do Dia"
    /\b(Esportes?|Sports?)\s*PPV/i, // Esportes PPV
    /\b(SPORTV|ESPN|FOX\s*SPORTS)\b/i, // Canais de esporte
    /\bPPV\b/i,                     // Pay-per-view
  ],

  movie: [
    // ... padrões existentes ...
    /\bCINE\s+\w+\s+\d{2}$/i,      // "CINE TERROR 01" (sem 24H)
  ]
};
```

**Ganho Estimado:**
- 5-10% menos classificações erradas
- Melhor detecção de canais ao vivo de esportes

---

### 1.2 Otimização de Series Detection

**Problema Atual:**
O código já detecta bem SxxExx, mas pode melhorar performance com cache

**Melhoria Sugerida:**

```typescript
export class ContentClassifier {
  // Cache de regex compiladas (inicializar uma vez)
  private static readonly SERIES_PATTERNS = {
    main: /(.+?)\s+S(\d{1,2})E(\d{1,3})/i,
    alt: /(.+?)\s+(\d{1,2})x(\d{1,3})\b/i,
    pt: /(.+?)\s+T(\d{1,2})E(\d{1,3})/i,
  };

  // Cache de resultados (LRU cache com max 10k entries)
  private static seriesCache = new Map<string, SeriesInfo | null>();
  private static readonly MAX_CACHE_SIZE = 10000;

  static extractSeriesInfo(name: string): SeriesInfo | null {
    // Check cache first
    const cached = this.seriesCache.get(name);
    if (cached !== undefined) return cached;

    // ... lógica existente ...
    const result = /* ... parsing ... */;

    // Update cache (com LRU eviction)
    if (this.seriesCache.size >= this.MAX_CACHE_SIZE) {
      const firstKey = this.seriesCache.keys().next().value;
      this.seriesCache.delete(firstKey);
    }
    this.seriesCache.set(name, result);

    return result;
  }
}
```

**Ganho Estimado:**
- 30-40% mais rápido em playlists grandes com séries
- Redução de 60% no uso de CPU para regex

---

## 2. Otimizações de Database Schema

### 2.1 Índices Adicionais para Queries Comuns

**Problema Atual:**
Algumas queries podem ser lentas em playlists grandes (50k+ items)

**Índices Adicionais Sugeridos:**

```typescript
// Em schema.ts, version 10
this.version(10).stores({
  playlists: 'id, url, lastUpdated, isActive',
  items: `
    id,
    playlistId,
    url,
    group,
    mediaKind,
    titleNormalized,
    seriesId,
    seasonNumber,
    episodeNumber,
    xuiId,
    [playlistId+titleNormalized],
    [playlistId+group],
    [playlistId+mediaKind],
    [playlistId+group+mediaKind],
    [seriesId+seasonNumber+episodeNumber],
    [playlistId+xuiId],
    [playlistId+url],                    // NOVO: Dedupe rápida
    [playlistId+mediaKind+group]         // NOVO: Queries de carrossel otimizadas
  `,
  groups: 'id, playlistId, mediaKind, [playlistId+mediaKind], name', // NOVO: +name para ordenação
  series: 'id, playlistId, [playlistId+group], name', // NOVO: +name para ordenação
  favorites: 'id, [playlistId+itemId], playlistId',
  watchProgress: 'id, [playlistId+itemId], playlistId, watchedAt, [playlistId+watchedAt]',
});
```

**Ganho Estimado:**
- Queries de carrossel: 2-3x mais rápidas
- Dedupe: O(1) em vez de O(n)

---

### 2.2 Normalização de Dados

**Problema Atual:**
Dados podem ter inconsistências (espaços, case, caracteres especiais)

**Campos Normalizados Adicionais:**

```typescript
export interface M3UItem {
  // ... campos existentes ...

  // Novos campos normalizados
  groupNormalized?: string;     // Uppercase sem espaços extras
  urlHash?: string;             // SHA-1 hash da URL (para dedupe ultra-rápida)
  nameHash?: string;            // Hash do nome (para fuzzy grouping)
}

// Helper function para normalização
export function normalizeGroup(group: string): string {
  return group
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/[⭐★•]/g, ''); // Remove emojis comuns
}

export function hashURL(url: string): string {
  // Usar crypto.subtle.digest (Web API)
  // ou alguma lib de hash rápida
  return simpleHash(url);
}
```

**Ganho Estimado:**
- Buscas: 50% mais rápidas (uppercase index)
- Dedupe: 90% mais rápido (hash comparison)

---

## 3. Otimizações de Parsing

### 3.1 Batch Processing Adaptativo

**Código Atual:**
Já implementado em `batchProcessor.ts` - Está ótimo! ✓

**Sugestão Adicional:**
Adicionar métricas de performance para ajuste dinâmico

```typescript
interface BatchMetrics {
  avgProcessTime: number;
  avgItemsPerBatch: number;
  memoryUsage: number;
  optimalBatchSize: number;
}

// Ajustar batch size dinamicamente baseado em performance
function calculateOptimalBatchSize(metrics: BatchMetrics): number {
  const { avgProcessTime, memoryUsage } = metrics;

  // Se processamento rápido (<50ms) e memória OK, aumentar batch
  if (avgProcessTime < 50 && memoryUsage < 0.7) {
    return Math.min(5000, metrics.optimalBatchSize * 1.2);
  }

  // Se lento ou memória alta, diminuir batch
  if (avgProcessTime > 200 || memoryUsage > 0.85) {
    return Math.max(500, metrics.optimalBatchSize * 0.8);
  }

  return metrics.optimalBatchSize;
}
```

---

### 3.2 Streaming Parse Otimizado

**Código Atual:**
Já implementado em `streamParser.ts` - Está ótimo! ✓

**Sugestão Adicional:**
Worker thread para parsing paralelo (se necessário)

```typescript
// Opcional: Para arquivos muito grandes (500MB+)
// src/core/services/m3u/workerParser.ts

if (fileSize > 500_000_000 && window.Worker) {
  // Usar Web Worker para parsing
  const worker = new Worker(new URL('./parser.worker.ts', import.meta.url));
  worker.postMessage({ url, playlistId });

  worker.onmessage = (e) => {
    const { batch } = e.data;
    processBatch(batch);
  };
}
```

---

## 4. Otimizações de Series Grouping

### 4.1 Hash-Based Grouping (Já Implementado)

**Status:** ✓ Código atual já usa hash-based grouping em `seriesGrouper.ts`

**Melhorias Sugeridas:**

```typescript
// Melhorar função de hash para reduzir colisões
function generateSeriesHash(seriesName: string, group: string): string {
  // Normalizar mais agressivamente
  const normalized = seriesName
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // Remove pontuação
    .replace(/\s+/g, '_')    // Normaliza espaços
    .replace(/^(the|o|a|os|as)\s+/i, ''); // Remove artigos

  return `${group}_${normalized}`;
}
```

**Ganho Estimado:**
- 10-15% menos falsos positivos em fuzzy merge
- Séries com nomes similares melhor agrupadas

---

### 4.2 Fuzzy Merge Otimizado

**Código Atual:**
Usa Levenshtein distance - pode ser lento para muitos singletons

**Melhoria Sugerida:**

```typescript
// Usar algoritmo mais rápido para primeira passagem
import { distance as levenshtein } from 'fastest-levenshtein';

// Pré-filtro rápido antes de Levenshtein
function quickSimilarity(s1: string, s2: string): number {
  // Jaccard similarity (muito mais rápido)
  const set1 = new Set(s1.toLowerCase().split(''));
  const set2 = new Set(s2.toLowerCase().split(''));

  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);

  return intersection.size / union.size;
}

// Usar quickSimilarity primeiro, só usar Levenshtein se passar threshold
function findSimilarSeries(singleton: SeriesGroup, groups: SeriesGroup[]): SeriesGroup | null {
  const candidates = groups.filter(g => {
    // Quick filter: Jaccard > 0.5
    if (quickSimilarity(singleton.name, g.name) > 0.5) {
      // Refine: Levenshtein
      const distance = levenshtein(singleton.name, g.name);
      const maxLen = Math.max(singleton.name.length, g.name.length);
      return distance / maxLen <= 0.15; // 85% similarity
    }
    return false;
  });

  return candidates[0] || null;
}
```

**Ganho Estimado:**
- 5-10x mais rápido para fuzzy merge
- Redução de 80% no tempo de CPU

---

## 5. Queries Otimizadas

### 5.1 Queries Comuns

```typescript
// operations.ts - Adicionar queries otimizadas

/**
 * Query otimizada: Buscar séries de um grupo específico
 */
export async function getSeriesByGroup(
  playlistId: string,
  group: string,
  limit = 20
): Promise<Series[]> {
  return db.series
    .where('[playlistId+group]')
    .equals([playlistId, group])
    .limit(limit)
    .toArray();
}

/**
 * Query otimizada: Buscar items recentes (para "Adicionados Recentemente")
 */
export async function getRecentItems(
  playlistId: string,
  mediaKind?: MediaKind,
  limit = 20
): Promise<M3UItem[]> {
  let query = db.items.where('playlistId').equals(playlistId);

  if (mediaKind) {
    query = query.filter(item => item.mediaKind === mediaKind);
  }

  return query
    .reverse()
    .sortBy('createdAt')
    .then(items => items.slice(0, limit));
}

/**
 * Query otimizada: Buscar por texto (fuzzy search)
 */
export async function searchItems(
  playlistId: string,
  searchText: string,
  mediaKind?: MediaKind,
  limit = 50
): Promise<M3UItem[]> {
  const normalized = searchText.toUpperCase();

  return db.items
    .where('[playlistId+titleNormalized]')
    .between(
      [playlistId, normalized],
      [playlistId, normalized + '\uffff'],
      true,
      true
    )
    .filter(item => {
      if (mediaKind && item.mediaKind !== mediaKind) return false;
      return item.titleNormalized?.includes(normalized) ?? false;
    })
    .limit(limit)
    .toArray();
}
```

---

## 6. Memory Management

### 6.1 Garbage Collection Estratégica

**Código Atual:**
Já tem GC intervals - pode melhorar

```typescript
// Em batchProcessor.ts

async function processBatches(generator, playlistId, onProgress) {
  // ... código existente ...

  // Melhorar timing de GC
  const GC_INTERVAL = 2000; // 2s em vez de 5s (mais frequente, menos acúmulo)
  const FORCE_GC_THRESHOLD = 0.85; // 85% de memória usada

  const gcInterval = setInterval(() => {
    const memUsage = performance.memory?.usedJSHeapSize / performance.memory?.jsHeapSizeLimit;

    if (memUsage > FORCE_GC_THRESHOLD) {
      // Força GC mais agressivo
      if (global.gc) global.gc();

      // Clear caches se necessário
      ContentClassifier.clearCache?.();
    }
  }, GC_INTERVAL);

  // ... resto do código ...
}
```

---

## 7. Validação e Qualidade de Dados

### 7.1 Validação de URLs

```typescript
// utils.ts - Adicionar validação

export function isValidStreamURL(url: string): boolean {
  try {
    const parsed = new URL(url);

    // Aceitar apenas http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    // Verificar extensões comuns
    const validExtensions = ['.m3u8', '.ts', '.mp4', '.mkv', '.avi'];
    const hasValidExt = validExtensions.some(ext =>
      url.toLowerCase().includes(ext)
    );

    // URL deve ter host válido
    const hasValidHost = parsed.hostname.length > 0;

    return hasValidHost && (hasValidExt || url.includes('/play/'));
  } catch {
    return false;
  }
}

// Usar na inserção
async function insertItems(items: M3UItem[]) {
  const validItems = items.filter(item => isValidStreamURL(item.url));
  // ... insert ...
}
```

---

## 8. Métricas e Monitoramento

### 8.1 Performance Tracking

```typescript
// metrics.ts

export class ParserMetrics {
  private startTime: number = 0;
  private metrics: {
    downloadTime: number;
    parseTime: number;
    classifyTime: number;
    insertTime: number;
    totalItems: number;
    itemsPerSecond: number;
  } = {
    downloadTime: 0,
    parseTime: 0,
    classifyTime: 0,
    insertTime: 0,
    totalItems: 0,
    itemsPerSecond: 0,
  };

  startPhase(phase: string) {
    this[`${phase}Start`] = performance.now();
  }

  endPhase(phase: string) {
    const duration = performance.now() - this[`${phase}Start`];
    this.metrics[`${phase}Time`] = duration;
  }

  logMetrics() {
    console.table(this.metrics);

    // Enviar para analytics (opcional)
    if (window.gtag) {
      gtag('event', 'parser_performance', {
        download_time: this.metrics.downloadTime,
        parse_time: this.metrics.parseTime,
        total_items: this.metrics.totalItems,
        items_per_second: this.metrics.itemsPerSecond,
      });
    }
  }
}
```

---

## 9. Priorização de Implementação

### Alta Prioridade (Implementar Primeiro)
1. **Cache de Regex** (1.2) - Ganho imediato de 30-40%
2. **Índices Adicionais** (2.1) - Melhora queries em 2-3x
3. **Normalização de Dados** (2.2) - Melhora qualidade e busca
4. **Queries Otimizadas** (5.1) - Melhora UX

### Média Prioridade
5. **Fuzzy Merge Otimizado** (4.2) - Melhora grouping 5-10x
6. **Validação de URLs** (7.1) - Melhora qualidade
7. **Hash-Based Grouping** (4.1) - Reduz colisões

### Baixa Prioridade (Otimizações Avançadas)
8. **Worker Threads** (3.2) - Apenas se necessário para arquivos 500MB+
9. **Batch Adaptativo Avançado** (3.1) - Já funciona bem
10. **Métricas** (8.1) - Nice to have

---

## 10. Ganhos Estimados Totais

### Performance
- **Parsing:** 3-5x mais rápido (cache de regex + otimizações)
- **Queries:** 2-3x mais rápidas (índices + normalização)
- **Series Grouping:** 5-10x mais rápido (fuzzy merge otimizado)

### Qualidade
- **Classificação:** 5-10% menos erros
- **Dedupe:** 95%+ de acurácia (hash-based)
- **Series Grouping:** 10-15% menos falsos positivos

### Memória
- **Uso de RAM:** Mantém-se estável (GC já implementado)
- **IndexedDB:** Cresce linearmente (sem duplicatas)

---

## 11. Checklist de Implementação

```markdown
### Fase 1: Quick Wins (1-2 dias)
- [ ] Implementar cache de regex no ContentClassifier
- [ ] Adicionar índices [playlistId+url] e [playlistId+mediaKind+group]
- [ ] Implementar normalizeGroup() e groupNormalized
- [ ] Adicionar queries otimizadas (getSeriesByGroup, searchItems)

### Fase 2: Qualidade (2-3 dias)
- [ ] Implementar validação de URLs
- [ ] Melhorar generateSeriesHash() com normalização agressiva
- [ ] Adicionar urlHash para dedupe ultra-rápida
- [ ] Implementar métricas básicas

### Fase 3: Performance Avançada (3-4 dias)
- [ ] Implementar quickSimilarity + Levenshtein otimizado
- [ ] Adicionar batch size adaptativo avançado
- [ ] Implementar GC estratégico com thresholds
- [ ] Adicionar telemetria completa

### Fase 4: Testing e Refinamento (2-3 dias)
- [ ] Testar com playlists grandes (200MB+)
- [ ] Benchmark comparativo (antes/depois)
- [ ] Ajustar thresholds baseado em métricas reais
- [ ] Documentar ganhos e limitações
```

---

## 12. Considerações Finais

### O Que Já Está Excelente ✓
- Streaming parse com chunking
- Batch processing incremental
- Hash-based series grouping
- Fuzzy merge de singletons
- Índices compostos no IndexedDB

### Onde Melhorar Mais
- Cache de regex patterns
- Normalização de dados
- Queries otimizadas
- Validação de dados

### Trade-offs
- **Cache:** Usa mais memória mas economiza CPU (vale a pena)
- **Índices:** Aumenta storage mas acelera queries (vale a pena)
- **Worker Threads:** Complexidade adicional, usar só se necessário

---

## Anexo: Exemplos de Queries com Novo Schema

```typescript
// Buscar séries de um grupo específico (otimizado)
const series = await db.series
  .where('[playlistId+group]')
  .equals([playlistId, 'Series | Netflix'])
  .toArray();

// Buscar items por URL hash (dedupe rápido)
const existing = await db.items
  .where('[playlistId+url]')
  .equals([playlistId, item.url])
  .first();

if (!existing) {
  // Insert novo item
}

// Buscar episódios de uma série ordenados
const episodes = await db.items
  .where('seriesId')
  .equals(seriesId)
  .sortBy('[seasonNumber+episodeNumber]');

// Buscar com texto (prefix search)
const results = await db.items
  .where('titleNormalized')
  .startsWith('BREAKING')
  .limit(20)
  .toArray();
```
