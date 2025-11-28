# AtivePlay - Roadmap MVP

**Objetivo:** Chegar o mais rapido possivel em um link reproduzindo na TV com interface funcional.
**Foco:** VOD (Filmes/Series) - mais facil de reproduzir que Live TV.
**Prioridade Critica:** Player Adapter (VLC-like com tracks embutidos).

---

## Visao Geral das Fases

```
FASE 1          FASE 2          FASE 3          FASE 4          FASE 5
Foundation      Data Layer      Onboarding      Player          UI/Navegacao
   |               |               |               |               |
   v               v               v               v               v
+-------+      +-------+       +-------+       +-------+       +-------+
|Setup  |  ->  |Parser |  ->   |Input  |  ->   |Adapter|  ->   |Home   |
|Vite   |      |IndexDB|       |Loading|       |Samsung|       |Filmes |
|Deps   |      |Schema |       |       |       |LG     |       |Detail |
+-------+      +-------+       +-------+       +-------+       +-------+
   |               |               |               |               |
  1-2h           4-6h            3-4h           8-12h           6-8h
                                                  ^
                                                  |
                                            CRITICO!
```

**Tempo estimado total MVP: ~25-35 horas de desenvolvimento**

---

## FASE 1: Foundation (PRD_Project_Setup + PRD_Dependencies)

**Tempo estimado: 1-2 horas**

### Checklist

- [ ] Criar projeto Vite + React + TypeScript
- [ ] Instalar todas as dependencias (PRD_Dependencies)
- [ ] Configurar vite.config.ts com plugin-legacy (Chromium 56)
- [ ] Configurar tsconfig.json com paths
- [ ] Criar estrutura de pastas basica
- [ ] Criar .env com variaveis
- [ ] Criar polyfills.ts para TVs antigas
- [ ] Criar platformMock.ts para dev no browser
- [ ] Testar `npm run dev` no browser

### Arquivos a Criar

```
ativeplay/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── core/
│   │   ├── polyfills.ts
│   │   └── utils/
│   │       └── platformMock.ts
│   └── styles/
│       ├── variables.css
│       └── global.css
├── vite.config.ts
├── tsconfig.json
├── package.json
└── .env
```

### Comandos

```bash
npm create vite@latest ativeplay -- --template react-ts
cd ativeplay

# Deps de producao
npm install react@^18.2.0 react-dom@^18.2.0 react-router-dom@^6.28.0
npm install zustand@^5.0.8 axios@^1.7.7
npm install dexie@^4.0.10 dexie-react-hooks@^1.1.7
npm install @noriginmedia/norigin-spatial-navigation@^2.1.0
npm install @tanstack/react-virtual@^3.10.9
npm install iptv-playlist-parser@^0.15.0

# Deps de dev
npm install -D @vitejs/plugin-legacy@^5.4.3 terser@^5.36.0 core-js@^3.39.0
npm install -D @types/react@^18.2.0 @types/react-dom@^18.2.0
```

---

## FASE 2: Data Layer (PRD_Parsing)

**Tempo estimado: 4-6 horas**

### Checklist

- [ ] Criar tipos TypeScript (M3UItem, M3UPlaylist, M3UGroup)
- [ ] Implementar M3U Parser com Web Worker
- [ ] Implementar ContentClassifier (movie/series/live)
- [ ] Criar schema IndexedDB com Dexie (v2)
- [ ] Criar operacoes CRUD basicas
- [ ] Testar parser com arquivo M3U real

### Arquivos a Criar

```
src/core/
├── services/
│   └── m3u/
│       ├── types.ts           # Interfaces
│       ├── parser.ts          # Parser principal
│       ├── classifier.ts      # ContentClassifier
│       └── parser.worker.ts   # Web Worker
└── db/
    ├── schema.ts              # Dexie schema
    └── operations.ts          # CRUD helpers
```

### Schema Minimo (v2)

```typescript
this.version(2).stores({
  playlists: 'id, url, lastUpdated, isActive',
  items: 'id, playlistId, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
  groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
  favorites: 'id, [playlistId+itemId], playlistId',
  watchProgress: 'id, [playlistId+itemId], playlistId',
});
```

---

## FASE 3: Onboarding Minimo (PRD_Onboarding simplificado)

**Tempo estimado: 3-4 horas**

### Checklist

- [ ] SplashScreen (2s, verifica playlists)
- [ ] PlaylistInput (teclado TV, URL input)
- [ ] LoadingProgress (progresso do parser)
- [ ] Zustand store para playlist ativa
- [ ] Roteamento basico (react-router-dom)
- [ ] Navegacao espacial basica (Norigin)

### Arquivos a Criar

```
src/
├── ui/
│   └── onboarding/
│       ├── SplashScreen.tsx
│       ├── PlaylistInput.tsx
│       └── LoadingProgress.tsx
├── store/
│   ├── playlistStore.ts
│   └── onboardingStore.ts
└── App.tsx                    # Routes
```

### Fluxo Simplificado (MVP)

```
Splash -> Tem playlist? -> Sim -> Home
                       -> Nao -> PlaylistInput -> Loading -> Home
```

**NOTA:** Pular WelcomeScreen, PlaylistSelector (multi-playlist) para MVP.

---

## FASE 4: Player Adapter (PRD_Player) - CRITICO!

**Tempo estimado: 8-12 horas**

Esta e a fase mais importante. O Player Adapter garante:
- Reproducao igual ao VLC
- Troca de audio embutido (multiplas faixas)
- Troca de legendas embutidas
- Funciona em Samsung E LG

### Checklist

- [ ] Criar interface IPlayerAdapter
- [ ] Criar tipos (Track, AudioTrack, SubtitleTrack, PlayerState)
- [ ] Implementar SamsungAVPlayAdapter (webapis.avplay)
- [ ] Implementar LGWebOSAdapter (HTML5 + Luna Service)
- [ ] Criar PlayerFactory com deteccao de plataforma
- [ ] Criar hook usePlayer
- [ ] Criar UI basica do player (PlayerContainer)
- [ ] Testar no browser com mocks
- [ ] Testar em TV Samsung (se disponivel)
- [ ] Testar em TV LG (se disponivel)

### Arquivos a Criar

```
src/player/
├── types/
│   └── index.ts               # Track, PlayerState, etc.
├── adapters/
│   ├── IPlayerAdapter.ts      # Interface
│   ├── SamsungAVPlayAdapter.ts
│   ├── LGWebOSAdapter.ts
│   └── index.ts
├── hooks/
│   └── usePlayer.ts
├── PlayerFactory.ts
└── index.ts

src/ui/player/
├── PlayerContainer.tsx
├── PlayerOverlay.tsx
├── ProgressBar.tsx
├── AudioSelector.tsx
├── SubtitleSelector.tsx
└── BufferingIndicator.tsx
```

### APIs Principais

**Samsung AVPlay:**
```typescript
webapis.avplay.getTotalTrackInfo()  // Lista tracks
webapis.avplay.setSelectTrack()     // Troca track
```

**LG Luna Service:**
```typescript
webOS.service.request('luna://com.webos.media', {
  method: 'selectTrack',
  parameters: { mediaId, type: 'audio', index }
})
```

---

## FASE 5: UI/Navegacao (PRD_Home + PRD_Filmes simplificados)

**Tempo estimado: 6-8 horas**

### Checklist

- [ ] Home basica com Sidebar minima
- [ ] Grid de filmes (virtualizado)
- [ ] ContentCard com poster
- [ ] Tela de detalhes do filme (sem TMDB por agora)
- [ ] Navegacao D-PAD completa
- [ ] Integrar com Player

### Arquivos a Criar

```
src/ui/
├── home/
│   ├── Home.tsx
│   ├── Sidebar.tsx
│   └── ContentRow.tsx
├── movies/
│   ├── MovieGrid.tsx
│   ├── MovieCard.tsx
│   └── MovieDetail.tsx
└── shared/
    ├── FocusableCard.tsx
    └── Loading.tsx
```

### Fluxo MVP

```
Home (Sidebar: Filmes) -> MovieGrid -> MovieDetail -> [Assistir] -> Player
```

---

## Ordem de Implementacao Detalhada

### Dia 1-2: Foundation + Data

| Tarefa | PRD | Tempo |
|--------|-----|-------|
| 1. Setup Vite + deps | PRD_Project_Setup | 1h |
| 2. Estrutura de pastas | PRD_Project_Setup | 30min |
| 3. Mocks de plataforma | PRD_Project_Setup | 30min |
| 4. Tipos M3U | PRD_Parsing | 1h |
| 5. Parser M3U | PRD_Parsing | 2h |
| 6. Schema IndexedDB | PRD_Parsing | 1h |
| 7. Testar parser | PRD_Parsing | 1h |

### Dia 3: Onboarding Minimo

| Tarefa | PRD | Tempo |
|--------|-----|-------|
| 8. Splash Screen | PRD_Onboarding | 1h |
| 9. URL Input + Teclado | PRD_Onboarding | 2h |
| 10. Loading Progress | PRD_Onboarding | 1h |
| 11. Rotas basicas | PRD_Onboarding | 30min |

### Dia 4-5: Player (CRITICO)

| Tarefa | PRD | Tempo |
|--------|-----|-------|
| 12. Tipos do Player | PRD_Player | 1h |
| 13. IPlayerAdapter | PRD_Player | 1h |
| 14. SamsungAVPlayAdapter | PRD_Player | 3h |
| 15. LGWebOSAdapter | PRD_Player | 3h |
| 16. usePlayer hook | PRD_Player | 1h |
| 17. PlayerContainer UI | PRD_Player | 2h |
| 18. AudioSelector | PRD_Player | 1h |
| 19. SubtitleSelector | PRD_Player | 1h |

### Dia 6-7: UI/Navegacao

| Tarefa | PRD | Tempo |
|--------|-----|-------|
| 20. Home + Sidebar | PRD_Home | 2h |
| 21. MovieGrid virtual | PRD_Filmes | 2h |
| 22. MovieCard | PRD_Filmes | 1h |
| 23. MovieDetail | PRD_Filmes | 2h |
| 24. Navegacao D-PAD | PRD_Home | 1h |

---

## Apos MVP: Melhorias Incrementais

### v1.1 - Polimento
- [ ] TMDB Integration (posters melhores, sinopses)
- [ ] Continue Watching
- [ ] Favoritos

### v1.2 - Multi-Playlist
- [ ] PlaylistSelector
- [ ] Limite de 3 playlists
- [ ] Sidebar com "Minhas Playlists"

### v1.3 - Series
- [ ] PRD_Series (episodios, temporadas)
- [ ] SeasonSelector
- [ ] EpisodeList

### v2.0 - Live TV
- [ ] PRD_LiveTV
- [ ] Channel List
- [ ] Channel Zapping
- [ ] MiniEPG

---

## Arquivos de Configuracao Tizen/webOS

### Para testar em TV Samsung (apos Fase 4)

```
tizen/
├── config.xml
└── icon.png
```

### Para testar em TV LG (apos Fase 4)

```
webos/
├── appinfo.json
├── icon.png
└── largeIcon.png
```

---

## Comandos Uteis

```bash
# Desenvolvimento
npm run dev                    # Localhost:3000

# Build
npm run build                  # Build para dist/

# Deploy Samsung
./scripts/build-tizen.sh       # Gera .wgt
./scripts/deploy-tizen.sh IP   # Instala na TV

# Deploy LG
./scripts/build-webos.sh       # Gera .ipk
./scripts/deploy-webos.sh tv   # Instala na TV
```

---

## Criterios de Sucesso MVP

- [ ] URL M3U carrega e parseia corretamente
- [ ] Lista de filmes aparece na Home
- [ ] Clicar em filme abre detalhes
- [ ] Clicar em "Assistir" abre o player
- [ ] Video reproduz na TV
- [ ] Troca de audio funciona (se stream tiver multiplas faixas)
- [ ] Troca de legenda funciona (se stream tiver legendas)
- [ ] Navegacao D-PAD funciona em todas as telas
- [ ] BACK volta para tela anterior

---

**Documento criado em:** 2025-11-27
**Objetivo:** MVP funcional em 1 semana de desenvolvimento intenso
