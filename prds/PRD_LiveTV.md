# PRD: Live TV (TV ao Vivo)

**Versao:** 1.0
**Data:** 2025-11-27
**Status:** Aprovado
**Autor:** Gerado com auxilio de IA para AtivePlay

---

## 1. Visao Geral

### 1.1 Objetivo

Este PRD documenta a experiencia de TV ao Vivo no AtivePlay, incluindo interface de lista de canais, player de live streaming, e funcionalidades especificas para conteudo ao vivo.

### 1.2 Diferencas entre Live TV e VOD

| Aspecto | Live TV | VOD (Filmes/Series) |
|---------|---------|---------------------|
| **Duracao** | Indefinida (-1) | Fixa (minutos) |
| **Seek** | Nao disponivel (exceto catchup) | Livre |
| **Buffer** | Minimo (baixa latencia) | Maior (estabilidade) |
| **Navegacao** | CH+/CH- (zapping) | Lista/Grid |
| **Contexto** | Programa atual (EPG) | Sinopse/Poster |
| **Atributos M3U** | tvg-id, tvg-logo, tvg-chno | tmdb-id, poster |

### 1.3 Escopo v1 (MVP)

**Incluido:**
- Lista de canais com grid virtual
- Live Player otimizado
- Channel Zapping (CH+/CH-)
- Favoritos de canais
- Ultimo canal assistido
- Entrada numerica (0-9)
- MiniInfo basico (nome + logo, sem EPG)
- Teclas especiais Samsung/LG

**Diferido para v2:**
- EPG com XMLTV
- Catchup/Timeshift
- EPG Grid completo
- Parental Controls

---

## 2. Atributos M3U para Live TV

### 2.1 Atributos Suportados

| Atributo | Proposito | Exemplo | Obrigatorio |
|----------|-----------|---------|-------------|
| `tvg-id` | ID para EPG (futuro) | `"globo.br"` | Nao |
| `tvg-name` | Nome do canal | `"Globo HD"` | Nao |
| `tvg-logo` | URL do logo | `"https://..."` | Nao |
| `tvg-chno` | Numero do canal (LCN) | `"4"` | Nao |
| `tvg-shift` | Offset timezone (horas) | `"-3"` | Nao |
| `group-title` | Categoria/Grupo | `"CANAIS ABERTOS FHD"` | Sim |

### 2.2 Exemplo de Entrada M3U Live

```m3u
#EXTINF:-1 tvg-id="globo.br" tvg-name="Globo" tvg-logo="https://i.ibb.co/logo.png" tvg-chno="4" group-title="CANAIS ABERTOS FHD",GLOBO FHD
http://server:8080/live/user/pass/globo.m3u8
```

### 2.3 Deteccao de Live Content

O `ContentClassifier` (PRD_Parsing.md) identifica live por:

```typescript
private patterns = {
  live: {
    groups: /\b(TV|CANAIS|ABERTOS?|FECHADOS?|HD|FHD|4K|ESPORTES?|SPORTS?|NEWS|24H|AO VIVO)\b/i,
    names: /\b(HD|FHD|UHD|4K|HEVC|H\.?265)\b/i,
  },
};
```

**Criterios:**
1. `duration === -1` (stream indefinido)
2. `group-title` contem padroes de TV (CANAIS, ESPORTES, etc.)
3. Ausencia de extensoes VOD (.mp4, .mkv)

---

## 3. Telas e Componentes

### 3.1 ChannelList (Lista de Canais)

#### Layout

```
+----------------------------------------------------------+
|  [icone] TV AO VIVO          [busca] Buscar   Filtrar [v] |
+----------------------------------------------------------+
|                                                          |
|  +----------+ +----------+ +----------+ +----------+     |
|  | [LOGO]   | | [LOGO]   | | [LOGO]   | | [LOGO]   |     |
|  | Globo    | | SBT      | | Record   | | Band     | <-- |
|  | CH 4     | | CH 5     | | CH 7     | | CH 13    |     |
|  +----------+ +----------+ +----------+ +----------+     |
|                                                          |
|  ------------- ESPORTES FHD -------------                |
|                                                          |
|  +----------+ +----------+ +----------+ +----------+     |
|  | [LOGO]   | | [LOGO]   | | [LOGO]   | | [LOGO]   |     |
|  | ESPN     | | SporTV   | | Fox      | | BandSp   |     |
|  | CH 70    | | CH 39    | | CH 73    | | CH 96    |     |
|  +----------+ +----------+ +----------+ +----------+     |
|                                                          |
|  [INFO] Info   [FAV] Favoritar   [OK] Assistir           |
+----------------------------------------------------------+
```

#### Especificacoes

| Propriedade | Valor |
|-------------|-------|
| Layout | Grid 4-6 colunas |
| Card Width | 160px |
| Card Height | 120px (16:9 + info) |
| Gap | 16px |
| Scroll | Virtual (TanStack Virtual) |
| Agrupamento | Por group-title |

#### Interface TypeScript

```typescript
interface ChannelListProps {
  channels: M3UItem[];
  groups: M3UGroup[];
  onSelectChannel: (channel: M3UItem) => void;
  onToggleFavorite: (channelId: string) => void;
}

interface ChannelListState {
  filter: string;           // Filtro de grupo
  search: string;           // Busca por nome
  focusedIndex: number;     // Index focado
  viewMode: 'grid' | 'list';
}
```

### 3.2 ChannelCard

#### Layout

```
+------------------+
|                  |
|    [LOGO]        |   <-- tvg-logo ou placeholder
|                  |
+------------------+
| Globo HD         |   <-- name
| CH 4  [star]     |   <-- tvg-chno + favorito
+------------------+
```

#### Estados

| Estado | Aparencia |
|--------|-----------|
| Normal | Borda transparente |
| Focused | Borda roxa (#7382FD), scale 1.05 |
| Favorito | Icone estrela amarela |
| Playing | Badge "AO VIVO" vermelho |

#### Componente

```typescript
interface ChannelCardProps {
  channel: M3UItem;
  isFocused: boolean;
  isFavorite: boolean;
  isPlaying: boolean;
  onSelect: () => void;
  onFavorite: () => void;
}

export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  isFocused,
  isFavorite,
  isPlaying,
  onSelect,
  onFavorite,
}) => {
  const { ref } = useFocusable({
    onEnterPress: onSelect,
  });

  return (
    <div
      ref={ref}
      className={cn(
        styles.card,
        isFocused && styles.focused,
        isPlaying && styles.playing
      )}
    >
      <div className={styles.logoContainer}>
        <img
          src={channel.logo || '/placeholder-channel.png'}
          alt={channel.name}
          loading="lazy"
          onError={(e) => {
            e.currentTarget.src = '/placeholder-channel.png';
          }}
        />
        {isPlaying && <span className={styles.liveBadge}>AO VIVO</span>}
      </div>
      <div className={styles.info}>
        <span className={styles.name}>{channel.name}</span>
        <div className={styles.meta}>
          {channel.tvgChno && <span>CH {channel.tvgChno}</span>}
          {isFavorite && <span className={styles.star}>star</span>}
        </div>
      </div>
    </div>
  );
};
```

### 3.3 LivePlayer

#### Layout Fullscreen

```
+----------------------------------------------------------+
|                                                          |
|                                                          |
|                    [VIDEO STREAM]                        |
|                                                          |
|                                                          |
+----------------------------------------------------------+
```

#### Com Overlay (ao pressionar OK/INFO)

```
+----------------------------------------------------------+
|                                                          |
|                    [VIDEO STREAM]                        |
|                                                          |
+----------------------------------------------------------+
|  +------+  GLOBO HD                      [red] AO VIVO   |
|  | LOGO |  Categoria: Canais Abertos                     |
|  +------+                                                |
|                                                          |
|  CH- [<]  4  [>] CH+    [vol] Vol    [audio] Audio       |
+----------------------------------------------------------+
```

#### Especificacoes Player

| Propriedade | Valor |
|-------------|-------|
| Buffer Min | 2000ms |
| Buffer Max | 30000ms |
| Rebuffer Goal | 500ms |
| Auto-hide overlay | 5 segundos |
| Preload next channel | Sim |

#### Componente

```typescript
interface LivePlayerProps {
  channel: M3UItem;
  onChannelChange: (direction: 'next' | 'prev') => void;
  onBack: () => void;
}

interface LivePlayerState {
  isPlaying: boolean;
  isBuffering: boolean;
  showOverlay: boolean;
  volume: number;
  audioTracks: AudioTrack[];
  selectedAudioTrack: string;
}

export const LivePlayer: React.FC<LivePlayerProps> = ({
  channel,
  onChannelChange,
  onBack,
}) => {
  const [state, setState] = useState<LivePlayerState>({
    isPlaying: false,
    isBuffering: true,
    showOverlay: true,
    volume: 100,
    audioTracks: [],
    selectedAudioTrack: '',
  });

  const overlayTimeout = useRef<NodeJS.Timeout>();

  // Auto-hide overlay apos 5s
  useEffect(() => {
    if (state.showOverlay) {
      overlayTimeout.current = setTimeout(() => {
        setState((s) => ({ ...s, showOverlay: false }));
      }, 5000);
    }
    return () => clearTimeout(overlayTimeout.current);
  }, [state.showOverlay]);

  // Keyboard handler
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.keyCode) {
        case 38: // UP
        case 427: // CH+
          onChannelChange('next');
          break;
        case 40: // DOWN
        case 428: // CH-
          onChannelChange('prev');
          break;
        case 13: // OK
          setState((s) => ({ ...s, showOverlay: !s.showOverlay }));
          break;
        case 457: // INFO
          setState((s) => ({ ...s, showOverlay: true }));
          break;
        case 10009: // BACK
        case 8: // Backspace
          onBack();
          break;
      }
    };

    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onChannelChange, onBack]);

  return (
    <div className={styles.playerContainer}>
      <VideoPlayer
        src={channel.url}
        autoPlay
        onBuffering={(buffering) => setState((s) => ({ ...s, isBuffering: buffering }))}
        onPlaying={() => setState((s) => ({ ...s, isPlaying: true }))}
        onAudioTracks={(tracks) => setState((s) => ({ ...s, audioTracks: tracks }))}
      />

      {state.isBuffering && <LoadingSpinner />}

      {state.showOverlay && (
        <LivePlayerOverlay
          channel={channel}
          audioTracks={state.audioTracks}
          onChannelChange={onChannelChange}
        />
      )}
    </div>
  );
};
```

### 3.4 LivePlayerOverlay (MiniInfo)

**Nota:** No MVP v1, o overlay mostra apenas informacoes do canal, SEM dados de EPG.

```typescript
interface LivePlayerOverlayProps {
  channel: M3UItem;
  audioTracks: AudioTrack[];
  onChannelChange: (direction: 'next' | 'prev') => void;
}

export const LivePlayerOverlay: React.FC<LivePlayerOverlayProps> = ({
  channel,
  audioTracks,
  onChannelChange,
}) => {
  return (
    <div className={styles.overlay}>
      <div className={styles.channelInfo}>
        <img
          src={channel.logo || '/placeholder-channel.png'}
          alt={channel.name}
          className={styles.logo}
        />
        <div className={styles.details}>
          <h2 className={styles.channelName}>{channel.name}</h2>
          <span className={styles.group}>{channel.group}</span>
        </div>
        <span className={styles.liveBadge}>AO VIVO</span>
      </div>

      <div className={styles.controls}>
        <button onClick={() => onChannelChange('prev')}>
          CH- [<]
        </button>
        <span className={styles.channelNumber}>
          {channel.tvgChno || '--'}
        </span>
        <button onClick={() => onChannelChange('next')}>
          [>] CH+
        </button>

        {audioTracks.length > 1 && (
          <AudioTrackSelector tracks={audioTracks} />
        )}
      </div>
    </div>
  );
};
```

---

## 4. Channel Zapping (Troca Rapida)

### 4.1 Requisitos de Performance

| Metrica | Alvo | Aceitavel |
|---------|------|-----------|
| Tempo para primeiro frame | < 500ms | < 1000ms |
| Feedback visual | Imediato | < 100ms |
| Pre-buffer proximo canal | Sim | - |

### 4.2 Navegacao D-PAD no Player

| Tecla | KeyCode | Acao |
|-------|---------|------|
| UP | 38 | Proximo canal |
| DOWN | 40 | Canal anterior |
| CH+ | 427 | Proximo canal |
| CH- | 428 | Canal anterior |
| OK | 13 | Toggle overlay |
| INFO | 457 | Mostrar overlay |
| BACK | 10009/8 | Voltar para lista |
| 0-9 | 48-57 | Entrada numerica |

### 4.3 Navegacao por Grupo

A troca de canal segue a ordem dentro do mesmo grupo:

```typescript
function getNextChannel(
  currentChannel: M3UItem,
  channels: M3UItem[],
  direction: 'next' | 'prev'
): M3UItem {
  // Filtra canais do mesmo grupo
  const groupChannels = channels.filter(
    (c) => c.group === currentChannel.group && c.mediaKind === 'live'
  );

  const currentIndex = groupChannels.findIndex((c) => c.id === currentChannel.id);

  if (direction === 'next') {
    const nextIndex = (currentIndex + 1) % groupChannels.length;
    return groupChannels[nextIndex];
  } else {
    const prevIndex = currentIndex === 0 ? groupChannels.length - 1 : currentIndex - 1;
    return groupChannels[prevIndex];
  }
}
```

### 4.4 Entrada Numerica (0-9)

Permite digitar o numero do canal diretamente:

```typescript
interface ChannelNumberInput {
  digits: string;
  timeout: NodeJS.Timeout | null;
}

function useChannelNumberInput(
  channels: M3UItem[],
  onSelectChannel: (channel: M3UItem) => void
) {
  const [input, setInput] = useState<ChannelNumberInput>({
    digits: '',
    timeout: null,
  });

  const DIGIT_TIMEOUT = 2000; // 2 segundos para completar

  const handleDigit = useCallback((digit: string) => {
    // Limpa timeout anterior
    if (input.timeout) {
      clearTimeout(input.timeout);
    }

    const newDigits = input.digits + digit;

    // Procura canal com esse numero
    const matchingChannel = channels.find(
      (c) => c.tvgChno === newDigits
    );

    // Se encontrou match exato, seleciona
    if (matchingChannel) {
      onSelectChannel(matchingChannel);
      setInput({ digits: '', timeout: null });
      return;
    }

    // Senao, espera mais digitos
    const timeout = setTimeout(() => {
      // Timeout: tenta selecionar com digitos atuais
      const channel = channels.find((c) => c.tvgChno === newDigits);
      if (channel) {
        onSelectChannel(channel);
      }
      setInput({ digits: '', timeout: null });
    }, DIGIT_TIMEOUT);

    setInput({ digits: newDigits, timeout });
  }, [input, channels, onSelectChannel]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // KeyCodes 48-57 sao 0-9
      if (e.keyCode >= 48 && e.keyCode <= 57) {
        const digit = String(e.keyCode - 48);
        handleDigit(digit);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleDigit]);

  return {
    currentInput: input.digits,
    isInputting: input.digits.length > 0,
  };
}
```

#### UI de Entrada Numerica

```
+----------------------------------------------------------+
|                                                          |
|                    [VIDEO STREAM]                        |
|                                                          |
|                    +-------+                             |
|                    |  104  |  <-- Digitos sendo digitados|
|                    +-------+                             |
|                                                          |
+----------------------------------------------------------+
```

### 4.5 Pre-Buffer Strategy

Para troca rapida, pre-carregamos o manifesto dos canais adjacentes:

```typescript
interface ChannelPreloader {
  preloadManifest: (url: string) => Promise<void>;
  clearPreload: () => void;
}

function useChannelPreloader(
  currentChannel: M3UItem,
  channels: M3UItem[]
): ChannelPreloader {
  const preloadedUrls = useRef<Set<string>>(new Set());

  useEffect(() => {
    const nextChannel = getNextChannel(currentChannel, channels, 'next');
    const prevChannel = getNextChannel(currentChannel, channels, 'prev');

    // Pre-fetch manifests
    [nextChannel, prevChannel].forEach((channel) => {
      if (!preloadedUrls.current.has(channel.url)) {
        fetch(channel.url, { method: 'HEAD' })
          .then(() => preloadedUrls.current.add(channel.url))
          .catch(() => {}); // Silently fail
      }
    });
  }, [currentChannel, channels]);

  return {
    preloadManifest: async (url) => {
      await fetch(url, { method: 'HEAD' });
      preloadedUrls.current.add(url);
    },
    clearPreload: () => {
      preloadedUrls.current.clear();
    },
  };
}
```

---

## 5. Favoritos de Canais

### 5.1 Interface

```typescript
interface ChannelFavorite {
  id: string;              // UUID
  playlistId: string;      // Playlist de origem
  itemId: string;          // M3UItem.id
  position: number;        // Ordem na lista
  addedAt: Date;
}
```

### 5.2 Persistencia (IndexedDB)

```typescript
// Adicionar ao schema existente (PRD_Parsing.md)
this.version(3).stores({
  // ... tabelas existentes v2
  channelFavorites: 'id, playlistId, itemId, [playlistId+itemId], position',
});
```

### 5.3 Hook useFavoriteChannels

```typescript
interface UseFavoriteChannelsReturn {
  favorites: ChannelFavorite[];
  isFavorite: (channelId: string) => boolean;
  toggleFavorite: (channel: M3UItem) => Promise<void>;
  reorderFavorites: (fromIndex: number, toIndex: number) => Promise<void>;
}

export function useFavoriteChannels(playlistId: string): UseFavoriteChannelsReturn {
  const [favorites, setFavorites] = useState<ChannelFavorite[]>([]);

  // Carregar favoritos
  useEffect(() => {
    db.channelFavorites
      .where('playlistId')
      .equals(playlistId)
      .sortBy('position')
      .then(setFavorites);
  }, [playlistId]);

  const isFavorite = useCallback(
    (channelId: string) => favorites.some((f) => f.itemId === channelId),
    [favorites]
  );

  const toggleFavorite = useCallback(
    async (channel: M3UItem) => {
      const existing = favorites.find((f) => f.itemId === channel.id);

      if (existing) {
        // Remover
        await db.channelFavorites.delete(existing.id);
        setFavorites((prev) => prev.filter((f) => f.id !== existing.id));
      } else {
        // Adicionar
        const newFavorite: ChannelFavorite = {
          id: crypto.randomUUID(),
          playlistId,
          itemId: channel.id,
          position: favorites.length,
          addedAt: new Date(),
        };
        await db.channelFavorites.add(newFavorite);
        setFavorites((prev) => [...prev, newFavorite]);
      }
    },
    [favorites, playlistId]
  );

  const reorderFavorites = useCallback(
    async (fromIndex: number, toIndex: number) => {
      const updated = [...favorites];
      const [moved] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, moved);

      // Atualizar positions
      const updates = updated.map((f, i) => ({ ...f, position: i }));
      await db.transaction('rw', db.channelFavorites, async () => {
        for (const fav of updates) {
          await db.channelFavorites.update(fav.id, { position: fav.position });
        }
      });

      setFavorites(updates);
    },
    [favorites]
  );

  return { favorites, isFavorite, toggleFavorite, reorderFavorites };
}
```

### 5.4 Atalho de Teclado

| Tecla | KeyCode | Acao |
|-------|---------|------|
| RED | 403 | Toggle favorito |
| FAV (se disponivel) | 1024 | Abrir lista de favoritos |

---

## 6. Ultimo Canal Assistido

### 6.1 Interface

```typescript
interface LastWatchedChannel {
  playlistId: string;
  itemId: string;
  watchedAt: Date;
}
```

### 6.2 Persistencia

```typescript
// Usando localStorage para acesso rapido
const LAST_CHANNEL_KEY = 'ativeplay_last_channel';

function saveLastChannel(playlistId: string, channelId: string): void {
  const data: LastWatchedChannel = {
    playlistId,
    itemId: channelId,
    watchedAt: new Date(),
  };
  localStorage.setItem(LAST_CHANNEL_KEY, JSON.stringify(data));
}

function getLastChannel(): LastWatchedChannel | null {
  const data = localStorage.getItem(LAST_CHANNEL_KEY);
  return data ? JSON.parse(data) : null;
}
```

### 6.3 Hook useLastChannel

```typescript
interface UseLastChannelReturn {
  lastChannel: M3UItem | null;
  setLastChannel: (channel: M3UItem) => void;
  resumeLastChannel: () => void;
}

export function useLastChannel(
  playlistId: string,
  channels: M3UItem[],
  onSelectChannel: (channel: M3UItem) => void
): UseLastChannelReturn {
  const [lastChannel, setLastChannelState] = useState<M3UItem | null>(null);

  // Carregar ultimo canal
  useEffect(() => {
    const saved = getLastChannel();
    if (saved && saved.playlistId === playlistId) {
      const channel = channels.find((c) => c.id === saved.itemId);
      if (channel) {
        setLastChannelState(channel);
      }
    }
  }, [playlistId, channels]);

  const setLastChannel = useCallback(
    (channel: M3UItem) => {
      saveLastChannel(playlistId, channel.id);
      setLastChannelState(channel);
    },
    [playlistId]
  );

  const resumeLastChannel = useCallback(() => {
    if (lastChannel) {
      onSelectChannel(lastChannel);
    }
  }, [lastChannel, onSelectChannel]);

  return { lastChannel, setLastChannel, resumeLastChannel };
}
```

### 6.4 Auto-Resume na Abertura

No `SplashScreen` ou `Home`, verificar se existe ultimo canal:

```typescript
// Em Home.tsx ou ChannelList.tsx
useEffect(() => {
  const lastChannel = getLastChannel();
  const { activePlaylistId } = usePlaylistStore.getState();

  if (lastChannel && lastChannel.playlistId === activePlaylistId) {
    // Opcional: mostrar modal "Continuar assistindo [Canal]?"
    // ou ir direto para o player
  }
}, []);
```

---

## 7. Multi-Audio

### 7.1 Interface

```typescript
interface AudioTrack {
  id: string;
  language: string;      // ISO 639-1 (pt, en, es)
  label: string;         // "Portugues", "English"
  isDefault: boolean;
}
```

### 7.2 Deteccao de Tracks

O player (AVPlay/HTML5) fornece tracks disponiveis:

```typescript
// Samsung Tizen (AVPlay)
webapis.avplay.getTotalTrackInfo().forEach((track) => {
  if (track.type === 'AUDIO') {
    audioTracks.push({
      id: track.index.toString(),
      language: track.extra_info?.language || 'und',
      label: track.extra_info?.name || `Audio ${track.index}`,
      isDefault: track.index === 0,
    });
  }
});

// HTML5 Video
video.audioTracks.forEach((track, index) => {
  audioTracks.push({
    id: index.toString(),
    language: track.language,
    label: track.label || `Audio ${index + 1}`,
    isDefault: track.enabled,
  });
});
```

### 7.3 Componente AudioTrackSelector

```typescript
interface AudioTrackSelectorProps {
  tracks: AudioTrack[];
  selectedTrack: string;
  onSelectTrack: (trackId: string) => void;
}

export const AudioTrackSelector: React.FC<AudioTrackSelectorProps> = ({
  tracks,
  selectedTrack,
  onSelectTrack,
}) => {
  const { ref, focusKey } = useFocusable({ trackChildren: true });

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className={styles.audioSelector}>
        <h3>Audio</h3>
        {tracks.map((track) => (
          <AudioTrackOption
            key={track.id}
            track={track}
            isSelected={track.id === selectedTrack}
            onSelect={() => onSelectTrack(track.id)}
          />
        ))}
      </div>
    </FocusContext.Provider>
  );
};
```

### 7.4 Atalho de Teclado

| Tecla | KeyCode | Acao |
|-------|---------|------|
| GREEN | 404 | Abrir seletor de audio |

---

## 8. Teclas Especiais (Samsung/LG)

### 8.1 Mapeamento Completo

| Tecla | Samsung (KeyCode) | LG (KeyCode) | Acao |
|-------|-------------------|--------------|------|
| CH+ | 427 | 33 | Proximo canal |
| CH- | 428 | 34 | Canal anterior |
| INFO | 457 | 457 | Mostrar overlay |
| GUIDE | 458 | 458 | (v2: EPG Grid) |
| RED | 403 | 403 | Toggle favorito |
| GREEN | 404 | 404 | Seletor de audio |
| YELLOW | 405 | 405 | (reservado) |
| BLUE | 406 | 406 | (reservado) |
| PLAY | 415 | 415 | Play (se pausado) |
| PAUSE | 19 | 19 | Pause (se disponivel) |
| BACK | 10009 | 461 | Voltar |

### 8.2 Registrar Teclas (Samsung)

```typescript
// Samsung Tizen requer registro de teclas
function registerTVKeys(): void {
  const keys = [
    'ChannelUp', 'ChannelDown',
    'Info', 'Guide',
    'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
    'MediaPlay', 'MediaPause', 'MediaStop',
  ];

  keys.forEach((key) => {
    try {
      tizen.tvinputdevice.registerKey(key);
    } catch (e) {
      console.warn(`Failed to register key: ${key}`);
    }
  });
}
```

### 8.3 Hook useRemoteKeys

```typescript
type RemoteKeyHandler = (keyCode: number, keyName: string) => void;

export function useRemoteKeys(handler: RemoteKeyHandler): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const keyName = getKeyName(e.keyCode);
      handler(e.keyCode, keyName);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handler]);
}

function getKeyName(keyCode: number): string {
  const keyMap: Record<number, string> = {
    427: 'CH_UP',
    428: 'CH_DOWN',
    457: 'INFO',
    458: 'GUIDE',
    403: 'RED',
    404: 'GREEN',
    405: 'YELLOW',
    406: 'BLUE',
    415: 'PLAY',
    19: 'PAUSE',
    10009: 'BACK',
    461: 'BACK', // LG
  };
  return keyMap[keyCode] || `KEY_${keyCode}`;
}
```

---

## 9. Persistencia (IndexedDB)

### 9.1 Schema Atualizado (v3)

```typescript
// src/core/db/schema.ts

import Dexie, { Table } from 'dexie';

export interface ChannelFavorite {
  id: string;
  playlistId: string;
  itemId: string;
  position: number;
  addedAt: Date;
}

export class AtivePlayDB extends Dexie {
  // Tabelas existentes (v2)
  playlists!: Table<M3UPlaylist>;
  items!: Table<M3UItem>;
  groups!: Table<M3UGroup>;
  favorites!: Table<Favorite>;
  watchProgress!: Table<WatchProgress>;

  // Novas tabelas (v3 - Live TV)
  channelFavorites!: Table<ChannelFavorite>;

  constructor() {
    super('ativeplay');

    // v2 existente
    this.version(2).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId, addedAt',
      watchProgress: 'id, [playlistId+itemId], playlistId, lastWatched',
    });

    // v3 - Live TV
    this.version(3).stores({
      playlists: 'id, url, lastUpdated, isActive',
      items: 'id, playlistId, group, mediaKind, [playlistId+group], [playlistId+mediaKind]',
      groups: 'id, playlistId, mediaKind, [playlistId+mediaKind]',
      favorites: 'id, [playlistId+itemId], playlistId, addedAt',
      watchProgress: 'id, [playlistId+itemId], playlistId, lastWatched',
      channelFavorites: 'id, playlistId, itemId, [playlistId+itemId], position',
    });
  }
}

export const db = new AtivePlayDB();
```

### 9.2 localStorage Keys

| Key | Conteudo | Tipo |
|-----|----------|------|
| `ativeplay_last_channel` | Ultimo canal assistido | LastWatchedChannel |
| `ativeplay_audio_preference` | Preferencia de idioma | string (ISO 639-1) |

---

## 10. Componentes React

### 10.1 Estrutura de Arquivos

```
src/ui/live/
+-- ChannelList.tsx           # Tela principal de lista
+-- ChannelList.module.css
+-- ChannelCard.tsx           # Card individual de canal
+-- ChannelCard.module.css
+-- ChannelGrid.tsx           # Grid virtual de canais
+-- LivePlayer.tsx            # Player para live streams
+-- LivePlayer.module.css
+-- LivePlayerOverlay.tsx     # Overlay do player
+-- ChannelNumberInput.tsx    # UI de entrada numerica
+-- AudioTrackSelector.tsx    # Seletor de audio
+-- hooks/
|   +-- useChannelList.ts     # Hook para lista de canais
|   +-- useChannelZapping.ts  # Hook para troca rapida
|   +-- useLivePlayer.ts      # Hook para player
|   +-- useFavoriteChannels.ts# Hook para favoritos
|   +-- useLastChannel.ts     # Hook para ultimo canal
|   +-- useRemoteKeys.ts      # Hook para teclas do controle
|   +-- useChannelNumberInput.ts # Hook para entrada numerica
+-- index.ts                  # Exports
```

### 10.2 Exports

```typescript
// src/ui/live/index.ts

export { ChannelList } from './ChannelList';
export { ChannelCard } from './ChannelCard';
export { ChannelGrid } from './ChannelGrid';
export { LivePlayer } from './LivePlayer';
export { LivePlayerOverlay } from './LivePlayerOverlay';
export { ChannelNumberInput } from './ChannelNumberInput';
export { AudioTrackSelector } from './AudioTrackSelector';

// Hooks
export { useChannelList } from './hooks/useChannelList';
export { useChannelZapping } from './hooks/useChannelZapping';
export { useLivePlayer } from './hooks/useLivePlayer';
export { useFavoriteChannels } from './hooks/useFavoriteChannels';
export { useLastChannel } from './hooks/useLastChannel';
export { useRemoteKeys } from './hooks/useRemoteKeys';
export { useChannelNumberInput } from './hooks/useChannelNumberInput';
```

---

## 11. Fluxo de Navegacao

### 11.1 Diagrama

```
+------------+     +----------------+     +-------------+
|   HOME     |---->| CHANNEL LIST   |---->| LIVE PLAYER |
| (Live row) |     | (/category/live)|     | (fullscreen)|
+------------+     +----------------+     +-------------+
                          |                     |
                          |                     | CH+/CH-
                          |                     v
                          |               +-------------+
                          |               | NEXT/PREV   |
                          |               | CHANNEL     |
                          |               +-------------+
                          |                     |
                          |                     | INFO
                          |                     v
                          |               +-------------+
                          +-------------->| MINI INFO   |
                                          | (overlay)   |
                                          +-------------+
```

### 11.2 Rotas

```typescript
// Adicionar em App.tsx

<Routes>
  {/* ... rotas existentes */}

  {/* Live TV */}
  <Route path="/category/live" element={<ChannelList />} />
  <Route path="/live/:channelId" element={<LivePlayer />} />
</Routes>
```

### 11.3 Navegacao Back

| Tela | BACK vai para |
|------|---------------|
| ChannelList | Home |
| LivePlayer | ChannelList |
| MiniInfo (overlay) | Fecha overlay |

---

## 12. Roadmap v2 (Futuro)

### 12.1 EPG (Electronic Program Guide)

- Parser XMLTV em Web Worker
- URL configuravel nas Settings
- Mapeamento tvg-id para channelId
- Cache local com TTL de 24h
- MiniEPG com programa atual/proximo
- EPG Grid completo (grade de programacao)

### 12.2 Catchup/Timeshift

- Detectar atributos `catchup`, `catchup-days`, `catchup-source`
- Construir URL de timeshift com placeholders
- UI de seek para conteudo passado
- Suporte a formatos Flussonic e Xtream

### 12.3 Parental Controls

- PIN de 4 digitos
- Bloqueio por canal
- Bloqueio por classificacao etaria
- Modo crianca

### 12.4 Funcionalidades Adicionais

- Picture-in-Picture (PiP)
- Gravacao (DVR) se suportado
- Qualidade adaptativa manual
- Estatisticas de stream (bitrate, buffer)

---

## 13. Referencias

### 13.1 PRDs Relacionados

- [PRD_Parsing.md](./PRD_Parsing.md) - Schema IndexedDB, M3UItem interface
- [PRD_Player.md](./PRD_Player.md) - Player adapter pattern, Samsung/LG APIs
- [PRD_Home.md](./PRD_Home.md) - Sidebar, navegacao, ContentRow para live
- [PRD_Dependencies.md](./PRD_Dependencies.md) - TanStack Virtual, Norigin Spatial

### 13.2 Documentacao Externa

- [Samsung Tizen AVPlay API](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [LG webOS Media API](https://webostv.developer.lge.com/develop/app-developer-guide/playing-media)
- [Norigin Spatial Navigation](https://github.com/NoriginMedia/Norigin-Spatial-Navigation)
- [TanStack Virtual](https://tanstack.com/virtual/latest)

---

**Versao do Documento**: 1.0
**Compativel com**: PRD_Parsing.md v1.1, PRD_Home.md v1.1, PRD_Player.md v2.0
