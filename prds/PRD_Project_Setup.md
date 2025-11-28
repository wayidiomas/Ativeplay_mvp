# PRD: Project Setup & Simulacao

> **PRD ID**: PRD_Project_Setup
> **Versao**: 1.1
> **Referencia**: PRD Master AtivePlay v1.1, PRD_Dependencies v1.0
> **Status**: Guia Completo (Atualizado)
> **Data**: 2025-11-26
> **Ultima Atualizacao**: Sincronizado com PRD_Dependencies.md (versoes Context7)

---

## 1. Objetivo

Este documento fornece um guia completo para:
- Configurar o ambiente de desenvolvimento do AtivePlay
- Estruturar o projeto React + TypeScript + Vite
- Simular o app no Mac (browser, emuladores)
- Fazer deploy em TVs Samsung (Tizen) e LG (webOS)

---

## 2. Requisitos do Sistema

### 2.1 Software Base

| Software | Versao Minima | Download |
|----------|---------------|----------|
| Node.js | 18.x LTS | [nodejs.org](https://nodejs.org/) |
| npm | 9.x | (incluido com Node.js) |
| Git | 2.x | [git-scm.com](https://git-scm.com/) |
| VS Code | Latest | [code.visualstudio.com](https://code.visualstudio.com/) |

### 2.2 Para Samsung Tizen

| Software | Versao | Download |
|----------|--------|----------|
| Tizen Studio | 5.x | [Samsung Developer](https://developer.samsung.com/smarttv/develop/tools/tizen-studio.html) |
| Java JDK | 8 ou 11 | [AdoptOpenJDK](https://adoptopenjdk.net/) |

### 2.3 Para LG webOS

| Software | Versao | Download |
|----------|--------|----------|
| webOS CLI | Latest | `npm install -g @webos-tools/cli` |
| VS Code Extension | webOS Studio | VS Code Marketplace |
| webOS TV Simulator | webOS 22+ | Via webOS Studio |

---

## 3. Estrutura do Projeto

```
ativeplay/
|-- public/
|   |-- index.html              # HTML principal
|   |-- favicon.ico
|   |-- assets/
|       |-- logo.png
|       |-- logo-white.png
|       |-- fonts/
|           |-- Inter-*.woff2
|           |-- Poppins-*.woff2
|
|-- src/
|   |-- main.tsx                # Entry point
|   |-- App.tsx                 # Router e providers
|   |-- vite-env.d.ts           # Tipos Vite
|   |
|   |-- core/
|   |   |-- services/
|   |   |   |-- m3u/
|   |   |   |   |-- m3uParser.ts
|   |   |   |   |-- m3uTypes.ts
|   |   |   |-- tmdb/
|   |   |   |   |-- tmdbClient.ts
|   |   |   |   |-- tmdbService.ts
|   |   |   |   |-- tmdbTypes.ts
|   |   |   |   |-- tmdbCache.ts
|   |   |   |-- playlist/
|   |   |       |-- playlistSyncService.ts
|   |   |
|   |   |-- utils/
|   |   |   |-- validators.ts
|   |   |   |-- generateId.ts
|   |   |   |-- titleNormalizer.ts
|   |   |   |-- platformDetect.ts
|   |   |   |-- platformMock.ts
|   |   |
|   |   |-- constants/
|   |       |-- keys.ts         # Teclas do controle
|   |       |-- storage.ts      # Chaves localStorage
|   |       |-- routes.ts       # Rotas da aplicacao
|   |
|   |-- ui/
|   |   |-- onboarding/
|   |   |   |-- SplashScreen.tsx
|   |   |   |-- WelcomeScreen.tsx
|   |   |   |-- PlaylistInput.tsx
|   |   |   |-- SyncProgress.tsx
|   |   |   |-- ErrorScreen.tsx
|   |   |   |-- TVKeyboard/
|   |   |   |-- RecentUrls/
|   |   |   |-- styles/
|   |   |
|   |   |-- home/
|   |   |   |-- Home.tsx
|   |   |   |-- HeroBanner.tsx
|   |   |   |-- Carousel.tsx
|   |   |   |-- ContentCard.tsx
|   |   |   |-- Sidebar.tsx
|   |   |
|   |   |-- player/
|   |   |   |-- PlayerContainer.tsx
|   |   |   |-- PlayerControls.tsx
|   |   |   |-- PlayerOverlay.tsx
|   |   |   |-- ProgressBar.tsx
|   |   |   |-- AudioSelector.tsx
|   |   |   |-- SubtitleSelector.tsx
|   |   |   |-- BufferingIndicator.tsx
|   |   |
|   |   |-- shared/
|   |       |-- Button.tsx
|   |       |-- Loading.tsx
|   |       |-- Modal.tsx
|   |       |-- FocusableItem.tsx
|   |
|   |-- player/
|   |   |-- adapters/
|   |   |   |-- IPlayerAdapter.ts
|   |   |   |-- SamsungAVPlayAdapter.ts
|   |   |   |-- LGWebOSAdapter.ts
|   |   |   |-- index.ts
|   |   |
|   |   |-- types/
|   |   |   |-- index.ts
|   |   |
|   |   |-- hooks/
|   |   |   |-- usePlayer.ts
|   |   |   |-- usePlayerControls.ts
|   |   |
|   |   |-- PlayerFactory.ts
|   |   |-- index.ts
|   |
|   |-- store/
|   |   |-- onboardingStore.ts
|   |   |-- playlistStore.ts
|   |   |-- playerStore.ts
|   |   |-- settingsStore.ts
|   |
|   |-- hooks/
|   |   |-- useRemoteControl.ts
|   |   |-- useDebounce.ts
|   |   |-- useLocalStorage.ts
|   |
|   |-- types/
|   |   |-- global.d.ts         # Tipos globais
|   |   |-- tizen.d.ts          # Tipos Samsung
|   |   |-- webos.d.ts          # Tipos LG
|   |
|   |-- styles/
|       |-- variables.css
|       |-- global.css
|       |-- reset.css
|
|-- tizen/                      # Config Samsung
|   |-- config.xml
|   |-- icon.png                # 512x512
|   |-- .tizensignature/
|
|-- webos/                      # Config LG
|   |-- appinfo.json
|   |-- icon.png                # 80x80
|   |-- largeIcon.png           # 130x130
|   |-- splash.png              # 1920x1080
|
|-- scripts/
|   |-- build-tizen.sh
|   |-- build-webos.sh
|   |-- deploy-tizen.sh
|   |-- deploy-webos.sh
|
|-- package.json
|-- vite.config.ts
|-- tsconfig.json
|-- tsconfig.node.json
|-- .env
|-- .env.example
|-- .gitignore
|-- README.md
```

---

## 4. Setup Inicial

### 4.1 Criar Projeto

```bash
# Criar projeto Vite com React + TypeScript
npm create vite@latest ativeplay -- --template react-ts

# Entrar no diretorio
cd ativeplay

# Instalar dependencias base
npm install
```

### 4.2 Instalar Dependencias

```bash
# ========================================
# Dependencias de Producao
# ========================================

# React (ja instalado pelo template, mas garantir versao)
npm install react@^18.2.0 react-dom@^18.2.0

# Router
npm install react-router-dom@^6.28.0

# State Management
npm install zustand@^5.0.8

# HTTP Client
npm install axios@^1.7.7

# IndexedDB (cache)
npm install dexie@^4.0.10 dexie-react-hooks@^1.1.7

# M3U Parser
npm install iptv-playlist-parser@^0.15.0 m3u8-parser@^7.2.0

# Navegacao TV
npm install @noriginmedia/norigin-spatial-navigation@^2.1.0

# ========================================
# Dependencias de Desenvolvimento
# ========================================

# TypeScript
npm install -D typescript@~5.6.3

# Vite e plugins
npm install -D vite@^5.4.11 @vitejs/plugin-react@^4.3.3
npm install -D @vitejs/plugin-legacy@^5.4.3 terser@^5.36.0

# Polyfills para TVs antigas
npm install -D core-js@^3.39.0

# Types
npm install -D @types/react@^18.2.0 @types/react-dom@^18.2.0 @types/node@^22.10.0

# ESLint (NAO usar v9 - breaking changes)
npm install -D eslint@^8.57.1
npm install -D @typescript-eslint/eslint-plugin@^7.18.0 @typescript-eslint/parser@^7.18.0
npm install -D eslint-plugin-react@^7.37.2 eslint-plugin-react-hooks@^5.0.0

# Prettier
npm install -D prettier@^3.4.2
```

> **IMPORTANTE**: As versoes acima foram pesquisadas via Context7 e sao compativeis com Chromium 56 (Tizen 4.0). Consulte o PRD_Dependencies.md para justificativas detalhadas.

### 4.3 Configurar Vite

```typescript
// vite.config.ts

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    // ESSENCIAL: Plugin legacy para compatibilidade com TVs antigas
    legacy({
      targets: ['chrome >= 56'],  // Tizen 4.0 = Chromium 56
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
    outDir: 'dist',
    target: 'es2015',         // Compatibilidade com Chromium 56+ (Tizen 4.0)
    minify: 'terser',
    sourcemap: false,
    terserOptions: {
      ecma: 2015,             // Garantir output ES2015
      compress: {
        drop_console: true,   // Remover console.log em producao
        drop_debugger: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          state: ['zustand', 'dexie'],
          navigation: ['@noriginmedia/norigin-spatial-navigation'],
        },
      },
    },
  },

  server: {
    port: 3000,
    host: true,               // Acesso via IP local (para TV)
    strictPort: true,
  },

  preview: {
    port: 3000,
    host: true,
  },
});
```

> **IMPORTANTE**: O `@vitejs/plugin-legacy` e ESSENCIAL para gerar bundles compativeis com Chromium 56. Sem ele, o app pode falhar em TVs Samsung Tizen 4.0.

### 4.4 Configurar TypeScript

```json
// tsconfig.json

{
  "compilerOptions": {
    "target": "ES2015",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,

    /* Bundler mode */
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",

    /* Linting */
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,

    /* Paths */
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

### 4.5 Configurar Variaveis de Ambiente

```bash
# .env

# ===========================================
# AtivePlay - Variaveis de Ambiente
# ===========================================

# App Config
VITE_APP_NAME=AtivePlay
VITE_APP_VERSION=1.0.0
VITE_MAX_PLAYLISTS=6

# Feature Flags
VITE_ENABLE_EPG=true
VITE_ENABLE_CONTINUE_WATCHING=true
VITE_ENABLE_TMDB=true

# TMDB API (The Movie Database)
VITE_TMDB_API_KEY=sua_api_key_aqui
VITE_TMDB_ACCESS_TOKEN=seu_access_token_aqui
VITE_TMDB_BASE_URL=https://api.themoviedb.org/3
VITE_TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p
```

```bash
# .env.example (sem valores sensiveis)

VITE_APP_NAME=AtivePlay
VITE_APP_VERSION=1.0.0
VITE_MAX_PLAYLISTS=6
VITE_ENABLE_EPG=true
VITE_ENABLE_CONTINUE_WATCHING=true
VITE_ENABLE_TMDB=true
VITE_TMDB_API_KEY=
VITE_TMDB_ACCESS_TOKEN=
VITE_TMDB_BASE_URL=https://api.themoviedb.org/3
VITE_TMDB_IMAGE_BASE_URL=https://image.tmdb.org/t/p
```

---

## 5. Configuracao Samsung Tizen

### 5.1 Instalar Tizen Studio

1. **Download**: [Tizen Studio](https://developer.samsung.com/smarttv/develop/tools/tizen-studio.html)

2. **macOS - Bypass Notarization**:
   ```bash
   # Ctrl+Click no instalador e selecionar "Abrir"
   # OU via terminal:
   xattr -d com.apple.quarantine Tizen-Studio-*.app
   ```

3. **Instalar Package Manager** (dentro do Tizen Studio):
   - Tools > Package Manager
   - Tab "Extension SDK"
   - Instalar:
     - Samsung Certificate Extension
     - TV Extensions-5.5 (ou mais recente)

### 5.2 Gerar Certificados Samsung

1. Abrir **Certificate Manager** (Tools > Certificate Manager)

2. Criar novo profile:
   - Type: **Samsung**
   - Device type: **TV**

3. **Author Certificate**:
   - Create new
   - Nome: "AtivePlay Author"
   - Preencher dados pessoais

4. **Distributor Certificate**:
   - Use default
   - Privilege: **Partner** (para Luna Service API na LG)

5. Salvar profile com nome: `ativeplay-profile`

### 5.3 Arquivo config.xml

```xml
<?xml version="1.0" encoding="UTF-8"?>
<widget xmlns="http://www.w3.org/ns/widgets"
        xmlns:tizen="http://tizen.org/ns/widgets"
        id="com.ativeapp.ativeplay"
        version="1.0.0"
        viewmodes="maximized">

    <name>AtivePlay</name>
    <icon src="icon.png"/>
    <content src="index.html"/>

    <tizen:application id="AbCdEf1234.AtivePlay"
                       package="AbCdEf1234"
                       required_version="4.0"/>

    <!-- Privilegios necessarios -->
    <tizen:privilege name="http://tizen.org/privilege/internet"/>
    <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/avplay"/>
    <tizen:privilege name="http://developer.samsung.com/privilege/network.public"/>

    <!-- Configuracoes -->
    <tizen:setting screen-orientation="landscape"
                   context-menu="enable"
                   background-support="disable"
                   encryption="disable"
                   install-location="auto"
                   hwkey-event="enable"/>

    <!-- Metadata -->
    <tizen:metadata key="http://samsung.com/tv/metadata/prelaunch.support"
                    value="true"/>

    <!-- Profile -->
    <tizen:profile name="tv-samsung"/>
</widget>
```

### 5.4 Script de Build (Samsung)

```bash
#!/bin/bash
# scripts/build-tizen.sh

set -e

echo "=========================================="
echo "  AtivePlay - Build Samsung Tizen"
echo "=========================================="

# 1. Build do projeto Vite
echo "[1/4] Building Vite project..."
npm run build

# 2. Copiar arquivos Tizen para dist
echo "[2/4] Copying Tizen config files..."
cp tizen/config.xml dist/
cp tizen/icon.png dist/

# 3. Entrar no diretorio dist
cd dist

# 4. Criar pacote .wgt
echo "[3/4] Creating .wgt package..."
tizen package -t wgt -s ativeplay-profile

# 5. Mover pacote para raiz
echo "[4/4] Moving package..."
mv *.wgt ../AtivePlay.wgt

cd ..

echo "=========================================="
echo "  Build complete: AtivePlay.wgt"
echo "=========================================="
```

### 5.5 Deploy em TV Samsung

```bash
#!/bin/bash
# scripts/deploy-tizen.sh

TV_IP="${1:-192.168.1.100}"  # IP da TV como argumento

echo "=========================================="
echo "  AtivePlay - Deploy Samsung TV"
echo "=========================================="

# 1. Build
./scripts/build-tizen.sh

# 2. Conectar a TV
echo "[1/3] Connecting to TV at $TV_IP..."
sdb connect $TV_IP

# 3. Listar devices
sdb devices

# 4. Instalar app
echo "[2/3] Installing app..."
tizen install -n AtivePlay.wgt -t $TV_IP

# 5. Executar app
echo "[3/3] Launching app..."
tizen run -p AbCdEf1234.AtivePlay -t $TV_IP

echo "=========================================="
echo "  Deploy complete!"
echo "=========================================="
```

### 5.6 Habilitar Developer Mode na TV Samsung

1. Ir para **Apps**
2. Pressionar sequencia: **1, 2, 3, 4, 5** no controle
3. Aparece popup "Developer mode"
4. Habilitar e inserir IP do Mac
5. Reiniciar TV
6. Icone "Developer" aparece na lista de apps

---

## 6. Configuracao LG webOS

### 6.1 Instalar webOS CLI

```bash
# Instalar via npm (recomendado)
npm install -g @webos-tools/cli

# Verificar instalacao
ares-version

# Saida esperada:
# webOS TV CLI Version: 1.x.x
```

### 6.2 Instalar webOS Studio (VS Code)

1. Abrir VS Code
2. Extensions (Ctrl+Shift+X)
3. Buscar "webOS Studio"
4. Instalar extensao oficial LG
5. Reiniciar VS Code

### 6.3 Arquivo appinfo.json

```json
{
  "id": "com.ativeapp.ativeplay",
  "version": "1.0.0",
  "vendor": "AtiveApp Midias",
  "type": "web",
  "main": "index.html",
  "title": "AtivePlay",
  "icon": "icon.png",
  "largeIcon": "largeIcon.png",
  "bgImage": "splash.png",
  "resolution": "1920x1080",
  "disableBackHistoryAPI": false,
  "transparent": false,
  "splashBackground": "#09182B",
  "requiredPermissions": [
    "time.query",
    "media.operation"
  ]
}
```

### 6.4 Script de Build (LG)

```bash
#!/bin/bash
# scripts/build-webos.sh

set -e

echo "=========================================="
echo "  AtivePlay - Build LG webOS"
echo "=========================================="

# 1. Build do projeto Vite
echo "[1/4] Building Vite project..."
npm run build

# 2. Copiar arquivos webOS para dist
echo "[2/4] Copying webOS config files..."
cp webos/appinfo.json dist/
cp webos/icon.png dist/
cp webos/largeIcon.png dist/
cp webos/splash.png dist/

# 3. Entrar no diretorio dist
cd dist

# 4. Criar pacote .ipk
echo "[3/4] Creating .ipk package..."
ares-package .

# 5. Mover pacote para raiz
echo "[4/4] Moving package..."
mv *.ipk ../AtivePlay.ipk

cd ..

echo "=========================================="
echo "  Build complete: AtivePlay.ipk"
echo "=========================================="
```

### 6.5 Deploy em TV LG

```bash
#!/bin/bash
# scripts/deploy-webos.sh

TV_NAME="${1:-tv}"  # Nome do device como argumento

echo "=========================================="
echo "  AtivePlay - Deploy LG webOS"
echo "=========================================="

# 1. Build
./scripts/build-webos.sh

# 2. Listar devices
echo "[1/3] Available devices:"
ares-setup-device --list

# 3. Instalar app
echo "[2/3] Installing app..."
ares-install --device $TV_NAME AtivePlay.ipk

# 4. Executar app
echo "[3/3] Launching app..."
ares-launch --device $TV_NAME com.ativeapp.ativeplay

echo "=========================================="
echo "  Deploy complete!"
echo "=========================================="
```

### 6.6 Habilitar Developer Mode na TV LG

1. Ir para **Settings > General > About This TV**
2. Clicar 5 vezes em **LG TV** (ou nome do modelo)
3. Aceitar termos de desenvolvedor
4. Reiniciar TV
5. App "Developer Mode" aparece instalado

**Configurar Developer Mode app:**
1. Abrir app Developer Mode
2. Habilitar "Dev Mode Status": ON
3. Habilitar "Key Server": ON (para extensao VS Code)
4. Anotar a **Passphrase**
5. Reiniciar TV

**Adicionar TV como device no CLI:**
```bash
# Modo interativo
ares-setup-device

# Selecionar "add"
# Nome: tv (ou qualquer nome)
# IP: IP da TV (ex: 192.168.1.101)
# Port: 9922
# SSH User: prisoner
# Description: LG TV

# Verificar conexao
ares-setup-device --list
```

---

## 7. Simulacao no Mac

### 7.1 Opcao 1: Browser (Desenvolvimento Rapido)

**Iniciar servidor de desenvolvimento:**
```bash
npm run dev
# Acessar http://localhost:3000
```

**Navegacao no browser:**
| Tecla | Funcao |
|-------|--------|
| Setas | Navegacao (UP/DOWN/LEFT/RIGHT) |
| Enter | OK/Select |
| Backspace | Back |
| R | Tecla Vermelha |
| G | Tecla Verde |
| Y | Tecla Amarela |
| B | Tecla Azul |

**Mock das APIs de plataforma:**

```typescript
// src/core/utils/platformMock.ts

/**
 * Inicializa mocks das APIs de TV para desenvolvimento no browser
 */
export function initPlatformMocks(): void {
  if (!import.meta.env.DEV) return;

  // Verificar se ja estamos em uma plataforma real
  if ('webapis' in window || 'webOS' in window) return;

  console.log('[DEV] Initializing platform mocks...');

  // ========================================
  // Mock Samsung webapis
  // ========================================
  (window as any).webapis = {
    avplay: {
      open: (url: string) => console.log('[MOCK] avplay.open:', url),
      close: () => console.log('[MOCK] avplay.close'),
      prepare: () => console.log('[MOCK] avplay.prepare'),
      prepareAsync: (onSuccess: () => void) => {
        console.log('[MOCK] avplay.prepareAsync');
        setTimeout(onSuccess, 100);
      },
      play: () => console.log('[MOCK] avplay.play'),
      pause: () => console.log('[MOCK] avplay.pause'),
      stop: () => console.log('[MOCK] avplay.stop'),
      seekTo: (ms: number) => console.log('[MOCK] avplay.seekTo:', ms),
      getDuration: () => 3600000, // 1 hora em ms
      getCurrentTime: () => 0,
      getState: () => 'IDLE',
      getTotalTrackInfo: () => [
        { index: 0, type: 'AUDIO', extra_info: JSON.stringify({ language: 'pt', channels: 2 }) },
        { index: 1, type: 'AUDIO', extra_info: JSON.stringify({ language: 'en', channels: 6 }) },
        { index: 0, type: 'TEXT', extra_info: JSON.stringify({ track_lang: 'pt' }) },
        { index: 1, type: 'TEXT', extra_info: JSON.stringify({ track_lang: 'en' }) },
      ],
      setSelectTrack: (type: string, index: number) =>
        console.log('[MOCK] avplay.setSelectTrack:', type, index),
      setListener: () => {},
      setDisplayRect: () => {},
      setDisplayMethod: () => {},
      setSilentSubtitle: () => {},
      setSubtitlePosition: () => {},
      setTimeoutForBuffering: () => {},
      setBufferingParam: () => {},
      setSpeed: () => {},
    },
  };

  // ========================================
  // Mock LG webOS
  // ========================================
  (window as any).webOS = {
    platform: { tv: true },
    service: {
      request: (uri: string, params: any) => {
        console.log('[MOCK] Luna Service:', uri, params.method);

        // Simular resposta do subscribe
        if (params.method === 'subscribe' && params.onSuccess) {
          setTimeout(() => {
            params.onSuccess({
              returnValue: true,
              sourceInfo: {
                container: 'ts',
                seekable: true,
                numPrograms: 1,
                programInfo: [{
                  duration: 3600000,
                  numAudioTracks: 2,
                  audioTrackInfo: [
                    { language: 'pt', codec: 'aac', channels: 2 },
                    { language: 'en', codec: 'ac3', channels: 6 },
                  ],
                  numSubtitleTracks: 2,
                  subtitleTrackInfo: [
                    { language: 'pt', type: 'text' },
                    { language: 'en', type: 'text' },
                  ],
                }],
              },
            });
          }, 500);
        }

        // Resposta padrao de sucesso
        if (params.onSuccess) {
          params.onSuccess({ returnValue: true });
        }
      },
    },
  };

  console.log('[DEV] Platform mocks initialized');
}
```

**Inicializar mocks no main.tsx:**
```typescript
// src/main.tsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initPlatformMocks } from '@/core/utils/platformMock';
import './styles/global.css';

// Inicializar mocks para desenvolvimento
initPlatformMocks();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### 7.2 Opcao 2: Samsung Tizen Emulator

**Disponibilidade:**
- macOS Intel (x86_64): Funciona
- macOS Apple Silicon (M1/M2/M3): NAO funciona nativamente

**Para Apple Silicon**, usar:
- UTM com Ubuntu x86_64 + Tizen Studio
- OU testar direto na TV (recomendado)

**Criar emulador (macOS Intel):**
1. Abrir Tizen Studio
2. Tools > Emulator Manager
3. Create > TV > 1920x1080
4. Launch

**Executar app no emulador:**
```bash
# Listar emuladores
sdb devices

# Instalar
tizen install -n AtivePlay.wgt -t emulator-26101

# Executar
tizen run -p AbCdEf1234.AtivePlay -t emulator-26101
```

### 7.3 Opcao 3: LG webOS Simulator

**Disponibilidade:**
- macOS Intel: Funciona
- macOS Apple Silicon: Funciona (via Rosetta)

**Instalar Simulator:**
1. Abrir VS Code com extensao webOS Studio
2. Command Palette (Cmd+Shift+P)
3. "webOS TV: Install Simulator"
4. Selecionar versao (webOS 22 ou mais recente)

**Executar app no Simulator:**
```bash
# Via CLI
ares-launch --simulator com.ativeapp.ativeplay

# OU via VS Code
# 1. Abrir pasta do projeto
# 2. View > Command Palette
# 3. "webOS TV: Run on Simulator"
```

**Limitacao importante:**
O Simulator usa Chromium mais recente que as TVs reais. Algumas APIs podem funcionar no Simulator mas falhar em TVs antigas.

---

## 8. Scripts package.json

> **IMPORTANTE**: As versoes abaixo foram sincronizadas com o PRD_Dependencies.md e pesquisadas via Context7 para garantir compatibilidade com Chromium 56 (Tizen 4.0).

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

    "build:tizen": "bash scripts/build-tizen.sh",
    "build:webos": "bash scripts/build-webos.sh",

    "deploy:tizen": "bash scripts/deploy-tizen.sh",
    "deploy:webos": "bash scripts/deploy-webos.sh",

    "wits": "wits -i",
    "wits:start": "wits -w",

    "lint": "eslint src --ext .ts,.tsx --fix",
    "lint:check": "eslint src --ext .ts,.tsx",
    "format": "prettier --write \"src/**/*.{ts,tsx,css}\"",
    "type-check": "tsc --noEmit",

    "clean": "rm -rf dist node_modules/.vite",
    "clean:all": "rm -rf dist node_modules"
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

### 8.1 Versoes Criticas

| Biblioteca | Versao | Por que esta versao? |
|------------|--------|---------------------|
| zustand | ^5.0.8 | v5 tem melhor API de persist |
| dexie | ^4.0.10 | v4 tem TypeScript nativo |
| react-router-dom | ^6.28.0 | v7 tem breaking changes |
| eslint | ^8.57.1 | v9 tem breaking changes (flat config) |
| vite | ^5.4.11 | v7 e muito recente |
| @vitejs/plugin-legacy | ^5.4.3 | ESSENCIAL para Chromium 56 |

---

## 9. Compatibilidade de Versoes

### 9.1 Tabela de Compatibilidade

| Plataforma | Versao Min | Chromium | ES Version | React |
|------------|------------|----------|------------|-------|
| Samsung Tizen 4.0 | 2018 | 56 | ES2015 | 17+ |
| Samsung Tizen 5.0 | 2019 | 63 | ES2017 | 17+ |
| Samsung Tizen 6.0 | 2021 | 76 | ES2019 | 18+ |
| LG webOS 5.0 | 2020 | 68 | ES2018 | 17+ |
| LG webOS 6.0 | 2021 | 79 | ES2020 | 18+ |
| LG webOS 22+ | 2022 | 87+ | ES2021 | 18+ |

### 9.2 Polyfills Necessarios

> **Recomendado**: Usar `core-js` para polyfills padronizados e bem testados.

```typescript
// src/core/polyfills.ts

/**
 * Polyfills para compatibilidade com Tizen 4.0 (Chromium 56) e webOS 5.0 (Chromium 68)
 *
 * Usando core-js para garantir implementacoes corretas e otimizadas.
 * Instalar: npm install -D core-js@^3.39.0
 */

// Promise.allSettled (nao existe em Chromium < 76)
import 'core-js/stable/promise/all-settled';

// Object.fromEntries (nao existe em Chromium < 73)
import 'core-js/stable/object/from-entries';

// Array.prototype.flat (nao existe em Chromium < 69)
import 'core-js/stable/array/flat';

// Array.prototype.flatMap (nao existe em Chromium < 69)
import 'core-js/stable/array/flat-map';

// String.prototype.padStart/padEnd (Chromium 57+, mas melhor garantir)
import 'core-js/stable/string/pad-start';
import 'core-js/stable/string/pad-end';

// globalThis (nao existe em Chromium < 71)
if (typeof globalThis === 'undefined') {
  (window as any).globalThis = window;
}

console.log('[Polyfills] Loaded for TV compatibility');
```

**Importar polyfills no main.tsx (DEVE SER O PRIMEIRO IMPORT):**
```typescript
// src/main.tsx

import './core/polyfills';  // PRIMEIRO import - OBRIGATORIO
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initPlatformMocks } from '@/core/utils/platformMock';
import './styles/global.css';

// Inicializar mocks para desenvolvimento
initPlatformMocks();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### 9.3 Features NAO Suportadas em Chromium 56

| Feature | Chromium Min | Solucao |
|---------|--------------|---------|
| `Promise.allSettled()` | 76 | core-js polyfill |
| `Object.fromEntries()` | 73 | core-js polyfill |
| `Array.flat()` | 69 | core-js polyfill |
| `Array.flatMap()` | 69 | core-js polyfill |
| `??` (Nullish Coalescing) | 80 | Vite plugin-legacy transpila |
| `?.` (Optional Chaining) | 80 | Vite plugin-legacy transpila |
| `globalThis` | 71 | Polyfill manual |

> **NOTA**: O `@vitejs/plugin-legacy` ja cuida da transpilacao de `??` e `?.` para ES2015. Os polyfills acima sao para APIs de runtime.

---

## 10. Checklist de Setup

### 10.1 Setup Basico

- [ ] Node.js 18+ instalado
- [ ] Clonar/criar repositorio
- [ ] `npm install`
- [ ] Criar `.env` a partir de `.env.example`
- [ ] Adicionar API keys TMDB
- [ ] `npm run dev` funciona no browser

### 10.2 Setup Samsung Tizen

- [ ] Java JDK 8 ou 11 instalado
- [ ] Tizen Studio instalado
- [ ] Package Manager: TV Extensions instalado
- [ ] Package Manager: Samsung Certificate Extension instalado
- [ ] Certificado gerado (Certificate Manager)
- [ ] `config.xml` configurado
- [ ] TV em Developer Mode
- [ ] IP do Mac adicionado na TV
- [ ] `sdb connect <IP>` funciona
- [ ] `npm run build:tizen` gera .wgt

### 10.3 Setup LG webOS

- [ ] webOS CLI instalado (`npm install -g @webos-tools/cli`)
- [ ] `ares-version` funciona
- [ ] VS Code + webOS Studio instalado
- [ ] `appinfo.json` configurado
- [ ] TV em Developer Mode
- [ ] TV adicionada como device (`ares-setup-device`)
- [ ] `npm run build:webos` gera .ipk

### 10.4 Deploy

- [ ] Build Tizen: `npm run build:tizen`
- [ ] Build webOS: `npm run build:webos`
- [ ] Deploy Tizen: `npm run deploy:tizen <IP>`
- [ ] Deploy webOS: `npm run deploy:webos <device>`
- [ ] App abre na TV Samsung
- [ ] App abre na TV LG

---

## 11. Troubleshooting

### 11.1 Tizen Studio nao abre no macOS

**Erro**: "App is damaged and can't be opened"

**Solucao**:
```bash
xattr -d com.apple.quarantine /path/to/Tizen-Studio.app
```

### 11.2 sdb connect falha

**Erro**: "unable to connect"

**Solucoes**:
1. Verificar se TV e Mac estao na mesma rede
2. Verificar se Developer Mode esta habilitado na TV
3. Verificar se IP do Mac esta autorizado na TV
4. Tentar reiniciar a TV

### 11.3 ares-install falha na LG

**Erro**: "FAILED_TO_INSTALL"

**Solucoes**:
1. Verificar se Developer Mode esta ON na TV
2. Verificar passphrase no app Developer Mode
3. Tentar: `ares-setup-device --reset`
4. Refazer setup do device

### 11.4 App nao carrega na TV

**Possiveis causas**:
1. JavaScript nao compativel com versao do Chromium
2. Erro de CORS (fetch de URL externa)
3. Falta de privilegios no config.xml/appinfo.json

**Debug**:
```bash
# Samsung - ver logs
sdb dlog | grep -i ativeplay

# LG - ver logs
ares-inspect --device tv --app com.ativeapp.ativeplay
```

### 11.5 Player nao reproduz video

**Verificar**:
1. Privilegios de media no manifest
2. URL do stream acessivel
3. Formato suportado (.ts, .m3u8, .mp4)
4. Logs do player adapter

---

## 12. Referencias

### 12.1 Samsung Tizen

- [Documentacao Oficial](https://developer.samsung.com/smarttv/develop)
- [AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [Tizen Studio Download](https://developer.samsung.com/smarttv/develop/tools/tizen-studio.html)
- [WITs - Live Reload](https://github.com/aspect/aspect-wits)
- [The Ultimate Guide to Samsung Tizen TV Web Development](https://medium.com/norigintech/the-ultimate-guide-to-samsung-tizen-tv-web-development-f4613f672368)

### 12.2 LG webOS

- [Documentacao Oficial](https://webostv.developer.lge.com/)
- [webOS CLI Reference](https://webostv.developer.lge.com/develop/tools/cli-introduction)
- [webOS Studio Guide](https://webostv.developer.lge.com/develop/tools/webos-studio-dev-guide)
- [Luna Service API](https://webostv.developer.lge.com/develop/references/luna-service-introduction)

### 12.3 Desenvolvimento TV

- [Norigin Spatial Navigation](https://github.com/NoriginMedia/Norigin-Spatial-Navigation)
- [Smart TV Navigation with React](https://medium.com/norigintech/smart-tv-navigation-with-react-86bd5f3037b7)
- [react-tizen Example](https://github.com/AmbientSensorsHQ/react-tizen)

---

> **Versao**: 1.1
> **Data**: 2025-11-26
> **Autor**: Gerado com auxilio de IA para AtivePlay
> **Atualizacao**: Versoes sincronizadas com PRD_Dependencies.md (Context7)
