# PRD: Multi-Playlist (Multiplas Playlists)

**Versao:** 1.0
**Data:** 2025-11-27
**Status:** Aprovado
**Autor:** Gerado com auxilio de IA para AtivePlay

---

## 1. Visao Geral

### 1.1 Objetivo

Este PRD documenta o sistema de gerenciamento de multiplas playlists no AtivePlay, permitindo que usuarios mantenham ate 6 playlists M3U simultaneamente, alternando entre elas de forma fluida.

### 1.2 Motivacao

Usuarios de IPTV frequentemente possuem:
- Multiplos provedores de conteudo
- Backups de playlists
- Playlists de teste vs. principais

### 1.3 Limites do Sistema

| Parametro | Valor | Justificativa |
|-----------|-------|---------------|
| Max Playlists | 3 | Memoria limitada em Smart TVs |


---

## 2. Arquitetura de Dados

### 2.1 Modelo de Playlist

```typescript
// src/store/playlistStore.ts

export interface PlaylistMeta {
  id: string;              // UUID
  name: string;            // Nome dado pelo usuario
  url: string;             // URL original do M3U
  itemCount: number;       // Total de items
  createdAt: number;       // Timestamp de criacao
  updatedAt: number;       // Ultima atualizacao/sync

  // Estatisticas por tipo
  liveCount: number;       // Canais ao vivo
  movieCount: number;      // Filmes
  seriesCount: number;     // Series

  // Estado
  isActive: boolean;       // Se eh a playlist ativa
  lastSyncStatus: 'success' | 'error' | 'pending';
  lastSyncError?: string;
}
```

### 2.2 Estado Global (Zustand)

```typescript
// src/store/playlistStore.ts

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { removePlaylistWithData, setActivePlaylist as setActiveInDB } from '@/core/db/operations';

interface PlaylistState {
  playlists: PlaylistMeta[];
  activePlaylistId: string | null;

  // Actions
  addPlaylist: (playlist: PlaylistMeta) => void;
  removePlaylist: (id: string) => Promise<void>;
  updatePlaylist: (id: string, updates: Partial<PlaylistMeta>) => void;
  setActivePlaylist: (id: string | null) => Promise<void>;
  canAddPlaylist: () => boolean;
  getActivePlaylist: () => PlaylistMeta | null;
  getPlaylistById: (id: string) => PlaylistMeta | undefined;
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

      setActivePlaylist: async (id) => {
        if (id) {
          // Sincroniza com IndexedDB (marca isActive nas playlists)
          await setActiveInDB(id);
        }
        set({ activePlaylistId: id });
      },

      canAddPlaylist: () => {
        const { playlists } = get();
        return playlists.length < MAX_PLAYLISTS;
      },

      getActivePlaylist: () => {
        const { playlists, activePlaylistId } = get();
        return playlists.find((p) => p.id === activePlaylistId) || null;
      },

      getPlaylistById: (id) => {
        const { playlists } = get();
        return playlists.find((p) => p.id === id);
      },
    }),
    {
      name: 'ativeplay_playlists',
    }
  )
);
```

### 2.3 Operacoes de Banco (IndexedDB)

```typescript
// src/core/db/operations.ts

import { db } from './schema';

/**
 * Remove uma playlist e todos os dados associados
 * Usa transacao para garantir atomicidade
 */
export async function removePlaylistWithData(playlistId: string): Promise<void> {
  await db.transaction('rw', [
    db.playlists,
    db.items,
    db.groups,
    db.favorites,
    db.watchProgress,
    db.channelFavorites,
  ], async () => {
    // Remover todos os dados associados a playlist
    await Promise.all([
      db.items.where('playlistId').equals(playlistId).delete(),
      db.groups.where('playlistId').equals(playlistId).delete(),
      db.favorites.where('playlistId').equals(playlistId).delete(),
      db.watchProgress.where('playlistId').equals(playlistId).delete(),
      db.channelFavorites.where('playlistId').equals(playlistId).delete(),
    ]);

    // Por ultimo, remover a playlist em si
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

/**
 * Conta total de items em todas as playlists
 */
export async function getTotalItemsCount(): Promise<number> {
  return await db.items.count();
}

/**
 * Estima uso de storage por playlist
 */
export async function estimatePlaylistStorage(playlistId: string): Promise<number> {
  const items = await db.items.where('playlistId').equals(playlistId).count();
  const groups = await db.groups.where('playlistId').equals(playlistId).count();

  // Estimativa: ~500 bytes por item, ~200 bytes por grupo
  return (items * 500) + (groups * 200);
}
```

---

## 3. Fluxo de Navegacao

### 3.1 Diagrama de Estados

```
                              +-------------------+
                              |   SPLASH SCREEN   |
                              +--------+----------+
                                       |
                                       v
                    +------------------+------------------+
                    |                                     |
                    v                                     v
    +---------------+----------+            +-------------+------------+
    | Sem playlists           |            | Tem playlists            |
    | -> WELCOME SCREEN       |            +-------------+------------+
    +---------------+----------+                         |
                    |                                    v
                    |                     +--------------+--------------+
                    |                     |                             |
                    |                     v                             v
                    |      +--------------+----------+   +--------------+----------+
                    |      | Nenhuma ativa          |   | Tem ativa               |
                    |      | -> PLAYLIST SELECTOR   |   | -> HOME                 |
                    |      +--------------+----------+   +--------------+----------+
                    |                     |
                    v                     v
            +-------+---------------------+-------+
            |          URL INPUT                  |
            |   (adicionar nova playlist)         |
            +-------+-----------------------------+
                    |
                    v
            +-------+-----------------------------+
            |       LOADING/PARSING               |
            +-------+-----------------------------+
                    |
         +----------+-----------+
         |                      |
         v                      v
    +----+----+           +-----+-----+
    | SUCCESS |           |   ERROR   |
    | -> HOME |           |  SCREEN   |
    +---------+           +-----------+
```

### 3.2 Acoes de Navegacao

| Origem | Acao | Destino |
|--------|------|---------|
| Splash | Sem playlists | Welcome |
| Splash | Tem playlist ativa | Home |
| Splash | Tem playlists, nenhuma ativa | PlaylistSelector |
| Welcome | Continuar | URL Input |
| PlaylistSelector | Selecionar playlist | Home |
| PlaylistSelector | Adicionar nova | URL Input |
| PlaylistSelector | Remover playlist | Confirmacao -> PlaylistSelector |
| Home (Sidebar) | Minhas Playlists | PlaylistSelector |
| Home (Sidebar) | Nova Playlist | URL Input |
| URL Input | Sucesso | Home |
| URL Input | Erro | Error Screen |

---

## 4. Telas e Componentes

### 4.1 PlaylistSelector (Lista de Playlists)

#### Layout

```
+----------------------------------------------------------+
|  <- Voltar              MINHAS PLAYLISTS                  |
+----------------------------------------------------------+
|                                                           |
|  +-----------------------------------------------------+  |
|  | [icone] Minha Lista Principal                        |  |
|  |    12.345 canais  |  1.234 filmes  |  567 series    |  |  <- Item ativo
|  |    Ultima atualizacao: Hoje as 14:30                |  |
|  |    [check] Ativo                                    |  |
|  +-----------------------------------------------------+  |
|                                                           |
|  +-----------------------------------------------------+  |
|  | [icone] Lista de Backup                              |  |
|  |    8.900 canais  |  890 filmes  |  234 series       |  |
|  |    Ultima atualizacao: 2 dias atras                 |  |
|  +-----------------------------------------------------+  |
|                                                           |
|  +-----------------------------------------------------+  |
|  | [icone] Lista Esportes                               |  |
|  |    456 canais  |  0 filmes  |  0 series             |  |
|  |    Ultima atualizacao: 1 semana atras               |  |
|  +-----------------------------------------------------+  |
|                                                           |
|  +- - - - - - - - - - - - - - - - - - - - - - - - - - -+  |
|  |  [+] Adicionar Nova Playlist                        |  |
|  +- - - - - - - - - - - - - - - - - - - - - - - - - - -+  |
|                                                           |
|  -------------------------------------------------------- |
|  [ENTER] Selecionar   [RED] Remover   [YELLOW] Atualizar  |
+----------------------------------------------------------+
```

#### Especificacoes

| Propriedade | Valor |
|-------------|-------|
| Max Playlists | 6 |
| Item Height | 120px |
| Gap | 16px |
| Padding | 48px horizontal, 32px vertical |
| Background | Navy Primary (#09182B) |

#### Estados do Item

| Estado | Aparencia |
|--------|-----------|
| Normal | Borda transparente |
| Focused | Borda roxa (#7382FD), scale 1.02 |
| Ativo | Borda verde (#00D9A5), badge "Ativo" |
| Syncing | Spinner no lugar do icone |
| Error | Borda vermelha, icone de alerta |

### 4.2 Componente PlaylistItem

```typescript
// src/ui/playlists/PlaylistItem.tsx

import React, { useEffect } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { PlaylistMeta } from '@/store/playlistStore';
import { formatRelativeTime, formatNumber } from '@/utils/format';
import styles from './PlaylistSelector.module.css';

interface PlaylistItemProps {
  playlist?: PlaylistMeta;
  isActive?: boolean;
  isAddButton?: boolean;
  isSyncing?: boolean;
  onSelect: () => void;
  onRemove?: () => void;
  onSync?: () => void;
}

export const PlaylistItem: React.FC<PlaylistItemProps> = ({
  playlist,
  isActive,
  isAddButton,
  isSyncing,
  onSelect,
  onRemove,
  onSync,
}) => {
  const { ref, focused } = useFocusable({
    onEnterPress: onSelect,
  });

  // Handler para teclas coloridas
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!focused) return;

      switch (e.keyCode) {
        case 403: // RED - Remover
          onRemove?.();
          break;
        case 405: // YELLOW - Atualizar
          onSync?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [focused, onRemove, onSync]);

  if (isAddButton) {
    return (
      <button
        ref={ref}
        className={`${styles.item} ${styles.addButton} ${focused ? styles.focused : ''}`}
      >
        <span className={styles.icon}>+</span>
        <span className={styles.addLabel}>Adicionar Nova Playlist</span>
      </button>
    );
  }

  return (
    <button
      ref={ref}
      className={`
        ${styles.item}
        ${focused ? styles.focused : ''}
        ${isActive ? styles.active : ''}
        ${playlist?.lastSyncStatus === 'error' ? styles.error : ''}
      `}
    >
      <div className={styles.iconContainer}>
        {isSyncing ? (
          <span className={styles.spinner}>...</span>
        ) : (
          <span className={styles.icon}>[playlist]</span>
        )}
      </div>

      <div className={styles.info}>
        <span className={styles.name}>{playlist?.name}</span>

        <div className={styles.stats}>
          <span>{formatNumber(playlist?.liveCount || 0)} canais</span>
          <span className={styles.divider}>|</span>
          <span>{formatNumber(playlist?.movieCount || 0)} filmes</span>
          <span className={styles.divider}>|</span>
          <span>{formatNumber(playlist?.seriesCount || 0)} series</span>
        </div>

        <span className={styles.date}>
          Ultima atualizacao: {formatRelativeTime(playlist?.updatedAt || 0)}
        </span>

        {playlist?.lastSyncStatus === 'error' && (
          <span className={styles.errorText}>
            Erro: {playlist.lastSyncError}
          </span>
        )}
      </div>

      {isActive && (
        <span className={styles.activeBadge}>[check] Ativo</span>
      )}
    </button>
  );
};
```

### 4.3 Componente PlaylistSelector

```typescript
// src/ui/playlists/PlaylistSelector.tsx

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { usePlaylistStore } from '@/store/playlistStore';
import { PlaylistItem } from './PlaylistItem';
import { ConfirmDialog } from '@/ui/common/ConfirmDialog';
import styles from './PlaylistSelector.module.css';

export const PlaylistSelector: React.FC = () => {
  const navigate = useNavigate();
  const {
    playlists,
    activePlaylistId,
    setActivePlaylist,
    removePlaylist,
    canAddPlaylist,
  } = usePlaylistStore();

  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [syncingId, setSyncingId] = useState<string | null>(null);

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
    setConfirmRemove(playlistId);
  };

  const confirmRemovePlaylist = async () => {
    if (!confirmRemove) return;

    await removePlaylist(confirmRemove);
    setConfirmRemove(null);

    // Se nao houver mais playlists, ir para welcome
    if (playlists.length <= 1) {
      navigate('/welcome');
    }
  };

  const handleSyncPlaylist = async (playlistId: string) => {
    setSyncingId(playlistId);
    try {
      // TODO: Implementar re-sync da playlist
      // await syncPlaylist(playlistId);
      await new Promise(resolve => setTimeout(resolve, 2000)); // Simular
    } finally {
      setSyncingId(null);
    }
  };

  const handleAddPlaylist = () => {
    if (!canAddPlaylist()) {
      // TODO: Mostrar mensagem de limite atingido
      return;
    }
    navigate('/input');
  };

  const handleBack = () => {
    if (activePlaylistId) {
      navigate('/home');
    } else {
      navigate('/welcome');
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.container}>
        <header className={styles.header}>
          <button className={styles.backButton} onClick={handleBack}>
            <- Voltar
          </button>
          <h1 className={styles.title}>Minhas Playlists</h1>
          <span className={styles.counter}>
            {playlists.length}/6
          </span>
        </header>

        <main className={styles.content}>
          {playlists.map((playlist) => (
            <PlaylistItem
              key={playlist.id}
              playlist={playlist}
              isActive={playlist.id === activePlaylistId}
              isSyncing={syncingId === playlist.id}
              onSelect={() => handleSelectPlaylist(playlist.id)}
              onRemove={() => handleRemovePlaylist(playlist.id)}
              onSync={() => handleSyncPlaylist(playlist.id)}
            />
          ))}

          {/* Botao Adicionar Nova (se nao atingiu limite) */}
          {canAddPlaylist() && (
            <PlaylistItem
              isAddButton
              onSelect={handleAddPlaylist}
            />
          )}
        </main>

        <footer className={styles.footer}>
          <span>[ENTER] Selecionar</span>
          <span>[RED] Remover</span>
          <span>[YELLOW] Atualizar</span>
          <span>[BACK] Voltar</span>
        </footer>

        {/* Dialog de Confirmacao */}
        {confirmRemove && (
          <ConfirmDialog
            title="Remover Playlist"
            message="Tem certeza que deseja remover esta playlist? Todos os dados (favoritos, progresso) serao perdidos."
            confirmLabel="Remover"
            cancelLabel="Cancelar"
            onConfirm={confirmRemovePlaylist}
            onCancel={() => setConfirmRemove(null)}
            destructive
          />
        )}
      </div>
    </FocusContext.Provider>
  );
};
```

### 4.4 Estilos

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
  padding: 8px 16px;
}

.title {
  font-family: var(--font-primary);
  font-size: 32px;
  font-weight: 600;
  color: var(--color-white);
  flex: 1;
}

.counter {
  font-family: var(--font-primary);
  font-size: 16px;
  color: var(--color-gray);
  background: var(--color-navy-secondary);
  padding: 8px 16px;
  border-radius: 8px;
}

.content {
  display: flex;
  flex-direction: column;
  gap: 16px;
  flex: 1;
  overflow-y: auto;
}

.item {
  display: flex;
  align-items: center;
  gap: 20px;
  padding: 24px;
  background: var(--color-navy-secondary);
  border: 2px solid transparent;
  border-radius: 12px;
  cursor: pointer;
  transition: all 150ms ease;
  text-align: left;
  width: 100%;
}

.item.focused {
  border-color: var(--color-purple);
  background: rgba(115, 130, 253, 0.1);
  transform: scale(1.02);
}

.item.active {
  border-color: var(--color-green);
}

.item.error {
  border-color: var(--color-red);
}

.iconContainer {
  width: 64px;
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-navy-primary);
  border-radius: 12px;
  flex-shrink: 0;
}

.icon {
  font-size: 32px;
}

.spinner {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
}

.name {
  font-family: var(--font-primary);
  font-size: 20px;
  font-weight: 500;
  color: var(--color-white);
}

.stats {
  display: flex;
  gap: 8px;
  font-family: var(--font-primary);
  font-size: 14px;
  color: var(--color-gray);
}

.divider {
  color: var(--color-gray);
  opacity: 0.5;
}

.date {
  font-family: var(--font-primary);
  font-size: 12px;
  color: var(--color-gray);
  opacity: 0.7;
}

.errorText {
  font-size: 12px;
  color: var(--color-red);
}

.activeBadge {
  background: var(--color-green);
  color: var(--color-navy-primary);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
}

.addButton {
  border-style: dashed;
  background: transparent;
  justify-content: center;
}

.addButton .icon {
  color: var(--color-cyan);
}

.addLabel {
  font-family: var(--font-primary);
  font-size: 18px;
  color: var(--color-cyan);
}

.footer {
  display: flex;
  gap: 32px;
  padding-top: 24px;
  margin-top: 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--color-gray);
  font-size: 14px;
}
```

---

## 5. Sidebar Integration

### 5.1 Items da Sidebar

```typescript
// src/ui/home/Sidebar.tsx

interface SidebarItem {
  id: string;
  icon: string;
  label: string;
  route: string;
  type: 'navigation' | 'action' | 'selector';
  alwaysVisible?: boolean;
  showCondition?: () => boolean;
}

const SIDEBAR_ITEMS: SidebarItem[] = [
  // SECAO 1: ACOES (topo)
  {
    id: 'add-playlist',
    icon: '+',
    label: 'Nova Playlist',
    route: '/input',
    type: 'action',
    alwaysVisible: true
  },

  // SECAO 2: GERENCIAMENTO (se multiplas playlists)
  {
    id: 'playlists',
    icon: '[list]',
    label: 'Minhas Playlists',
    route: '/playlists',
    type: 'selector',
    showCondition: () => usePlaylistStore.getState().playlists.length > 1,
  },

  // SEPARADOR

  // SECAO 3: NAVEGACAO PRINCIPAL
  { id: 'home', icon: '[home]', label: 'Inicio', route: '/home', type: 'navigation' },
  { id: 'live', icon: '[tv]', label: 'TV ao Vivo', route: '/category/live', type: 'navigation' },
  { id: 'movies', icon: '[film]', label: 'Filmes', route: '/category/movie', type: 'navigation' },
  { id: 'series', icon: '[video]', label: 'Series', route: '/category/series', type: 'navigation' },
  { id: 'favorites', icon: '[star]', label: 'Favoritos', route: '/favorites', type: 'navigation' },

  // SEPARADOR

  // SECAO 4: CONFIGURACOES
  { id: 'settings', icon: '[gear]', label: 'Configuracoes', route: '/settings', type: 'navigation' },
];

// Filtrar items baseado em condicoes
function getVisibleSidebarItems(): SidebarItem[] {
  return SIDEBAR_ITEMS.filter(item => {
    if (item.showCondition) {
      return item.showCondition();
    }
    return true;
  });
}
```

### 5.2 Indicador de Playlist Ativa

Na Sidebar, mostrar qual playlist esta ativa:

```typescript
// Em Sidebar.tsx

const { getActivePlaylist, playlists } = usePlaylistStore();
const activePlaylist = getActivePlaylist();

// No header da Sidebar (quando expandida)
{sidebarExpanded && activePlaylist && (
  <div className={styles.activePlaylistIndicator}>
    <span className={styles.playlistName}>{activePlaylist.name}</span>
    <span className={styles.playlistCount}>
      {activePlaylist.itemCount.toLocaleString()} items
    </span>
  </div>
)}
```

---

## 6. Sincronizacao de Playlist

### 6.1 Hook useSyncPlaylist

```typescript
// src/hooks/useSyncPlaylist.ts

import { useState, useCallback } from 'react';
import { usePlaylistStore } from '@/store/playlistStore';
import { parseM3U } from '@/core/services/m3u/parser';
import { db } from '@/core/db/schema';

interface SyncProgress {
  phase: 'fetching' | 'parsing' | 'saving' | 'complete' | 'error';
  progress: number;
  message: string;
}

interface UseSyncPlaylistReturn {
  sync: (playlistId: string) => Promise<void>;
  progress: SyncProgress | null;
  issyncing: boolean;
}

export function useSyncPlaylist(): UseSyncPlaylistReturn {
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const { getPlaylistById, updatePlaylist } = usePlaylistStore();

  const sync = useCallback(async (playlistId: string) => {
    const playlist = getPlaylistById(playlistId);
    if (!playlist) return;

    try {
      // Fase 1: Fetch
      setProgress({ phase: 'fetching', progress: 10, message: 'Baixando playlist...' });

      const response = await fetch(playlist.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const content = await response.text();

      // Fase 2: Parse
      setProgress({ phase: 'parsing', progress: 40, message: 'Processando items...' });

      const parsed = await parseM3U(content, (p) => {
        setProgress({
          phase: 'parsing',
          progress: 40 + (p * 0.3),
          message: `Processando items... ${Math.round(p * 100)}%`
        });
      });

      // Fase 3: Salvar
      setProgress({ phase: 'saving', progress: 70, message: 'Salvando no banco...' });

      await db.transaction('rw', [db.items, db.groups], async () => {
        // Remover items antigos
        await db.items.where('playlistId').equals(playlistId).delete();
        await db.groups.where('playlistId').equals(playlistId).delete();

        // Inserir novos
        await db.items.bulkAdd(parsed.items.map(item => ({
          ...item,
          playlistId,
        })));

        await db.groups.bulkAdd(parsed.groups.map(group => ({
          ...group,
          playlistId,
        })));
      });

      // Atualizar metadata
      updatePlaylist(playlistId, {
        itemCount: parsed.items.length,
        liveCount: parsed.items.filter(i => i.mediaKind === 'live').length,
        movieCount: parsed.items.filter(i => i.mediaKind === 'movie').length,
        seriesCount: parsed.items.filter(i => i.mediaKind === 'series').length,
        lastSyncStatus: 'success',
        lastSyncError: undefined,
      });

      setProgress({ phase: 'complete', progress: 100, message: 'Sincronizado!' });

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erro desconhecido';

      updatePlaylist(playlistId, {
        lastSyncStatus: 'error',
        lastSyncError: message,
      });

      setProgress({ phase: 'error', progress: 0, message });
      throw error;

    } finally {
      // Limpar progress apos 2s
      setTimeout(() => setProgress(null), 2000);
    }
  }, [getPlaylistById, updatePlaylist]);

  return {
    sync,
    progress,
    issyncing: progress !== null && progress.phase !== 'complete' && progress.phase !== 'error',
  };
}
```

---

## 7. Isolamento de Dados

### 7.1 Queries com Playlist ID

Todas as queries devem filtrar por `playlistId` para garantir isolamento:

```typescript
// src/hooks/usePlaylistData.ts

import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/core/db/schema';
import { usePlaylistStore } from '@/store/playlistStore';

/**
 * Hook para obter items da playlist ativa
 */
export function usePlaylistItems(mediaKind?: MediaKind) {
  const { activePlaylistId } = usePlaylistStore();

  return useLiveQuery(
    async () => {
      if (!activePlaylistId) return [];

      let query = db.items.where('playlistId').equals(activePlaylistId);

      if (mediaKind) {
        query = db.items
          .where('[playlistId+mediaKind]')
          .equals([activePlaylistId, mediaKind]);
      }

      return query.toArray();
    },
    [activePlaylistId, mediaKind],
    []
  );
}

/**
 * Hook para obter grupos da playlist ativa
 */
export function usePlaylistGroups(mediaKind?: MediaKind) {
  const { activePlaylistId } = usePlaylistStore();

  return useLiveQuery(
    async () => {
      if (!activePlaylistId) return [];

      if (mediaKind) {
        return db.groups
          .where('[playlistId+mediaKind]')
          .equals([activePlaylistId, mediaKind])
          .toArray();
      }

      return db.groups
        .where('playlistId')
        .equals(activePlaylistId)
        .toArray();
    },
    [activePlaylistId, mediaKind],
    []
  );
}

/**
 * Hook para obter favoritos da playlist ativa
 */
export function usePlaylistFavorites() {
  const { activePlaylistId } = usePlaylistStore();

  return useLiveQuery(
    async () => {
      if (!activePlaylistId) return [];

      const favorites = await db.favorites
        .where('playlistId')
        .equals(activePlaylistId)
        .toArray();

      const itemIds = favorites.map(f => f.itemId);
      const items = await db.items.bulkGet(itemIds);

      return items.filter(Boolean);
    },
    [activePlaylistId],
    []
  );
}

/**
 * Hook para obter progresso de assistir da playlist ativa
 */
export function useWatchProgress() {
  const { activePlaylistId } = usePlaylistStore();

  return useLiveQuery(
    async () => {
      if (!activePlaylistId) return [];

      return db.watchProgress
        .where('playlistId')
        .equals(activePlaylistId)
        .sortBy('lastWatched');
    },
    [activePlaylistId],
    []
  );
}
```

---

## 8. Persistencia

### 8.1 Zustand Persist

O estado das playlists (metadata) eh persistido via Zustand:

```typescript
// localStorage key: 'ativeplay_playlists'
{
  playlists: PlaylistMeta[],
  activePlaylistId: string | null
}
```

### 8.2 IndexedDB

Os dados pesados (items, grupos) sao persistidos via Dexie:

| Tabela | Dados | Filtro |
|--------|-------|--------|
| `playlists` | Metadata completa | - |
| `items` | Todos os items M3U | `playlistId` |
| `groups` | Grupos/categorias | `playlistId` |
| `favorites` | Items favoritados | `playlistId` |
| `watchProgress` | Progresso de VOD | `playlistId` |
| `channelFavorites` | Canais favoritos | `playlistId` |

---

## 9. Variaveis de Ambiente

```bash
# .env
VITE_MAX_PLAYLISTS=6
VITE_MAX_ITEMS_PER_PLAYLIST=500000
VITE_PLAYLIST_SYNC_TIMEOUT=120000
```

---

## 10. Rotas

```typescript
// src/App.tsx

<Routes>
  {/* Onboarding */}
  <Route path="/" element={<SplashScreen />} />
  <Route path="/welcome" element={<WelcomeScreen />} />
  <Route path="/input" element={<PlaylistInput />} />

  {/* Multi-Playlist */}
  <Route path="/playlists" element={<PlaylistSelector />} />

  {/* Main App */}
  <Route path="/home" element={<Home />} />
  <Route path="/category/:mediaKind" element={<CategoryPage />} />
  <Route path="/favorites" element={<FavoritesPage />} />
  <Route path="/player/:itemId" element={<Player />} />
  <Route path="/settings" element={<Settings />} />

  {/* Live TV */}
  <Route path="/category/live" element={<ChannelList />} />
  <Route path="/live/:channelId" element={<LivePlayer />} />

  {/* Fallback */}
  <Route path="*" element={<Navigate to="/" replace />} />
</Routes>
```

---

## 11. Atalhos de Teclado

| Tecla | KeyCode | Contexto | Acao |
|-------|---------|----------|------|
| ENTER | 13 | PlaylistSelector | Selecionar playlist |
| RED | 403 | PlaylistSelector | Remover playlist (com confirmacao) |
| YELLOW | 405 | PlaylistSelector | Sincronizar playlist |
| BACK | 10009/461 | PlaylistSelector | Voltar |

---

## 12. Estrutura de Arquivos

```
src/
+-- store/
|   +-- playlistStore.ts         # Estado global (Zustand)
|
+-- core/db/
|   +-- schema.ts                # Schema IndexedDB
|   +-- operations.ts            # Operacoes de banco
|
+-- ui/playlists/
|   +-- PlaylistSelector.tsx     # Tela principal
|   +-- PlaylistItem.tsx         # Item individual
|   +-- PlaylistSelector.module.css
|   +-- index.ts
|
+-- hooks/
|   +-- useSyncPlaylist.ts       # Hook de sincronizacao
|   +-- usePlaylistData.ts       # Hooks de dados
|
+-- utils/
    +-- format.ts                # formatRelativeTime, formatNumber
```

---

## 13. Referencias

### 13.1 PRDs Relacionados

- [PRD_Onboarding.md](./PRD_Onboarding.md) - Fluxo inicial, SplashScreen
- [PRD_Home.md](./PRD_Home.md) - Sidebar, integracao
- [PRD_Parsing.md](./PRD_Parsing.md) - Schema IndexedDB, parser
- [PRD_Dependencies.md](./PRD_Dependencies.md) - Zustand, Dexie

---

**Versao do Documento**: 1.0
**Compativel com**: PRD_Parsing.md v1.1, PRD_Home.md v1.1, PRD_Onboarding.md v1.1
