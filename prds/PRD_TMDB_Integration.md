# PRD: TMDB Integration (Integracao TMDB)

**Versao:** 1.0
**Data:** 2025-11-27
**Status:** Aprovado
**Autor:** Gerado com auxilio de IA para AtivePlay

---

## 1. Visao Geral

### 1.1 Objetivo

Este PRD documenta a integracao com a API do TMDB (The Movie Database) para enriquecimento automatico de metadados de filmes e series no AtivePlay, utilizando os dados extraidos dos arquivos M3U.

### 1.2 Motivacao

Playlists M3U geralmente contem informacoes limitadas:
- Titulo (frequentemente com ruido: qualidade, ano, prefixos)
- Logo/poster de baixa qualidade
- Grupo/categoria

Com TMDB, podemos enriquecer com:
- Poster e backdrop em alta resolucao
- Sinopse completa
- Avaliacao (rating)
- Generos
- Elenco principal
- Ano de lancamento

### 1.3 Fluxo de Enriquecimento

```
M3U Item           TMDB Search          TMDB Details         Enriched Item
+-------------+    +-------------+      +-------------+      +-------------+
| name        | -> | search/movie| ->   | movie/{id}  | ->   | tmdbId      |
| logo (ruim) |    | search/tv   |      | credits     |      | poster (HD) |
| group       |    +-------------+      | videos      |      | backdrop    |
+-------------+         |               +-------------+      | overview    |
                        v                                    | rating      |
                   +---------+                               | genres      |
                   | Matcher |                               | cast        |
                   | (score) |                               | year        |
                   +---------+                               +-------------+
```

---

## 2. Configuracao da API

### 2.1 Variaveis de Ambiente

```bash
# .env
VITE_TMDB_ENABLED=true
VITE_TMDB_API_KEY=your_api_key_here
VITE_TMDB_ACCESS_TOKEN=your_bearer_token_here
VITE_TMDB_BASE_URL=https://api.themoviedb.org/3
VITE_TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p
VITE_TMDB_LANGUAGE=pt-BR
VITE_TMDB_RATE_LIMIT=10
VITE_TMDB_CACHE_TTL_DAYS=30
```

### 2.2 Obtendo API Key

1. Criar conta em https://www.themoviedb.org/
2. Acessar https://www.themoviedb.org/settings/api
3. Solicitar API Key (Developer)
4. Usar o **Access Token (Bearer)** para autenticacao

### 2.3 Limites da API

| Metrica | Limite | Recomendado |
|---------|--------|-------------|
| Requests/segundo | ~40 por IP | 10 (conservador) |
| Requests/dia | Ilimitado | - |
| Conexoes simultaneas | 20 | 5 |
| Tamanho resposta | Variavel | - |

---

## 3. Endpoints Utilizados

### 3.1 Busca de Filmes

```typescript
// GET https://api.themoviedb.org/3/search/movie

interface MovieSearchParams {
  query: string;          // Titulo do filme
  language?: string;      // 'pt-BR'
  page?: number;          // 1-1000
  year?: number;          // Ano de lancamento
  include_adult?: boolean;
}

interface MovieSearchResult {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;     // YYYY-MM-DD
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;     // 0-10
  vote_count: number;
  popularity: number;
  genre_ids: number[];
}

interface MovieSearchResponse {
  page: number;
  results: MovieSearchResult[];
  total_pages: number;
  total_results: number;
}
```

### 3.2 Busca de Series

```typescript
// GET https://api.themoviedb.org/3/search/tv

interface TVSearchParams {
  query: string;              // Nome da serie
  language?: string;          // 'pt-BR'
  page?: number;
  first_air_date_year?: number;
  include_adult?: boolean;
}

interface TVSearchResult {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;   // YYYY-MM-DD
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  popularity: number;
  genre_ids: number[];
}

interface TVSearchResponse {
  page: number;
  results: TVSearchResult[];
  total_pages: number;
  total_results: number;
}
```

### 3.3 Detalhes de Filme

```typescript
// GET https://api.themoviedb.org/3/movie/{movie_id}?append_to_response=credits,videos

interface MovieDetails {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  release_date: string;
  runtime: number;            // Minutos
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  genres: Array<{ id: number; name: string }>;

  // Com append_to_response
  credits?: {
    cast: Array<{
      id: number;
      name: string;
      character: string;
      profile_path: string | null;
      order: number;
    }>;
    crew: Array<{
      id: number;
      name: string;
      job: string;
      department: string;
    }>;
  };

  videos?: {
    results: Array<{
      id: string;
      key: string;          // YouTube video ID
      name: string;
      type: string;         // 'Trailer', 'Teaser'
      site: string;         // 'YouTube'
    }>;
  };
}
```

### 3.4 Detalhes de Serie

```typescript
// GET https://api.themoviedb.org/3/tv/{series_id}?append_to_response=credits,videos

interface TVSeriesDetails {
  id: number;
  name: string;
  original_name: string;
  overview: string;
  first_air_date: string;
  last_air_date: string;
  number_of_seasons: number;
  number_of_episodes: number;
  episode_run_time: number[];
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number;
  vote_count: number;
  genres: Array<{ id: number; name: string }>;

  seasons: Array<{
    id: number;
    name: string;
    season_number: number;
    episode_count: number;
    air_date: string;
    poster_path: string | null;
  }>;

  credits?: {
    cast: Array<{
      id: number;
      name: string;
      character: string;
      profile_path: string | null;
    }>;
  };

  videos?: {
    results: Array<{
      key: string;
      name: string;
      type: string;
      site: string;
    }>;
  };
}
```

---

## 4. Normalizacao de Titulos M3U

### 4.1 Padroes Comuns em M3U

| Padrao | Exemplo | Titulo Limpo |
|--------|---------|--------------|
| Prefixo tipo | `Filme: Avengers Endgame` | `Avengers Endgame` |
| Qualidade | `Matrix 4K` | `Matrix` |
| Ano | `Inception (2010)` | `Inception` |
| Season/Episode | `Breaking Bad S01E05` | `Breaking Bad` |
| Codec | `Avatar HEVC` | `Avatar` |
| Combinado | `Serie: The Office S02E03 HD` | `The Office` |

### 4.2 Implementacao do Normalizador

```typescript
// src/core/utils/titleNormalizer.ts

interface ParsedTitle {
  title: string;
  type: 'movie' | 'series' | 'other';
  year?: number;
  quality?: string;
  season?: number;
  episode?: number;
}

export class TitleNormalizer {
  // Regex patterns
  private patterns = {
    // Prefixos de tipo
    typePrefix: /^(Filme|FILME|Movie|Serie|SERIE|Series|SERIES|Série)[\s:]+/i,

    // Qualidade (4K, FHD, HD, SD, UHD, HEVC, H.265)
    quality: /(4K|FHD|UHD|HD|SD|HEVC|H\.?265|H\.?264|AVC)/gi,

    // Season/Episode: S01E05, 1x05, T01E05
    seasonEpisode: /[Ss]?(\d{1,2})[xXeE](\d{1,2})|[Tt](\d{1,2})\s*[eE]?(\d{1,2})/,

    // Ano: (2019), 2019 no final
    year: /\(?(\d{4})\)?$/,

    // Prefixos genericos (CINE, TV, etc)
    genericPrefix: /^(CINE|TV|CH)\s+/i,

    // Sufixo numerico (para sequencias)
    numericSuffix: /\s+\d{2}$/,
  };

  /**
   * Extrai informacoes do titulo M3U
   */
  parse(rawTitle: string): ParsedTitle {
    let title = rawTitle.trim();
    let type: ParsedTitle['type'] = 'other';
    let year: number | undefined;
    let quality: string | undefined;
    let season: number | undefined;
    let episode: number | undefined;

    // 1. Detectar tipo pelo prefixo
    const typeMatch = title.match(this.patterns.typePrefix);
    if (typeMatch) {
      const prefix = typeMatch[1].toLowerCase();
      type = prefix.includes('serie') || prefix.includes('series') ? 'series' : 'movie';
      title = title.replace(this.patterns.typePrefix, '');
    }

    // 2. Extrair qualidade
    const qualityMatch = title.match(this.patterns.quality);
    if (qualityMatch) {
      quality = qualityMatch[0].toUpperCase();
      title = title.replace(this.patterns.quality, '');
    }

    // 3. Extrair season/episode (indica serie)
    const seMatch = title.match(this.patterns.seasonEpisode);
    if (seMatch) {
      type = 'series';
      season = parseInt(seMatch[1] || seMatch[3]);
      episode = parseInt(seMatch[2] || seMatch[4]);
      title = title.replace(this.patterns.seasonEpisode, '');
    }

    // 4. Extrair ano
    const yearMatch = title.match(this.patterns.year);
    if (yearMatch) {
      year = parseInt(yearMatch[1]);
      // Validar que eh um ano razoavel (1900-2030)
      if (year < 1900 || year > 2030) {
        year = undefined;
      } else {
        title = title.replace(this.patterns.year, '');
      }
    }

    // 5. Remover prefixos genericos
    title = title.replace(this.patterns.genericPrefix, '');

    // 6. Remover sufixo numerico
    title = title.replace(this.patterns.numericSuffix, '');

    // 7. Limpar espacos extras
    title = title.replace(/\s+/g, ' ').trim();

    return { title, type, year, quality, season, episode };
  }

  /**
   * Gera query de busca para TMDB
   */
  generateSearchQuery(parsed: ParsedTitle): string {
    // Nao incluir season/episode na busca
    // Ano pode ajudar a refinar
    return parsed.title;
  }
}

export const titleNormalizer = new TitleNormalizer();
```

### 4.3 Exemplos de Normalizacao

```typescript
// Testes
const examples = [
  { input: 'Filme: Avengers Endgame 2019 4K', expected: { title: 'Avengers Endgame', year: 2019, quality: '4K', type: 'movie' } },
  { input: 'Serie: Breaking Bad S01E05 HD', expected: { title: 'Breaking Bad', season: 1, episode: 5, quality: 'HD', type: 'series' } },
  { input: 'The Office 2x03', expected: { title: 'The Office', season: 2, episode: 3, type: 'series' } },
  { input: 'CINE ACAO 01', expected: { title: 'ACAO', type: 'other' } },
  { input: 'Inception (2010)', expected: { title: 'Inception', year: 2010, type: 'other' } },
  { input: 'Matrix HEVC 4K', expected: { title: 'Matrix', quality: '4K', type: 'other' } },
];
```

---

## 5. Matching de Resultados

### 5.1 Sistema de Score

Ao buscar no TMDB, multiplos resultados podem retornar. O matcher calcula score para cada:

```typescript
// src/core/utils/tmdbMatcher.ts

interface SearchMatch {
  result: MovieSearchResult | TVSearchResult;
  score: number;
  confidence: number;  // 0-100
  matchType: 'exact' | 'fuzzy' | 'year-match';
}

export class TMDBMatcher {
  /**
   * Calcula similaridade entre strings (Levenshtein)
   */
  private calculateSimilarity(str1: string, str2: string): number {
    const s1 = str1.toLowerCase();
    const s2 = str2.toLowerCase();

    if (s1 === s2) return 100;

    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;

    if (longer.length === 0) return 100;

    const editDistance = this.levenshteinDistance(longer, shorter);
    return ((longer.length - editDistance) / longer.length) * 100;
  }

  private levenshteinDistance(s1: string, s2: string): number {
    const costs: number[] = [];

    for (let i = 0; i <= s1.length; i++) {
      let lastValue = i;
      for (let j = 0; j <= s2.length; j++) {
        if (i === 0) {
          costs[j] = j;
        } else if (j > 0) {
          let newValue = costs[j - 1];
          if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
            newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
          }
          costs[j - 1] = lastValue;
          lastValue = newValue;
        }
      }
      if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
  }

  /**
   * Encontra o melhor match para um titulo M3U
   */
  findBestMatch(
    m3uTitle: string,
    results: any[],
    mediaType: 'movie' | 'tv',
    year?: number
  ): SearchMatch | null {
    if (!results || results.length === 0) return null;

    const matches: SearchMatch[] = [];

    for (const result of results) {
      let score = 0;
      let matchType: SearchMatch['matchType'] = 'fuzzy';

      const tmdbTitle = mediaType === 'movie'
        ? result.original_title || result.title
        : result.original_name || result.name;

      const tmdbYear = mediaType === 'movie'
        ? parseInt(result.release_date?.split('-')[0])
        : parseInt(result.first_air_date?.split('-')[0]);

      // Similaridade de titulo
      const similarity = this.calculateSimilarity(m3uTitle, tmdbTitle);

      // Match exato = 100 pontos
      if (similarity >= 95) {
        score = 100;
        matchType = 'exact';
      }
      // Match alto = 70-90 pontos
      else if (similarity >= 80) {
        score = 70 + (similarity - 80);
        matchType = 'fuzzy';
      }
      // Match medio = 50-70 pontos
      else if (similarity >= 60) {
        score = 50 + (similarity - 60);
        matchType = 'fuzzy';
      }
      // Muito baixo = ignorar
      else {
        continue;
      }

      // Bonus por ano correspondente (+10)
      if (year && tmdbYear === year) {
        score += 10;
        if (matchType === 'fuzzy') matchType = 'year-match';
      }

      // Bonus por popularidade (max +5)
      const popularityBoost = Math.min(result.popularity / 100, 5);
      score += popularityBoost;

      matches.push({
        result,
        score,
        confidence: Math.min(score, 100),
        matchType,
      });
    }

    // Ordenar por score
    matches.sort((a, b) => b.score - a.score);

    // Retornar apenas se confianca >= 60
    return matches[0]?.confidence >= 60 ? matches[0] : null;
  }

  /**
   * Retorna top N matches para selecao manual
   */
  findTopMatches(
    m3uTitle: string,
    results: any[],
    mediaType: 'movie' | 'tv',
    topN: number = 5
  ): SearchMatch[] {
    // Similar ao acima, mas retorna array
    // ... implementacao ...
    return [];
  }
}

export const tmdbMatcher = new TMDBMatcher();
```

---

## 6. Rate Limiting

### 6.1 Implementacao

```typescript
// src/core/services/tmdb/rateLimiter.ts

export class RateLimiter {
  private queue: Array<() => Promise<any>> = [];
  private running = false;
  private requestsPerSecond: number;
  private requestTimestamps: number[] = [];

  constructor(requestsPerSecond: number = 10) {
    this.requestsPerSecond = requestsPerSecond;
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const result = await fn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });

      this.processQueue();
    });
  }

  private async processQueue(): Promise<void> {
    if (this.running || this.queue.length === 0) return;

    this.running = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      const oneSecondAgo = now - 1000;

      // Remover timestamps antigos
      this.requestTimestamps = this.requestTimestamps.filter(t => t > oneSecondAgo);

      // Se atingiu limite, esperar
      if (this.requestTimestamps.length >= this.requestsPerSecond) {
        const oldestRequest = this.requestTimestamps[0];
        const waitTime = 1000 - (now - oldestRequest) + 10;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue;
      }

      // Executar request
      const request = this.queue.shift();
      if (request) {
        this.requestTimestamps.push(Date.now());
        await request();
      }
    }

    this.running = false;
  }
}

export const tmdbLimiter = new RateLimiter(
  parseInt(import.meta.env.VITE_TMDB_RATE_LIMIT || '10')
);
```

---

## 7. Cache (IndexedDB)

### 7.1 Schema

```typescript
// Adicionar ao schema existente (PRD_Parsing.md)

export interface TMDBCache {
  id: string;              // Chave: 'search:movie:titulo' ou 'details:movie:12345'
  type: 'search' | 'details';
  mediaType: 'movie' | 'tv';
  query: string;           // Titulo ou TMDB ID
  data: any;               // Resultado da API
  createdAt: number;
  expiresAt: number;
}

// Schema v4
this.version(4).stores({
  // ... tabelas existentes v3
  tmdbCache: 'id, type, mediaType, expiresAt',
});
```

### 7.2 TTL (Time-To-Live)

| Tipo de Cache | TTL | Justificativa |
|---------------|-----|---------------|
| Search | 7 dias | Resultados podem mudar |
| Details | 30 dias | Metadados sao estaveis |
| Credits | 30 dias | Elenco nao muda |
| Videos | 60 dias | Trailers sao estaveis |

### 7.3 Servico de Cache

```typescript
// src/core/services/tmdb/tmdbCache.ts

import { db } from '@/core/db/schema';

const CACHE_TTL = {
  search: 7 * 24 * 60 * 60 * 1000,    // 7 dias
  details: 30 * 24 * 60 * 60 * 1000,  // 30 dias
};

export class TMDBCacheService {
  private generateKey(query: string, type: string, mediaType: string): string {
    return `${type}:${mediaType}:${query.toLowerCase().trim()}`;
  }

  async getSearchCache(query: string, mediaType: 'movie' | 'tv'): Promise<any | null> {
    const key = this.generateKey(query, 'search', mediaType);
    const now = Date.now();

    const cached = await db.tmdbCache?.where('id').equals(key).first();

    if (cached && cached.expiresAt > now) {
      console.log(`TMDB cache HIT: ${key}`);
      return cached.data;
    }

    // Limpar expirado
    if (cached) {
      await db.tmdbCache?.delete(key);
    }

    return null;
  }

  async setSearchCache(query: string, mediaType: 'movie' | 'tv', data: any): Promise<void> {
    const key = this.generateKey(query, 'search', mediaType);

    await db.tmdbCache?.put({
      id: key,
      type: 'search',
      mediaType,
      query,
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL.search,
    });
  }

  async getDetailsCache(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<any | null> {
    const key = this.generateKey(String(tmdbId), 'details', mediaType);
    const now = Date.now();

    const cached = await db.tmdbCache?.where('id').equals(key).first();

    if (cached && cached.expiresAt > now) {
      return cached.data;
    }

    if (cached) {
      await db.tmdbCache?.delete(key);
    }

    return null;
  }

  async setDetailsCache(tmdbId: number, mediaType: 'movie' | 'tv', data: any): Promise<void> {
    const key = this.generateKey(String(tmdbId), 'details', mediaType);

    await db.tmdbCache?.put({
      id: key,
      type: 'details',
      mediaType,
      query: String(tmdbId),
      data,
      createdAt: Date.now(),
      expiresAt: Date.now() + CACHE_TTL.details,
    });
  }

  async cleanExpiredCache(): Promise<number> {
    const now = Date.now();
    const expired = await db.tmdbCache?.where('expiresAt').below(now).toArray() || [];

    for (const entry of expired) {
      await db.tmdbCache?.delete(entry.id);
    }

    return expired.length;
  }

  async clearAll(): Promise<void> {
    await db.tmdbCache?.clear();
  }
}

export const tmdbCache = new TMDBCacheService();
```

---

## 8. Servico TMDB

### 8.1 Implementacao Principal

```typescript
// src/core/services/tmdb/tmdbService.ts

import { tmdbLimiter } from './rateLimiter';
import { tmdbCache } from './tmdbCache';

interface TMDBConfig {
  apiKey: string;
  accessToken: string;
  baseUrl: string;
  imageBaseUrl: string;
  language: string;
}

export class TMDBService {
  private config: TMDBConfig;
  private timeout = 5000;
  private maxRetries = 3;

  constructor() {
    this.config = {
      apiKey: import.meta.env.VITE_TMDB_API_KEY,
      accessToken: import.meta.env.VITE_TMDB_ACCESS_TOKEN,
      baseUrl: import.meta.env.VITE_TMDB_BASE_URL || 'https://api.themoviedb.org/3',
      imageBaseUrl: import.meta.env.VITE_TMDB_IMAGE_BASE_URL || 'https://image.tmdb.org/t/p',
      language: import.meta.env.VITE_TMDB_LANGUAGE || 'pt-BR',
    };
  }

  private async fetchWithRetry(url: string, retries = this.maxRetries): Promise<Response> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      clearTimeout(timeoutId);

      // Rate limited - esperar e retry
      if (response.status === 429) {
        const retryAfter = parseInt(response.headers.get('retry-after') || '60');
        console.warn(`TMDB rate limited. Retry in ${retryAfter}s`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        return this.fetchWithRetry(url, retries - 1);
      }

      // Outros erros - retry com backoff
      if (!response.ok && retries > 0) {
        const delay = Math.pow(2, this.maxRetries - retries) * 1000;
        await new Promise(r => setTimeout(r, delay));
        return this.fetchWithRetry(url, retries - 1);
      }

      return response;

    } catch (error) {
      if (retries > 0 && !(error instanceof Error && error.message.includes('aborted'))) {
        await new Promise(r => setTimeout(r, 1000));
        return this.fetchWithRetry(url, retries - 1);
      }
      throw error;
    }
  }

  /**
   * Buscar filme por titulo
   */
  async searchMovie(title: string, year?: number): Promise<MovieSearchResponse> {
    // Verificar cache
    const cached = await tmdbCache.getSearchCache(title, 'movie');
    if (cached) return cached;

    const result = await tmdbLimiter.execute(async () => {
      const url = new URL(`${this.config.baseUrl}/search/movie`);
      url.searchParams.set('query', title);
      url.searchParams.set('language', this.config.language);
      url.searchParams.set('include_adult', 'false');
      if (year) url.searchParams.set('year', String(year));

      const response = await this.fetchWithRetry(url.toString());
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);

      return response.json();
    });

    // Salvar cache
    await tmdbCache.setSearchCache(title, 'movie', result);
    return result;
  }

  /**
   * Buscar serie por titulo
   */
  async searchTV(title: string, year?: number): Promise<TVSearchResponse> {
    const cached = await tmdbCache.getSearchCache(title, 'tv');
    if (cached) return cached;

    const result = await tmdbLimiter.execute(async () => {
      const url = new URL(`${this.config.baseUrl}/search/tv`);
      url.searchParams.set('query', title);
      url.searchParams.set('language', this.config.language);
      url.searchParams.set('include_adult', 'false');
      if (year) url.searchParams.set('first_air_date_year', String(year));

      const response = await this.fetchWithRetry(url.toString());
      if (!response.ok) throw new Error(`Search failed: ${response.status}`);

      return response.json();
    });

    await tmdbCache.setSearchCache(title, 'tv', result);
    return result;
  }

  /**
   * Obter detalhes de filme
   */
  async getMovieDetails(movieId: number): Promise<MovieDetails> {
    const cached = await tmdbCache.getDetailsCache(movieId, 'movie');
    if (cached) return cached;

    const result = await tmdbLimiter.execute(async () => {
      const url = new URL(`${this.config.baseUrl}/movie/${movieId}`);
      url.searchParams.set('language', this.config.language);
      url.searchParams.set('append_to_response', 'credits,videos');

      const response = await this.fetchWithRetry(url.toString());
      if (!response.ok) throw new Error(`Details failed: ${response.status}`);

      return response.json();
    });

    await tmdbCache.setDetailsCache(movieId, 'movie', result);
    return result;
  }

  /**
   * Obter detalhes de serie
   */
  async getTVDetails(seriesId: number): Promise<TVSeriesDetails> {
    const cached = await tmdbCache.getDetailsCache(seriesId, 'tv');
    if (cached) return cached;

    const result = await tmdbLimiter.execute(async () => {
      const url = new URL(`${this.config.baseUrl}/tv/${seriesId}`);
      url.searchParams.set('language', this.config.language);
      url.searchParams.set('append_to_response', 'credits,videos');

      const response = await this.fetchWithRetry(url.toString());
      if (!response.ok) throw new Error(`Details failed: ${response.status}`);

      return response.json();
    });

    await tmdbCache.setDetailsCache(seriesId, 'tv', result);
    return result;
  }

  /**
   * Construir URL de imagem
   */
  buildImageUrl(path: string | null, size: string = 'w500'): string {
    if (!path) return '/assets/placeholder-poster.png';
    return `${this.config.imageBaseUrl}/${size}${path}`;
  }
}

export const tmdbService = new TMDBService();
```

---

## 9. URLs de Imagem

### 9.1 Tamanhos Disponiveis

| Tipo | Tamanhos | Uso Recomendado |
|------|----------|-----------------|
| Poster | w92, w154, w185, w342, w500, w780, original | w342 (cards), w500 (detalhes) |
| Backdrop | w300, w780, w1280, original | w780 (medio), w1280 (hero) |
| Profile | w45, w185, h632, original | w185 (elenco) |

### 9.2 Helper de URLs

```typescript
// src/core/utils/tmdbImages.ts

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export const IMAGE_SIZES = {
  poster: {
    small: 'w185',
    medium: 'w342',
    large: 'w500',
    original: 'original',
  },
  backdrop: {
    small: 'w300',
    medium: 'w780',
    large: 'w1280',
    original: 'original',
  },
  profile: {
    small: 'w185',
    medium: 'h632',
    original: 'original',
  },
};

export function buildPosterUrl(path: string | null, size: keyof typeof IMAGE_SIZES.poster = 'medium'): string {
  if (!path) return '/assets/placeholder-poster.png';
  return `${TMDB_IMAGE_BASE}/${IMAGE_SIZES.poster[size]}${path}`;
}

export function buildBackdropUrl(path: string | null, size: keyof typeof IMAGE_SIZES.backdrop = 'medium'): string {
  if (!path) return '/assets/placeholder-backdrop.png';
  return `${TMDB_IMAGE_BASE}/${IMAGE_SIZES.backdrop[size]}${path}`;
}

export function buildProfileUrl(path: string | null, size: keyof typeof IMAGE_SIZES.profile = 'small'): string {
  if (!path) return '/assets/placeholder-profile.png';
  return `${TMDB_IMAGE_BASE}/${IMAGE_SIZES.profile[size]}${path}`;
}
```

---

## 10. Hook de Enriquecimento

### 10.1 useTMDBEnrichment

```typescript
// src/hooks/useTMDBEnrichment.ts

import { useState, useCallback, useEffect } from 'react';
import { tmdbService } from '@/core/services/tmdb/tmdbService';
import { tmdbMatcher } from '@/core/utils/tmdbMatcher';
import { titleNormalizer } from '@/core/utils/titleNormalizer';
import type { M3UItem } from '@/core/services/m3u/types';

interface EnrichedData {
  tmdbId?: number;
  tmdbTitle?: string;
  tmdbPoster?: string;
  tmdbBackdrop?: string;
  tmdbOverview?: string;
  tmdbRating?: number;
  tmdbYear?: number;
  tmdbRuntime?: number;
  tmdbGenres?: string[];
  tmdbCast?: Array<{
    name: string;
    character: string;
    profilePath?: string;
  }>;
  matchConfidence?: number;
}

interface EnrichmentState {
  status: 'idle' | 'loading' | 'success' | 'error';
  data: EnrichedData | null;
  error?: string;
}

export function useTMDBEnrichment(
  item: M3UItem,
  mediaType: 'movie' | 'tv' = 'movie',
  autoEnrich = true
) {
  const [state, setState] = useState<EnrichmentState>({
    status: 'idle',
    data: null,
  });

  const enrich = useCallback(async () => {
    // Verificar se TMDB esta habilitado
    if (import.meta.env.VITE_TMDB_ENABLED === 'false') {
      return;
    }

    setState({ status: 'loading', data: null });

    try {
      // 1. Normalizar titulo
      const parsed = titleNormalizer.parse(item.name);
      const searchQuery = titleNormalizer.generateSearchQuery(parsed);

      // 2. Buscar no TMDB
      const searchResults = mediaType === 'movie'
        ? (await tmdbService.searchMovie(searchQuery, parsed.year)).results
        : (await tmdbService.searchTV(searchQuery, parsed.year)).results;

      if (!searchResults || searchResults.length === 0) {
        throw new Error('No results found');
      }

      // 3. Encontrar melhor match
      const match = tmdbMatcher.findBestMatch(
        parsed.title,
        searchResults,
        mediaType,
        parsed.year
      );

      if (!match || match.confidence < 60) {
        throw new Error('Low confidence match');
      }

      // 4. Obter detalhes completos
      const details = mediaType === 'movie'
        ? await tmdbService.getMovieDetails(match.result.id)
        : await tmdbService.getTVDetails(match.result.id);

      // 5. Mapear dados
      const enrichedData: EnrichedData = {
        tmdbId: details.id,
        tmdbTitle: mediaType === 'movie' ? details.title : details.name,
        tmdbPoster: details.poster_path,
        tmdbBackdrop: details.backdrop_path,
        tmdbOverview: details.overview,
        tmdbRating: details.vote_average,
        tmdbYear: mediaType === 'movie'
          ? parseInt(details.release_date?.split('-')[0])
          : parseInt(details.first_air_date?.split('-')[0]),
        tmdbRuntime: mediaType === 'movie' ? details.runtime : details.episode_run_time?.[0],
        tmdbGenres: details.genres?.map((g: any) => g.name) || [],
        tmdbCast: details.credits?.cast?.slice(0, 5).map((actor: any) => ({
          name: actor.name,
          character: actor.character,
          profilePath: actor.profile_path,
        })) || [],
        matchConfidence: match.confidence,
      };

      setState({ status: 'success', data: enrichedData });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setState({ status: 'error', data: null, error: message });
    }
  }, [item, mediaType]);

  // Auto-enrich ao montar
  useEffect(() => {
    if (autoEnrich && state.status === 'idle') {
      enrich();
    }
  }, [autoEnrich, enrich, state.status]);

  return {
    ...state,
    enrich,
    isLoading: state.status === 'loading',
  };
}
```

---

## 11. Interface de Detalhes

### 11.1 Componente MovieDetail

```typescript
// src/ui/detail/MovieDetail.tsx

import React from 'react';
import { useTMDBEnrichment } from '@/hooks/useTMDBEnrichment';
import { buildPosterUrl, buildBackdropUrl, buildProfileUrl } from '@/core/utils/tmdbImages';
import type { M3UItem } from '@/core/services/m3u/types';
import styles from './MovieDetail.module.css';

interface MovieDetailProps {
  item: M3UItem;
  onPlay: () => void;
  onFavorite: () => void;
  isFavorite: boolean;
}

export const MovieDetail: React.FC<MovieDetailProps> = ({
  item,
  onPlay,
  onFavorite,
  isFavorite,
}) => {
  const { data, isLoading, status } = useTMDBEnrichment(item, 'movie');

  // Fallback para dados M3U se TMDB falhar
  const poster = data?.tmdbPoster
    ? buildPosterUrl(data.tmdbPoster, 'large')
    : item.logo || '/assets/placeholder-poster.png';

  const backdrop = data?.tmdbBackdrop
    ? buildBackdropUrl(data.tmdbBackdrop, 'large')
    : '/assets/placeholder-backdrop.png';

  const title = data?.tmdbTitle || item.name;
  const overview = data?.tmdbOverview || 'Sem descricao disponivel.';
  const rating = data?.tmdbRating?.toFixed(1) || 'N/A';
  const year = data?.tmdbYear || '';
  const runtime = data?.tmdbRuntime ? `${data.tmdbRuntime} min` : '';
  const genres = data?.tmdbGenres || [];

  return (
    <div className={styles.container}>
      {/* Hero Backdrop */}
      <div
        className={styles.backdrop}
        style={{ backgroundImage: `url(${backdrop})` }}
      >
        <div className={styles.gradient} />
      </div>

      {/* Conteudo */}
      <div className={styles.content}>
        {/* Poster */}
        <img
          src={poster}
          alt={title}
          className={styles.poster}
          loading="lazy"
        />

        {/* Info */}
        <div className={styles.info}>
          <h1 className={styles.title}>{title}</h1>

          {/* Meta */}
          <div className={styles.meta}>
            {year && <span className={styles.year}>{year}</span>}
            {runtime && <span className={styles.runtime}>{runtime}</span>}
            {rating !== 'N/A' && (
              <span className={styles.rating}>
                <span className={styles.star}>*</span> {rating}
              </span>
            )}
            {data?.tmdbId && (
              <span className={styles.source}>TMDB</span>
            )}
          </div>

          {/* Generos */}
          {genres.length > 0 && (
            <div className={styles.genres}>
              {genres.map((genre) => (
                <span key={genre} className={styles.genre}>
                  {genre}
                </span>
              ))}
            </div>
          )}

          {/* Sinopse */}
          <p className={styles.overview}>{overview}</p>

          {/* Elenco */}
          {data?.tmdbCast && data.tmdbCast.length > 0 && (
            <div className={styles.cast}>
              <h3>Elenco</h3>
              <div className={styles.castList}>
                {data.tmdbCast.map((actor, idx) => (
                  <div key={idx} className={styles.castMember}>
                    <img
                      src={buildProfileUrl(actor.profilePath)}
                      alt={actor.name}
                      className={styles.castPhoto}
                    />
                    <div className={styles.castInfo}>
                      <span className={styles.actorName}>{actor.name}</span>
                      <span className={styles.characterName}>{actor.character}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Acoes */}
          <div className={styles.actions}>
            <button
              className={styles.btnPlay}
              onClick={onPlay}
              autoFocus
            >
              [>] Assistir
            </button>

            <button
              className={`${styles.btnFavorite} ${isFavorite ? styles.active : ''}`}
              onClick={onFavorite}
            >
              [*] {isFavorite ? 'Favoritado' : 'Favoritar'}
            </button>
          </div>

          {/* Indicador de confianca (debug) */}
          {data?.matchConfidence && data.matchConfidence < 100 && (
            <span className={styles.confidence}>
              Confianca: {data.matchConfidence.toFixed(0)}%
            </span>
          )}

          {/* Loading/Error */}
          {isLoading && <div className={styles.loading}>Carregando metadados...</div>}
          {status === 'error' && (
            <div className={styles.error}>Usando dados do M3U (TMDB indisponivel)</div>
          )}
        </div>
      </div>
    </div>
  );
};
```

---

## 12. Persistencia de Metadados

### 12.1 Salvar no M3UItem

Apos enriquecimento, os dados podem ser persistidos no IndexedDB:

```typescript
// src/core/db/operations.ts

export async function updateItemWithTMDB(
  itemId: string,
  tmdbData: {
    tmdbId?: number;
    tmdbPoster?: string;
    tmdbBackdrop?: string;
    tmdbOverview?: string;
    tmdbRating?: number;
    tmdbYear?: number;
    tmdbGenres?: string[];
  }
): Promise<void> {
  await db.items.update(itemId, {
    ...tmdbData,
    tmdbEnrichedAt: Date.now(),
  });
}
```

### 12.2 Schema Extendido

```typescript
// Adicionar campos ao M3UItem
interface M3UItem {
  // ... campos existentes

  // TMDB Enrichment
  tmdbId?: number;
  tmdbPoster?: string;
  tmdbBackdrop?: string;
  tmdbOverview?: string;
  tmdbRating?: number;
  tmdbYear?: number;
  tmdbGenres?: string[];
  tmdbEnrichedAt?: number;
}
```

---

## 13. Atribuicao TMDB

### 13.1 Requisitos Legais

TMDB exige atribuicao visivel:

```typescript
// src/ui/settings/About.tsx

export const About: React.FC = () => {
  return (
    <div className={styles.about}>
      <h1>Sobre AtivePlay</h1>
      <p>Versao 1.0.0</p>

      {/* Atribuicao TMDB - OBRIGATORIA */}
      <section className={styles.tmdbAttribution}>
        <h3>Fontes de Dados</h3>
        <p>
          Este produto utiliza a API TMDB, mas nao e endossado ou certificado pelo TMDB.
        </p>

        {/* Logo TMDB */}
        <img
          src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bbb5ce97b4ef8ae2fbe4c2be6c0e27a033cdf5b.svg"
          alt="TMDB Logo"
          className={styles.tmdbLogo}
        />

        <p className={styles.smallText}>
          TMDB (The Movie Database) e um banco de dados de filmes e TV construido pela comunidade.
          Saiba mais em{' '}
          <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">
            https://www.themoviedb.org/
          </a>
        </p>
      </section>
    </div>
  );
};
```

---

## 14. Estrutura de Arquivos

```
src/
+-- core/
|   +-- services/
|   |   +-- tmdb/
|   |       +-- tmdbService.ts       # Servico principal
|   |       +-- tmdbCache.ts         # Cache IndexedDB
|   |       +-- rateLimiter.ts       # Rate limiting
|   |       +-- types.ts             # Interfaces
|   |       +-- index.ts
|   |
|   +-- utils/
|       +-- titleNormalizer.ts       # Normalizacao de titulos
|       +-- tmdbMatcher.ts           # Matching de resultados
|       +-- tmdbImages.ts            # Helpers de URLs
|
+-- hooks/
|   +-- useTMDBEnrichment.ts         # Hook de enriquecimento
|
+-- ui/
    +-- detail/
        +-- MovieDetail.tsx          # Tela de detalhes filme
        +-- SeriesDetail.tsx         # Tela de detalhes serie
        +-- MovieDetail.module.css
```

---

## 15. Feature Flags

```typescript
// src/config/features.ts

export const FEATURES = {
  tmdb: {
    enabled: import.meta.env.VITE_TMDB_ENABLED !== 'false',
    autoEnrich: true,           // Enriquecer automaticamente ao abrir detalhes
    showConfidence: false,      // Mostrar score de match (debug)
    minConfidence: 60,          // Confianca minima para usar dados
    cacheEnabled: true,
    rateLimitPerSecond: 10,
  },
};

// Uso
if (FEATURES.tmdb.enabled) {
  // Fazer chamada TMDB
}
```

---

## 16. Referencias

### 16.1 Documentacao TMDB

- [TMDB API Documentation](https://developer.themoviedb.org/docs)
- [TMDB API Reference](https://developer.themoviedb.org/reference/intro/getting-started)
- [TMDB Image Basics](https://developer.themoviedb.org/docs/image-basics)
- [TMDB Rate Limiting](https://developer.themoviedb.org/docs/rate-limiting)

### 16.2 PRDs Relacionados

- [PRD_Parsing.md](./PRD_Parsing.md) - Schema IndexedDB, M3UItem
- [PRD_Home.md](./PRD_Home.md) - ContentCard, grid de conteudo
- [PRD_Player.md](./PRD_Player.md) - Player de VOD
- [PRD_Dependencies.md](./PRD_Dependencies.md) - Axios, Dexie

---

**Versao do Documento**: 1.0
**Compativel com**: PRD_Parsing.md v1.1, PRD_Home.md v1.1
