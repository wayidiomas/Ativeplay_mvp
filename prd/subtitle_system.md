# PRD: Subtitle System - Sistema de Legendas para AtivePlay

## 1. Visao Geral

### Objetivo
Implementar um sistema completo de legendas para o AtivePlay que permita:
- Exibicao de legendas embutidas em streams HLS
- Busca e download automatico de legendas via OpenSubtitles
- Customizacao completa da aparencia das legendas
- Sincronizacao manual de timing
- Compatibilidade total com Smart TVs (Samsung Tizen / LG webOS)

### Por Que Isso e Importante
- Acessibilidade para usuarios com deficiencia auditiva
- Suporte a idiomas estrangeiros
- Experiencia esperada em apps IPTV modernos (TiviMate, Kodi, IINA)
- Diferencial competitivo

---

## 2. Arquitetura de Legendas

```
+-------------------------------------------------------------------------+
|                    SISTEMA DE LEGENDAS - ARQUITETURA                     |
+-------------------------------------------------------------------------+
|                                                                          |
|   +------------------+     +------------------+     +----------------+   |
|   |  FONTES          |     |  PROCESSAMENTO   |     |  RENDERIZACAO  |   |
|   +------------------+     +------------------+     +----------------+   |
|   |                  |     |                  |     |                |   |
|   |  1. Embutidas    |---->|  SubtitleParser  |---->| SubtitleRender |   |
|   |     (HLS/WebVTT) |     |  - SRT -> VTT    |     |                |   |
|   |                  |     |  - ASS -> VTT    |     |  - Posicao     |   |
|   |  2. OpenSubtitles|---->|  - Timing adj    |     |  - Fonte       |   |
|   |     (API REST)   |     |  - Encoding fix  |     |  - Cor         |   |
|   |                  |     |                  |     |  - Sombra      |   |
|   |  3. Arquivo local|---->|                  |---->|  - Opacidade   |   |
|   |     (upload)     |     |                  |     |                |   |
|   +------------------+     +------------------+     +----------------+   |
|                                                                          |
|   +------------------------------------------------------------------+   |
|   |  STORAGE (IndexedDB)                                              |   |
|   |  - Cache de legendas baixadas (TTL: 30 dias)                      |   |
|   |  - Preferencias do usuario (idioma, estilo)                       |   |
|   |  - Historico de ajustes de sync por arquivo                       |   |
|   +------------------------------------------------------------------+   |
|                                                                          |
+-------------------------------------------------------------------------+
```

---

## 3. Fontes de Legendas

### 3.1 Legendas Embutidas (HLS.js)

HLS streams podem ter legendas WebVTT embutidas. O HLS.js detecta automaticamente:

```typescript
// Eventos HLS.js para legendas
hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, (event, data) => {
  // data.subtitleTracks contem todas as faixas disponiveis
  const tracks = data.subtitleTracks.map(track => ({
    id: track.id,
    language: track.lang,
    label: track.name,
    isDefault: track.default
  }));
});

hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, (event, data) => {
  // Usuario selecionou nova faixa
  console.log('Switched to track:', data.id);
});

// Mudar faixa de legenda
hls.subtitleTrack = trackIndex; // -1 para desativar
```

### 3.2 OpenSubtitles API

**Base URL**: `https://www.opensubtitles.com/api/v1`

#### Autenticacao
```typescript
// Apenas API Key para busca (sem login)
const headers = {
  'Api-Key': import.meta.env.VITE_OPENSUBTITLES_API_KEY,
  'Content-Type': 'application/json'
};

// JWT Token necessario para download (requer login)
const token = await login(username, password);
headers['Authorization'] = `Bearer ${token}`;
```

#### Metodos de Busca

| Metodo | Precisao | Uso |
|--------|----------|-----|
| **IMDB ID** | Alta | Quando temos metadados do conteudo |
| **Nome + Ano** | Media | Fallback quando nao ha IMDB |
| **File Hash** | Muito Alta | Para arquivos locais (nao aplicavel para streams) |
| **Temporada/Episodio** | Alta | Para series com IMDB ID |

```typescript
// Busca por IMDB ID (recomendado)
GET /subtitles?imdb_id=0111161&languages=pt-br,en

// Busca por nome
GET /subtitles?query=The%20Matrix&languages=pt-br

// Busca para serie
GET /subtitles?imdb_id=0903747&season_number=1&episode_number=1&languages=pt-br
```

#### Rate Limits
- **40 requests / 10 segundos** por IP
- **Downloads**: 5 (anonimo) -> 50 (usuario normal) -> 1000 (VIP) por 24h

### 3.3 Upload de Arquivo Local

Para Smart TVs, permitir carregar arquivo .srt via:
- URL remota (HTTP)
- Arquivo em pendrive (USB) - apenas Samsung Tizen

---

## 4. Formatos de Legenda Suportados

### 4.1 WebVTT (Nativo)
```
WEBVTT

00:00:01.000 --> 00:00:04.000
Ola, mundo!

00:00:05.000 --> 00:00:08.000
Esta e uma legenda.
```

### 4.2 SRT (Requer Conversao)
```
1
00:00:01,000 --> 00:00:04,000
Ola, mundo!

2
00:00:05,000 --> 00:00:08,000
Esta e uma legenda.
```

### 4.3 ASS/SSA (Avancado)
Suporte basico - remover formatacao e converter para VTT.

---

## 5. Parser de Legendas

```typescript
// src/player/subtitles/SubtitleParser.ts

export interface SubtitleCue {
  index: number;
  startTime: number;  // ms
  endTime: number;    // ms
  text: string;
}

export class SubtitleParser {
  // Detectar formato automaticamente
  static detectFormat(content: string): 'vtt' | 'srt' | 'ass' | 'unknown' {
    if (content.trimStart().startsWith('WEBVTT')) return 'vtt';
    if (/^\d+\r?\n\d{2}:\d{2}:\d{2},\d{3}/.test(content.trim())) return 'srt';
    if (content.includes('[Script Info]') || content.includes('[Events]')) return 'ass';
    return 'unknown';
  }

  // Converter qualquer formato para array de cues
  static parse(content: string): SubtitleCue[] {
    const format = this.detectFormat(content);
    switch (format) {
      case 'vtt': return this.parseVTT(content);
      case 'srt': return this.parseSRT(content);
      case 'ass': return this.parseASS(content);
      default: throw new Error('Formato de legenda nao suportado');
    }
  }

  // Converter para WebVTT (para uso com <track>)
  static toVTT(cues: SubtitleCue[]): string {
    let vtt = 'WEBVTT\n\n';
    cues.forEach(cue => {
      vtt += `${this.msToVTTTime(cue.startTime)} --> ${this.msToVTTTime(cue.endTime)}\n`;
      vtt += `${cue.text}\n\n`;
    });
    return vtt;
  }

  // Aplicar offset de tempo (sync)
  static applyOffset(cues: SubtitleCue[], offsetMs: number): SubtitleCue[] {
    return cues.map(cue => ({
      ...cue,
      startTime: Math.max(0, cue.startTime + offsetMs),
      endTime: Math.max(0, cue.endTime + offsetMs)
    }));
  }

  private static msToVTTTime(ms: number): string {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    const ms_ = ms % 1000;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}.${ms_.toString().padStart(3,'0')}`;
  }

  // Implementacoes de parseVTT, parseSRT, parseASS...
}
```

---

## 6. Renderizador de Legendas

### Por que Custom Renderer?

| Plataforma | `<track>` nativo | Custom Renderer |
|------------|------------------|-----------------|
| Browser Chrome | Funciona bem | Opcional |
| Samsung Tizen | Limitado | Recomendado |
| LG webOS | Bugs conhecidos | Recomendado |

```typescript
// src/player/subtitles/SubtitleRenderer.ts

export interface SubtitleStyle {
  fontSize: number;        // 50-200 (%)
  fontFamily: string;      // 'Arial', 'Helvetica', etc
  color: string;           // '#FFFFFF'
  backgroundColor: string; // 'rgba(0,0,0,0.7)'
  position: 'top' | 'center' | 'bottom';
  edgeStyle: 'none' | 'outline' | 'shadow' | 'raised' | 'depressed';
  edgeColor: string;
}

export class SubtitleRenderer {
  private container: HTMLDivElement;
  private style: SubtitleStyle;
  private cues: SubtitleCue[] = [];
  private visible: boolean = true;

  constructor(playerContainer: HTMLElement) {
    this.container = document.createElement('div');
    this.container.className = 'subtitle-container';
    this.container.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      bottom: 40px;
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 100;
    `;
    playerContainer.appendChild(this.container);
  }

  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
  }

  // Chamar a cada timeupdate do video
  render(currentTimeMs: number): void {
    if (!this.visible) {
      this.container.innerHTML = '';
      return;
    }

    const activeCues = this.cues.filter(
      cue => cue.startTime <= currentTimeMs && currentTimeMs < cue.endTime
    );

    if (activeCues.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    this.container.innerHTML = activeCues
      .map(cue => `<div class="subtitle-cue">${this.escapeHTML(cue.text)}</div>`)
      .join('');

    this.applyStyles();
  }

  setStyle(style: Partial<SubtitleStyle>): void {
    this.style = { ...this.style, ...style };
    this.applyStyles();
  }

  setVisible(visible: boolean): void {
    this.visible = visible;
    if (!visible) this.container.innerHTML = '';
  }

  destroy(): void {
    this.container.remove();
  }

  private applyStyles(): void {
    const cueElements = this.container.querySelectorAll('.subtitle-cue');
    cueElements.forEach(el => {
      (el as HTMLElement).style.cssText = `
        font-size: ${16 * this.style.fontSize / 100}px;
        font-family: ${this.style.fontFamily};
        color: ${this.style.color};
        background-color: ${this.style.backgroundColor};
        padding: 4px 12px;
        margin: 4px;
        border-radius: 4px;
        text-align: center;
        max-width: 80%;
        ${this.getEdgeStyle()}
      `;
    });
  }

  private getEdgeStyle(): string {
    switch (this.style.edgeStyle) {
      case 'outline':
        return `text-shadow: -1px -1px 0 ${this.style.edgeColor}, 1px -1px 0 ${this.style.edgeColor}, -1px 1px 0 ${this.style.edgeColor}, 1px 1px 0 ${this.style.edgeColor};`;
      case 'shadow':
        return `text-shadow: 2px 2px 4px ${this.style.edgeColor};`;
      default:
        return '';
    }
  }

  private escapeHTML(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
  }
}
```

---

## 7. Servico OpenSubtitles

```typescript
// src/services/subtitles/OpenSubtitlesService.ts

interface SubtitleSearchResult {
  id: string;
  language: string;
  release: string;
  fileId: number;
  fileName: string;
  downloads: number;
  rating: number;
}

interface SearchOptions {
  imdbId?: string;
  query?: string;
  year?: number;
  season?: number;
  episode?: number;
  languages?: string[];
}

class OpenSubtitlesService {
  private baseUrl = 'https://www.opensubtitles.com/api/v1';
  private apiKey: string;
  private userToken: string | null = null;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async search(options: SearchOptions): Promise<SubtitleSearchResult[]> {
    const params = new URLSearchParams();

    if (options.imdbId) params.set('imdb_id', options.imdbId.replace(/^tt/, ''));
    if (options.query) params.set('query', options.query);
    if (options.year) params.set('year', options.year.toString());
    if (options.season) params.set('season_number', options.season.toString());
    if (options.episode) params.set('episode_number', options.episode.toString());
    if (options.languages) params.set('languages', options.languages.join(','));

    const response = await fetch(`${this.baseUrl}/subtitles?${params}`, {
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || '60';
        throw new Error(`Rate limited. Retry after ${retryAfter}s`);
      }
      throw new Error(`Search failed: ${response.status}`);
    }

    const data = await response.json();
    return data.data.map((item: any) => ({
      id: item.id,
      language: item.attributes.language,
      release: item.attributes.release,
      fileId: item.attributes.files[0]?.file_id,
      fileName: item.attributes.files[0]?.file_name,
      downloads: item.attributes.download_count,
      rating: item.attributes.ratings
    }));
  }

  async login(username: string, password: string): Promise<boolean> {
    const response = await fetch(`${this.baseUrl}/login`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) return false;

    const data = await response.json();
    this.userToken = data.token;
    return true;
  }

  async download(fileId: number): Promise<string> {
    if (!this.userToken) {
      throw new Error('Login required for download');
    }

    const response = await fetch(`${this.baseUrl}/download`, {
      method: 'POST',
      headers: {
        'Api-Key': this.apiKey,
        'Authorization': `Bearer ${this.userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file_id: fileId })
    });

    if (!response.ok) {
      throw new Error(`Download failed: ${response.status}`);
    }

    const data = await response.json();
    return data.link || data.content;
  }
}

export default OpenSubtitlesService;
```

---

## 8. UI de Legendas

### 8.1 Menu de Selecao de Legendas

```
+--------------------------------------+
|  LEGENDAS                     [X]    |
+--------------------------------------+
|                                      |
|  ( ) Desativadas                     |
|  (*) Portugues (BR) - Embutida       |
|  ( ) English - Embutida              |
|                                      |
|  ------------------------------------+
|                                      |
|  [Buscar Online]                     |
|  [Carregar Arquivo]                  |
|  [Configuracoes]                     |
|                                      |
+--------------------------------------+
```

### 8.2 Configuracoes de Estilo

```
+--------------------------------------+
|  CONFIGURACOES DE LEGENDA     [X]    |
+--------------------------------------+
|                                      |
|  Tamanho da Fonte                    |
|  [--------*--------] 100%            |
|                                      |
|  Cor do Texto                        |
|  [W B Y B G R]   Branco              |
|                                      |
|  Cor de Fundo                        |
|  [Preto Semi-transparente]           |
|                                      |
|  Posicao                             |
|  [Topo] [Centro] [*Baixo]            |
|                                      |
|  Estilo de Borda                     |
|  [Contorno]                          |
|                                      |
|  ------------------------------------+
|  PREVIEW:                            |
|  +--------------------------------+  |
|  |   Exemplo de legenda aqui      |  |
|  +--------------------------------+  |
|                                      |
|  [Restaurar Padrao]    [Salvar]      |
+--------------------------------------+
```

### 8.3 Ajuste de Sincronizacao

```
+--------------------------------------+
|  SINCRONIZACAO              [X]      |
+--------------------------------------+
|                                      |
|         Atraso da Legenda            |
|                                      |
|    [-5s] <----*----> [+5s]           |
|              +0.0s                   |
|                                      |
|  Atalhos:                            |
|  [G] Adiantar 50ms                   |
|  [H] Atrasar 50ms                    |
|                                      |
|           [Resetar]                  |
+--------------------------------------+
```

---

## 9. Fluxo de Busca Automatica

```
+-----------------------------------------------------------------+
|                 FLUXO DE BUSCA AUTOMATICA                        |
+-----------------------------------------------------------------+
|                                                                  |
|   1. Usuario inicia reproducao de filme/serie                    |
|                      |                                           |
|                      v                                           |
|   2. Verificar se tem legendas embutidas (HLS)                   |
|      +-- SIM -> Usar legendas embutidas                          |
|      +-- NAO                                                     |
|                      |                                           |
|                      v                                           |
|   3. Verificar cache local (IndexedDB)                           |
|      +-- ENCONTROU -> Usar legenda cacheada                      |
|      +-- NAO                                                     |
|                      |                                           |
|                      v                                           |
|   4. Extrair metadados do item M3U                               |
|      - title (do M3UItem)                                        |
|      - year (do parsedTitle)                                     |
|      - season/episode (para series)                              |
|                      |                                           |
|                      v                                           |
|   5. Buscar no OpenSubtitles                                     |
|      +-- query: title                                            |
|      +-- year: year (se disponivel)                              |
|      +-- languages: preferencia do usuario                       |
|      +-- season/episode (se serie)                               |
|                      |                                           |
|                      v                                           |
|   6. Mostrar resultados para selecao                             |
|      - Ordenar por downloads/rating                              |
|      - Destacar idioma preferido                                 |
|                      |                                           |
|                      v                                           |
|   7. Usuario seleciona legenda                                   |
|                      |                                           |
|                      v                                           |
|   8. Download e cache da legenda                                 |
|                      |                                           |
|                      v                                           |
|   9. Renderizar legenda no player                                |
|                                                                  |
+-----------------------------------------------------------------+
```

---

## 10. Persistencia (IndexedDB)

### Schema v4 - Adicionar Tabelas de Legendas

```typescript
// Adicionar ao schema.ts

this.version(4).stores({
  // ... tabelas existentes

  // Cache de legendas baixadas
  subtitleCache: 'id, itemId, language, [itemId+language], createdAt',

  // Preferencias de legenda do usuario
  subtitlePreferences: 'id',
});

interface SubtitleCache {
  id: string;           // hash do conteudo
  itemId: string;       // M3UItem.id
  language: string;     // pt-br, en, etc
  content: string;      // conteudo WebVTT
  source: 'embedded' | 'opensubtitles' | 'manual';
  syncOffset: number;   // offset de sync aplicado
  createdAt: number;
  expiresAt: number;    // TTL de 30 dias
}

interface SubtitlePreferences {
  id: 'default';
  preferredLanguages: string[];  // ['pt-br', 'en']
  autoSearch: boolean;
  style: SubtitleStyle;
  openSubtitlesCredentials?: {
    username: string;
  };
}
```

---

## 11. Teclas de Atalho (D-PAD)

| Tecla | Acao |
|-------|------|
| **G** | Adiantar legenda 50ms |
| **H** | Atrasar legenda 50ms |
| **S** ou **CC** | Toggle legenda on/off |
| **YELLOW** (Samsung) | Abrir menu de legendas |
| **405** (LG) | Abrir menu de legendas |

---

## 12. Componentes React

```
src/player/subtitles/
+-- SubtitleParser.ts           # Parser SRT/VTT/ASS
+-- SubtitleRenderer.ts         # Renderizador customizado
+-- SubtitleManager.ts          # Coordena fontes e rendering
+-- types.ts                    # Tipos compartilhados

src/services/subtitles/
+-- OpenSubtitlesService.ts     # API client
+-- SubtitleCacheService.ts     # Cache IndexedDB

src/ui/player/
+-- SubtitleMenu.tsx            # Menu de selecao
+-- SubtitleSettings.tsx        # Configuracoes de estilo
+-- SubtitleSearch.tsx          # Busca online
+-- SubtitleSync.tsx            # Ajuste de sync
```

---

## 13. Consideracoes Legais

### OpenSubtitles
- API oficial com rate limits
- Requer atribuicao: "Subtitles from OpenSubtitles.com"
- Uso pessoal apenas
- DMCA compliant

### Recomendacoes
1. Incluir disclaimer no app
2. Nao redistribuir legendas
3. Respeitar rate limits
4. Nao cachear indefinidamente (TTL de 30 dias)

---

## 14. Compatibilidade Smart TVs

### Samsung Tizen
- WebVTT via `<track>` element (limitado)
- Custom renderer (recomendado)
- Fetch API para OpenSubtitles
- Fontes limitadas (Arial, Helvetica, sans-serif)

### LG webOS
- `<track>` tem bugs conhecidos
- Custom renderer (recomendado)
- Fetch API para OpenSubtitles
- Overscan - usar margin de 10%

### Fallback Strategy
```typescript
function shouldUseCustomRenderer(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return ua.includes('tizen') || ua.includes('webos') || ua.includes('smarttv');
}
```

---

## 15. Matriz de Prioridade

| Feature | Impacto | Esforco | Prioridade |
|---------|---------|---------|------------|
| **Legendas HLS embutidas** | Alto | Baixo | **P0** |
| **Custom Renderer** | Alto | Medio | **P0** |
| **Parser SRT/VTT** | Alto | Baixo | **P0** |
| **Menu de selecao** | Alto | Baixo | **P0** |
| **OpenSubtitles busca** | Medio | Medio | **P1** |
| **Configuracoes de estilo** | Medio | Medio | **P1** |
| **Ajuste de sync** | Medio | Baixo | **P1** |
| **OpenSubtitles download** | Medio | Medio | **P2** |
| **Cache IndexedDB** | Baixo | Medio | **P2** |
| **Auto-search** | Baixo | Alto | **P3** |

---

## 16. Estimativa de Implementacao

| Fase | Descricao | Esforco |
|------|-----------|---------|
| **Fase 1** | Parser + Renderer + Menu basico | 6-8h |
| **Fase 2** | Integracao HLS.js | 2-3h |
| **Fase 3** | Configuracoes de estilo | 3-4h |
| **Fase 4** | OpenSubtitles service | 4-6h |
| **Fase 5** | Cache + Persistencia | 2-3h |
| **Fase 6** | Testes em Smart TVs | 3-4h |
| **Total** | | **20-28h** |

---

## 17. Variaveis de Ambiente

```env
# .env
VITE_OPENSUBTITLES_API_KEY=your_api_key_here
VITE_SUBTITLE_CACHE_TTL_DAYS=30
VITE_ENABLE_AUTO_SUBTITLE_SEARCH=false
```

---

## 18. Referencias

- [OpenSubtitles REST API Docs](https://opensubtitles.stoplight.io/docs/opensubtitles-api)
- [HLS.js Subtitle Events](https://github.com/video-dev/hls.js/blob/master/docs/API.md)
- [WebVTT Spec](https://www.w3.org/TR/webvtt1/)
- [Kodi Subtitle System](https://kodi.wiki/view/Subtitles)
- [VLC VLSub](https://wiki.videolan.org/VLSub/)
- [IINA Subtitle Providers](https://docs.iina.io/pages/subtitle-providers.html)
