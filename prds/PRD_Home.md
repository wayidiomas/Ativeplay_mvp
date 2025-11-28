# PRD: Home Screen (Netflix-Like Interface)

**Versão:** 1.1.0
**Data:** 2025-11-26
**Status:** Aprovado
**Atualização:** Sidebar com "➕ Nova Playlist", PlaylistSelector, múltiplas playlists

---

## 1. Visão Geral

A Home Screen é o hub central do AtivePlay após o onboarding. Apresenta uma interface estilo Netflix com carrosséis horizontais, navegação por D-PAD, e organização inteligente de conteúdo baseada nos dados parseados da playlist M3U.

### 1.1 Objetivos

1. Exibir conteúdo organizado por tipo (Live TV, Filmes, Séries)
2. Permitir navegação fluida com controle remoto (D-PAD)
3. Mostrar progresso de reprodução (Continue Watching)
4. Acesso rápido a favoritos
5. Hero Banner com conteúdo destacado

### 1.2 Referências

- [PRD_Onboarding.md](./PRD_Onboarding.md) - Fluxo anterior
- [PRD_Parsing.md](./PRD_Parsing.md) - Estrutura de dados M3U
- [PRD_Dependencies.md](./PRD_Dependencies.md) - Versões de bibliotecas

---

## 2. Layout da Tela (1920x1080)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                         HERO BANNER (480px height)                      │ │
│  │  ┌──────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Backdrop Image (blur/gradient overlay)                          │  │ │
│  │  │                                                                   │  │ │
│  │  │  TÍTULO DO CONTEÚDO                                              │  │ │
│  │  │  Descrição breve do conteúdo selecionado...                      │  │ │
│  │  │                                                                   │  │ │
│  │  │  [▶ ASSISTIR]  [+ FAVORITOS]                                     │  │ │
│  │  └──────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌─────┐ ┌────────────────────────────────────────────────────────────────┐ │
│  │     │ │  Continue Assistindo                              ← SCROLL →  │ │
│  │  S  │ │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │ │
│  │  I  │ │  │ THUMB  │ │ THUMB  │ │ THUMB  │ │ THUMB  │ │ THUMB  │      │ │
│  │  D  │ │  │ ████▒▒ │ │ ██████ │ │ ████▒▒ │ │ █▒▒▒▒▒ │ │ ██████ │      │ │
│  │  E  │ │  │ Title  │ │ Title  │ │ Title  │ │ Title  │ │ Title  │      │ │
│  │  B  │ │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘      │ │
│  │  A  │ └────────────────────────────────────────────────────────────────┘ │
│  │  R  │                                                                     │
│  │     │ ┌────────────────────────────────────────────────────────────────┐ │
│  │  🏠 │ │  TV ao Vivo                                       ← SCROLL →  │ │
│  │  📺 │ │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │ │
│  │  🎬 │ │  │ LOGO   │ │ LOGO   │ │ LOGO   │ │ LOGO   │ │ LOGO   │      │ │
│  │  📼 │ │  │ Channel│ │ Channel│ │ Channel│ │ Channel│ │ Channel│      │ │
│  │  ⭐ │ │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘      │ │
│  │  ⚙️ │ └────────────────────────────────────────────────────────────────┘ │
│  └─────┘                                                                     │
│          ┌────────────────────────────────────────────────────────────────┐ │
│          │  Filmes                                           ← SCROLL →  │ │
│          │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐      │ │
│          │  │ POSTER │ │ POSTER │ │ POSTER │ │ POSTER │ │ POSTER │      │ │
│          │  │        │ │        │ │        │ │        │ │        │      │ │
│          │  │ Title  │ │ Title  │ │ Title  │ │ Title  │ │ Title  │      │ │
│          │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘      │ │
│          └────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Estrutura de Componentes

### 3.1 Arquivos

```
src/ui/home/
├── Home.tsx                    # Container principal
├── HeroBanner/
│   ├── HeroBanner.tsx         # Banner com backdrop
│   ├── HeroBanner.module.css
│   └── HeroActions.tsx        # Botões do hero
├── Sidebar/
│   ├── Sidebar.tsx            # Menu lateral
│   ├── SidebarItem.tsx        # Item focável
│   └── Sidebar.module.css
├── ContentRow/
│   ├── ContentRow.tsx         # Seção horizontal
│   ├── ContentCard.tsx        # Card individual
│   ├── CardProgress.tsx       # Barra de progresso
│   └── ContentRow.module.css
├── CategoryPage/
│   ├── CategoryPage.tsx       # Página de categoria
│   └── CategoryGrid.tsx       # Grid de conteúdo
└── hooks/
    ├── useHomeData.ts         # Dados da home
    ├── useContinueWatching.ts # Progresso de reprodução
    └── useFavorites.ts        # Favoritos
```

---

## 4. Hero Banner

### 4.1 Especificações

```typescript
interface HeroBannerProps {
  item: M3UItem | null;
  onPlay: () => void;
  onFavorite: () => void;
}
```

### 4.2 Layout

| Propriedade | Valor |
|-------------|-------|
| Altura | 480px (fixa) |
| Largura | 100% da tela |
| Backdrop | tvg-logo ou TMDB backdrop (blur + gradient) |
| Gradient overlay | `linear-gradient(to right, #09182B 30%, transparent 70%)` |

### 4.3 Conteúdo

| Elemento | Especificação |
|----------|---------------|
| Título | Inter 700, 48px, branco |
| Descrição | Inter 400, 18px, #CECECE (max 2 linhas, truncate) |
| Botão Assistir | Verde (#1FAF38) |
| Botão Favoritos | Roxo (#7382FD) |

### 4.4 Lógica de Seleção do Item

1. Primeiro item de "Continue Watching" se houver
2. Primeiro item de "Favoritos" se houver
3. Item aleatório de Filmes/Séries
4. Fallback: Primeiro item da playlist

---

## 5. Sidebar (Menu Lateral) - Atualizado v1.1

### 5.1 Especificações

```typescript
interface SidebarItem {
  id: string;
  icon: string;
  label: string;
  route: string;
  mediaKind?: MediaKind;
  alwaysVisible?: boolean;  // NOVO: Item sempre visível (ex: Add Playlist)
  type?: 'navigation' | 'action' | 'selector';  // NOVO: Tipo do item
}

// ATUALIZADO v1.1: Nova estrutura com "Adicionar Playlist" e "Minhas Playlists"
const SIDEBAR_ITEMS: SidebarItem[] = [
  // SEÇÃO 1: AÇÕES PRINCIPAIS (sempre visíveis no topo)
  { id: 'add-playlist', icon: '➕', label: 'Nova Playlist', route: '/input', type: 'action', alwaysVisible: true },

  // SEÇÃO 2: GERENCIAMENTO (se houver múltiplas playlists)
  { id: 'playlists', icon: '📋', label: 'Minhas Playlists', route: '/playlists', type: 'selector' },

  // SEPARADOR VISUAL (divider)

  // SEÇÃO 3: NAVEGAÇÃO PRINCIPAL
  { id: 'home', icon: '🏠', label: 'Início', route: '/home', type: 'navigation' },
  { id: 'live', icon: '📺', label: 'TV ao Vivo', route: '/category/live', mediaKind: 'live', type: 'navigation' },
  { id: 'movies', icon: '🎬', label: 'Filmes', route: '/category/movie', mediaKind: 'movie', type: 'navigation' },
  { id: 'series', icon: '📼', label: 'Séries', route: '/category/series', mediaKind: 'series', type: 'navigation' },
  { id: 'favorites', icon: '⭐', label: 'Favoritos', route: '/favorites', type: 'navigation' },

  // SEPARADOR VISUAL (divider)

  // SEÇÃO 4: CONFIGURAÇÕES
  { id: 'settings', icon: '⚙️', label: 'Configurações', route: '/settings', type: 'navigation' },
];
```

### 5.1.1 Lógica de Exibição Condicional

```typescript
function getSidebarItems(playlistCount: number): SidebarItem[] {
  return SIDEBAR_ITEMS.filter(item => {
    // "Minhas Playlists" só aparece se houver 2+ playlists
    if (item.id === 'playlists' && playlistCount < 2) {
      return false;
    }
    return true;
  });
}
```

### 5.2 Layout

| Propriedade | Valor |
|-------------|-------|
| Largura colapsada | 80px |
| Largura expandida | 240px |
| Posição | Fixa à esquerda |
| Fundo | #071A2B (Navy Secondary) |

### 5.3 Navegação

| Tecla | Ação |
|-------|------|
| UP/DOWN | Move entre itens |
| OK/Enter | Seleciona/navega |
| RIGHT | Move foco para conteúdo |
| LEFT | Colapsa sidebar (se expandido) |

### 5.4 Estados Visuais

| Estado | Estilo |
|--------|--------|
| Normal | Ícone + label (se expandido) |
| Focused | Fundo #7382FD (roxo), scale(1.05) |
| Selected | Border-left 4px #1FAF38 (verde) |

---

## 6. Content Row (Carrossel Horizontal)

### 6.1 Especificações

```typescript
interface ContentRowProps {
  title: string;
  items: M3UItem[];
  onItemSelect: (item: M3UItem) => void;
  onItemFocus: (item: M3UItem) => void;
  showProgress?: boolean;  // Para "Continue Watching"
}
```

### 6.2 Layout

| Propriedade | Valor |
|-------------|-------|
| Título | Inter 600, 24px, branco, margin-bottom 16px |
| Cards visíveis | 5 por vez (200px width cada) |
| Gap entre cards | 16px |
| Padding horizontal | 100px |
| Scroll | Horizontal smooth animation |

### 6.3 Navegação

| Tecla | Ação |
|-------|------|
| LEFT/RIGHT | Move entre cards |
| UP/DOWN | Move entre rows |
| OK/Enter | Seleciona item |

### 6.4 Lazy Loading

- Carregar 10 items inicialmente
- Carregar mais 10 ao aproximar do final
- Usar IntersectionObserver para trigger

---

## 7. Content Card

### 7.1 Especificações

```typescript
interface ContentCardProps {
  item: M3UItem;
  focused: boolean;
  progress?: number;  // 0-100 para Continue Watching
  onSelect: () => void;
}
```

### 7.2 Dimensões por Tipo

| MediaKind | Largura | Altura | Aspect Ratio |
|-----------|---------|--------|--------------|
| live | 200px | 112px | 16:9 |
| movie | 160px | 240px | 2:3 (poster) |
| series | 160px | 240px | 2:3 (poster) |
| vod | 200px | 112px | 16:9 |

### 7.3 Estrutura Visual

```
┌──────────────────────┐
│                      │
│      THUMBNAIL       │  ← tvg-logo ou placeholder
│      (tvg-logo)      │
│                      │
├──────────────────────┤
│ ████████░░░░ 65%     │  ← Progress bar (se aplicável)
├──────────────────────┤
│ Título do Conteúdo   │  ← Inter 500, 14px, truncate
│ Grupo/Categoria      │  ← Inter 400, 12px, #CECECE
└──────────────────────┘
```

### 7.4 Estados

| Estado | Estilo |
|--------|--------|
| Normal | Border 2px transparent |
| Focused | Border 2px #7382FD, scale(1.08), shadow |
| Placeholder | Gradient #071A2B com ícone de mídia |

---

## 8. Seções da Home (Ordem)

### 8.1 Configuração

```typescript
interface HomeSection {
  id: string;
  title: string;
  type: 'continue' | 'favorites' | 'mediaKind' | 'group';
  filter?: MediaKind | string;
  maxItems?: number;
}

const HOME_SECTIONS: HomeSection[] = [
  { id: 'continue', title: 'Continue Assistindo', type: 'continue', maxItems: 20 },
  { id: 'favorites', title: 'Meus Favoritos', type: 'favorites', maxItems: 20 },
  { id: 'live', title: 'TV ao Vivo', type: 'mediaKind', filter: 'live', maxItems: 20 },
  { id: 'movies', title: 'Filmes', type: 'mediaKind', filter: 'movie', maxItems: 20 },
  { id: 'series', title: 'Séries', type: 'mediaKind', filter: 'series', maxItems: 20 },
  // Grupos dinâmicos da playlist serão adicionados aqui
];
```

### 8.2 Lógica de Exibição

- Seções vazias são ocultadas automaticamente
- "Continue Watching" só aparece se houver progresso salvo
- "Favoritos" só aparece se houver favoritos
- Grupos da playlist são adicionados dinamicamente

---

## 9. Hooks da Home

### 9.1 useHomeData

```typescript
// src/ui/home/hooks/useHomeData.ts

interface HomeData {
  playlist: M3UPlaylist | null;
  sections: {
    id: string;
    title: string;
    items: M3UItem[];
  }[];
  heroBannerItem: M3UItem | null;
  isLoading: boolean;
}

export function useHomeData(playlistId: string): HomeData {
  const [data, setData] = useState<HomeData>({ ... });

  useEffect(() => {
    async function loadData() {
      // 1. Carregar playlist do IndexedDB
      const playlist = await db.playlists.get(playlistId);

      // 2. Carregar grupos
      const groups = await db.groups
        .where('playlistId')
        .equals(playlistId)
        .toArray();

      // 3. Montar seções
      const sections = await buildSections(playlistId, groups);

      // 4. Selecionar item do hero
      const heroBannerItem = selectHeroItem(sections);

      setData({ playlist, sections, heroBannerItem, isLoading: false });
    }

    loadData();
  }, [playlistId]);

  return data;
}
```

### 9.2 useContinueWatching

```typescript
// src/ui/home/hooks/useContinueWatching.ts

interface WatchProgress {
  itemId: string;
  playlistId: string;
  progress: number;      // 0-100
  position: number;      // segundos
  duration: number;      // segundos
  lastWatched: Date;
}

export function useContinueWatching(playlistId: string) {
  const [items, setItems] = useState<(M3UItem & { progress: number })[]>([]);

  // Carregar do IndexedDB (tabela watchProgress)
  // Ordenar por lastWatched DESC
  // Filtrar items com progress > 5% e < 95%

  const updateProgress = useCallback(async (
    itemId: string,
    position: number,
    duration: number
  ) => {
    const progress = Math.round((position / duration) * 100);
    await db.watchProgress.put({
      itemId,
      playlistId,
      progress,
      position,
      duration,
      lastWatched: new Date(),
    });
  }, [playlistId]);

  return { items, updateProgress };
}
```

### 9.3 useFavorites

```typescript
// src/ui/home/hooks/useFavorites.ts

export function useFavorites(playlistId: string) {
  const [favorites, setFavorites] = useState<M3UItem[]>([]);

  const toggleFavorite = useCallback(async (itemId: string) => {
    const existing = await db.favorites.get({ itemId, playlistId });
    if (existing) {
      await db.favorites.delete(existing.id);
    } else {
      await db.favorites.add({ itemId, playlistId, addedAt: new Date() });
    }
  }, [playlistId]);

  const isFavorite = useCallback((itemId: string) => {
    return favorites.some(f => f.id === itemId);
  }, [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}
```

---

## 10. Navegação D-PAD

### 10.1 Fluxo de Navegação

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                  │
│  SIDEBAR ◄────────────── LEFT ──────────────► CONTENT AREA      │
│                                                                  │
│  ▲ UP                                           ▲ UP            │
│  │                                              │                │
│  ▼ DOWN                                         ▼ DOWN          │
│                                                                  │
│  [Item 1]                                 [Hero Banner]          │
│  [Item 2] ◄──── RIGHT ────►               [Continue Row]        │
│  [Item 3]                                 [Live TV Row]          │
│  [Item 4]                                 [Movies Row]           │
│  [Item 5]                                 [Series Row]           │
│  [Item 6]                                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 10.2 Teclas Mapeadas

```typescript
// src/core/constants/keys.ts

export const TV_KEYS = {
  // Navegação básica
  UP: 38,
  DOWN: 40,
  LEFT: 37,
  RIGHT: 39,
  ENTER: 13,

  // Back button (diferente por plataforma)
  BACK_SAMSUNG: 10009,
  BACK_LG: 461,
  BACK_BROWSER: 8,  // Backspace para dev

  // Teclas coloridas
  RED: 403,
  GREEN: 404,
  YELLOW: 405,
  BLUE: 406,

  // Playback
  PLAY: 415,
  PAUSE: 19,
  STOP: 413,
  REWIND: 412,
  FORWARD: 417,
};
```

### 10.3 Integração Norigin Spatial Navigation

```typescript
// src/ui/home/Home.tsx

import { init, useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';

// Inicializar no App.tsx
init({
  debug: import.meta.env.DEV,
  visualDebug: import.meta.env.DEV,
});

function Home() {
  const { ref, focusKey } = useFocusable({
    trackChildren: true,
    saveLastFocusedChild: true,
  });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.home}>
        <Sidebar />
        <main className={styles.content}>
          <HeroBanner item={heroBannerItem} />
          {sections.map(section => (
            <ContentRow
              key={section.id}
              title={section.title}
              items={section.items}
            />
          ))}
        </main>
      </div>
    </FocusContext.Provider>
  );
}
```

---

## 11. Zustand Store (homeStore)

```typescript
// src/store/homeStore.ts

interface HomeState {
  // Playlist atual
  currentPlaylistId: string | null;

  // Favoritos
  favoriteIds: string[];

  // Continue Watching
  watchProgress: Record<string, WatchProgress>;

  // UI State
  sidebarExpanded: boolean;
  selectedCategory: string | null;

  // Actions
  setCurrentPlaylist: (id: string) => void;
  toggleFavorite: (itemId: string) => void;
  updateWatchProgress: (itemId: string, progress: WatchProgress) => void;
  toggleSidebar: () => void;
  selectCategory: (category: string | null) => void;
}

export const useHomeStore = create<HomeState>()(
  persist(
    (set, get) => ({
      currentPlaylistId: null,
      favoriteIds: [],
      watchProgress: {},
      sidebarExpanded: false,
      selectedCategory: null,

      setCurrentPlaylist: (id) => set({ currentPlaylistId: id }),

      toggleFavorite: (itemId) => set((state) => ({
        favoriteIds: state.favoriteIds.includes(itemId)
          ? state.favoriteIds.filter(id => id !== itemId)
          : [...state.favoriteIds, itemId]
      })),

      updateWatchProgress: (itemId, progress) => set((state) => ({
        watchProgress: { ...state.watchProgress, [itemId]: progress }
      })),

      toggleSidebar: () => set((state) => ({
        sidebarExpanded: !state.sidebarExpanded
      })),

      selectCategory: (category) => set({ selectedCategory: category }),
    }),
    {
      name: 'ativeplay-home',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

---

## 12. Schema IndexedDB (v2)

```typescript
// src/core/db/schema.ts

export class AtivePlayDB extends Dexie {
  playlists!: Table<M3UPlaylist>;
  items!: Table<M3UItem>;
  groups!: Table<M3UGroup>;
  favorites!: Table<Favorite>;        // NOVO
  watchProgress!: Table<WatchProgress>; // NOVO

  constructor() {
    super('ativeplay');

    this.version(2).stores({
      playlists: 'id, url, lastUpdated',
      items: 'id, playlistId, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId, addedAt',
      watchProgress: 'id, [playlistId+itemId], playlistId, lastWatched',
    });
  }
}

interface Favorite {
  id: string;
  playlistId: string;
  itemId: string;
  addedAt: Date;
}

interface WatchProgress {
  id: string;
  playlistId: string;
  itemId: string;
  progress: number;
  position: number;
  duration: number;
  lastWatched: Date;
}
```

---

## 13. CSS Design Tokens

```css
/* src/styles/home.module.css */

.home {
  display: flex;
  min-height: 100vh;
  background-color: var(--color-navy-primary);
}

.content {
  flex: 1;
  margin-left: 80px; /* Sidebar colapsada */
  transition: margin-left 200ms ease;
}

.content.sidebarExpanded {
  margin-left: 240px;
}

/* Hero Banner */
.heroBanner {
  height: 480px;
  position: relative;
  overflow: hidden;
}

.heroBackdrop {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  filter: blur(20px);
  transform: scale(1.1);
}

.heroGradient {
  position: absolute;
  inset: 0;
  background: linear-gradient(to right, var(--color-navy-primary) 30%, transparent 70%),
              linear-gradient(to top, var(--color-navy-primary) 0%, transparent 50%);
}

.heroContent {
  position: relative;
  padding: 80px 100px;
  max-width: 600px;
}

/* Content Row */
.contentRow {
  padding: 24px 100px;
}

.rowTitle {
  font-family: var(--font-primary);
  font-size: 24px;
  font-weight: 600;
  color: var(--color-white);
  margin-bottom: 16px;
}

.rowScroller {
  display: flex;
  gap: 16px;
  overflow-x: hidden;
  scroll-behavior: smooth;
}

/* Content Card */
.contentCard {
  flex-shrink: 0;
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-navy-secondary);
  border: 2px solid transparent;
  transition: transform 150ms ease, border-color 150ms ease;
}

.contentCard.focused {
  border-color: var(--color-purple);
  transform: scale(1.08);
  box-shadow: 0 8px 32px rgba(115, 130, 253, 0.3);
}

.cardThumbnail {
  width: 100%;
  aspect-ratio: 16/9; /* ou 2/3 para posters */
  object-fit: cover;
  background: linear-gradient(135deg, var(--color-navy-secondary), var(--color-navy-primary));
}

.cardProgress {
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
}

.cardProgressFill {
  height: 100%;
  background: var(--color-purple);
}

.cardInfo {
  padding: 8px 12px;
}

.cardTitle {
  font-family: var(--font-primary);
  font-size: 14px;
  font-weight: 500;
  color: var(--color-white);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cardSubtitle {
  font-family: var(--font-primary);
  font-size: 12px;
  font-weight: 400;
  color: var(--color-gray);
}
```

---

## 14. Performance Optimizations

### 14.1 Virtual Scrolling para Rows

Para playlists com muitos items, usar virtualização:

```typescript
// Usar @tanstack/react-virtual
import { useVirtualizer } from '@tanstack/react-virtual';

function ContentRow({ items }: { items: M3UItem[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 216,  // card width + gap
    horizontal: true,
    overscan: 3,
  });

  return (
    <div ref={parentRef} className={styles.rowScroller}>
      <div style={{ width: `${virtualizer.getTotalSize()}px` }}>
        {virtualizer.getVirtualItems().map(virtualItem => (
          <ContentCard
            key={virtualItem.key}
            item={items[virtualItem.index]}
            style={{
              position: 'absolute',
              left: virtualItem.start,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

### 14.2 Image Loading

```typescript
// Lazy load de imagens com placeholder
function CardThumbnail({ src, alt }: { src?: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  return (
    <div className={styles.thumbnailContainer}>
      {!loaded && <div className={styles.placeholder}>🎬</div>}
      {src && !error && (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
          className={cn(styles.thumbnail, loaded && styles.loaded)}
        />
      )}
    </div>
  );
}
```

---

## 15. Testes

```typescript
// src/ui/home/__tests__/Home.test.tsx

describe('Home Screen', () => {
  test('renderiza seções baseadas nos dados da playlist', async () => {
    // Mock de dados
    const mockPlaylist = createMockPlaylist();

    render(<Home playlistId={mockPlaylist.id} />);

    expect(screen.getByText('TV ao Vivo')).toBeInTheDocument();
    expect(screen.getByText('Filmes')).toBeInTheDocument();
  });

  test('navega entre cards com D-PAD', async () => {
    render(<Home playlistId="test" />);

    // Simular navegação
    fireEvent.keyDown(document, { keyCode: TV_KEYS.RIGHT });

    // Verificar foco moveu
    const firstCard = screen.getAllByTestId('content-card')[0];
    expect(firstCard).toHaveFocus();
  });

  test('adiciona item aos favoritos', async () => {
    render(<Home playlistId="test" />);

    const favoriteButton = screen.getByText('+ FAVORITOS');
    fireEvent.click(favoriteButton);

    // Verificar estado atualizado
    expect(useHomeStore.getState().favoriteIds).toContain('item-id');
  });
});
```

---

## 16. Dependências Adicionais

```json
{
  "dependencies": {
    "@tanstack/react-virtual": "^3.10.9"
  }
}
```

---

## 17. Checklist de Implementação

- [ ] Criar estrutura de pastas `src/ui/home/`
- [ ] Implementar Home.tsx com FocusContext
- [ ] Implementar HeroBanner com backdrop e gradient
- [ ] Implementar Sidebar com estados (collapsed/expanded)
- [ ] Implementar ContentRow com scroll horizontal
- [ ] Implementar ContentCard com estados visuais
- [ ] Implementar useHomeData hook
- [ ] Implementar useContinueWatching hook
- [ ] Implementar useFavorites hook
- [ ] Criar homeStore com persist
- [ ] Atualizar IndexedDB schema para v2
- [ ] Implementar virtual scrolling para rows grandes
- [ ] Configurar Norigin Spatial Navigation
- [ ] Adicionar lazy loading de imagens
- [ ] Escrever testes unitários

---

## 18. PlaylistSelector (NOVO v1.1)

### 18.1 Visão Geral

A tela PlaylistSelector permite ao usuário gerenciar e alternar entre múltiplas playlists.

### 18.2 Layout

```
┌──────────────────────────────────────────────────┐
│  ← Voltar              MINHAS PLAYLISTS          │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ 📋 Minha Lista Principal                    │  │  ← Item focado (ativo)
│  │    1.234 canais • ✓ Ativo                  │  │
│  │    Última atualização: Hoje às 14:30       │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ 📋 Lista de Backup                          │  │
│  │    890 canais                               │  │
│  │    Última atualização: 2 dias atrás        │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ 📋 Lista Esportes                           │  │
│  │    456 canais                               │  │
│  │    Última atualização: 1 semana atrás      │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │ ➕ Adicionar Nova Playlist                  │  │
│  └────────────────────────────────────────────┘  │
│                                                  │
│  ─────────────────────────────────────────────── │
│  [ENTER] Selecionar   [🔴] Remover   [←] Voltar │
└──────────────────────────────────────────────────┘
```

### 18.3 Estrutura de Arquivos

```
src/ui/playlists/
├── PlaylistSelector.tsx          # Componente principal
├── PlaylistItem.tsx              # Item individual de playlist
├── PlaylistSelector.module.css   # Estilos
└── usePlaylistSelector.ts        # Hook com lógica
```

### 18.4 Componente PlaylistSelector

```typescript
// src/ui/playlists/PlaylistSelector.tsx

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { usePlaylistStore } from '@/store/playlistStore';
import { PlaylistItem } from './PlaylistItem';
import styles from './PlaylistSelector.module.css';

export const PlaylistSelector: React.FC = () => {
  const navigate = useNavigate();
  const { playlists, activePlaylistId, setActivePlaylist, removePlaylist } = usePlaylistStore();

  const { ref, focusKey, focusSelf } = useFocusable({
    trackChildren: true,
    saveLastFocusedChild: true,
  });

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  const handleSelectPlaylist = async (playlistId: string) => {
    await setActivePlaylist(playlistId);
    navigate('/home');
  };

  const handleRemovePlaylist = async (playlistId: string) => {
    // Confirmar remoção (modal ou atalho)
    await removePlaylist(playlistId);

    // Se não houver mais playlists, ir para welcome
    if (playlists.length <= 1) {
      navigate('/welcome');
    }
  };

  const handleAddPlaylist = () => {
    navigate('/input');
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backButton} onClick={() => navigate(-1)}>
            ← Voltar
          </button>
          <h1 className={styles.title}>Minhas Playlists</h1>
        </header>

        <main className={styles.content}>
          {playlists.map((playlist) => (
            <PlaylistItem
              key={playlist.id}
              playlist={playlist}
              isActive={playlist.id === activePlaylistId}
              onSelect={() => handleSelectPlaylist(playlist.id)}
              onRemove={() => handleRemovePlaylist(playlist.id)}
            />
          ))}

          {/* Botão Adicionar Nova */}
          <PlaylistItem
            isAddButton
            onSelect={handleAddPlaylist}
          />
        </main>

        <footer className={styles.footer}>
          <span>[ENTER] Selecionar</span>
          <span>[🔴] Remover</span>
          <span>[←] Voltar</span>
        </footer>
      </div>
    </FocusContext.Provider>
  );
};
```

### 18.5 Componente PlaylistItem

```typescript
// src/ui/playlists/PlaylistItem.tsx

import React from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { PlaylistMeta } from '@/store/playlistStore';
import { formatRelativeTime } from '@/utils/date';
import styles from './PlaylistSelector.module.css';

interface PlaylistItemProps {
  playlist?: PlaylistMeta;
  isActive?: boolean;
  isAddButton?: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}

export const PlaylistItem: React.FC<PlaylistItemProps> = ({
  playlist,
  isActive,
  isAddButton,
  onSelect,
  onRemove,
}) => {
  const { ref, focused } = useFocusable({
    onEnterPress: onSelect,
    extraProps: { onRemove },
  });

  // Handler para tecla vermelha (remover)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (focused && e.keyCode === 403 && onRemove) {  // 403 = RED
        onRemove();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focused, onRemove]);

  if (isAddButton) {
    return (
      <button
        ref={ref}
        className={`${styles.item} ${styles.addButton} ${focused ? styles.focused : ''}`}
      >
        <span className={styles.icon}>➕</span>
        <span className={styles.name}>Adicionar Nova Playlist</span>
      </button>
    );
  }

  return (
    <button
      ref={ref}
      className={`${styles.item} ${focused ? styles.focused : ''} ${isActive ? styles.active : ''}`}
    >
      <span className={styles.icon}>📋</span>
      <div className={styles.info}>
        <span className={styles.name}>{playlist?.name}</span>
        <span className={styles.meta}>
          {playlist?.itemCount.toLocaleString()} canais
          {isActive && ' • ✓ Ativo'}
        </span>
        <span className={styles.date}>
          Última atualização: {formatRelativeTime(playlist?.updatedAt || 0)}
        </span>
      </div>
    </button>
  );
};
```

### 18.6 Estilos

```css
/* src/ui/playlists/PlaylistSelector.module.css */

.container {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: var(--color-navy-primary);
  padding: 48px 100px;
}

.header {
  display: flex;
  align-items: center;
  gap: 24px;
  margin-bottom: 48px;
}

.backButton {
  background: transparent;
  border: none;
  color: var(--color-gray);
  font-size: 16px;
  cursor: pointer;
}

.title {
  font-family: var(--font-primary);
  font-size: 32px;
  font-weight: 600;
  color: var(--color-white);
}

.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
}

.item {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 24px;
  background: var(--color-navy-secondary);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 150ms ease;
  text-align: left;
}

.item.focused {
  border-color: var(--color-purple);
  background: rgba(115, 130, 253, 0.1);
  transform: scale(1.02);
}

.item.active {
  border-color: var(--color-green);
}

.icon {
  font-size: 32px;
}

.info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.name {
  font-family: var(--font-primary);
  font-size: 20px;
  font-weight: 500;
  color: var(--color-white);
}

.meta {
  font-family: var(--font-primary);
  font-size: 14px;
  color: var(--color-gray);
}

.date {
  font-family: var(--font-primary);
  font-size: 12px;
  color: var(--color-gray);
  opacity: 0.7;
}

.addButton {
  border-style: dashed;
  background: transparent;
}

.addButton .name {
  color: var(--color-cyan);
}

.footer {
  display: flex;
  gap: 32px;
  padding-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-gray);
  font-size: 14px;
}
```

### 18.7 Navegação D-PAD

| Tecla | Ação |
|-------|------|
| UP/DOWN | Move entre playlists |
| OK/Enter | Seleciona playlist e vai para Home |
| RED (403) | Remove playlist (com confirmação) |
| BACK | Volta para tela anterior |

---

## 19. Fluxo Pós-Home

```
┌──────────┐     ┌──────────────┐     ┌──────────┐
│   HOME   │────▶│ CATEGORY PAGE│────▶│  PLAYER  │
└──────────┘     └──────────────┘     └──────────┘
      │                 │                   │
      │    ┌────────────┴───────────┐      │
      │    ▼                        ▼      │
      │  ┌──────────┐     ┌──────────────┐ │
      └─▶│PLAYLISTS │     │   SETTINGS   │◀┘
         │ SELECTOR │     └──────────────┘
         └──────────┘
```

**Próximo PRD**: PRD_Player.md (já existente - revisar integração)
