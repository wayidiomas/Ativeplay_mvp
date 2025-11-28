# PRD: Worker Improvement - Otimização de Carregamento de Playlists

> **Status:** Planejado
> **Prioridade:** P0 - Crítico para UX
> **Estimativa:** 10-16 horas de implementação

---

## 1. Visão Geral

### Problema Atual
O carregamento de playlists grandes (200K-300K itens) bloqueia a thread principal por vários segundos, causando:
- UI congelada durante o parsing
- Progress bar travada
- Experiência ruim em Smart TVs com hardware limitado
- Potencial timeout em dispositivos mais lentos

### Objetivo
Otimizar o pipeline de carregamento de playlists para:
- Manter UI responsiva durante todo o processo
- Reduzir tempo de carregamento percebido
- Melhorar performance em dispositivos com recursos limitados
- Permitir cancelamento do carregamento

---

## 2. Arquitetura Atual (Problemas)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       ARQUITETURA ATUAL                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐                                                       │
│   │  Main Thread │ ← TUDO AQUI (bloqueante)                             │
│   │              │                                                       │
│   │  1. fetch()  │ ─── ~2-5s para 10MB de M3U                           │
│   │      ↓       │                                                       │
│   │  2. parse()  │ ─── ~3-8s para 300K itens (BLOQUEIA UI)              │
│   │      ↓       │                                                       │
│   │  3. classify │ ─── ~2-4s para classificar cada item                 │
│   │      ↓       │                                                       │
│   │  4. bulkAdd  │ ─── ~5-15s para inserir no IndexedDB                 │
│   │      ↓       │                                                       │
│   │  5. setState │                                                       │
│   └──────────────┘                                                       │
│                                                                          │
│   TEMPO TOTAL: 12-32 segundos de UI CONGELADA                            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Gargalos Identificados

| Etapa | Tempo Típico | Problema |
|-------|--------------|----------|
| Download | 2-5s | Aceitável, mas sem streaming |
| Parsing | 3-8s | Bloqueia completamente a UI |
| Classificação | 2-4s | Loop síncrono de 300K iterações |
| IndexedDB | 5-15s | bulkAdd com 300K items de uma vez |

---

## 3. Arquitetura Proposta (Solução)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       ARQUITETURA OTIMIZADA                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌──────────────┐          ┌──────────────┐                            │
│   │  Main Thread │          │  Web Worker  │                            │
│   │              │          │              │                            │
│   │  UI sempre   │ ←─────── │  1. fetch    │ ← Download em background   │
│   │  responsiva! │  eventos │  2. parse    │ ← Parsing isolado          │
│   │              │  de      │  3. classify │ ← Classificação em chunks  │
│   │  Progress    │  progress│              │                            │
│   │  atualizado  │ ←─────── │  postMessage │                            │
│   │              │          │              │                            │
│   │  4. bulkAdd  │ ←─────── │  chunks de   │                            │
│   │  (streaming) │  1000    │  items       │                            │
│   └──────────────┘          └──────────────┘                            │
│                                                                          │
│   TEMPO PERCEBIDO: 3-5s até ver conteúdo (streaming progressivo)        │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Componentes da Solução

### 4.1 Web Worker para Parsing

**Arquivo:** `src/core/workers/playlistWorker.ts`

```typescript
// playlistWorker.ts

import parser from 'iptv-playlist-parser';
import { ContentClassifier } from '../services/m3u/classifier';

const CHUNK_SIZE = 1000; // Items por chunk

self.onmessage = async (event: MessageEvent<WorkerInput>) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'PARSE_PLAYLIST':
      await parsePlaylist(payload.url, payload.playlistId);
      break;
    case 'CANCEL':
      // Permite cancelamento
      cancelled = true;
      break;
  }
};

let cancelled = false;

async function parsePlaylist(url: string, playlistId: string) {
  cancelled = false;

  try {
    // 1. Download com progress
    self.postMessage({ type: 'PROGRESS', phase: 'downloading', percentage: 0 });

    const response = await fetch(url);
    const content = await response.text();

    if (cancelled) return;

    self.postMessage({ type: 'PROGRESS', phase: 'downloading', percentage: 100 });

    // 2. Parse
    self.postMessage({ type: 'PROGRESS', phase: 'parsing', percentage: 0 });
    const parsed = parser.parse(content);
    const totalItems = parsed.items.length;

    if (cancelled) return;

    // 3. Classificar e enviar em chunks
    self.postMessage({ type: 'PROGRESS', phase: 'classifying', percentage: 0 });

    const stats = { movieCount: 0, seriesCount: 0, liveCount: 0, unknownCount: 0 };
    const groupsMap = new Map();

    for (let i = 0; i < totalItems; i += CHUNK_SIZE) {
      if (cancelled) return;

      const chunk = parsed.items.slice(i, i + CHUNK_SIZE);
      const processedChunk = [];

      for (const raw of chunk) {
        if (!raw.url || !raw.name) continue;

        const groupName = raw.group?.title || 'Sem Grupo';
        const mediaKind = ContentClassifier.classify(raw.name, groupName);
        const parsedTitle = ContentClassifier.parseTitle(raw.name);

        // Atualizar stats
        stats[`${mediaKind}Count`]++;

        // Atualizar groups
        const groupId = `${groupName}_${mediaKind}`;
        if (!groupsMap.has(groupId)) {
          groupsMap.set(groupId, { name: groupName, mediaKind, itemCount: 0 });
        }
        groupsMap.get(groupId).itemCount++;

        processedChunk.push({
          id: `${playlistId}_item_${i + processedChunk.length}`,
          playlistId,
          name: raw.name,
          url: raw.url,
          logo: raw.tvg?.logo,
          group: groupName,
          mediaKind,
          title: parsedTitle.title,
          year: parsedTitle.year,
          season: parsedTitle.season,
          episode: parsedTitle.episode,
          quality: parsedTitle.quality,
        });
      }

      // Enviar chunk para Main Thread salvar
      self.postMessage({
        type: 'ITEMS_CHUNK',
        items: processedChunk,
        chunkIndex: Math.floor(i / CHUNK_SIZE),
        totalChunks: Math.ceil(totalItems / CHUNK_SIZE),
      });

      // Atualizar progress
      const percentage = Math.round(((i + CHUNK_SIZE) / totalItems) * 100);
      self.postMessage({ type: 'PROGRESS', phase: 'classifying', percentage });
    }

    // 4. Enviar grupos e stats finais
    self.postMessage({
      type: 'COMPLETE',
      stats,
      groups: Array.from(groupsMap.values()),
    });

  } catch (error) {
    self.postMessage({ type: 'ERROR', error: error.message });
  }
}

export type WorkerInput =
  | { type: 'PARSE_PLAYLIST'; payload: { url: string; playlistId: string } }
  | { type: 'CANCEL' };

export type WorkerOutput =
  | { type: 'PROGRESS'; phase: string; percentage: number }
  | { type: 'ITEMS_CHUNK'; items: any[]; chunkIndex: number; totalChunks: number }
  | { type: 'COMPLETE'; stats: any; groups: any[] }
  | { type: 'ERROR'; error: string };
```

### 4.2 Hook para Gerenciar Worker

**Arquivo:** `src/core/hooks/usePlaylistWorker.ts`

```typescript
import { useRef, useCallback, useState } from 'react';
import { db } from '../db';
import type { WorkerOutput } from '../workers/playlistWorker';

interface WorkerProgress {
  phase: 'idle' | 'downloading' | 'parsing' | 'classifying' | 'indexing' | 'complete' | 'error';
  percentage: number;
  message: string;
  chunksReceived: number;
  totalChunks: number;
}

export function usePlaylistWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [progress, setProgress] = useState<WorkerProgress>({
    phase: 'idle',
    percentage: 0,
    message: '',
    chunksReceived: 0,
    totalChunks: 0,
  });

  const loadPlaylist = useCallback(async (url: string, playlistId: string) => {
    // Criar worker
    workerRef.current = new Worker(
      new URL('../workers/playlistWorker.ts', import.meta.url),
      { type: 'module' }
    );

    let chunksReceived = 0;
    let totalChunks = 0;

    return new Promise<void>((resolve, reject) => {
      workerRef.current!.onmessage = async (event: MessageEvent<WorkerOutput>) => {
        const { type } = event.data;

        switch (type) {
          case 'PROGRESS':
            setProgress(prev => ({
              ...prev,
              phase: event.data.phase,
              percentage: event.data.percentage,
              message: getProgressMessage(event.data.phase, event.data.percentage),
            }));
            break;

          case 'ITEMS_CHUNK':
            // Salvar chunk no IndexedDB (streaming)
            totalChunks = event.data.totalChunks;
            chunksReceived++;

            await db.items.bulkAdd(event.data.items);

            setProgress(prev => ({
              ...prev,
              phase: 'indexing',
              percentage: Math.round((chunksReceived / totalChunks) * 100),
              message: `Salvando ${chunksReceived}/${totalChunks} lotes...`,
              chunksReceived,
              totalChunks,
            }));
            break;

          case 'COMPLETE':
            // Salvar playlist e grupos
            await db.groups.bulkAdd(event.data.groups.map(g => ({
              ...g,
              id: `${playlistId}_${g.name}_${g.mediaKind}`,
              playlistId,
            })));

            await db.playlists.add({
              id: playlistId,
              url,
              ...event.data.stats,
              isActive: 1,
              lastUpdated: Date.now(),
            });

            setProgress({
              phase: 'complete',
              percentage: 100,
              message: 'Concluído!',
              chunksReceived: totalChunks,
              totalChunks,
            });

            workerRef.current?.terminate();
            resolve();
            break;

          case 'ERROR':
            setProgress(prev => ({
              ...prev,
              phase: 'error',
              message: event.data.error,
            }));
            workerRef.current?.terminate();
            reject(new Error(event.data.error));
            break;
        }
      };

      // Iniciar parsing
      workerRef.current!.postMessage({
        type: 'PARSE_PLAYLIST',
        payload: { url, playlistId },
      });
    });
  }, []);

  const cancel = useCallback(() => {
    workerRef.current?.postMessage({ type: 'CANCEL' });
    workerRef.current?.terminate();
    setProgress(prev => ({ ...prev, phase: 'idle' }));
  }, []);

  return { progress, loadPlaylist, cancel };
}

function getProgressMessage(phase: string, percentage: number): string {
  switch (phase) {
    case 'downloading': return `Baixando playlist... ${percentage}%`;
    case 'parsing': return 'Analisando estrutura...';
    case 'classifying': return `Classificando conteúdo... ${percentage}%`;
    case 'indexing': return `Salvando dados... ${percentage}%`;
    default: return '';
  }
}
```

### 4.3 Configuração Vite para Worker

**Arquivo:** `vite.config.ts` (adicionar)

```typescript
export default defineConfig({
  // ... config existente

  worker: {
    format: 'es',
    plugins: () => [react()],
  },

  optimizeDeps: {
    include: ['iptv-playlist-parser'],
  },
});
```

---

## 5. Otimização do IndexedDB

### 5.1 Bulk Insert Otimizado

**Problema:** `bulkAdd()` com 300K items é lento
**Solução:** Inserir em lotes menores durante o streaming

```typescript
// ANTES (lento):
await db.items.bulkAdd(allItems); // 300K de uma vez

// DEPOIS (rápido):
// Worker envia chunks de 1000
// Main thread insere cada chunk imediatamente
worker.onmessage = async (e) => {
  if (e.data.type === 'ITEMS_CHUNK') {
    await db.items.bulkAdd(e.data.items); // 1000 por vez
  }
};
```

### 5.2 Índices Otimizados

```typescript
// schema.ts - índices compostos para queries eficientes
this.version(3).stores({
  items: 'id, playlistId, [playlistId+mediaKind], [playlistId+group]',
  groups: 'id, playlistId, [playlistId+mediaKind]',
});
```

---

## 6. Streaming Progressivo (Opcional - v2)

### Conceito
Começar a mostrar conteúdo **antes** do parsing completo.

```typescript
// Após receber primeiro chunk de filmes:
// 1. Mostrar na UI imediatamente
// 2. Continuar carregando em background

const INITIAL_DISPLAY_THRESHOLD = 100; // Mostrar após 100 filmes

worker.onmessage = (e) => {
  if (e.data.type === 'ITEMS_CHUNK') {
    // Se temos 100+ filmes, já podemos navegar para Home
    if (movieCount >= INITIAL_DISPLAY_THRESHOLD && !navigatedToHome) {
      navigatedToHome = true;
      navigate('/home'); // UI mostra conteúdo parcial
    }
    // Continua salvando em background...
  }
};
```

---

## 7. Lazy Classification (Alternativa)

### Conceito
NÃO classificar durante o parsing. Salvar items "raw" e classificar sob demanda.

```typescript
// Durante parsing:
// - Salvar só: name, url, group, logo
// - mediaKind = null (não classificado)

// Quando usuário navega para "Filmes":
// 1. Query items do grupo
// 2. Classificar apenas esses
// 3. Cachear resultado

async function getMoviesFromGroup(groupId: string) {
  const items = await db.items.where('group').equals(groupId).toArray();

  // Classificar sob demanda
  return items.filter(item => {
    if (item.mediaKind) return item.mediaKind === 'movie';

    // Classificar e salvar cache
    const kind = ContentClassifier.classify(item.name, item.group);
    db.items.update(item.id, { mediaKind: kind });
    return kind === 'movie';
  });
}
```

### Trade-offs

| Abordagem | Vantagem | Desvantagem |
|-----------|----------|-------------|
| Eager (atual) | Dados prontos na Home | Parsing lento |
| Lazy | Parsing super rápido | Primeira navegação lenta |
| Híbrido | Melhor dos dois | Mais complexo |

---

## 8. Matriz de Prioridade de Implementação

| Otimização | Impacto | Esforço | Prioridade |
|------------|---------|---------|------------|
| **Web Worker** | Alto | Médio | **P0 - Crítico** |
| **Chunk Streaming** | Alto | Baixo | **P0 - Crítico** |
| **IndexedDB Batch** | Médio | Baixo | **P1 - Importante** |
| **Cancelamento** | Médio | Baixo | **P1 - Importante** |
| **Lazy Classification** | Alto | Alto | **P2 - Futuro** |
| **Streaming Display** | Médio | Alto | **P2 - Futuro** |

---

## 9. Métricas de Sucesso

| Métrica | Antes | Depois | Meta |
|---------|-------|--------|------|
| Tempo até UI responsiva | 15-30s | < 1s | OK |
| Tempo até ver conteúdo | 15-30s | 3-5s | OK |
| Tempo total de parsing | 15-30s | 10-15s | OK |
| Memory spikes | Alto | Baixo | OK |
| CPU blocking | 100% | 0% Main | OK |

---

## 10. Arquivos a Criar/Modificar

### Novos Arquivos
```
src/core/workers/
├── playlistWorker.ts       # Web Worker principal
└── workerTypes.ts          # Tipos compartilhados

src/core/hooks/
└── usePlaylistWorker.ts    # Hook React para gerenciar worker
```

### Arquivos a Modificar
```
src/core/services/m3u/parser.ts     # Remover fetch, mover para worker
src/core/db/operations.ts           # Adaptar para streaming inserts
src/ui/onboarding/LoadingProgress.tsx  # Usar hook do worker
vite.config.ts                      # Config de worker
```

---

## 11. Riscos e Mitigações

| Risco | Probabilidade | Impacto | Mitigação |
|-------|---------------|---------|-----------|
| Worker não suportado | Baixa | Alto | Fallback para Main Thread |
| Memory leak no Worker | Média | Médio | Terminate após uso |
| IndexedDB quota | Baixa | Alto | Limpar dados antigos |
| Compatibilidade Tizen/webOS | Média | Alto | Testar em emuladores |

---

## 12. Compatibilidade Smart TVs

### Samsung Tizen
- Web Workers suportados (Tizen 4.0+, 2018+)
- Limites de memória mais restritos
- IndexedDB suportado

### LG webOS
- Web Workers suportados (webOS 4.0+, 2018+)
- Performance de IndexedDB pode variar
- Fallback graceful se Worker falhar

### Fallback Strategy
```typescript
function createPlaylistLoader() {
  if (typeof Worker !== 'undefined') {
    return new WorkerBasedLoader();
  }
  console.warn('Web Workers not supported, using main thread');
  return new MainThreadLoader(); // Implementação atual
}
```

---

## 13. Estimativa de Implementação

| Fase | Descrição | Esforço |
|------|-----------|---------|
| **Fase 1** | Web Worker básico + chunking | 4-6h |
| **Fase 2** | Hook React + integração UI | 2-3h |
| **Fase 3** | IndexedDB otimizado | 2-3h |
| **Fase 4** | Testes em Smart TVs | 2-4h |
| **Total** | | **10-16h** |

---

## 14. Exemplo de Uso Final

```tsx
// LoadingProgress.tsx

import { usePlaylistWorker } from '@core/hooks/usePlaylistWorker';

export function LoadingProgress() {
  const navigate = useNavigate();
  const { playlistUrl } = useOnboardingStore();
  const { progress, loadPlaylist, cancel } = usePlaylistWorker();

  useEffect(() => {
    if (!playlistUrl) {
      navigate('/onboarding/input');
      return;
    }

    const playlistId = `playlist_${Date.now()}`;

    loadPlaylist(playlistUrl, playlistId)
      .then(() => navigate('/home'))
      .catch((err) => {
        setError(err.message);
        navigate('/onboarding/error');
      });

    return () => cancel(); // Cleanup se sair da página
  }, [playlistUrl]);

  return (
    <div className={styles.container}>
      <ProgressBar percentage={progress.percentage} />
      <p>{progress.message}</p>
      {progress.phase !== 'idle' && (
        <button onClick={cancel}>Cancelar</button>
      )}
    </div>
  );
}
```

---

## 15. Conclusão

A implementação de Web Workers para o parsing de playlists é a otimização mais impactante para a experiência do usuário. Combinada com streaming de chunks para o IndexedDB, permite:

1. **UI sempre responsiva** - Nunca bloqueia a thread principal
2. **Feedback visual contínuo** - Progress bar atualiza em tempo real
3. **Cancelamento** - Usuário pode desistir a qualquer momento
4. **Escalabilidade** - Funciona bem com playlists de qualquer tamanho
5. **Compatibilidade** - Fallback para dispositivos sem suporte a Workers

Esta arquitetura é o padrão recomendado para processamento pesado em aplicações web modernas e está alinhada com as melhores práticas para Smart TVs.

---

## Changelog

| Data | Versão | Descrição |
|------|--------|-----------|
| 2025-11-27 | 1.0 | Documento inicial criado |
