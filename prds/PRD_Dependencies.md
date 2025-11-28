# PRD: Dependencies & Versions

**Versão**: 1.1
**Data**: 26/11/2024
**Autor**: Claude (via Context7 MCP)
**Status**: Aprovado
**Atualização**: Adicionado @tanstack/react-virtual para virtual scrolling

---

## 1. Visão Geral

Este PRD documenta as versões ideais de todas as dependências do projeto **AtivePlay**, com justificativas baseadas na compatibilidade com Smart TVs (Samsung Tizen 4.0 / Chromium 56 e LG webOS 5.0 / Chromium 68).

### 1.1 Objetivo

Garantir estabilidade e compatibilidade do aplicativo em Smart TVs com engines JavaScript mais antigas, evitando breaking changes e problemas de runtime.

### 1.2 Metodologia

Todas as versões foram pesquisadas usando o **Context7 MCP** para obter documentação oficial e informações de compatibilidade atualizadas.

---

## 2. Restrições de Plataforma

| Plataforma | Versão Mínima | Engine | ES Target | Data de Lançamento |
|------------|---------------|--------|-----------|-------------------|
| Samsung Tizen | 4.0 | Chromium 56 | ES2015 | 2018 |
| LG webOS | 5.0 | Chromium 68 | ES2017 | 2020 |

### 2.1 Regra de Compatibilidade

```
Target: ES2015 (ES6)
```

Usar **ES2015** como target de build para garantir compatibilidade com **ambas** plataformas. O Chromium 56 (Tizen 4.0) é o denominador comum mais restritivo.

### 2.2 Features JavaScript Não Suportadas em Chromium 56

| Feature | Chromium Min | Alternativa |
|---------|--------------|-------------|
| `Promise.allSettled()` | 76 | Polyfill |
| `Object.fromEntries()` | 73 | Polyfill |
| `Array.flat()` | 69 | Polyfill |
| `Array.flatMap()` | 69 | Polyfill |
| `??` (Nullish Coalescing) | 80 | `|| ` ou babel |
| `?.` (Optional Chaining) | 80 | `&& ` ou babel |
| `globalThis` | 71 | Polyfill |

---

## 3. Dependências Core

### 3.1 React

```json
"react": "^18.2.0",
"react-dom": "^18.2.0"
```

**Fonte Context7**: `/websites/react_dev` (Benchmark 89)

**Justificativa**:
- React 18.x é estável e maduro
- React 19 ainda é muito recente (lançado em 2024) - não recomendado para TVs
- Concurrent Features podem ser desabilitados se necessário
- Suporte a Server Components não é relevante para TV apps

**Configuração para TVs**:
```typescript
// main.tsx - Usar createRoot (React 18 padrão)
import { createRoot } from 'react-dom/client';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

### 3.2 Zustand (State Management)

```json
"zustand": "^5.0.8"
```

**Fonte Context7**: `/pmndrs/zustand` (v5.0.8)

**Justificativa**:
- v5.0.8 é a versão mais recente e estável
- Middleware `persist` nativo para localStorage/IndexedDB
- API simples e leve (~1KB gzipped) - importante para TVs com memória limitada
- Compatível com React 17, 18 e 19
- Sem dependências externas

**Configuração com Persist**:
```typescript
import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'

interface PlaylistStore {
  playlists: Playlist[];
  currentPlaylistId: string | null;
  addPlaylist: (playlist: Playlist) => void;
  setCurrentPlaylist: (id: string) => void;
}

export const usePlaylistStore = create<PlaylistStore>()(
  persist(
    (set) => ({
      playlists: [],
      currentPlaylistId: null,
      addPlaylist: (playlist) =>
        set((state) => ({ playlists: [...state.playlists, playlist] })),
      setCurrentPlaylist: (id) =>
        set({ currentPlaylistId: id }),
    }),
    {
      name: 'ativeplay-playlists',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
```

### 3.3 Axios (HTTP Client)

```json
"axios": "^1.7.7"
```

**Fonte Context7**: `/axios/axios-docs`

**Justificativa**:
- v1.7.x é estável e bem mantido
- Suporte a interceptors para tratamento centralizado de erros
- Configuração de timeout essencial para conexões de TV (redes mais lentas)
- Cancel tokens para abortar requisições

**Configuração Recomendada**:
```typescript
// src/core/services/api.ts
import axios from 'axios';

export const api = axios.create({
  timeout: 30000, // 30s para conexões lentas de TV
  headers: {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  },
});

// Interceptor de erro global
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.code === 'ECONNABORTED') {
      console.error('[API] Timeout - conexão lenta');
    }
    return Promise.reject(error);
  }
);
```

### 3.4 Dexie (IndexedDB)

```json
"dexie": "^4.0.10",
"dexie-react-hooks": "^1.1.7"
```

**Fonte Context7**: `/websites/dexie`

**Justificativa**:
- v4.x com suporte a TypeScript nativo
- Hooks React para integração simplificada (`useLiveQuery`)
- IndexedDB é suportado em Chromium 56+
- Melhor para armazenar grandes volumes de dados (playlists, metadados)

**Schema do Banco**:
```typescript
// src/core/db/database.ts
import Dexie, { Table } from 'dexie';

export interface Channel {
  id?: number;
  playlistId: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
}

export interface Playlist {
  id?: string;
  name: string;
  url: string;
  channelCount: number;
  lastSync: Date;
}

export class AtivePlayDB extends Dexie {
  channels!: Table<Channel>;
  playlists!: Table<Playlist>;

  constructor() {
    super('ativeplay');
    this.version(1).stores({
      channels: '++id, playlistId, name, group',
      playlists: 'id, name, url',
    });
  }
}

export const db = new AtivePlayDB();
```

### 3.5 React Router

```json
"react-router-dom": "^6.28.0"
```

**Fonte Context7**: `/remix-run/react-router`

**Justificativa**:
- v6.x é estável e maduro
- v7 tem breaking changes significativos (não recomendado)
- API de Data Loaders não é necessária para TV apps
- Roteamento simples com `BrowserRouter`

**IMPORTANTE**: **NÃO** usar React Router v7.x - API completamente diferente.

**Configuração**:
```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/add-playlist" element={<PlaylistInput />} />
        <Route path="/home" element={<HomeScreen />} />
        <Route path="/player" element={<PlayerScreen />} />
      </Routes>
    </BrowserRouter>
  );
}
```

### 3.6 Norigin Spatial Navigation

```json
"@noriginmedia/norigin-spatial-navigation": "^2.1.0"
```

**Fonte Context7**: `/noriginmedia/norigin-spatial-navigation`

**Justificativa**:
- Única biblioteca madura para navegação D-PAD em React
- v2.1.0 com hooks (`useFocusable`, `FocusContext`)
- Suporte nativo a Samsung Tizen e LG webOS
- Amplamente usado em produção (Netflix-style apps)

**Configuração e Uso**:
```typescript
// src/main.tsx
import { init } from '@noriginmedia/norigin-spatial-navigation';

init({
  debug: false,
  visualDebug: false, // true para desenvolvimento
  distanceCalculationMethod: 'center',
});

// Componente focusable
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface ButtonProps {
  label: string;
  onPress: () => void;
}

export function TVButton({ label, onPress }: ButtonProps) {
  const { ref, focused, focusSelf } = useFocusable({
    onEnterPress: onPress,
  });

  return (
    <button
      ref={ref}
      className={`tv-button ${focused ? 'focused' : ''}`}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
```

### 3.7 TanStack Virtual (Virtual Scrolling)

```json
"@tanstack/react-virtual": "^3.10.9"
```

**Fonte Context7**: `/tanstack/virtual`

**Justificativa**:
- Virtual scrolling essencial para listas grandes (290K+ canais)
- Renderiza apenas itens visíveis - crítico para TVs com memória limitada
- ~2KB gzipped - muito leve
- Compatível com React 17, 18 e 19
- API de hooks simples (`useVirtualizer`)

**Uso para Listas de Canais**:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

interface VirtualListProps {
  items: Channel[];
  itemHeight: number;
}

export function VirtualChannelList({ items, itemHeight }: VirtualListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => itemHeight,
    overscan: 5, // Pré-renderiza 5 itens acima/abaixo
  });

  return (
    <div
      ref={parentRef}
      style={{ height: '100%', overflow: 'auto' }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualItem.size}px`,
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            <ChannelItem channel={items[virtualItem.index]} />
          </div>
        ))}
      </div>
    </div>
  );
}
```

**Uso para Grid de Conteúdo (Home)**:
```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

export function VirtualContentGrid({ items, columns = 5 }: GridProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(items.length / columns);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // Altura de cada row
    overscan: 2,
  });

  return (
    <div ref={parentRef} style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns;
          const rowItems = items.slice(startIndex, startIndex + columns);

          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
                display: 'flex',
                gap: '16px',
              }}
            >
              {rowItems.map((item) => (
                <ContentCard key={item.id} item={item} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

---

## 4. Dependências de Parsing

### 4.1 M3U/IPTV Parsers

```json
"iptv-playlist-parser": "^0.15.0",
"m3u8-parser": "^7.2.0"
```

**Justificativa**:
- `iptv-playlist-parser`: Parser específico para playlists IPTV (formato #EXTINF)
- `m3u8-parser`: Parser para streams HLS (manifests .m3u8)

**Uso**:
```typescript
import { parse } from 'iptv-playlist-parser';

async function parsePlaylist(content: string) {
  const result = parse(content);
  return result.items.map((item) => ({
    name: item.name,
    url: item.url,
    logo: item.tvg?.logo,
    group: item.group?.title,
    tvgId: item.tvg?.id,
  }));
}
```

---

## 5. DevDependencies

### 5.1 TypeScript

```json
"typescript": "~5.6.3"
```

**Fonte Context7**: `/microsoft/typescript`

**Justificativa**:
- v5.6.x é estável (v5.9 é muito recente - dezembro 2024)
- Usar `~` (til) para receber apenas patches
- Suporte completo a React 18 types

**tsconfig.json Recomendado**:
```json
{
  "compilerOptions": {
    "target": "ES2015",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules"]
}
```

### 5.2 Vite

```json
"vite": "^5.4.11",
"@vitejs/plugin-react": "^4.3.3",
"@vitejs/plugin-legacy": "^5.4.3",
"terser": "^5.36.0"
```

**Fonte Context7**: `/vitejs/vite` (v5.4.21)

**Justificativa**:
- v5.4.x é estável (v7.0.0 é muito recente e pode ter bugs)
- `@vitejs/plugin-legacy` **ESSENCIAL** para TVs antigas
- `terser` para minificação compatível com ES2015

**vite.config.ts Completo**:
```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    legacy({
      targets: ['chrome >= 56'], // Tizen 4.0
      modernPolyfills: true,
      renderLegacyChunks: true,
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    target: 'es2015',
    outDir: 'dist',
    minify: 'terser',
    terserOptions: {
      ecma: 2015,
      compress: {
        drop_console: true, // Remover console.log em produção
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          state: ['zustand', 'dexie'],
        },
      },
    },
    sourcemap: false,
  },
  server: {
    port: 3000,
    host: true, // Acesso via IP local para testar em TV
  },
});
```

### 5.3 ESLint

```json
"eslint": "^8.57.1",
"@typescript-eslint/eslint-plugin": "^7.18.0",
"@typescript-eslint/parser": "^7.18.0",
"eslint-plugin-react": "^7.37.2",
"eslint-plugin-react-hooks": "^5.0.0"
```

**Fonte Context7**: `/eslint/eslint` (v8.57.1)

**Justificativa**:
- ESLint v8.x é estável
- v9 tem breaking changes (novo sistema de config flat) - **NÃO USAR**
- TypeScript ESLint v7.x compatível com ESLint 8

**.eslintrc.cjs**:
```javascript
module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'plugin:react-hooks/recommended',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint', 'react', 'react-hooks'],
  settings: {
    react: { version: '18.2' },
  },
  rules: {
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
```

### 5.4 Prettier

```json
"prettier": "^3.4.2"
```

**Fonte Context7**: `/prettier/prettier` (v3.6.2)

**Justificativa**:
- v3.4.x é a versão mais recente e estável

**.prettierrc**:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```

### 5.5 Types

```json
"@types/react": "^18.2.0",
"@types/react-dom": "^18.2.0",
"@types/node": "^22.10.0"
```

---

## 6. package.json Completo

```json
{
  "name": "ativeplay",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src --ext .ts,.tsx",
    "lint:fix": "eslint src --ext .ts,.tsx --fix",
    "format": "prettier --write \"src/**/*.{ts,tsx,css}\"",
    "type-check": "tsc --noEmit",
    "build:tizen": "npm run build && bash scripts/build-tizen.sh",
    "build:webos": "npm run build && bash scripts/build-webos.sh"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.28.0",
    "zustand": "^5.0.8",
    "axios": "^1.7.7",
    "dexie": "^4.0.10",
    "dexie-react-hooks": "^1.1.7",
    "@noriginmedia/norigin-spatial-navigation": "^2.1.0",
    "@tanstack/react-virtual": "^3.10.9",
    "iptv-playlist-parser": "^0.15.0",
    "m3u8-parser": "^7.2.0"
  },
  "devDependencies": {
    "typescript": "~5.6.3",
    "vite": "^5.4.11",
    "@vitejs/plugin-react": "^4.3.3",
    "@vitejs/plugin-legacy": "^5.4.3",
    "terser": "^5.36.0",
    "core-js": "^3.39.0",
    "@types/react": "^18.2.0",
    "@types/react-dom": "^18.2.0",
    "@types/node": "^22.10.0",
    "eslint": "^8.57.1",
    "@typescript-eslint/eslint-plugin": "^7.18.0",
    "@typescript-eslint/parser": "^7.18.0",
    "eslint-plugin-react": "^7.37.2",
    "eslint-plugin-react-hooks": "^5.0.0",
    "prettier": "^3.4.2"
  }
}
```

---

## 7. Matriz de Compatibilidade

| Biblioteca | Versão | ES Target | Chromium Min | Tizen 4.0 | webOS 5.0 |
|------------|--------|-----------|--------------|-----------|-----------|
| React | 18.2.0 | ES5+ | 49+ | ✅ | ✅ |
| Zustand | 5.0.8 | ES2015 | 51+ | ✅ | ✅ |
| Axios | 1.7.7 | ES5+ | 49+ | ✅ | ✅ |
| Dexie | 4.0.10 | ES2015 | 56+ | ✅ | ✅ |
| React Router | 6.28.0 | ES2015 | 51+ | ✅ | ✅ |
| Spatial Nav | 2.1.0 | ES2015 | 49+ | ✅ | ✅ |
| TanStack Virtual | 3.10.9 | ES2015 | 51+ | ✅ | ✅ |
| Vite Build | 5.4.11 | ES2015* | 56+ | ✅ | ✅ |

*Com `@vitejs/plugin-legacy` configurado para `chrome >= 56`

---

## 8. Polyfills Necessários

Para garantir compatibilidade total com Chromium 56 (Tizen 4.0), alguns polyfills são necessários:

### 8.1 Arquivo de Polyfills

```typescript
// src/polyfills.ts
import 'core-js/stable/promise/all-settled';
import 'core-js/stable/object/from-entries';
import 'core-js/stable/array/flat';
import 'core-js/stable/array/flat-map';
import 'core-js/stable/string/pad-start';
import 'core-js/stable/string/pad-end';
```

### 8.2 Importar no Entry Point

```typescript
// src/main.tsx
import './polyfills';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
```

### 8.3 Dependência core-js

```json
"core-js": "^3.39.0"
```

---

## 9. Bibliotecas NÃO Recomendadas

| Biblioteca | Versão | Motivo |
|------------|--------|--------|
| React | 19.x | Muito recente, pode ter bugs em ambientes TV |
| React Router | 7.x | Breaking changes significativos na API |
| Vite | 7.x | Muito recente, v5.4.x é mais estável |
| ESLint | 9.x | Novo sistema de config (flat config) - breaking change |
| TypeScript | 5.9.x | Muito recente, preferir 5.6.x estável |

---

## 10. Atualizações Futuras

### 10.1 Quando Atualizar

| Biblioteca | Atualizar Quando |
|------------|------------------|
| React | v19.x estável por 6+ meses E testado em TVs |
| Vite | v6.x estável (pular v7 se instável) |
| ESLint | v9.x quando flat config for padrão do ecossistema |
| TypeScript | A cada minor release (5.7, 5.8...) após 2-3 meses |
| Zustand | Sempre usar última versão (API estável) |

### 10.2 Comandos de Monitoramento

```bash
# Ver pacotes desatualizados
npm outdated

# Verificar atualizações disponíveis
npx npm-check-updates

# Atualizar patch versions apenas (seguro)
npx npm-check-updates -u --target patch
npm install

# Verificar vulnerabilidades
npm audit
```

### 10.3 Política de Atualização

1. **Patches** (x.x.PATCH): Atualizar imediatamente
2. **Minor** (x.MINOR.x): Testar em ambiente de desenvolvimento antes
3. **Major** (MAJOR.x.x): Avaliar changelog e testar extensivamente

---

## 11. Fontes e Referências

### 11.1 Context7 MCP (Documentação Oficial)

| Biblioteca | Library ID | Benchmark |
|------------|------------|-----------|
| React | `/websites/react_dev` | 89 |
| Zustand | `/pmndrs/zustand` | - |
| Vite | `/vitejs/vite` | - |
| React Router | `/remix-run/react-router` | - |
| Dexie | `/websites/dexie` | - |
| TypeScript | `/microsoft/typescript` | - |
| ESLint | `/eslint/eslint` | - |
| Prettier | `/prettier/prettier` | - |
| Axios | `/axios/axios-docs` | - |
| Norigin | `/noriginmedia/norigin-spatial-navigation` | - |
| TanStack Virtual | `/tanstack/virtual` | - |

### 11.2 Documentação de Plataforma

- [Samsung Tizen TV Development Guide](https://developer.samsung.com/smarttv)
- [LG webOS TV Development Guide](https://webostv.developer.lge.com)
- [Chromium Feature Status](https://chromestatus.com/features)

---

## 12. Checklist de Instalação

```bash
# 1. Criar projeto
npm create vite@latest ativeplay -- --template react-ts
cd ativeplay

# 2. Instalar dependências core
npm install react@^18.2.0 react-dom@^18.2.0 react-router-dom@^6.28.0
npm install zustand@^5.0.8 axios@^1.7.7
npm install dexie@^4.0.10 dexie-react-hooks@^1.1.7
npm install @noriginmedia/norigin-spatial-navigation@^2.1.0
npm install @tanstack/react-virtual@^3.10.9
npm install iptv-playlist-parser@^0.15.0 m3u8-parser@^7.2.0

# 3. Instalar devDependencies
npm install -D typescript@~5.6.3
npm install -D vite@^5.4.11 @vitejs/plugin-react@^4.3.3
npm install -D @vitejs/plugin-legacy@^5.4.3 terser@^5.36.0
npm install -D core-js@^3.39.0
npm install -D @types/react@^18.2.0 @types/react-dom@^18.2.0 @types/node@^22.10.0
npm install -D eslint@^8.57.1 @typescript-eslint/eslint-plugin@^7.18.0 @typescript-eslint/parser@^7.18.0
npm install -D eslint-plugin-react@^7.37.2 eslint-plugin-react-hooks@^5.0.0
npm install -D prettier@^3.4.2

# 4. Verificar instalação
npm ls --depth=0
npm run build
```

---

**Documento gerado automaticamente via Context7 MCP**
**Última atualização**: 26/11/2024
