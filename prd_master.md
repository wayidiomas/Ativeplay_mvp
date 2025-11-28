# PRD MASTER - AtivePlay

> **Versão**: 1.1
> **Plataforma**: Smart TVs (Samsung Tizen + LG webOS)
> **Formato**: IA-Ready - Otimizado para geração de micro-PRDs

---

## 1. Visão Geral

### 1.1 Produto
- **Nome**: AtivePlay
- **Tipo**: Player IPTV/M3U profissional para Smart TVs
- **Empresa**: AtiveApp Mídias

### 1.2 Objetivo
Criar um aplicativo de reprodução de listas IPTV/M3U com UX moderna estilo Netflix, executado nativamente em TVs Samsung (Tizen) e LG (webOS), oferecendo:
- Interface premium e intuitiva
- Suporte completo a M3U/M3U8
- Player avançado com troca de áudio e legendas embutidos no stream
- Gerenciamento de múltiplas playlists
- Navegação otimizada para controle remoto

### 1.3 Plataformas Alvo
| Plataforma | Sistema | Player Nativo |
|------------|---------|---------------|
| Samsung TV | Tizen OS | AVPlay |
| LG TV | webOS | webOS Media Pipeline |

### 1.4 Arquitetura
Codebase limpa e modular com ~80% de código compartilhado entre plataformas, facilitando futuras expansões (Roku TV, Android TV, etc.).

---

## 2. Identidade Visual

### 2.1 Paleta de Cores (AtiveApp Mídias)

| Cor | HEX | RGB | Uso |
|-----|-----|-----|-----|
| Navy Principal | `#09182B` | rgb(9, 24, 43) | Background principal |
| Navy Secundário | `#071A2B` | rgb(7, 26, 43) | Cards, seções |
| Roxo/Violeta | `#7382FD` | rgb(115, 130, 253) | Destaques, badges, preços |
| Roxo Secundário | `#787DFC` | rgb(120, 125, 252) | Hover states |
| Verde Ação | `#1FAF38` | rgb(31, 175, 56) | Botões (Ativar, Play, Conectar) |
| Amarelo/Dourado | `#F6D423` | rgb(246, 212, 35) | Rankings, destaques especiais |
| Branco | `#FFFFFF` | rgb(255, 255, 255) | Textos principais |
| Cinza Claro | `#CECECE` | rgb(206, 206, 206) | Textos secundários |
| Ciano Accent | `#BBEDFF` | rgb(187, 237, 255) | Links, acentos |

### 2.2 Tipografia
- **Principal**: Inter (300, 400, 500, 600, 700, 800)
- **Secundária**: Poppins (400, 500, 600, 700)

### 2.3 Estilo Visual
- Dark mode por padrão
- Cards com bordas arredondadas
- Gradientes sutis
- UI minimalista e limpa
- Foco em thumbnails grandes

---

## 3. Público-Alvo

- Usuários de IPTV que buscam interface premium
- Consumidores que querem organizar suas listas M3U como "Netflix pessoal"
- Pessoas que compraram TV nova e procuram "player M3U"
- Usuários avançados que precisam trocar áudio e legenda
- Clientes de provedores IPTV que compraram links de playlist

---

## 4. Problema e Solução

### 4.1 Problema
Usuários de M3U geralmente usam players com:
- Interface antiga e desatualizada
- UX confusa e lenta
- Navegação difícil via controle remoto
- Sem organização inteligente do conteúdo

### 4.2 Solução
AtivePlay oferece:
- Interface moderna estilo Netflix
- Organização automática (Filmes, Séries, TV ao Vivo)
- Player avançado com tracks de áudio/legenda
- Performance otimizada para Smart TVs
- Gerenciamento de múltiplas playlists

---

## 5. Benchmark UX

### 5.1 iBoproPlayer (Referência Principal)
**Pontos fortes:**
- UI minimalista, leve, clara
- Carrosséis horizontais eficientes
- Atalhos rápidos entre categorias
- Suporte impecável a legendas
- Player nativo rápido
- Foco em simplicidade

**Lições aplicadas:**
- Priorizar velocidade
- Navegação com poucos cliques
- Interface sempre limpa

### 5.2 Vizzion (Referência Secundária)
**Pontos fortes:**
- Visual estilo Netflix, cinematográfico
- Cards com thumbnails grandes
- Sessão "Continue Watching"
- Player elegante com overlay transparente

**Lições aplicadas:**
- Hero banner imersivo
- Carrosséis com destaques visuais
- Player com UI moderna

---

## 6. Escopo Funcional Macro

### 6.1 Onboarding / Ativação
- Tela inicial moderna com logo AtivePlay
- Input de URL M3U/M3U8 (teclado otimizado para TV)
- Botão "Conectar" para sincronizar
- Loading com progresso durante parsing
- Validação do link com feedback visual
- Suporte a até 6 playlists (configurável via `.env`)

### 6.2 Parsing da Playlist
- Suporte a M3U e M3U8
- Detecção automática de categorias (Live TV / Movies / Series)
- Extração de metadados (poster, backdrop, logo, descrição)
- Normalização de títulos
- Tratamento de links quebrados/duplicados
- Cache local do catálogo parseado

### 6.3 Tela de Seleção de Playlist
- Cards para cada playlist cadastrada
- Nome, quantidade de itens, última atualização
- Badge "Ativa" na playlist selecionada
- Botão "+ Adicionar nova playlist"
- Opções de editar/remover/atualizar

### 6.4 Home (Netflix-like)
- Hero Banner com destaque
- Seções:
  - Continue Watching
  - Canais Favoritos
  - Filmes
  - Séries
  - TV ao Vivo
  - Trending (baseado em grupo da playlist)
- Carrosséis horizontais com cards
- Navegação otimizada para controle remoto

### 6.5 Filmes
- Catálogo com thumbnails
- Página de detalhes:
  - Poster grande
  - Descrição / Sinopse
  - Ano / Rating (se disponível)
  - Botão "Assistir"
  - Indicador de áudio/legendas disponíveis

### 6.6 Séries
- Lista de séries com poster
- Tela de temporadas
- Lista de episódios
- "Play next episode"
- Memória de progresso por episódio

### 6.7 TV ao Vivo (Live TV)
- Lista rápida de canais
- Filtros por categoria (Sports, News, Cinema, etc.)
- Logo do canal
- EPG básico (programa atual e próximo)
- Reprodutor com troca de qualidade

### 6.8 Player
- Funcionalidades:
  - Play/Pause
  - Seek (avançar/retroceder)
  - Troca de faixa de áudio (multi-track do stream)
  - Troca de legenda (embutida no stream)
  - Ajuste de qualidade (auto/manual)
  - Modo cinema (UI minimalista)
  - Botão voltar
- Extração de tracks de áudio/legenda de arquivos .ts e .mp4

### 6.9 Configurações
- Idioma da UI
- Gerenciar playlists
- Atualizar playlist (refetch)
- Resetar app (limpar cache)
- Sobre / Versão

### 6.10 Persistência
- LocalStorage para dados leves
- IndexDB para cache de catálogo (se necessário)
- Dados persistidos:
  - URLs das playlists
  - Catálogo parseado (cache)
  - Continue watching
  - Favoritos
  - Configurações do usuário

---

## 7. Fluxo do Usuário End-to-End

```
1. Abre o app pela primeira vez
   ↓
2. Tela de boas-vindas → botão "Adicionar Playlist"
   ↓
3. Usuário digita URL M3U/M3U8
   ↓
4. Clica em "Conectar"
   ↓
5. App baixa e valida o M3U (loading com progresso)
   ↓
6. Parsing completo → salva no cache
   ↓
7. Abre tela de seleção de playlist (se > 1) ou vai direto para Home
   ↓
8. Home exibe catálogo organizado (Filmes, Séries, Live TV)
   ↓
9. Usuário navega nos carrosséis
   ↓
10. Escolhe um filme → tela de detalhes
    ↓
11. Clica em "Assistir"
    ↓
12. Player abre com controles
    ↓
13. Durante reprodução pode:
    - Trocar áudio
    - Trocar legenda
    - Pausar
    - Avançar/Retroceder
    ↓
14. Ao fechar, progresso é salvo
    ↓
15. Volta ao catálogo → item aparece em "Continue Watching"
    ↓
16. Pode trocar de playlist a qualquer momento
```

---

## 8. Requisitos Técnicos

### 8.1 Frontend
| Tecnologia | Uso |
|------------|-----|
| React | UI (SPA) |
| TypeScript | Tipagem |
| Vite | Build tool |
| Zustand | State management (leve) |
| CSS Modules / Tailwind | Estilos (compilado para CSS puro) |

### 8.2 Player por Plataforma
| Plataforma | API |
|------------|-----|
| Samsung | Tizen AVPlay |
| LG | webOS Media Pipeline |

### 8.3 Parsing
| Biblioteca | Função |
|------------|--------|
| iptv-playlist-parser | Parse de M3U |
| m3u8-parser | Parse de M3U8/HLS |

### 8.4 Estrutura de Pastas (Sugestão)
```
src/
├── core/           # Services, parsers, utils
├── ui/             # Componentes React
├── player/         # Módulos do player
├── adapters/       # Samsung / LG adapters
├── store/          # Estado global (Zustand)
├── hooks/          # Custom hooks
├── types/          # TypeScript types
└── assets/         # Imagens, fontes
```

---

## 9. Arquitetura Multi-Plataforma

### 9.1 Código Compartilhado (~80%)
- Toda UI React
- Lógica de parsing
- State management
- Navegação
- Cache/persistência

### 9.2 Código Específico (~20%)
```typescript
// Adapter pattern
interface IPlayerAdapter {
  play(url: string): void;
  pause(): void;
  seek(time: number): void;
  getAudioTracks(): Track[];
  setAudioTrack(index: number): void;
  getSubtitleTracks(): Track[];
  setSubtitleTrack(index: number): void;
}

// Inicialização
if (isSamsung()) {
  player = new SamsungAVPlayAdapter();
} else if (isLG()) {
  player = new LGWebOSAdapter();
}
```

---

## 10. Integração TMDB (The Movie Database)

### 10.1 Objetivo
Enriquecer os metadados dos conteúdos extraídos do M3U com informações detalhadas da API TMDB, proporcionando uma experiência visual rica estilo Netflix.

### 10.2 Dados Obtidos via TMDB

| Dado | Endpoint | Uso no App |
|------|----------|------------|
| Sinopse | `/movie/{id}` ou `/tv/{id}` | Tela de detalhes |
| Ano de lançamento | `release_date` | Card e detalhes |
| Nota/Rating | `vote_average` | Estrelas (0-10) |
| Poster HD | `/movie/{id}/images` | Substituir tvg-logo de baixa qualidade |
| Backdrop | `backdrop_path` | Hero banner, fundo de detalhes |
| Gêneros | `genres[]` | Filtros, badges |
| Elenco | `/movie/{id}/credits` | Seção "Elenco" nos detalhes |
| Trailer | `/movie/{id}/videos` | Preview antes de assistir |
| Duração | `runtime` | Informação adicional |

### 10.3 Fluxo de Integração

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   M3U Parser    │────▶│ Title Extractor │────▶│  TMDB Search   │
│  (tvg-name)     │     │  (normalize)  │     │ /search/movie  │
└─────────────────┘     └──────────────┘     └────────┬────────┘
                                                      │
                                                      ▼
┌─────────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Cache Local   │◀────│   Merge Data  │◀────│  TMDB Details  │
│  (IndexedDB)    │     │  M3U + TMDB   │     │  /movie/{id}   │
└─────────────────┘     └──────────────┘     └─────────────────┘
```

### 10.4 Estrutura no Código

```
src/
├── core/
│   ├── services/
│   │   └── tmdb/
│   │       ├── tmdbClient.ts      # Cliente HTTP configurado
│   │       ├── tmdbService.ts     # Métodos de busca
│   │       ├── tmdbTypes.ts       # Interfaces TypeScript
│   │       └── tmdbCache.ts       # Cache de resultados
│   └── utils/
│       └── titleNormalizer.ts     # Normaliza títulos para busca
```

### 10.5 Exemplo de Implementação

```typescript
// src/core/services/tmdb/tmdbService.ts
import { tmdbClient } from './tmdbClient';
import { tmdbCache } from './tmdbCache';

interface TMDBMovie {
  id: number;
  title: string;
  overview: string;
  release_date: string;
  vote_average: number;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: { id: number; name: string }[];
}

export const tmdbService = {
  async searchMovie(query: string): Promise<TMDBMovie | null> {
    // Verificar cache primeiro
    const cached = await tmdbCache.get(query);
    if (cached) return cached;

    // Buscar na API
    const response = await tmdbClient.get('/search/movie', {
      params: { query, language: 'pt-BR' }
    });

    const movie = response.data.results[0] || null;

    // Salvar no cache
    if (movie) {
      await tmdbCache.set(query, movie);
    }

    return movie;
  },

  async getMovieDetails(id: number): Promise<TMDBMovie> {
    const response = await tmdbClient.get(`/movie/${id}`, {
      params: { language: 'pt-BR', append_to_response: 'credits,videos' }
    });
    return response.data;
  },

  getImageUrl(path: string | null, size: 'w500' | 'original' = 'w500'): string {
    if (!path) return '/assets/placeholder-poster.png';
    return `${import.meta.env.VITE_TMDB_IMAGE_BASE_URL}/${size}${path}`;
  }
};
```

### 10.6 Cliente HTTP

```typescript
// src/core/services/tmdb/tmdbClient.ts
import axios from 'axios';

export const tmdbClient = axios.create({
  baseURL: import.meta.env.VITE_TMDB_BASE_URL,
  headers: {
    'Authorization': `Bearer ${import.meta.env.VITE_TMDB_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  }
});
```

### 10.7 Estratégia de Cache

| Tipo | Storage | TTL | Uso |
|------|---------|-----|-----|
| Busca por título | IndexedDB | 7 dias | Evitar buscas repetidas |
| Detalhes do filme | IndexedDB | 30 dias | Dados completos |
| Imagens | Cache do browser | Indefinido | Posters, backdrops |

### 10.8 Normalização de Títulos

```typescript
// src/core/utils/titleNormalizer.ts
export function normalizeTitle(title: string): string {
  return title
    .replace(/\s*(FHD|HD|SD|4K|UHD)\s*/gi, '')  // Remove qualidade
    .replace(/\s*\d{4}\s*$/, '')                 // Remove ano no final
    .replace(/\s*S\d{1,2}E\d{1,2}\s*/gi, '')    // Remove S01E01
    .replace(/[^\w\s]/g, '')                     // Remove caracteres especiais
    .trim();
}

// Exemplo:
// "Inception FHD 2010" → "Inception"
// "Breaking Bad S01E05" → "Breaking Bad"
```

### 10.9 Pontos de Integração na UI

| Tela | Dados TMDB | Fallback (M3U) |
|------|------------|----------------|
| **Card do Catálogo** | `poster_path` + `vote_average` | `tvg-logo` |
| **Hero Banner** | `backdrop_path` + `overview` | `tvg-logo` (blur) |
| **Detalhes Filme** | Todos os campos | Dados básicos do M3U |
| **Detalhes Série** | `poster_path` + seasons | `tvg-logo` |

### 10.10 Requisitos de Atribuição

**Obrigatório** exibir na tela "Sobre" do app:
- Logo do TMDB
- Texto: "Este produto usa a API TMDB mas não é endossado ou certificado pelo TMDB."

### 10.11 Rate Limits e Boas Práticas

| Regra | Valor |
|-------|-------|
| Rate limit | ~40 req/segundo |
| Timeout | 5 segundos |
| Retry | 3 tentativas com backoff |
| Cache obrigatório | Sim (evitar requests repetidos) |

---

## 11. Lista de PRDs Específicos

Cada PRD abaixo deve ser gerado como documento separado, derivado deste PRD Master:

| # | PRD ID | Nome | Descrição |
|---|--------|------|-----------|
| 1 | `PRD_Onboarding` | Onboarding & Ativação | Tela inicial, inserção de URL, validação, sincronização |
| 2 | `PRD_Parsing` | Parser de Playlist | Parser M3U/M3U8, categorização, extração de metadados |
| 3 | `PRD_Home` | Interface Home | Home Netflix-like, carrosséis, hero banner, navegação |
| 4 | `PRD_Filmes` | Módulo Filmes | Catálogo, tela de detalhes, poster, descrição |
| 5 | `PRD_Series` | Módulo Séries | Temporadas, episódios, continue watching, play next |
| 6 | `PRD_LiveTV` | TV ao Vivo | Lista de canais, filtros, EPG básico |
| 7 | `PRD_Player` | Player Avançado | Player com troca de áudio/legenda do stream |
| 8 | `PRD_Configuracoes` | Configurações | Settings, idioma, reset, atualizar playlist |
| 9 | `PRD_Multi_Playlist` | Multi-Playlist | Gerenciamento de até 6 playlists |
| 10 | `PRD_Platform_Adapters` | Adaptadores | Samsung AVPlay e LG webOS Media Pipeline |
| 11 | `PRD_TMDB_Integration` | Integração TMDB | Enriquecimento de metadados via API TMDB |

---

## 12. Recursos e Links Técnicos

### 12.1 Samsung (Tizen)
- [Docs oficiais](https://developer.samsung.com/smarttv/develop)
- [AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/tizen-web-device-api-references/avplay.html)
- [Guia WebApps](https://developer.samsung.com/smarttv/develop/getting-started/creating-your-first-web-app.html)
- [Tizen Studio](https://developer.tizen.org/development/tizen-studio/download)

### 12.2 LG (webOS)
- [Docs oficiais](https://webostv.developer.lge.com/)
- [Media Playback](https://webostv.developer.lge.com/develop/app-developer-guide/media-app)
- [webOS API](https://webostv.developer.lge.com/api/webos-service-request)

### 12.3 Parsing M3U
- [iptv-playlist-parser](https://github.com/freearhey/iptv-playlist-parser)
- [m3u8-parser](https://github.com/videojs/m3u8-parser)

### 12.4 HLS (fallback se necessário)
- [HLS.js](https://github.com/video-dev/hls.js)

### 12.5 Cache/Storage
- [Dexie.js](https://dexie.org/) - IndexDB wrapper leve

### 12.6 TMDB (The Movie Database)
- [Docs oficiais](https://developer.themoviedb.org/docs/getting-started)
- [API Reference](https://developer.themoviedb.org/reference/intro/getting-started)
- [Search Movie](https://developer.themoviedb.org/reference/search-movie)
- [Movie Details](https://developer.themoviedb.org/reference/movie-details)
- [TV Series](https://developer.themoviedb.org/reference/tv-series-details)
- [Image Configuration](https://developer.themoviedb.org/reference/configuration-details)

---

## 13. Critérios de Qualidade

### 13.1 Performance
| Métrica | Target |
|---------|--------|
| Abertura do app | < 2s |
| Parse de M3U (5-10k itens) | < 5s |
| Início da reprodução | 1-3s |
| Navegação entre telas | Fluida (60fps) |

### 13.2 Compatibilidade
- Samsung: Tizen 4.0+
- LG: webOS 5.0+

### 13.3 UX
- Navegação com poucos cliques
- Feedback visual em todas as ações
- Loading states claros
- Tratamento de erros amigável
- Interface sempre responsiva ao controle remoto

---

## 14. Variáveis de Ambiente

```env
# Configurações do App
VITE_APP_NAME=AtivePlay
VITE_APP_VERSION=1.0.0
VITE_MAX_PLAYLISTS=6

# Feature Flags
VITE_ENABLE_EPG=true
VITE_ENABLE_CONTINUE_WATCHING=true
VITE_ENABLE_TMDB=true

# TMDB API (The Movie Database)
# Docs: https://developer.themoviedb.org/docs/getting-started
VITE_TMDB_API_KEY=sua_api_key_aqui
VITE_TMDB_ACCESS_TOKEN=seu_access_token_aqui
VITE_TMDB_BASE_URL=https://api.themoviedb.org/3
VITE_TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p
```

---

## 15. Próximos Passos

1. Gerar PRDs específicos para cada módulo
2. Criar wireframes/mockups das telas principais
3. Configurar ambiente de desenvolvimento
4. Configurar conta TMDB e obter API keys
5. Implementar módulo por módulo seguindo a ordem dos PRDs
6. Testar em TVs reais (Samsung e LG)
7. Publicar nas stores (Tizen Store e LG Content Store)

---

> **Nota**: Este PRD Master serve como documento fonte. Cada PRD específico deve referenciar este documento e detalhar apenas seu escopo.
