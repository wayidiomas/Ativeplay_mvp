# PRD: M3U/IPTV Playlist Parsing

**Versão**: 1.0
**Última atualização**: 2025-11-26
**Status**: Aprovado
**Autor**: AtivePlay Dev Team

---

## 1. Visão Geral

O módulo de Parsing é responsável por processar playlists M3U/M3U8 de IPTV, extrair metadados, classificar conteúdo (filmes, séries, TV ao vivo, rádio) e organizar por categorias.

### 1.1 Importância Crítica

Este módulo é **CRÍTICO** para a performance do app, pois playlists IPTV podem ter:
- **290.000+ canais** (582.000 linhas)
- Múltiplos grupos e categorias
- Metadados diversos (logos, EPG IDs, etc.)

### 1.2 Objetivos

1. Parsear playlists M3U de qualquer tamanho sem bloquear a UI
2. Classificar automaticamente conteúdo por tipo (live, movie, series, radio)
3. Extrair e organizar grupos/categorias
4. Persistir dados no IndexedDB para acesso offline
5. Fornecer feedback de progresso durante o processamento

---

## 2. Análise do Formato M3U IPTV

### 2.1 Estrutura Identificada

Baseado na análise do arquivo `playlist_940113135170_plus.m3u` (582.908 linhas):

```m3u
#EXTM3U
#EXT-X-SESSION-DATA:DATA-ID="com.xui.1_5_5r2"
#EXTINF:-1 xui-id="OPBX" tvg-id="" tvg-name="CINE CATASTROFE 01" tvg-logo="https://i.ibb.co/..." group-title="CINE FILMES HD 24HRS",CINE CATASTROFE 01
http://upline.click:80/play/XSYwbPJsjvo.../ts
```

### 2.2 Atributos Identificados

| Atributo | Descrição | Exemplo | Obrigatório |
|----------|-----------|---------|-------------|
| `xui-id` | ID único do provedor | `"OPBX"` | Não |
| `tvg-id` | ID para EPG | `""` (geralmente vazio) | Não |
| `tvg-name` | Nome do canal/conteúdo | `"CINE CATASTROFE 01"` | Sim |
| `tvg-logo` | URL do logo/poster | `"https://i.ibb.co/..."` | Não |
| `group-title` | Categoria/grupo | `"CINE FILMES HD 24HRS"` | Sim |

### 2.3 Grupos Encontrados na Playlist de Exemplo

- `CINE FILMES HD 24HRS` - Filmes 24 horas
- `CINE SERIES HD 24HRS` - Séries 24 horas
- `CINE DESENHOS HD 24HRS` - Desenhos/Animações
- `CINE NOVELAS HD 24HRS` - Novelas/Telenovelas
- `CINE ESPECIAL HD 24HRS` - Conteúdo especial

### 2.4 Padrões de Nomenclatura para Séries

```
"OS SIMPSONS 01"           → Série: Os Simpsons, Temporada 01
"DOIS HOMENS E MEIO 01"    → Série: Dois Homens e Meio, Temporada 01
"BREAKING BAD S01E01"      → Série com formato SxxExx
"GAME OF THRONES 1x05"     → Série com formato 1x05
```

---

## 3. Bibliotecas Recomendadas

### 3.1 @iptv/playlist (RECOMENDADA - Parser Principal)

```json
"@iptv/playlist": "^1.0.0"
```

**Vantagens**:
- **Mais rápida**: 1.3M ops/sec (5x mais rápida que alternativas)
- **Leve**: 1.34 kB minified + gzipped
- **Zero dependências**
- **TypeScript nativo**

**Uso**:
```typescript
import { parse } from '@iptv/playlist';

const playlist = parse(m3uContent);
// playlist.items[].name, .url, .group, .logo, etc.
```

### 3.2 iptv-playlist-parser (Fallback)

```json
"iptv-playlist-parser": "^0.15.0"
```

**Vantagens**:
- Estável e bem documentado
- Já incluído nas dependências

**Desvantagens**:
- 5x mais lento que @iptv/playlist

### 3.3 Dependências Adicionais

```json
{
  "dependencies": {
    "@iptv/playlist": "^1.0.0",
    "uuid": "^11.0.3"
  },
  "devDependencies": {
    "@types/uuid": "^10.0.0"
  }
}
```

---

## 4. Arquitetura de Parsing

### 4.1 Diagrama de Fluxo

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FLUXO DE PARSING                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   ┌─────────────┐     ┌──────────────────┐     ┌─────────────────┐      │
│   │  Main       │────▶│  Parser Worker   │────▶│  IndexedDB      │      │
│   │  Thread     │     │  (Web Worker)    │     │  (Dexie)        │      │
│   └─────────────┘     └──────────────────┘     └─────────────────┘      │
│         │                     │                                          │
│         │  Progress Events    │                                          │
│         ◀─────────────────────┘                                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Decisão: Web Worker vs Main Thread

| Tamanho da Playlist | Estratégia |
|---------------------|------------|
| < 100 KB | Parsing síncrono (main thread) |
| >= 100 KB | Web Worker (background) |

### 4.3 Estrutura de Arquivos

```
src/core/services/m3u/
├── index.ts                    # Exports públicos
├── types.ts                    # Tipos/interfaces
├── parser.worker.ts            # Web Worker
├── M3UParser.ts                # Classe principal
├── ContentClassifier.ts        # Classificador de conteúdo
├── GroupExtractor.ts           # Extrator de grupos
└── constants.ts                # Regex patterns, MediaKind
```

---

## 5. Tipos TypeScript

### 5.1 Tipos Principais

```typescript
// src/core/services/m3u/types.ts

export type MediaKind = 'live' | 'movie' | 'series' | 'radio' | 'vod' | 'unknown';

export interface M3UItem {
  id: string;                    // UUID gerado
  playlistId: string;            // FK para playlist
  name: string;                  // tvg-name
  url: string;                   // URL do stream
  logo?: string;                 // tvg-logo
  group: string;                 // group-title
  tvgId?: string;                // tvg-id (para EPG)
  xuiId?: string;                // xui-id (ID do provedor)

  // Classificação automática
  mediaKind: MediaKind;

  // Para séries
  seriesInfo?: SeriesInfo;

  // Metadata adicional
  duration?: number;             // -1 para live
  tmdbId?: string;               // ID TMDB (se enriquecido)
}

export interface SeriesInfo {
  title: string;                 // Nome da série
  season?: number;               // Temporada
  episode?: number;              // Episódio
}

export interface M3UPlaylist {
  id: string;                    // UUID da playlist
  url: string;                   // URL original
  name: string;                  // Nome dado pelo usuário
  isActive: boolean;             // NOVO: Se é a playlist ativa no momento

  // Estatísticas
  totalItems: number;
  itemsByKind: Record<MediaKind, number>;

  // Grupos
  groups: M3UGroup[];

  // Metadata
  lastUpdated: Date;
  expiresAt?: Date;
}

export interface M3UGroup {
  id: string;
  playlistId: string;            // FK para playlist
  name: string;                  // group-title original
  displayName: string;           // Nome formatado
  mediaKind: MediaKind;          // Tipo predominante
  itemCount: number;
  logo?: string;                 // Primeiro logo do grupo
}
```

### 5.2 Tipos de Progress e Result

```typescript
export interface ParseProgress {
  stage: 'downloading' | 'parsing' | 'classifying' | 'indexing';
  progress: number;              // 0-100
  currentItem?: number;
  totalItems?: number;
}

export interface ParseResult {
  success: boolean;
  playlist?: M3UPlaylist;
  items?: M3UItem[];
  error?: ParseError;
}

export interface ParseError {
  code: 'INVALID_FORMAT' | 'EMPTY_PLAYLIST' | 'NETWORK_ERROR' | 'TIMEOUT';
  message: string;
}
```

---

## 6. Classificador de Conteúdo

### 6.1 Algoritmo de Classificação (6 Estágios)

```typescript
// src/core/services/m3u/ContentClassifier.ts

export class ContentClassifier {
  // Padrões para cada tipo
  private patterns = {
    live: {
      groups: /\b(TV|CANAIS|ABERTOS?|FECHADOS?|HD|FHD|4K|ESPORTES?|SPORTS?|NEWS|24H|AO VIVO)\b/i,
      names: /\b(HD|FHD|UHD|4K|HEVC|H\.?265)\b/i,
    },
    movie: {
      groups: /\b(FILMES?|MOVIES?|CINE|CINEMA|LANÇAMENTOS?|DUBLADO|LEGENDADO)\b/i,
      names: /\(\d{4}\)/,  // Ano entre parênteses ex: (2024)
    },
    series: {
      groups: /\b(SERIES?|SÉRIES?|TEMPORADA|SEASON)\b/i,
      names: /\b(S\d{1,2}E\d{1,2}|T\d{1,2}\s*E\d{1,2}|\d{1,2}x\d{1,2}|\s\d{2}$)\b/i,
    },
    radio: {
      groups: /\b(RÁDIO|RADIO|FM|AM|PODCAST)\b/i,
      urls: /\.(mp3|aac|ogg|m4a)/i,
    },
  };

  classify(item: { name: string; group: string; url: string }): MediaKind {
    // 1. Classificar por URL (rádio - extensões de áudio)
    if (this.patterns.radio.urls.test(item.url)) return 'radio';

    // 2. Classificar por group-title (mais confiável)
    if (this.patterns.series.groups.test(item.group)) return 'series';
    if (this.patterns.movie.groups.test(item.group)) return 'movie';
    if (this.patterns.live.groups.test(item.group)) return 'live';
    if (this.patterns.radio.groups.test(item.group)) return 'radio';

    // 3. Classificar por nome (fallback)
    if (this.patterns.series.names.test(item.name)) return 'series';
    if (this.patterns.movie.names.test(item.name)) return 'movie';
    if (this.patterns.live.names.test(item.name)) return 'live';

    // 4. Default para VOD genérico
    return 'vod';
  }

  extractSeriesInfo(name: string): SeriesInfo | undefined {
    const patterns = [
      /^(.+?)\s+S(\d{1,2})E(\d{1,2})/i,      // S01E05
      /^(.+?)\s+(\d{1,2})x(\d{1,2})/i,       // 1x05
      /^(.+?)\s+T(\d{1,2})\s*E(\d{1,2})/i,   // T01 E05
      /^(.+?)\s+(\d{2})$/,                    // "SERIE 01" (só temporada)
    ];

    for (const pattern of patterns) {
      const match = name.match(pattern);
      if (match) {
        return {
          title: match[1].trim(),
          season: parseInt(match[2]),
          episode: match[3] ? parseInt(match[3]) : undefined,
        };
      }
    }
    return undefined;
  }
}
```

### 6.2 Ordem de Prioridade

1. **URL** - Extensões de áudio identificam rádio
2. **group-title** - Mais confiável, definido pelo provedor
3. **nome** - Padrões como S01E05, ano (2024), etc.
4. **Default** - VOD genérico

---

## 7. Parser Principal com Web Worker

### 7.1 Classe M3UParser

```typescript
// src/core/services/m3u/M3UParser.ts

import { ParseProgress, ParseResult } from './types';

export class M3UParser {
  private worker: Worker | null = null;

  async parse(
    content: string,
    onProgress?: (progress: ParseProgress) => void
  ): Promise<ParseResult> {
    // Usar Web Worker para playlists grandes (>100KB)
    if (content.length > 100_000) {
      return this.parseInWorker(content, onProgress);
    }

    // Parsing síncrono para playlists pequenas
    return this.parseSync(content, onProgress);
  }

  private async parseInWorker(
    content: string,
    onProgress?: (progress: ParseProgress) => void
  ): Promise<ParseResult> {
    return new Promise((resolve, reject) => {
      this.worker = new Worker(
        new URL('./parser.worker.ts', import.meta.url),
        { type: 'module' }
      );

      this.worker.onmessage = (e) => {
        const { type, data } = e.data;

        switch (type) {
          case 'progress':
            onProgress?.(data);
            break;
          case 'complete':
            resolve(data);
            this.worker?.terminate();
            break;
          case 'error':
            reject(new Error(data.message));
            this.worker?.terminate();
            break;
        }
      };

      this.worker.onerror = (error) => {
        reject(new Error(`Worker error: ${error.message}`));
        this.worker?.terminate();
      };

      this.worker.postMessage({ type: 'parse', content });
    });
  }

  private async parseSync(
    content: string,
    onProgress?: (progress: ParseProgress) => void
  ): Promise<ParseResult> {
    // Implementação síncrona para playlists pequenas
    // Usar mesma lógica do worker, mas na main thread
    // ...
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}
```

### 7.2 Web Worker Implementation

```typescript
// src/core/services/m3u/parser.worker.ts

import { parse } from '@iptv/playlist';
import { ContentClassifier } from './ContentClassifier';
import { v4 as uuid } from 'uuid';
import type { M3UItem, M3UGroup, MediaKind } from './types';

const classifier = new ContentClassifier();

self.onmessage = async (e: MessageEvent) => {
  const { type, content } = e.data;

  if (type !== 'parse') return;

  try {
    // Stage 1: Parsing
    self.postMessage({
      type: 'progress',
      data: { stage: 'parsing', progress: 0 }
    });

    const parsed = parse(content);
    const totalItems = parsed.items.length;

    if (totalItems === 0) {
      throw new Error('Playlist vazia ou formato inválido');
    }

    // Stage 2: Classifying
    self.postMessage({
      type: 'progress',
      data: { stage: 'classifying', progress: 25, totalItems }
    });

    const items: M3UItem[] = [];
    const groups = new Map<string, M3UGroup>();

    for (let i = 0; i < parsed.items.length; i++) {
      const item = parsed.items[i];

      const mediaKind = classifier.classify({
        name: item.name || '',
        group: item.group || '',
        url: item.url || '',
      });

      const m3uItem: M3UItem = {
        id: uuid(),
        playlistId: '', // Será preenchido depois
        name: item.name || 'Sem Nome',
        url: item.url,
        logo: item.tvg?.logo,
        group: item.group || 'Sem Categoria',
        tvgId: item.tvg?.id,
        mediaKind,
        seriesInfo: mediaKind === 'series'
          ? classifier.extractSeriesInfo(item.name || '')
          : undefined,
      };

      items.push(m3uItem);

      // Agrupar
      if (!groups.has(m3uItem.group)) {
        groups.set(m3uItem.group, {
          id: uuid(),
          playlistId: '', // Será preenchido depois
          name: m3uItem.group,
          displayName: formatGroupName(m3uItem.group),
          mediaKind,
          itemCount: 0,
          logo: m3uItem.logo,
        });
      }
      groups.get(m3uItem.group)!.itemCount++;

      // Progress update a cada 1000 itens
      if (i % 1000 === 0) {
        self.postMessage({
          type: 'progress',
          data: {
            stage: 'classifying',
            progress: 25 + Math.round((i / totalItems) * 50),
            currentItem: i,
            totalItems,
          },
        });
      }
    }

    // Stage 3: Indexing
    self.postMessage({
      type: 'progress',
      data: { stage: 'indexing', progress: 90 },
    });

    // Estatísticas por tipo
    const itemsByKind = items.reduce((acc, item) => {
      acc[item.mediaKind] = (acc[item.mediaKind] || 0) + 1;
      return acc;
    }, {} as Record<MediaKind, number>);

    self.postMessage({
      type: 'complete',
      data: {
        success: true,
        playlist: {
          id: uuid(),
          totalItems,
          itemsByKind,
          groups: Array.from(groups.values()),
          lastUpdated: new Date(),
        },
        items,
      },
    });

  } catch (error) {
    self.postMessage({
      type: 'error',
      data: {
        code: 'INVALID_FORMAT',
        message: error instanceof Error ? error.message : 'Erro desconhecido'
      },
    });
  }
};

function formatGroupName(name: string): string {
  // Remove sufixos comuns para display mais limpo
  return name
    .replace(/\s*(HD|FHD|4K|24HRS?|24 HORAS?)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
```

---

## 8. Integração com Dexie (IndexedDB)

### 8.1 Schema do Banco (v2 - Consolidado)

```typescript
// src/core/db/schema.ts

import Dexie, { Table } from 'dexie';
import type { M3UItem, M3UPlaylist, M3UGroup } from '../services/m3u/types';

// Tipos para Favoritos e Progresso
export interface Favorite {
  id: string;
  playlistId: string;
  itemId: string;
  addedAt: Date;
}

export interface WatchProgress {
  id: string;
  playlistId: string;
  itemId: string;
  progress: number;      // 0-100
  position: number;      // segundos
  duration: number;      // segundos
  lastWatched: Date;
}

export class AtivePlayDB extends Dexie {
  playlists!: Table<M3UPlaylist>;
  items!: Table<M3UItem>;
  groups!: Table<M3UGroup>;
  favorites!: Table<Favorite>;           // NOVO v2
  watchProgress!: Table<WatchProgress>;  // NOVO v2

  constructor() {
    super('ativeplay');

    // Schema v2 - Consolidado com Favoritos e Progresso
    this.version(2).stores({
      playlists: 'id, url, lastUpdated, isActive',  // NOVO: isActive
      items: 'id, playlistId, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId, addedAt',           // NOVO
      watchProgress: 'id, [playlistId+itemId], playlistId, lastWatched',   // NOVO
    });
  }
}

export const db = new AtivePlayDB();
```

### 8.2 Função de Limpeza ao Remover Playlist

```typescript
// src/core/db/operations.ts

import { db } from './schema';

/**
 * Remove uma playlist e todos os dados associados (items, grupos, favoritos, progresso)
 * Usa transação para garantir atomicidade
 */
export async function removePlaylistWithData(playlistId: string): Promise<void> {
  await db.transaction('rw', [
    db.playlists,
    db.items,
    db.groups,
    db.favorites,
    db.watchProgress
  ], async () => {
    // Remover todos os dados associados à playlist
    await Promise.all([
      db.items.where('playlistId').equals(playlistId).delete(),
      db.groups.where('playlistId').equals(playlistId).delete(),
      db.favorites.where('playlistId').equals(playlistId).delete(),
      db.watchProgress.where('playlistId').equals(playlistId).delete(),
    ]);

    // Por último, remover a playlist em si
    await db.playlists.delete(playlistId);
  });
}

/**
 * Define uma playlist como ativa (desativa as outras)
 */
export async function setActivePlaylist(playlistId: string): Promise<void> {
  await db.transaction('rw', db.playlists, async () => {
    // Desativar todas as playlists
    await db.playlists.toCollection().modify({ isActive: false });

    // Ativar a playlist selecionada
    await db.playlists.update(playlistId, { isActive: true });
  });
}

/**
 * Retorna a playlist ativa ou null se nenhuma estiver ativa
 */
export async function getActivePlaylist(): Promise<M3UPlaylist | null> {
  const active = await db.playlists.where('isActive').equals(1).first();
  return active || null;
}
```

### 8.3 Índices Compostos

| Índice | Uso |
|--------|-----|
| `[playlistId+group]` | Buscar items por playlist e grupo |
| `[playlistId+mediaKind]` | Buscar items por playlist e tipo (filmes, séries, etc.) |

---

## 9. Hook de Parsing

### 9.1 useM3UParser

```typescript
// src/hooks/useM3UParser.ts

import { useState, useCallback } from 'react';
import { M3UParser } from '../core/services/m3u/M3UParser';
import type { ParseProgress, ParseResult } from '../core/services/m3u/types';
import { db } from '../core/db/schema';

export function useM3UParser() {
  const [progress, setProgress] = useState<ParseProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsePlaylist = useCallback(async (
    url: string,
    name: string
  ): Promise<boolean> => {
    const parser = new M3UParser();
    setIsLoading(true);
    setError(null);

    try {
      // 1. Download
      setProgress({ stage: 'downloading', progress: 0 });
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Falha ao baixar: ${response.status}`);
      }

      const content = await response.text();

      // Validar formato básico
      if (!content.includes('#EXTM3U')) {
        throw new Error('Formato de playlist inválido');
      }

      // 2. Parse
      const result = await parser.parse(content, setProgress);

      if (!result.success || !result.playlist || !result.items) {
        throw new Error(result.error?.message || 'Erro ao parsear playlist');
      }

      // 3. Salvar no IndexedDB
      setProgress({ stage: 'indexing', progress: 95 });

      await db.transaction('rw', [db.playlists, db.items, db.groups], async () => {
        const playlistId = result.playlist!.id;

        // Salvar playlist
        await db.playlists.add({
          ...result.playlist!,
          url,
          name,
        });

        // Adicionar playlistId aos items
        const itemsWithPlaylistId = result.items!.map(item => ({
          ...item,
          playlistId,
        }));

        // Adicionar playlistId aos groups
        const groupsWithPlaylistId = result.playlist!.groups.map(group => ({
          ...group,
          playlistId,
        }));

        await db.items.bulkAdd(itemsWithPlaylistId);
        await db.groups.bulkAdd(groupsWithPlaylistId);
      });

      setProgress({ stage: 'indexing', progress: 100 });
      return true;

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      setError(message);
      return false;
    } finally {
      setIsLoading(false);
      parser.terminate();
    }
  }, []);

  const reset = useCallback(() => {
    setProgress(null);
    setError(null);
    setIsLoading(false);
  }, []);

  return {
    parsePlaylist,
    progress,
    isLoading,
    error,
    reset,
  };
}
```

### 9.2 Uso no Componente

```typescript
// Exemplo de uso no SyncProgress.tsx
import { useM3UParser } from '@/hooks/useM3UParser';

function SyncProgress({ url, name, onSuccess, onError }) {
  const { parsePlaylist, progress, isLoading, error } = useM3UParser();

  useEffect(() => {
    parsePlaylist(url, name).then((success) => {
      if (success) {
        onSuccess();
      } else {
        onError(error);
      }
    });
  }, []);

  const stageLabels = {
    downloading: 'Baixando playlist...',
    parsing: 'Parseando conteúdo...',
    classifying: 'Classificando itens...',
    indexing: 'Salvando no dispositivo...',
  };

  return (
    <div>
      <ProgressBar value={progress?.progress || 0} />
      <p>{progress ? stageLabels[progress.stage] : 'Iniciando...'}</p>
      {progress?.currentItem && (
        <p>{progress.currentItem} / {progress.totalItems} itens</p>
      )}
    </div>
  );
}
```

---

## 10. Performance Considerations

### 10.1 Otimizações para Smart TVs

| Otimização | Descrição |
|------------|-----------|
| **Web Worker** | Parsing em background para não bloquear UI |
| **Chunked Processing** | Processar em lotes de 5000 itens |
| **Progress Updates** | A cada 1000 itens para feedback visual |
| **Lazy Loading** | Carregar grupos sob demanda |
| **Virtual Scrolling** | Usar para listas longas na UI |
| **Memory Management** | Limpar items não visíveis |

### 10.2 Benchmarks Esperados

| Operação | Tempo Esperado | Nota |
|----------|----------------|------|
| Parse 290K itens | ~2-3s | Com @iptv/playlist |
| Classificação | ~1-2s | Em Web Worker |
| IndexedDB bulk insert | ~3-5s | Com Dexie bulkAdd |
| **Total** | **~8-10s** | Para playlist completa |

### 10.3 Limites de Memória

| Plataforma | RAM Disponível | Limite Recomendado |
|------------|----------------|-------------------|
| Samsung Tizen 4.0 | ~512MB | 200K items |
| LG webOS 5.0 | ~768MB | 300K items |

---

## 11. Enriquecimento com TMDB (Opcional)

### 11.1 TMDBEnricher

```typescript
// src/core/services/tmdb/enricher.ts

import type { M3UItem } from '../m3u/types';

interface TMDBResult {
  id: string;
  poster?: string;
  backdrop?: string;
  overview?: string;
}

export class TMDBEnricher {
  private apiKey: string;
  private cache = new Map<string, TMDBResult>();

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async enrichItem(item: M3UItem): Promise<M3UItem> {
    // Só enriquecer filmes e séries
    if (item.mediaKind !== 'movie' && item.mediaKind !== 'series') {
      return item;
    }

    const searchQuery = item.seriesInfo?.title || item.name;

    // Cache check
    if (this.cache.has(searchQuery)) {
      const cached = this.cache.get(searchQuery)!;
      return {
        ...item,
        tmdbId: cached.id,
        logo: cached.poster || item.logo
      };
    }

    try {
      const result = await this.searchTMDB(searchQuery, item.mediaKind);
      if (result) {
        this.cache.set(searchQuery, result);
        return {
          ...item,
          tmdbId: result.id,
          logo: result.poster || item.logo
        };
      }
    } catch (e) {
      // Falha silenciosa - manter dados originais
      console.warn(`TMDB search failed for: ${searchQuery}`);
    }

    return item;
  }

  private async searchTMDB(
    query: string,
    type: 'movie' | 'series'
  ): Promise<TMDBResult | null> {
    const endpoint = type === 'movie' ? 'movie' : 'tv';
    const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${this.apiKey}&query=${encodeURIComponent(query)}&language=pt-BR`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.results?.length > 0) {
      const first = data.results[0];
      return {
        id: first.id.toString(),
        poster: first.poster_path
          ? `https://image.tmdb.org/t/p/w500${first.poster_path}`
          : undefined,
        backdrop: first.backdrop_path
          ? `https://image.tmdb.org/t/p/w1280${first.backdrop_path}`
          : undefined,
        overview: first.overview,
      };
    }

    return null;
  }
}
```

### 11.2 Quando Enriquecer

O enriquecimento TMDB deve ser feito **sob demanda** (quando o usuário acessa o item), não durante o parsing inicial, para não atrasar a sincronização.

---

## 12. Testes Unitários

### 12.1 ContentClassifier Tests

```typescript
// src/core/services/m3u/__tests__/ContentClassifier.test.ts

import { ContentClassifier } from '../ContentClassifier';

describe('ContentClassifier', () => {
  const classifier = new ContentClassifier();

  describe('classify', () => {
    test('classifica filmes por group-title', () => {
      expect(classifier.classify({
        name: 'Avatar',
        group: 'CINE FILMES HD 24HRS',
        url: 'http://example.com/video.ts'
      })).toBe('movie');
    });

    test('classifica séries por group-title', () => {
      expect(classifier.classify({
        name: 'OS SIMPSONS 01',
        group: 'CINE SERIES HD 24HRS',
        url: 'http://example.com/video.ts'
      })).toBe('series');
    });

    test('classifica rádio por extensão de URL', () => {
      expect(classifier.classify({
        name: 'Rádio FM',
        group: 'Qualquer',
        url: 'http://example.com/stream.mp3'
      })).toBe('radio');
    });

    test('classifica live por padrões de nome', () => {
      expect(classifier.classify({
        name: 'GLOBO HD',
        group: 'CANAIS',
        url: 'http://example.com/video.ts'
      })).toBe('live');
    });

    test('retorna vod para casos não identificados', () => {
      expect(classifier.classify({
        name: 'Conteúdo Genérico',
        group: 'Outros',
        url: 'http://example.com/video.ts'
      })).toBe('vod');
    });
  });

  describe('extractSeriesInfo', () => {
    test('extrai info de série formato S01E05', () => {
      expect(classifier.extractSeriesInfo('BREAKING BAD S01E05')).toEqual({
        title: 'BREAKING BAD',
        season: 1,
        episode: 5
      });
    });

    test('extrai info de série formato 1x05', () => {
      expect(classifier.extractSeriesInfo('GAME OF THRONES 1x05')).toEqual({
        title: 'GAME OF THRONES',
        season: 1,
        episode: 5
      });
    });

    test('extrai info de série formato "NOME 01"', () => {
      expect(classifier.extractSeriesInfo('OS SIMPSONS 01')).toEqual({
        title: 'OS SIMPSONS',
        season: 1,
        episode: undefined
      });
    });

    test('retorna undefined para nomes sem padrão', () => {
      expect(classifier.extractSeriesInfo('Avatar')).toBeUndefined();
    });
  });
});
```

---

## 13. Checklist de Implementação

### 13.1 Arquivos a Criar

- [ ] `src/core/services/m3u/types.ts`
- [ ] `src/core/services/m3u/constants.ts`
- [ ] `src/core/services/m3u/ContentClassifier.ts`
- [ ] `src/core/services/m3u/M3UParser.ts`
- [ ] `src/core/services/m3u/parser.worker.ts`
- [ ] `src/core/services/m3u/index.ts`
- [ ] `src/core/db/schema.ts`
- [ ] `src/hooks/useM3UParser.ts`

### 13.2 Dependências a Instalar

```bash
npm install @iptv/playlist uuid
npm install -D @types/uuid
```

### 13.3 Configuração Vite para Web Worker

```typescript
// vite.config.ts - já suporta workers nativamente
// Não precisa configuração adicional para:
// new Worker(new URL('./worker.ts', import.meta.url))
```

---

## 14. Referências

### 14.1 Documentação

- [@iptv/playlist](https://www.npmjs.com/package/@iptv/playlist) - Parser M3U
- [Dexie.js](https://dexie.org/) - IndexedDB Wrapper
- [Web Workers API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API)

### 14.2 Formato M3U

- [M3U Wikipedia](https://en.wikipedia.org/wiki/M3U)
- [EXTINF Specification](https://datatracker.ietf.org/doc/html/rfc8216)

---

**Versão do Documento**: 1.1
**Atualização**: Schema v2 com múltiplas playlists, favoritos e progresso
**Compatível com**: PRD_Dependencies.md v1.1, PRD_Project_Setup.md v1.1, PRD_Home.md
