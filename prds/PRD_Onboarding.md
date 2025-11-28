# PRD: Onboarding & Ativacao

> **PRD ID**: PRD_Onboarding
> **Versao**: 1.0
> **Referencia**: PRD Master AtivePlay v1.1
> **Status**: Especificacao Completa
> **Data**: 2025-01-26

---

## 1. Objetivo

Implementar o fluxo de onboarding do AtivePlay, permitindo que usuarios:
- Adicionem suas playlists M3U/M3U8 de forma simples
- Visualizem o progresso de sincronizacao
- Gerenciem erros de forma amigavel
- Acessem URLs recentes para conveniencia

---

## 2. Fluxo de Telas

### 2.1 Diagrama do Fluxo (Atualizado v1.1 - Multiplas Playlists)

```
+-------------------------------------------------------------------------+
|                  FLUXO DE ONBOARDING - ATUALIZADO                        |
+-------------------------------------------------------------------------+
|                                                                          |
|   +-------------+                                                        |
|   |   SPLASH    |                                                        |
|   |   (2 sec)   |                                                        |
|   +------+------+                                                        |
|          |                                                               |
|          v                                                               |
|   +---------------------------+                                          |
|   | Tem playlists salvas?     |                                          |
|   +-------------+-------------+                                          |
|          |              |                                                |
|          | NAO          | SIM                                            |
|          v              v                                                |
|   +-------------+  +---------------------------+                         |
|   |  WELCOME    |  | Tem playlist ativa?       |                         |
|   |  SCREEN     |  +-------------+-------------+                         |
|   +------+------+         |              |                               |
|          |                | NAO          | SIM                           |
|          |                v              v                               |
|          |         +-------------+  +-------------+                      |
|          |         |  PLAYLIST   |  |    HOME     |                      |
|          |         |  SELECTOR   |  | (direto)    |                      |
|          |         +------+------+  +-------------+                      |
|          |                |                                              |
|          v                |                                              |
|   +-------------+         |                                              |
|   |  URL INPUT  |<--------+ (se selecionar "Adicionar")                  |
|   |  + TECLADO  |                                                        |
|   +------+------+                                                        |
|          |                                                               |
|          v                                                               |
|   +-------------+    +----------+    +----------+                        |
|   |  LOADING    |--->|  ERROR   |    | SUCCESS  |                        |
|   |  PROGRESS   |    |  SCREEN  |    | -> HOME  |                        |
|   +-------------+    +----------+    +----------+                        |
+-------------------------------------------------------------------------+
```

### 2.2 Decisoes do Fluxo

| Condicao | Destino |
|----------|---------|
| Primeira abertura (sem playlists) | Welcome Screen |
| Tem playlists MAS nenhuma ativa | Playlist Selector |
| Tem playlists E uma ativa | Direto para Home |
| URL valida e parseada | Home (ativa a nova playlist) |
| Erro no processo | Error Screen |
| Limite de 6 playlists atingido | Error Screen |

### 2.3 Fluxo de Selecao de Playlist (NOVO)

A tela **Playlist Selector** e exibida quando:
1. Usuario tem multiplas playlists e nenhuma esta ativa
2. Usuario acessa via Sidebar na Home (menu "Minhas Playlists")

Detalhes da tela estao no PRD_Home.md secao PlaylistSelector.

---

## 3. Telas Detalhadas

### 3.1 Splash Screen

```
+----------------------------------------+
|                                        |
|                                        |
|                                        |
|            +---------------+           |
|            |     LOGO      |           |
|            |   ATIVEPLAY   |           |
|            +---------------+           |
|                                        |
|             Carregando...              |
|               [spinner]                |
|                                        |
|                                        |
+----------------------------------------+
```

**Especificacoes:**
- **Duracao**: 2 segundos (minimo)
- **Background**: Navy (#09182B)
- **Logo**: Centralizado, com fade-in (300ms)
- **Spinner**: Discreto, abaixo do texto
- **Acao**: Verificar localStorage para playlists existentes

**Logica (Atualizada v1.1):**
```typescript
// Pseudo-codigo - Fluxo com multiplas playlists
useEffect(() => {
  const timer = setTimeout(async () => {
    const { playlists, activePlaylistId } = usePlaylistStore.getState();

    if (playlists.length === 0) {
      // Sem playlists -> Welcome
      navigate('/welcome');
    } else if (!activePlaylistId) {
      // Tem playlists mas nenhuma ativa -> Playlist Selector
      navigate('/playlists');
    } else {
      // Tem playlist ativa -> Home direto
      navigate('/home');
    }
  }, 2000);
  return () => clearTimeout(timer);
}, []);
```

---

### 3.2 Welcome Screen

```
+----------------------------------------+
|                                        |
|            +---------------+           |
|            |     LOGO      |           |
|            |   ATIVEPLAY   |           |
|            +---------------+           |
|                                        |
|      Bem-vindo ao AtivePlay!           |
|                                        |
|    Assista suas playlists IPTV com     |
|       uma experiencia premium.         |
|                                        |
|  +----------------------------------+  |
|  |   [+]  ADICIONAR PLAYLIST        |  |  <- Focado
|  +----------------------------------+  |
|                                        |
|          v1.0.0 | AtiveApp             |
+----------------------------------------+
```

**Especificacoes:**
- **Background**: Navy (#09182B)
- **Botao**: Verde (#1FAF38), focado por padrao
- **Versao**: Cinza (#CECECE), no rodape
- **Tipografia**:
  - Titulo: Inter 600, 32px
  - Subtitulo: Inter 400, 18px
  - Botao: Inter 500, 16px

**Navegacao D-PAD:**
| Tecla | Acao |
|-------|------|
| OK/Enter | Ir para PlaylistInput |
| Back | Fechar app (com confirmacao) |

---

### 3.3 Playlist Input + Teclado Virtual

```
+----------------------------------------+
|  <- Voltar       ADICIONAR PLAYLIST    |
+----------------------------------------+
|                                        |
|   Cole ou digite a URL da playlist:    |
|                                        |
|  +----------------------------------+  |
|  | http://exemplo.com/playlist.m3u  |  |  <- Input
|  +----------------------------------+  |
|                                        |
|  +----------------------------------+  |
|  | 1 2 3 4 5 6 7 8 9 0 - _ .        |  |
|  | q w e r t y u i o p / : @        |  |
|  | a s d f g h j k l http:// [<-]   |  |
|  | z x c v b n m .m3u [CONECTAR]    |  |
|  | [ABC] [123] [  ESPACO  ] [.com]  |  |
|  +----------------------------------+  |
|                                        |
|  URLs recentes:                        |
|  > http://minha-lista.m3u              |
|  > http://outra-lista.m3u8             |
+----------------------------------------+
```

**Layout do Teclado:**

#### Layout Principal (QWERTY + Simbolos URL)
```typescript
const KEYBOARD_LAYOUT_MAIN = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '_', '.'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p', '/', ':', '@'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'http://', 'BACKSPACE'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.m3u', 'CONECTAR'],
  ['ABC', '123', 'SPACE', '.com'],
];
```

#### Layout Numerico
```typescript
const KEYBOARD_LAYOUT_NUMERIC = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['!', '@', '#', '$', '%', '^', '&', '*', '(', ')'],
  ['-', '_', '=', '+', '[', ']', '{', '}', 'BACKSPACE'],
  ['\\', '|', ';', "'", '"', ',', '.', '?', 'CONECTAR'],
  ['ABC', '123', 'SPACE', 'https://'],
];
```

**Teclas Especiais:**

| Tecla | Funcao | Visual |
|-------|--------|--------|
| `BACKSPACE` | Remove ultimo caractere | `<-` ou icone |
| `SPACE` | Adiciona espaco | Barra larga |
| `CONECTAR` | Submete URL | Verde (#1FAF38) |
| `ABC/123` | Troca layout | Toggle |
| `http://` | Atalho prefixo | Texto completo |
| `.m3u` | Atalho extensao | Texto completo |
| `.com` | Atalho dominio | Texto completo |

**Navegacao D-PAD:**
| Tecla | Acao |
|-------|------|
| Setas | Move entre teclas |
| OK/Enter | Seleciona tecla |
| Back | Volta para Welcome |
| Verde (TV) | Submete (atalho) |

---

### 3.4 Loading/Sincronizacao

```
+----------------------------------------+
|                                        |
|                                        |
|        Sincronizando playlist...       |
|                                        |
|        +------------------------+      |
|        | ########--------  65% |      |
|        +------------------------+      |
|                                        |
|        Etapa: Parseando conteudo       |
|                                        |
|        +----------------------+        |
|        |     [CANCELAR]       |        |
|        +----------------------+        |
|                                        |
+----------------------------------------+
```

**Etapas do Progresso:**

| Etapa | Progresso | Mensagem |
|-------|-----------|----------|
| 1 | 0-25% | "Conectando ao servidor..." |
| 2 | 25-50% | "Baixando playlist..." |
| 3 | 50-75% | "Validando formato..." |
| 4 | 75-100% | "Parseando conteudo..." |

**Especificacoes:**
- **Barra de progresso**: Roxo (#7382FD) sobre cinza
- **Texto etapa**: Atualiza em tempo real
- **Botao Cancelar**: Sempre visivel e focado
- **Timeout**: 30 segundos

**Logica de Cancelamento:**
```typescript
const abortController = useRef(new AbortController());

const handleCancel = () => {
  abortController.current.abort();
  navigate('/input');
};
```

---

### 3.5 Tela de Erro

```
+----------------------------------------+
|                                        |
|              ! Erro                    |
|                                        |
|    Nao foi possivel carregar a         |
|    playlist. Verifique a URL.          |
|                                        |
|    Codigo: URL_INVALID                 |
|                                        |
|    +-----------------------------+     |
|    |    [TENTAR NOVAMENTE]       |     |  <- Focado
|    +-----------------------------+     |
|    +-----------------------------+     |
|    |         [VOLTAR]            |     |
|    +-----------------------------+     |
|                                        |
+----------------------------------------+
```

**Codigos de Erro:**

| Codigo | Mensagem para Usuario | Causa |
|--------|----------------------|-------|
| `URL_INVALID` | "URL invalida. Verifique o formato." | Regex nao bateu |
| `CONNECTION_FAILED` | "Nao foi possivel conectar ao servidor." | Fetch falhou |
| `TIMEOUT` | "Tempo limite excedido. Tente novamente." | > 30 segundos |
| `PARSE_ERROR` | "Formato de playlist invalido." | Nao contem #EXTM3U |
| `EMPTY_PLAYLIST` | "Playlist vazia ou sem itens validos." | 0 items parseados |
| `LIMIT_REACHED` | "Limite de 6 playlists atingido." | playlists.length >= 6 |

**Navegacao D-PAD:**
| Tecla | Acao |
|-------|------|
| UP/DOWN | Move entre botoes |
| OK/Enter | Executa acao |
| Back | Equivale a "Voltar" |

---

## 4. Componentes React

### 4.1 Estrutura de Arquivos

```
src/ui/onboarding/
|-- index.ts                    # Exports
|-- SplashScreen.tsx            # Tela de splash
|-- WelcomeScreen.tsx           # Tela de boas-vindas
|-- PlaylistInput.tsx           # Container input + teclado
|-- SyncProgress.tsx            # Tela de progresso
|-- ErrorScreen.tsx             # Tela de erro
|-- TVKeyboard/
|   |-- index.ts
|   |-- TVKeyboard.tsx          # Teclado principal
|   |-- KeyboardKey.tsx         # Tecla individual (focusable)
|   |-- KeyboardRow.tsx         # Linha de teclas
|   |-- KeyboardLayouts.ts      # Definicoes de layouts
|   |-- useKeyboardNavigation.ts # Hook de navegacao
|   |-- TVKeyboard.module.css
|-- RecentUrls/
|   |-- RecentUrls.tsx          # Lista de URLs recentes
|   |-- RecentUrlItem.tsx       # Item individual
|-- styles/
    |-- SplashScreen.module.css
    |-- WelcomeScreen.module.css
    |-- PlaylistInput.module.css
    |-- SyncProgress.module.css
    |-- ErrorScreen.module.css
```

### 4.2 Componente SplashScreen

```typescript
// src/ui/onboarding/SplashScreen.tsx

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePlaylistStore } from '@/store/playlistStore';
import styles from './styles/SplashScreen.module.css';

export const SplashScreen: React.FC = () => {
  const navigate = useNavigate();
  const { playlists, loadPlaylists } = usePlaylistStore();
  const [fadeIn, setFadeIn] = useState(false);

  useEffect(() => {
    // Trigger fade-in animation
    const fadeTimer = setTimeout(() => setFadeIn(true), 100);

    // Load playlists and navigate
    const navTimer = setTimeout(async () => {
      await loadPlaylists();

      if (playlists.length > 0) {
        navigate('/home', { replace: true });
      } else {
        navigate('/welcome', { replace: true });
      }
    }, 2000);

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(navTimer);
    };
  }, [navigate, loadPlaylists, playlists.length]);

  return (
    <div className={styles.container}>
      <div className={`${styles.content} ${fadeIn ? styles.fadeIn : ''}`}>
        <img
          src="/assets/logo.png"
          alt="AtivePlay"
          className={styles.logo}
        />
        <p className={styles.loading}>Carregando...</p>
        <div className={styles.spinner} />
      </div>
    </div>
  );
};
```

### 4.3 Componente WelcomeScreen

```typescript
// src/ui/onboarding/WelcomeScreen.tsx

import React, { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import styles from './styles/WelcomeScreen.module.css';

export const WelcomeScreen: React.FC = () => {
  const navigate = useNavigate();

  const { ref, focusKey, focusSelf } = useFocusable({
    onEnterPress: () => navigate('/input'),
  });

  // Auto-focus on mount
  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className={styles.container}>
        <div className={styles.content}>
          <img
            src="/assets/logo.png"
            alt="AtivePlay"
            className={styles.logo}
          />

          <h1 className={styles.title}>Bem-vindo ao AtivePlay!</h1>
          <p className={styles.subtitle}>
            Assista suas playlists IPTV com uma experiencia premium.
          </p>

          <button
            ref={ref}
            className={styles.addButton}
          >
            <span className={styles.icon}>+</span>
            ADICIONAR PLAYLIST
          </button>

          <p className={styles.version}>
            v{import.meta.env.VITE_APP_VERSION} | AtiveApp
          </p>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
```

### 4.4 Componente TVKeyboard

```typescript
// src/ui/onboarding/TVKeyboard/TVKeyboard.tsx

import React, { useState, useCallback } from 'react';
import {
  useFocusable,
  FocusContext,
} from '@noriginmedia/norigin-spatial-navigation';
import { KeyboardRow } from './KeyboardRow';
import { KEYBOARD_LAYOUTS, KeyboardLayoutType } from './KeyboardLayouts';
import styles from './TVKeyboard.module.css';

interface TVKeyboardProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
}

export const TVKeyboard: React.FC<TVKeyboardProps> = ({
  value,
  onChange,
  onSubmit,
}) => {
  const [layout, setLayout] = useState<KeyboardLayoutType>('main');

  const { ref, focusKey } = useFocusable({
    trackChildren: true,
    saveLastFocusedChild: true,
  });

  const handleKeyPress = useCallback((key: string) => {
    switch (key) {
      case 'BACKSPACE':
        onChange(value.slice(0, -1));
        break;
      case 'SPACE':
        onChange(value + ' ');
        break;
      case 'CONECTAR':
        onSubmit();
        break;
      case 'ABC':
        setLayout('main');
        break;
      case '123':
        setLayout('numeric');
        break;
      default:
        // Atalhos e caracteres normais
        onChange(value + key);
    }
  }, [value, onChange, onSubmit]);

  const currentLayout = KEYBOARD_LAYOUTS[layout];

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.keyboard}>
        {currentLayout.map((row, rowIndex) => (
          <KeyboardRow
            key={rowIndex}
            keys={row}
            onKeyPress={handleKeyPress}
            rowIndex={rowIndex}
          />
        ))}
      </div>
    </FocusContext.Provider>
  );
};
```

### 4.5 Componente KeyboardKey

```typescript
// src/ui/onboarding/TVKeyboard/KeyboardKey.tsx

import React from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import styles from './TVKeyboard.module.css';

interface KeyboardKeyProps {
  keyValue: string;
  onPress: (key: string) => void;
  focusKey: string;
}

const SPECIAL_KEYS = ['CONECTAR', 'BACKSPACE', 'SPACE', 'ABC', '123'];
const SHORTCUT_KEYS = ['http://', 'https://', '.m3u', '.m3u8', '.com'];

export const KeyboardKey: React.FC<KeyboardKeyProps> = ({
  keyValue,
  onPress,
  focusKey: customFocusKey,
}) => {
  const { ref, focused } = useFocusable({
    focusKey: customFocusKey,
    onEnterPress: () => onPress(keyValue),
  });

  const isSpecial = SPECIAL_KEYS.includes(keyValue);
  const isShortcut = SHORTCUT_KEYS.includes(keyValue);
  const isSubmit = keyValue === 'CONECTAR';

  const getDisplayValue = () => {
    switch (keyValue) {
      case 'BACKSPACE':
        return '<-';
      case 'SPACE':
        return 'ESPACO';
      default:
        return keyValue;
    }
  };

  const getKeyClassName = () => {
    const classes = [styles.key];
    if (focused) classes.push(styles.focused);
    if (isSpecial) classes.push(styles.special);
    if (isShortcut) classes.push(styles.shortcut);
    if (isSubmit) classes.push(styles.submit);
    return classes.join(' ');
  };

  return (
    <button
      ref={ref}
      className={getKeyClassName()}
      tabIndex={-1}
    >
      {getDisplayValue()}
    </button>
  );
};
```

### 4.6 Componente SyncProgress

```typescript
// src/ui/onboarding/SyncProgress.tsx

import React from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { useOnboardingStore } from '@/store/onboardingStore';
import styles from './styles/SyncProgress.module.css';

interface SyncProgressProps {
  onCancel: () => void;
}

const STAGE_MESSAGES: Record<string, string> = {
  connecting: 'Conectando ao servidor...',
  downloading: 'Baixando playlist...',
  validating: 'Validando formato...',
  parsing: 'Parseando conteudo...',
};

export const SyncProgress: React.FC<SyncProgressProps> = ({ onCancel }) => {
  const { syncStatus, syncProgress } = useOnboardingStore();

  const { ref, focusKey, focusSelf } = useFocusable({
    onEnterPress: onCancel,
  });

  React.useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className={styles.container}>
        <h2 className={styles.title}>Sincronizando playlist...</h2>

        <div className={styles.progressContainer}>
          <div
            className={styles.progressBar}
            style={{ width: `${syncProgress}%` }}
          />
          <span className={styles.progressText}>{syncProgress}%</span>
        </div>

        <p className={styles.stage}>
          Etapa: {STAGE_MESSAGES[syncStatus] || 'Processando...'}
        </p>

        <button ref={ref} className={styles.cancelButton}>
          CANCELAR
        </button>
      </div>
    </FocusContext.Provider>
  );
};
```

### 4.7 Componente ErrorScreen

```typescript
// src/ui/onboarding/ErrorScreen.tsx

import React, { useEffect } from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { SyncError } from '@/store/onboardingStore';
import styles from './styles/ErrorScreen.module.css';

interface ErrorScreenProps {
  error: SyncError;
  onRetry: () => void;
  onBack: () => void;
}

const ERROR_MESSAGES: Record<string, string> = {
  URL_INVALID: 'URL invalida. Verifique o formato.',
  CONNECTION_FAILED: 'Nao foi possivel conectar ao servidor.',
  TIMEOUT: 'Tempo limite excedido. Tente novamente.',
  PARSE_ERROR: 'Formato de playlist invalido.',
  EMPTY_PLAYLIST: 'Playlist vazia ou sem itens validos.',
  LIMIT_REACHED: 'Limite de 6 playlists atingido.',
};

export const ErrorScreen: React.FC<ErrorScreenProps> = ({
  error,
  onRetry,
  onBack,
}) => {
  const { ref: retryRef, focusKey, focusSelf } = useFocusable({
    onEnterPress: onRetry,
  });

  const { ref: backRef } = useFocusable({
    onEnterPress: onBack,
  });

  useEffect(() => {
    focusSelf();
  }, [focusSelf]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div className={styles.container}>
        <div className={styles.icon}>!</div>
        <h2 className={styles.title}>Erro</h2>

        <p className={styles.message}>
          {ERROR_MESSAGES[error.code] || error.message}
        </p>

        <p className={styles.code}>Codigo: {error.code}</p>

        <div className={styles.buttons}>
          <button ref={retryRef} className={styles.retryButton}>
            TENTAR NOVAMENTE
          </button>
          <button ref={backRef} className={styles.backButton}>
            VOLTAR
          </button>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
```

---

## 5. Gerenciamento de Estado (Zustand)

### 5.1 Onboarding Store

```typescript
// src/store/onboardingStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SyncStatus =
  | 'idle'
  | 'connecting'
  | 'downloading'
  | 'validating'
  | 'parsing'
  | 'success'
  | 'error';

export interface SyncError {
  code:
    | 'URL_INVALID'
    | 'CONNECTION_FAILED'
    | 'TIMEOUT'
    | 'PARSE_ERROR'
    | 'EMPTY_PLAYLIST'
    | 'LIMIT_REACHED';
  message: string;
}

interface OnboardingState {
  // Input State
  currentUrl: string;
  recentUrls: string[];

  // Sync State
  syncStatus: SyncStatus;
  syncProgress: number;
  syncError: SyncError | null;

  // Abort Controller
  abortController: AbortController | null;

  // Actions
  setUrl: (url: string) => void;
  addRecentUrl: (url: string) => void;
  removeRecentUrl: (url: string) => void;
  clearRecentUrls: () => void;

  // Sync Actions
  setSyncStatus: (status: SyncStatus) => void;
  setSyncProgress: (progress: number) => void;
  setSyncError: (error: SyncError | null) => void;
  setAbortController: (controller: AbortController | null) => void;
  resetSync: () => void;
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      // Initial State
      currentUrl: '',
      recentUrls: [],
      syncStatus: 'idle',
      syncProgress: 0,
      syncError: null,
      abortController: null,

      // URL Actions
      setUrl: (url) => set({ currentUrl: url }),

      addRecentUrl: (url) => {
        const { recentUrls } = get();
        // Remove duplicata e adiciona no inicio
        const filtered = recentUrls.filter((u) => u !== url);
        const newUrls = [url, ...filtered].slice(0, 5); // Max 5 URLs
        set({ recentUrls: newUrls });
      },

      removeRecentUrl: (url) => {
        const { recentUrls } = get();
        set({ recentUrls: recentUrls.filter((u) => u !== url) });
      },

      clearRecentUrls: () => set({ recentUrls: [] }),

      // Sync Actions
      setSyncStatus: (status) => set({ syncStatus: status }),
      setSyncProgress: (progress) => set({ syncProgress: progress }),
      setSyncError: (error) => set({ syncError: error }),
      setAbortController: (controller) => set({ abortController: controller }),

      resetSync: () =>
        set({
          syncStatus: 'idle',
          syncProgress: 0,
          syncError: null,
          abortController: null,
        }),
    }),
    {
      name: 'ativeplay_onboarding',
      partialize: (state) => ({
        recentUrls: state.recentUrls,
      }),
    }
  )
);
```

### 5.2 Playlist Store (Atualizado v1.1 - Multiplas Playlists)

```typescript
// src/store/playlistStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { removePlaylistWithData, setActivePlaylist as setActiveInDB } from '@/core/db/operations';

export interface PlaylistMeta {
  id: string;
  name: string;
  url: string;
  itemCount: number;
  createdAt: number;
  updatedAt: number;
  lastWatched?: number;
}

export interface PlaylistItem {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  type: 'live' | 'movie' | 'series';
}

interface PlaylistState {
  playlists: PlaylistMeta[];
  activePlaylistId: string | null;  // NOVO: Playlist ativa no momento

  // Actions
  addPlaylist: (playlist: PlaylistMeta) => void;
  removePlaylist: (id: string) => Promise<void>;  // Agora async para limpar IndexedDB
  updatePlaylist: (id: string, updates: Partial<PlaylistMeta>) => void;
  setActivePlaylist: (id: string | null) => Promise<void>;  // NOVO: Define playlist ativa
  loadPlaylists: () => Promise<void>;
  canAddPlaylist: () => boolean;
  getActivePlaylist: () => PlaylistMeta | null;  // NOVO: Retorna playlist ativa
}

const MAX_PLAYLISTS = parseInt(import.meta.env.VITE_MAX_PLAYLISTS || '6');

export const usePlaylistStore = create<PlaylistState>()(
  persist(
    (set, get) => ({
      playlists: [],
      activePlaylistId: null,

      addPlaylist: (playlist) => {
        const { playlists } = get();
        if (playlists.length >= MAX_PLAYLISTS) {
          throw new Error('LIMIT_REACHED');
        }
        set({
          playlists: [...playlists, playlist],
          // Se for a primeira playlist, ativa automaticamente
          activePlaylistId: playlists.length === 0 ? playlist.id : get().activePlaylistId,
        });
      },

      removePlaylist: async (id) => {
        const { playlists, activePlaylistId } = get();

        // Remover dados do IndexedDB (items, grupos, favoritos, progresso)
        await removePlaylistWithData(id);

        const newPlaylists = playlists.filter((p) => p.id !== id);
        set({
          playlists: newPlaylists,
          // Se remover a ativa, limpa a selecao
          activePlaylistId: activePlaylistId === id ? null : activePlaylistId,
        });
      },

      updatePlaylist: (id, updates) => {
        const { playlists } = get();
        set({
          playlists: playlists.map((p) =>
            p.id === id ? { ...p, ...updates, updatedAt: Date.now() } : p
          ),
        });
      },

      // NOVO: Define qual playlist esta ativa
      setActivePlaylist: async (id) => {
        if (id) {
          // Sincroniza com IndexedDB (marca isActive nas playlists)
          await setActiveInDB(id);
        }
        set({ activePlaylistId: id });
      },

      loadPlaylists: async () => {
        // Playlists sao carregadas automaticamente via persist
      },

      canAddPlaylist: () => {
        const { playlists } = get();
        return playlists.length < MAX_PLAYLISTS;
      },

      // NOVO: Helper para obter playlist ativa
      getActivePlaylist: () => {
        const { playlists, activePlaylistId } = get();
        return playlists.find((p) => p.id === activePlaylistId) || null;
      },
    }),
    {
      name: 'ativeplay_playlists',
    }
  )
);
```

---

## 6. Servico de Sincronizacao

```typescript
// src/core/services/playlist/playlistSyncService.ts

import { useOnboardingStore } from '@/store/onboardingStore';
import { usePlaylistStore, PlaylistMeta } from '@/store/playlistStore';
import { parseM3U, ParsedPlaylist } from '@/core/services/m3u/m3uParser';
import { generateId } from '@/core/utils/generateId';

export interface SyncResult {
  success: boolean;
  playlist?: PlaylistMeta;
  error?: {
    code: string;
    message: string;
  };
}

const URL_REGEX = /^https?:\/\/.+\.(m3u8?|txt)(\?.*)?$/i;
const TIMEOUT_MS = 30000;

export async function syncPlaylist(url: string): Promise<SyncResult> {
  const store = useOnboardingStore.getState();
  const playlistStore = usePlaylistStore.getState();

  // Reset state
  store.resetSync();

  // Create abort controller
  const abortController = new AbortController();
  store.setAbortController(abortController);

  try {
    // 1. Validar URL (0-25%)
    store.setSyncStatus('connecting');
    store.setSyncProgress(10);

    if (!URL_REGEX.test(url)) {
      throw { code: 'URL_INVALID', message: 'URL invalida' };
    }

    // Verificar limite
    if (!playlistStore.canAddPlaylist()) {
      throw { code: 'LIMIT_REACHED', message: 'Limite de playlists atingido' };
    }

    store.setSyncProgress(25);

    // 2. Download (25-50%)
    store.setSyncStatus('downloading');

    const response = await fetchWithTimeout(url, {
      signal: abortController.signal,
      timeout: TIMEOUT_MS,
    });

    if (!response.ok) {
      throw { code: 'CONNECTION_FAILED', message: `HTTP ${response.status}` };
    }

    store.setSyncProgress(50);

    // 3. Validar formato (50-75%)
    store.setSyncStatus('validating');
    const content = await response.text();

    if (!content.includes('#EXTM3U')) {
      throw { code: 'PARSE_ERROR', message: 'Formato M3U invalido' };
    }

    store.setSyncProgress(75);

    // 4. Parsear (75-100%)
    store.setSyncStatus('parsing');
    const parsed: ParsedPlaylist = parseM3U(content);

    if (parsed.items.length === 0) {
      throw { code: 'EMPTY_PLAYLIST', message: 'Playlist vazia' };
    }

    store.setSyncProgress(100);

    // Criar metadata
    const playlistMeta: PlaylistMeta = {
      id: generateId(),
      name: extractPlaylistName(url, parsed),
      url,
      itemCount: parsed.items.length,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    // Salvar
    playlistStore.addPlaylist(playlistMeta);
    store.addRecentUrl(url);

    // Sucesso
    store.setSyncStatus('success');
    return { success: true, playlist: playlistMeta };

  } catch (error: any) {
    // Cancelamento
    if (error.name === 'AbortError') {
      store.resetSync();
      return { success: false };
    }

    // Erro de timeout
    if (error.code === 'TIMEOUT') {
      store.setSyncError({ code: 'TIMEOUT', message: 'Timeout' });
      store.setSyncStatus('error');
      return { success: false, error: { code: 'TIMEOUT', message: 'Timeout' } };
    }

    // Outros erros
    const errorInfo = {
      code: error.code || 'UNKNOWN',
      message: error.message || 'Erro desconhecido',
    };

    store.setSyncError(errorInfo);
    store.setSyncStatus('error');
    return { success: false, error: errorInfo };

  } finally {
    store.setAbortController(null);
  }
}

export function cancelSync(): void {
  const { abortController } = useOnboardingStore.getState();
  if (abortController) {
    abortController.abort();
  }
}

// Helper: Fetch com timeout
async function fetchWithTimeout(
  url: string,
  options: { signal: AbortSignal; timeout: number }
): Promise<Response> {
  const timeoutId = setTimeout(() => {
    throw { code: 'TIMEOUT', message: 'Timeout' };
  }, options.timeout);

  try {
    const response = await fetch(url, { signal: options.signal });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

// Helper: Extrair nome da playlist
function extractPlaylistName(url: string, parsed: ParsedPlaylist): string {
  // Tentar obter do header da playlist
  if (parsed.header?.['x-tvg-name']) {
    return parsed.header['x-tvg-name'];
  }

  // Extrair do URL
  const urlObj = new URL(url);
  const pathname = urlObj.pathname;
  const filename = pathname.split('/').pop() || 'Playlist';
  return filename.replace(/\.(m3u8?|txt)$/i, '');
}
```

---

## 7. Validacoes

### 7.1 Regex de Validacao

```typescript
// src/core/utils/validators.ts

// URL M3U valida
export const M3U_URL_REGEX = /^https?:\/\/.+\.(m3u8?|txt)(\?.*)?$/i;

// Verificar se eh URL
export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};

// Verificar se eh URL M3U
export const isValidM3UUrl = (url: string): boolean => {
  return M3U_URL_REGEX.test(url);
};

// Verificar se conteudo eh M3U
export const isValidM3UContent = (content: string): boolean => {
  return content.trim().startsWith('#EXTM3U');
};

// Validar playlist completa
export interface ValidationResult {
  valid: boolean;
  error?: {
    code: string;
    message: string;
  };
}

export const validatePlaylistUrl = (url: string): ValidationResult => {
  if (!url.trim()) {
    return {
      valid: false,
      error: { code: 'URL_EMPTY', message: 'URL nao pode ser vazia' },
    };
  }

  if (!isValidUrl(url)) {
    return {
      valid: false,
      error: { code: 'URL_INVALID', message: 'URL invalida' },
    };
  }

  if (!isValidM3UUrl(url)) {
    return {
      valid: false,
      error: { code: 'URL_INVALID', message: 'URL deve terminar em .m3u ou .m3u8' },
    };
  }

  return { valid: true };
};
```

---

## 8. Estilos CSS

### 8.1 Variaveis Globais

```css
/* src/styles/variables.css */

:root {
  /* Cores principais */
  --color-navy: #09182B;
  --color-navy-light: #071A2B;
  --color-purple: #7382FD;
  --color-purple-light: #787DFC;
  --color-green: #1FAF38;
  --color-yellow: #F6D423;
  --color-white: #FFFFFF;
  --color-gray: #CECECE;
  --color-cyan: #BBEDFF;

  /* Espacamentos */
  --spacing-xs: 8px;
  --spacing-sm: 16px;
  --spacing-md: 24px;
  --spacing-lg: 32px;
  --spacing-xl: 48px;

  /* Fontes */
  --font-primary: 'Inter', sans-serif;
  --font-secondary: 'Poppins', sans-serif;

  /* Bordas */
  --border-radius-sm: 4px;
  --border-radius-md: 8px;
  --border-radius-lg: 12px;

  /* Transicoes */
  --transition-fast: 150ms ease;
  --transition-normal: 300ms ease;
}
```

### 8.2 Estilo do Teclado

```css
/* src/ui/onboarding/TVKeyboard/TVKeyboard.module.css */

.keyboard {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-md);
  background: var(--color-navy-light);
  border-radius: var(--border-radius-lg);
}

.row {
  display: flex;
  justify-content: center;
  gap: var(--spacing-xs);
}

.key {
  min-width: 48px;
  height: 48px;
  padding: 0 var(--spacing-sm);
  background: var(--color-navy);
  border: 2px solid transparent;
  border-radius: var(--border-radius-sm);
  color: var(--color-white);
  font-family: var(--font-primary);
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  transition: var(--transition-fast);
}

.key:hover {
  background: var(--color-purple);
}

.key.focused {
  border-color: var(--color-purple);
  background: var(--color-purple);
  transform: scale(1.05);
}

.key.special {
  min-width: 80px;
  background: var(--color-navy-light);
}

.key.shortcut {
  min-width: 72px;
  font-size: 12px;
  color: var(--color-cyan);
}

.key.submit {
  min-width: 120px;
  background: var(--color-green);
  font-weight: 600;
}

.key.submit.focused {
  background: #17a32d;
  border-color: var(--color-white);
}
```

---

## 9. Navegacao com Controle Remoto

### 9.1 Hook useRemoteControl

```typescript
// src/hooks/useRemoteControl.ts

import { useEffect, useCallback } from 'react';
import { detectPlatform } from '@/player/PlayerFactory';

interface RemoteControlHandlers {
  onBack?: () => void;
  onOK?: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onUp?: () => void;
  onDown?: () => void;
  onRed?: () => void;
  onGreen?: () => void;
  onYellow?: () => void;
  onBlue?: () => void;
}

const KEY_CODES = {
  tizen: {
    BACK: 10009,
    OK: 13,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
  },
  webos: {
    BACK: 461,
    OK: 13,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
  },
  browser: {
    BACK: 8, // Backspace
    OK: 13, // Enter
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    RED: 82, // R
    GREEN: 71, // G
    YELLOW: 89, // Y
    BLUE: 66, // B
  },
};

export function useRemoteControl(handlers: RemoteControlHandlers) {
  const platform = detectPlatform();
  const keys = KEY_CODES[platform] || KEY_CODES.browser;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const { keyCode } = event;

      switch (keyCode) {
        case keys.BACK:
          event.preventDefault();
          handlers.onBack?.();
          break;
        case keys.OK:
          handlers.onOK?.();
          break;
        case keys.LEFT:
          handlers.onLeft?.();
          break;
        case keys.RIGHT:
          handlers.onRight?.();
          break;
        case keys.UP:
          handlers.onUp?.();
          break;
        case keys.DOWN:
          handlers.onDown?.();
          break;
        case keys.RED:
          handlers.onRed?.();
          break;
        case keys.GREEN:
          handlers.onGreen?.();
          break;
        case keys.YELLOW:
          handlers.onYellow?.();
          break;
        case keys.BLUE:
          handlers.onBlue?.();
          break;
      }
    },
    [handlers, keys]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
```

---

## 10. Rotas (Atualizado v1.1)

```typescript
// src/App.tsx

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { init as initSpatialNavigation } from '@noriginmedia/norigin-spatial-navigation';

// Onboarding
import { SplashScreen } from '@/ui/onboarding/SplashScreen';
import { WelcomeScreen } from '@/ui/onboarding/WelcomeScreen';
import { PlaylistInput } from '@/ui/onboarding/PlaylistInput';

// NOVO: Playlist Selector (multiplas playlists)
import { PlaylistSelector } from '@/ui/playlists/PlaylistSelector';

// Home
import { Home } from '@/ui/home/Home';
import { CategoryPage } from '@/ui/home/CategoryPage';
import { FavoritesPage } from '@/ui/home/FavoritesPage';

// Player
import { Player } from '@/ui/player/Player';

// Settings
import { Settings } from '@/ui/settings/Settings';

// Inicializar navegacao espacial
initSpatialNavigation({
  debug: import.meta.env.DEV,
  visualDebug: import.meta.env.DEV,
});

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <Routes>
        {/* Onboarding */}
        <Route path="/" element={<SplashScreen />} />
        <Route path="/welcome" element={<WelcomeScreen />} />
        <Route path="/input" element={<PlaylistInput />} />

        {/* NOVO: Seletor de Playlists */}
        <Route path="/playlists" element={<PlaylistSelector />} />

        {/* Main App */}
        <Route path="/home" element={<Home />} />
        <Route path="/category/:mediaKind" element={<CategoryPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/player/:itemId" element={<Player />} />
        <Route path="/settings" element={<Settings />} />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
};
```

---

## 11. Referencias

- [Norigin Spatial Navigation](https://github.com/NoriginMedia/Norigin-Spatial-Navigation)
- [Smart TV Navigation with React](https://medium.com/norigintech/smart-tv-navigation-with-react-86bd5f3037b7)
- [smart-tv-keyboard](https://github.com/dipcore/smart-tv-keyboard)
- [Zustand Documentation](https://docs.pmnd.rs/zustand/getting-started/introduction)

---

> **Versao**: 1.1
> **Data**: 2025-11-26
> **Atualizacao**: Fluxo para multiplas playlists, activePlaylistId, nova rota /playlists
> **Autor**: Gerado com auxilio de IA para AtivePlay
