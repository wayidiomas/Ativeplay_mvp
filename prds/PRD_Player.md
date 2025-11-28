# PRD: Player Avançado

> **PRD ID**: PRD_Player
> **Versão**: 2.0
> **Referência**: PRD Master AtivePlay v1.1
> **Status**: Especificação Detalhada
> **Última Atualização**: 2025-01-26

---

## 1. Objetivo

Implementar um player de vídeo profissional para Smart TVs que suporte:
- Reprodução de streams IPTV (.ts, .mp4, HLS)
- Troca de múltiplas faixas de áudio embutidas no stream
- Troca de legendas embutidas no stream
- Interface moderna estilo Netflix
- Performance otimizada para controle remoto

---

## 2. Arquitetura: Adapter Pattern

### 2.1 Diagrama de Arquitetura

```
┌────────────────────────────────────────────────────────────────────┐
│                         React UI Layer                              │
│              (PlayerControls, Overlay, Progress Bar)                │
│                                                                     │
│   usePlayer() hook → expõe API unificada para componentes React    │
└────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌────────────────────────────────────────────────────────────────────┐
│                      IPlayerAdapter                                 │
│                                                                     │
│   Interface TypeScript que define contrato comum:                   │
│   - play(), pause(), seek(), stop()                                │
│   - getAudioTracks(), setAudioTrack()                              │
│   - getSubtitleTracks(), setSubtitleTrack()                        │
│   - Eventos: onStateChange, onTracksReady, onError                 │
└────────────────────────────────────────────────────────────────────┘
                                │
              ┌─────────────────┴─────────────────┐
              ▼                                   ▼
┌──────────────────────────────┐    ┌──────────────────────────────┐
│   SamsungAVPlayAdapter       │    │     LGWebOSAdapter           │
│                              │    │                              │
│   webapis.avplay             │    │   HTML5 <video> element      │
│   - getTotalTrackInfo()      │    │   + Luna Service API         │
│   - setSelectTrack()         │    │   - luna://com.webos.media   │
│   - Suporte nativo completo  │    │   - selectTrack()            │
│                              │    │   - setSubtitleEnable()      │
│   ✅ Multi-áudio             │    │   ✅ Multi-áudio             │
│   ✅ Legendas embutidas      │    │   ✅ Legendas embutidas      │
└──────────────────────────────┘    └──────────────────────────────┘
```

### 2.2 Justificativa

| Critério | Por que Adapter Pattern? |
|----------|--------------------------|
| **Manutenibilidade** | Código específico isolado por plataforma |
| **Testabilidade** | Interface mockável para testes |
| **Extensibilidade** | Fácil adicionar Android TV, Roku no futuro |
| **Type Safety** | TypeScript garante implementação completa |

---

## 3. Interface IPlayerAdapter

### 3.1 Tipos Base

```typescript
// src/player/types/index.ts

export interface Track {
  index: number;
  type: 'audio' | 'subtitle';
  language: string;       // ISO 639-1 (pt, en, es)
  label: string;          // Display name
  codec?: string;         // ac3, aac, etc.
  channels?: number;      // 2, 6 (5.1), 8 (7.1)
  isDefault?: boolean;
}

export interface AudioTrack extends Track {
  type: 'audio';
  bitrate?: number;
  sampleRate?: number;
}

export interface SubtitleTrack extends Track {
  type: 'subtitle';
  format?: 'text' | 'bitmap';  // CEA-608/708 vs DVB-SUB
}

export interface PlayerState {
  status: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'buffering' | 'error';
  currentTime: number;      // segundos
  duration: number;         // segundos
  buffered: number;         // porcentagem 0-100
  volume: number;           // 0-100
  muted: boolean;
  playbackRate: number;     // 0.5, 1, 1.5, 2
  currentAudioTrack: number | null;
  currentSubtitleTrack: number | null;
  subtitlesEnabled: boolean;
}

export interface PlayerError {
  code: string;
  message: string;
  details?: any;
}

export interface SubtitleStyle {
  fontSize: 'tiny' | 'small' | 'normal' | 'large' | 'huge';
  color: 'white' | 'yellow' | 'green' | 'cyan';
  backgroundColor: 'transparent' | 'black' | 'gray';
  position: 'bottom' | 'top';
}
```

### 3.2 Interface Principal

```typescript
// src/player/adapters/IPlayerAdapter.ts

import {
  Track,
  AudioTrack,
  SubtitleTrack,
  PlayerState,
  PlayerError,
  SubtitleStyle
} from '../types';

export interface PlayerEventMap {
  'statechange': PlayerState;
  'timeupdate': number;
  'durationchange': number;
  'tracksready': { audio: AudioTrack[]; subtitles: SubtitleTrack[] };
  'audiotrackchange': number;
  'subtitletrackchange': number | null;
  'buffering': boolean;
  'error': PlayerError;
  'ended': void;
}

export type PlayerEventHandler<K extends keyof PlayerEventMap> =
  (data: PlayerEventMap[K]) => void;

export interface IPlayerAdapter {
  // ============================================
  // LIFECYCLE
  // ============================================

  /**
   * Inicializa o player no container especificado
   * @param container - Elemento HTML onde o player será renderizado
   */
  initialize(container: HTMLElement): Promise<void>;

  /**
   * Destroi o player e limpa recursos
   */
  destroy(): void;

  // ============================================
  // PLAYBACK CONTROL
  // ============================================

  /**
   * Carrega uma URL de mídia
   * @param url - URL do stream (HLS, MPEG-TS, MP4)
   */
  load(url: string): Promise<void>;

  play(): void;
  pause(): void;
  stop(): void;

  /**
   * Seek para posição específica
   * @param seconds - Posição em segundos
   */
  seek(seconds: number): void;

  /**
   * Seek relativo (avança/retrocede)
   * @param deltaSeconds - Segundos para avançar (positivo) ou retroceder (negativo)
   */
  seekRelative(deltaSeconds: number): void;

  // ============================================
  // AUDIO TRACKS
  // ============================================

  /**
   * Retorna lista de faixas de áudio disponíveis
   */
  getAudioTracks(): AudioTrack[];

  /**
   * Seleciona faixa de áudio pelo índice
   * @param index - Índice da faixa (0-based)
   */
  setAudioTrack(index: number): void;

  /**
   * Retorna índice da faixa de áudio atual
   */
  getCurrentAudioTrack(): number | null;

  // ============================================
  // SUBTITLE TRACKS
  // ============================================

  /**
   * Retorna lista de faixas de legenda disponíveis
   */
  getSubtitleTracks(): SubtitleTrack[];

  /**
   * Seleciona faixa de legenda pelo índice
   * @param index - Índice da faixa (0-based)
   */
  setSubtitleTrack(index: number): void;

  /**
   * Retorna índice da faixa de legenda atual
   */
  getCurrentSubtitleTrack(): number | null;

  /**
   * Habilita/desabilita legendas
   */
  setSubtitlesEnabled(enabled: boolean): void;

  /**
   * Configura estilo das legendas
   */
  setSubtitleStyle(style: Partial<SubtitleStyle>): void;

  // ============================================
  // VOLUME & PLAYBACK
  // ============================================

  setVolume(level: number): void;      // 0-100
  getVolume(): number;
  setMuted(muted: boolean): void;
  isMuted(): boolean;
  setPlaybackRate(rate: number): void; // 0.5, 1, 1.5, 2

  // ============================================
  // STATE
  // ============================================

  getState(): PlayerState;
  getDuration(): number;
  getCurrentTime(): number;
  isPlaying(): boolean;

  // ============================================
  // EVENTS
  // ============================================

  on<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void;

  off<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void;

  once<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void;
}
```

---

## 4. Implementação Samsung Tizen (AVPlay)

### 4.1 Visão Geral

Samsung usa a API proprietária **AVPlay** que oferece suporte completo a:
- Múltiplas faixas de áudio embutidas
- Legendas embutidas (CEA-608/708, DVB-SUB, Teletext)
- DRM (PlayReady, Widevine)
- Trick play (seek rápido)

### 4.2 Implementação Completa

```typescript
// src/player/adapters/SamsungAVPlayAdapter.ts

import {
  IPlayerAdapter,
  PlayerEventMap,
  PlayerEventHandler,
  AudioTrack,
  SubtitleTrack,
  PlayerState,
  PlayerError,
  SubtitleStyle
} from '../types';

// Tipos do Samsung webapis (declarados em @types/tizen-tv)
declare const webapis: {
  avplay: SamsungAVPlay;
};

interface SamsungAVPlay {
  open(url: string): void;
  close(): void;
  prepare(): void;
  prepareAsync(onSuccess: () => void, onError: (error: any) => void): void;
  play(): void;
  pause(): void;
  stop(): void;
  seekTo(milliseconds: number, onSuccess?: () => void, onError?: (error: any) => void): void;
  jumpForward(milliseconds: number): void;
  jumpBackward(milliseconds: number): void;
  getDuration(): number;
  getCurrentTime(): number;
  getState(): string;
  setDisplayRect(x: number, y: number, width: number, height: number): void;
  setDisplayMethod(method: string): void;
  getTotalTrackInfo(): SamsungTrackInfo[];
  setSelectTrack(type: string, index: number): void;
  getCurrentStreamInfo(): any;
  setListener(listener: SamsungAVPlayListener): void;
  setSilentSubtitle(silent: boolean): void;
  setSubtitlePosition(position: number): void;
  setTimeoutForBuffering(seconds: number): void;
  setBufferingParam(initialBuffer: string, pendingBuffer: string, mode: string): void;
  setSpeed(speed: number): void;
}

interface SamsungTrackInfo {
  index: number;
  type: 'AUDIO' | 'VIDEO' | 'TEXT';
  extra_info: string; // JSON stringified
}

interface SamsungAVPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (currentTime: number) => void;
  onevent?: (eventType: string, eventData: string) => void;
  onerror?: (eventType: string) => void;
  onsubtitlechange?: (duration: number, text: string, data3: number, data4: string) => void;
  onstreamcompleted?: () => void;
  ondrmevent?: (drmEvent: string, drmData: string) => void;
}

export class SamsungAVPlayAdapter implements IPlayerAdapter {
  private avplay: SamsungAVPlay;
  private container: HTMLElement | null = null;
  private objectElement: HTMLObjectElement | null = null;

  private audioTracks: AudioTrack[] = [];
  private subtitleTracks: SubtitleTrack[] = [];
  private currentAudioIndex: number = 0;
  private currentSubtitleIndex: number | null = null;
  private subtitlesEnabled: boolean = true;

  private state: PlayerState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 100,
    muted: false,
    playbackRate: 1,
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    subtitlesEnabled: true,
  };

  private eventHandlers: Map<keyof PlayerEventMap, Set<Function>> = new Map();
  private timeUpdateInterval: number | null = null;

  // ============================================
  // LIFECYCLE
  // ============================================

  async initialize(container: HTMLElement): Promise<void> {
    this.container = container;

    // Criar elemento <object> para AVPlay
    this.objectElement = document.createElement('object');
    this.objectElement.type = 'application/avplayer';
    this.objectElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      z-index: 0;
    `;
    container.appendChild(this.objectElement);

    // Referência ao AVPlay
    this.avplay = webapis.avplay;

    // Configurar listener de eventos
    this.setupEventListeners();
  }

  destroy(): void {
    this.stopTimeUpdate();

    try {
      this.avplay.stop();
      this.avplay.close();
    } catch (e) {
      // Ignorar erros ao fechar
    }

    if (this.objectElement && this.container) {
      this.container.removeChild(this.objectElement);
    }

    this.eventHandlers.clear();
    this.audioTracks = [];
    this.subtitleTracks = [];
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================

  private setupEventListeners(): void {
    const listener: SamsungAVPlayListener = {
      onbufferingstart: () => {
        this.updateState({ status: 'buffering' });
        this.emit('buffering', true);
      },

      onbufferingprogress: (percent: number) => {
        this.updateState({ buffered: percent });
      },

      onbufferingcomplete: () => {
        this.updateState({ status: 'playing', buffered: 100 });
        this.emit('buffering', false);
      },

      oncurrentplaytime: (currentTimeMs: number) => {
        const currentTime = currentTimeMs / 1000;
        this.updateState({ currentTime });
        this.emit('timeupdate', currentTime);
      },

      onevent: (eventType: string, eventData: string) => {
        console.log('[AVPlay Event]', eventType, eventData);

        // Stream info disponível
        if (eventType === 'PLAYER_MSG_RESOLUTION_CHANGED') {
          this.parseTrackInfo();
        }
      },

      onerror: (errorType: string) => {
        console.error('[AVPlay Error]', errorType);
        this.updateState({ status: 'error' });
        this.emit('error', {
          code: errorType,
          message: this.getErrorMessage(errorType),
        });
      },

      onsubtitlechange: (duration: number, text: string) => {
        // Legenda interna atualizada
        // UI pode capturar via evento customizado se necessário
      },

      onstreamcompleted: () => {
        this.updateState({ status: 'idle' });
        this.emit('ended', undefined);
      },
    };

    this.avplay.setListener(listener);
  }

  private getErrorMessage(errorType: string): string {
    const errorMessages: Record<string, string> = {
      'PLAYER_ERROR_NONE': 'Sem erro',
      'PLAYER_ERROR_INVALID_PARAMETER': 'Parâmetro inválido',
      'PLAYER_ERROR_NO_SUCH_FILE': 'Arquivo não encontrado',
      'PLAYER_ERROR_INVALID_OPERATION': 'Operação inválida',
      'PLAYER_ERROR_SEEK_FAILED': 'Seek falhou',
      'PLAYER_ERROR_INVALID_STATE': 'Estado inválido',
      'PLAYER_ERROR_NOT_SUPPORTED_FILE': 'Formato não suportado',
      'PLAYER_ERROR_INVALID_URI': 'URL inválida',
      'PLAYER_ERROR_CONNECTION_FAILED': 'Conexão falhou',
      'PLAYER_ERROR_GENEREIC': 'Erro genérico',
    };
    return errorMessages[errorType] || `Erro desconhecido: ${errorType}`;
  }

  // ============================================
  // PLAYBACK CONTROL
  // ============================================

  async load(url: string): Promise<void> {
    this.updateState({ status: 'loading' });

    try {
      // Fechar stream anterior se existir
      try {
        this.avplay.close();
      } catch (e) {}

      // Abrir novo stream
      this.avplay.open(url);

      // Configurar display
      this.avplay.setDisplayRect(0, 0, 1920, 1080);
      this.avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');

      // Configurar buffering
      this.avplay.setTimeoutForBuffering(10);
      this.avplay.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', '3');

      // Preparar assincronamente
      await this.prepareAsync();

      // Obter duração
      const duration = this.avplay.getDuration() / 1000;
      this.updateState({ duration, status: 'ready' });
      this.emit('durationchange', duration);

      // Parsear tracks
      this.parseTrackInfo();

    } catch (error: any) {
      this.updateState({ status: 'error' });
      this.emit('error', {
        code: 'LOAD_ERROR',
        message: error.message || 'Erro ao carregar mídia',
        details: error,
      });
      throw error;
    }
  }

  private prepareAsync(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.avplay.prepareAsync(
        () => resolve(),
        (error: any) => reject(error)
      );
    });
  }

  play(): void {
    try {
      this.avplay.play();
      this.updateState({ status: 'playing' });
      this.startTimeUpdate();
    } catch (error) {
      console.error('[AVPlay] Play error:', error);
    }
  }

  pause(): void {
    try {
      this.avplay.pause();
      this.updateState({ status: 'paused' });
      this.stopTimeUpdate();
    } catch (error) {
      console.error('[AVPlay] Pause error:', error);
    }
  }

  stop(): void {
    try {
      this.avplay.stop();
      this.updateState({ status: 'idle', currentTime: 0 });
      this.stopTimeUpdate();
    } catch (error) {
      console.error('[AVPlay] Stop error:', error);
    }
  }

  seek(seconds: number): void {
    const milliseconds = Math.floor(seconds * 1000);
    this.avplay.seekTo(
      milliseconds,
      () => {
        this.updateState({ currentTime: seconds });
        this.emit('timeupdate', seconds);
      },
      (error) => {
        console.error('[AVPlay] Seek error:', error);
      }
    );
  }

  seekRelative(deltaSeconds: number): void {
    const milliseconds = Math.abs(deltaSeconds * 1000);
    if (deltaSeconds > 0) {
      this.avplay.jumpForward(milliseconds);
    } else {
      this.avplay.jumpBackward(milliseconds);
    }
  }

  // ============================================
  // TRACK PARSING
  // ============================================

  private parseTrackInfo(): void {
    const tracks = this.avplay.getTotalTrackInfo();

    this.audioTracks = [];
    this.subtitleTracks = [];

    tracks.forEach((track) => {
      const extraInfo = this.parseExtraInfo(track.extra_info);

      if (track.type === 'AUDIO') {
        this.audioTracks.push({
          index: track.index,
          type: 'audio',
          language: extraInfo.language || extraInfo.track_lang || 'und',
          label: this.getLanguageLabel(extraInfo.language || extraInfo.track_lang),
          codec: extraInfo.fourCC || extraInfo.codec,
          channels: parseInt(extraInfo.channels) || 2,
          bitrate: parseInt(extraInfo.bit_rate),
          sampleRate: parseInt(extraInfo.sample_rate),
          isDefault: track.index === 0,
        });
      }

      if (track.type === 'TEXT') {
        this.subtitleTracks.push({
          index: track.index,
          type: 'subtitle',
          language: extraInfo.track_lang || extraInfo.language || 'und',
          label: this.getLanguageLabel(extraInfo.track_lang || extraInfo.language),
          format: extraInfo.fourCC === 'TTML' ? 'text' : 'text',
          isDefault: track.index === 0,
        });
      }
    });

    // Emitir evento com tracks disponíveis
    this.emit('tracksready', {
      audio: this.audioTracks,
      subtitles: this.subtitleTracks,
    });

    // Definir tracks iniciais
    if (this.audioTracks.length > 0) {
      this.currentAudioIndex = 0;
      this.updateState({ currentAudioTrack: 0 });
    }

    if (this.subtitleTracks.length > 0) {
      this.currentSubtitleIndex = 0;
      this.updateState({ currentSubtitleTrack: 0 });
    }
  }

  private parseExtraInfo(extraInfoStr: string): Record<string, string> {
    try {
      return JSON.parse(extraInfoStr);
    } catch {
      return {};
    }
  }

  private getLanguageLabel(langCode: string | undefined): string {
    if (!langCode) return 'Desconhecido';

    const languages: Record<string, string> = {
      'por': 'Português',
      'pt': 'Português',
      'eng': 'English',
      'en': 'English',
      'spa': 'Español',
      'es': 'Español',
      'jpn': 'Japanese',
      'ja': 'Japanese',
      'und': 'Desconhecido',
    };

    return languages[langCode.toLowerCase()] || langCode.toUpperCase();
  }

  // ============================================
  // AUDIO TRACKS
  // ============================================

  getAudioTracks(): AudioTrack[] {
    return [...this.audioTracks];
  }

  setAudioTrack(index: number): void {
    if (index < 0 || index >= this.audioTracks.length) {
      console.warn('[AVPlay] Invalid audio track index:', index);
      return;
    }

    const track = this.audioTracks[index];
    this.avplay.setSelectTrack('AUDIO', track.index);
    this.currentAudioIndex = index;
    this.updateState({ currentAudioTrack: index });
    this.emit('audiotrackchange', index);
  }

  getCurrentAudioTrack(): number | null {
    return this.currentAudioIndex;
  }

  // ============================================
  // SUBTITLE TRACKS
  // ============================================

  getSubtitleTracks(): SubtitleTrack[] {
    return [...this.subtitleTracks];
  }

  setSubtitleTrack(index: number): void {
    if (index < 0 || index >= this.subtitleTracks.length) {
      console.warn('[AVPlay] Invalid subtitle track index:', index);
      return;
    }

    const track = this.subtitleTracks[index];
    this.avplay.setSelectTrack('TEXT', track.index);
    this.currentSubtitleIndex = index;
    this.avplay.setSilentSubtitle(false);
    this.updateState({ currentSubtitleTrack: index, subtitlesEnabled: true });
    this.emit('subtitletrackchange', index);
  }

  getCurrentSubtitleTrack(): number | null {
    return this.currentSubtitleIndex;
  }

  setSubtitlesEnabled(enabled: boolean): void {
    this.avplay.setSilentSubtitle(!enabled);
    this.subtitlesEnabled = enabled;
    this.updateState({ subtitlesEnabled: enabled });

    if (!enabled) {
      this.emit('subtitletrackchange', null);
    } else if (this.currentSubtitleIndex !== null) {
      this.emit('subtitletrackchange', this.currentSubtitleIndex);
    }
  }

  setSubtitleStyle(style: Partial<SubtitleStyle>): void {
    // Samsung AVPlay tem controle limitado de estilo
    // Apenas posição é configurável via API
    if (style.position !== undefined) {
      const positionValue = style.position === 'top' ? -100 : 0;
      this.avplay.setSubtitlePosition(positionValue);
    }
  }

  // ============================================
  // VOLUME & PLAYBACK RATE
  // ============================================

  setVolume(level: number): void {
    // AVPlay não tem controle de volume direto
    // Volume é controlado pelo sistema da TV
    this.updateState({ volume: level });
  }

  getVolume(): number {
    return this.state.volume;
  }

  setMuted(muted: boolean): void {
    // Controlado pelo sistema
    this.updateState({ muted });
  }

  isMuted(): boolean {
    return this.state.muted;
  }

  setPlaybackRate(rate: number): void {
    // Valores suportados: 0, 1, 2, 4, 8, -1, -2, -4, -8
    const supportedRates = [1, 2, 4, 8];
    const closestRate = supportedRates.reduce((prev, curr) =>
      Math.abs(curr - rate) < Math.abs(prev - rate) ? curr : prev
    );

    this.avplay.setSpeed(closestRate);
    this.updateState({ playbackRate: closestRate });
  }

  // ============================================
  // STATE
  // ============================================

  getState(): PlayerState {
    return { ...this.state };
  }

  getDuration(): number {
    return this.state.duration;
  }

  getCurrentTime(): number {
    try {
      return this.avplay.getCurrentTime() / 1000;
    } catch {
      return this.state.currentTime;
    }
  }

  isPlaying(): boolean {
    return this.state.status === 'playing';
  }

  // ============================================
  // EVENTS
  // ============================================

  on<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  once<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void {
    const onceHandler = (data: PlayerEventMap[K]) => {
      handler(data);
      this.off(event, onceHandler as PlayerEventHandler<K>);
    };
    this.on(event, onceHandler as PlayerEventHandler<K>);
  }

  private emit<K extends keyof PlayerEventMap>(
    event: K,
    data: PlayerEventMap[K]
  ): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        (handler as PlayerEventHandler<K>)(data);
      } catch (error) {
        console.error(`[AVPlay] Error in event handler for ${event}:`, error);
      }
    });
  }

  // ============================================
  // HELPERS
  // ============================================

  private updateState(partial: Partial<PlayerState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('statechange', this.state);
  }

  private startTimeUpdate(): void {
    if (this.timeUpdateInterval) return;

    this.timeUpdateInterval = window.setInterval(() => {
      const currentTime = this.getCurrentTime();
      if (currentTime !== this.state.currentTime) {
        this.updateState({ currentTime });
        this.emit('timeupdate', currentTime);
      }
    }, 250);
  }

  private stopTimeUpdate(): void {
    if (this.timeUpdateInterval) {
      clearInterval(this.timeUpdateInterval);
      this.timeUpdateInterval = null;
    }
  }
}
```

---

## 5. Implementação LG webOS (Luna Service)

### 5.1 Visão Geral

LG webOS usa uma combinação de:
1. **HTML5 `<video>` element** - Para renderização do vídeo
2. **Luna Service API** - Para controle avançado de tracks (áudio/legenda)

A API `luna://com.webos.media` oferece acesso a:
- Informações das tracks (`sourceInfo`)
- Seleção de tracks (`selectTrack`)
- Controle de legendas (`setSubtitleEnable`, `setSubtitleFontSize`, etc.)

### 5.2 Implementação Completa

```typescript
// src/player/adapters/LGWebOSAdapter.ts

import {
  IPlayerAdapter,
  PlayerEventMap,
  PlayerEventHandler,
  AudioTrack,
  SubtitleTrack,
  PlayerState,
  PlayerError,
  SubtitleStyle
} from '../types';

// Tipos do webOS
declare const webOS: {
  service: {
    request(uri: string, params: LunaServiceParams): void;
  };
  platform: {
    tv: boolean;
  };
};

interface LunaServiceParams {
  method: string;
  parameters: Record<string, any>;
  onSuccess?: (response: any) => void;
  onFailure?: (error: any) => void;
  subscribe?: boolean;
}

interface WebOSSourceInfo {
  container: string;
  seekable: boolean;
  numPrograms: number;
  programInfo: WebOSProgramInfo[];
}

interface WebOSProgramInfo {
  duration: number;
  numAudioTracks: number;
  audioTrackInfo: WebOSAudioTrackInfo[];
  numVideoTracks: number;
  videoTrackInfo: any[];
  numSubtitleTracks: number;
  subtitleTrackInfo: WebOSSubtitleTrackInfo[];
}

interface WebOSAudioTrackInfo {
  language: string;
  codec: string;
  channels: number;
  sampleRate?: number;
  bitRate?: number;
}

interface WebOSSubtitleTrackInfo {
  language: string;
  type: 'text' | 'bitmap';
}

export class LGWebOSAdapter implements IPlayerAdapter {
  private videoElement: HTMLVideoElement | null = null;
  private container: HTMLElement | null = null;
  private mediaId: string | null = null;

  private audioTracks: AudioTrack[] = [];
  private subtitleTracks: SubtitleTrack[] = [];
  private currentAudioIndex: number = 0;
  private currentSubtitleIndex: number | null = null;
  private subtitlesEnabled: boolean = true;

  private state: PlayerState = {
    status: 'idle',
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 100,
    muted: false,
    playbackRate: 1,
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    subtitlesEnabled: true,
  };

  private eventHandlers: Map<keyof PlayerEventMap, Set<Function>> = new Map();
  private lunaSubscription: boolean = false;

  // ============================================
  // LIFECYCLE
  // ============================================

  async initialize(container: HTMLElement): Promise<void> {
    this.container = container;

    // Criar elemento <video>
    this.videoElement = document.createElement('video');
    this.videoElement.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #000;
    `;
    this.videoElement.setAttribute('playsinline', '');
    this.videoElement.setAttribute('autoplay', '');
    container.appendChild(this.videoElement);

    // Configurar listeners do video element
    this.setupVideoListeners();
  }

  destroy(): void {
    // Cancelar subscription Luna
    this.unsubscribeLuna();

    // Remover listeners
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.src = '';
      this.videoElement.load();

      if (this.container) {
        this.container.removeChild(this.videoElement);
      }
    }

    this.eventHandlers.clear();
    this.audioTracks = [];
    this.subtitleTracks = [];
    this.mediaId = null;
  }

  // ============================================
  // VIDEO ELEMENT LISTENERS
  // ============================================

  private setupVideoListeners(): void {
    if (!this.videoElement) return;

    this.videoElement.addEventListener('loadedmetadata', () => {
      const duration = this.videoElement!.duration;
      this.updateState({ duration, status: 'ready' });
      this.emit('durationchange', duration);

      // Obter mediaId e tracks via Luna
      this.initializeLunaMedia();
    });

    this.videoElement.addEventListener('canplay', () => {
      this.updateState({ status: 'ready' });
    });

    this.videoElement.addEventListener('playing', () => {
      this.updateState({ status: 'playing' });
    });

    this.videoElement.addEventListener('pause', () => {
      this.updateState({ status: 'paused' });
    });

    this.videoElement.addEventListener('waiting', () => {
      this.updateState({ status: 'buffering' });
      this.emit('buffering', true);
    });

    this.videoElement.addEventListener('canplaythrough', () => {
      if (this.state.status === 'buffering') {
        this.updateState({ status: 'playing' });
        this.emit('buffering', false);
      }
    });

    this.videoElement.addEventListener('timeupdate', () => {
      const currentTime = this.videoElement!.currentTime;
      this.updateState({ currentTime });
      this.emit('timeupdate', currentTime);
    });

    this.videoElement.addEventListener('ended', () => {
      this.updateState({ status: 'idle' });
      this.emit('ended', undefined);
    });

    this.videoElement.addEventListener('error', () => {
      const error = this.videoElement!.error;
      this.updateState({ status: 'error' });
      this.emit('error', {
        code: `MEDIA_ERR_${error?.code || 'UNKNOWN'}`,
        message: error?.message || 'Erro desconhecido',
      });
    });

    this.videoElement.addEventListener('progress', () => {
      const buffered = this.videoElement!.buffered;
      if (buffered.length > 0) {
        const bufferedEnd = buffered.end(buffered.length - 1);
        const duration = this.videoElement!.duration;
        const bufferedPercent = (bufferedEnd / duration) * 100;
        this.updateState({ buffered: bufferedPercent });
      }
    });
  }

  // ============================================
  // LUNA SERVICE INTEGRATION
  // ============================================

  private initializeLunaMedia(): void {
    // Obter mediaId do elemento video
    // O webOS atribui automaticamente um mediaId a cada <video>
    this.mediaId = (this.videoElement as any).mediaId;

    if (!this.mediaId) {
      console.warn('[LG] mediaId não disponível, tentando novamente...');
      setTimeout(() => this.initializeLunaMedia(), 500);
      return;
    }

    console.log('[LG] mediaId obtido:', this.mediaId);

    // Subscrever para receber sourceInfo
    this.subscribeLuna();
  }

  private subscribeLuna(): void {
    if (!this.mediaId || this.lunaSubscription) return;

    webOS.service.request('luna://com.webos.media', {
      method: 'subscribe',
      parameters: {
        mediaId: this.mediaId,
        subscribe: true,
      },
      onSuccess: (response: any) => {
        console.log('[LG Luna] Subscribe response:', response);

        if (response.sourceInfo) {
          this.parseSourceInfo(response.sourceInfo);
        }
      },
      onFailure: (error: any) => {
        console.error('[LG Luna] Subscribe error:', error);
      },
    });

    this.lunaSubscription = true;
  }

  private unsubscribeLuna(): void {
    if (!this.mediaId || !this.lunaSubscription) return;

    webOS.service.request('luna://com.webos.media', {
      method: 'unsubscribe',
      parameters: {
        mediaId: this.mediaId,
      },
      onSuccess: () => {
        console.log('[LG Luna] Unsubscribed');
      },
      onFailure: (error: any) => {
        console.error('[LG Luna] Unsubscribe error:', error);
      },
    });

    this.lunaSubscription = false;
  }

  private parseSourceInfo(sourceInfo: WebOSSourceInfo): void {
    if (!sourceInfo.programInfo || sourceInfo.programInfo.length === 0) {
      return;
    }

    const program = sourceInfo.programInfo[0];

    // Parsear audio tracks
    this.audioTracks = (program.audioTrackInfo || []).map((track, index) => ({
      index,
      type: 'audio' as const,
      language: track.language || 'und',
      label: this.getLanguageLabel(track.language),
      codec: track.codec,
      channels: track.channels || 2,
      sampleRate: track.sampleRate,
      bitrate: track.bitRate,
      isDefault: index === 0,
    }));

    // Parsear subtitle tracks
    this.subtitleTracks = (program.subtitleTrackInfo || []).map((track, index) => ({
      index,
      type: 'subtitle' as const,
      language: track.language || 'und',
      label: this.getLanguageLabel(track.language),
      format: track.type,
      isDefault: index === 0,
    }));

    console.log('[LG] Audio tracks:', this.audioTracks);
    console.log('[LG] Subtitle tracks:', this.subtitleTracks);

    // Emitir evento
    this.emit('tracksready', {
      audio: this.audioTracks,
      subtitles: this.subtitleTracks,
    });

    // Definir tracks iniciais
    if (this.audioTracks.length > 0) {
      this.currentAudioIndex = 0;
      this.updateState({ currentAudioTrack: 0 });
    }

    if (this.subtitleTracks.length > 0) {
      this.currentSubtitleIndex = 0;
      this.updateState({ currentSubtitleTrack: 0 });
      // Habilitar legendas por padrão
      this.setSubtitlesEnabled(true);
    }
  }

  private getLanguageLabel(langCode: string | undefined): string {
    if (!langCode) return 'Desconhecido';

    const languages: Record<string, string> = {
      'por': 'Português',
      'pt': 'Português',
      'pt-br': 'Português (BR)',
      'eng': 'English',
      'en': 'English',
      'spa': 'Español',
      'es': 'Español',
      'jpn': 'Japanese',
      'ja': 'Japanese',
      'ru': 'Русский',
      'und': 'Desconhecido',
    };

    return languages[langCode.toLowerCase()] || langCode.toUpperCase();
  }

  // ============================================
  // PLAYBACK CONTROL
  // ============================================

  async load(url: string): Promise<void> {
    if (!this.videoElement) {
      throw new Error('Player not initialized');
    }

    this.updateState({ status: 'loading' });

    // Reset tracks
    this.audioTracks = [];
    this.subtitleTracks = [];
    this.mediaId = null;
    this.lunaSubscription = false;

    // Carregar novo source
    this.videoElement.src = url;
    this.videoElement.load();
  }

  play(): void {
    this.videoElement?.play();
  }

  pause(): void {
    this.videoElement?.pause();
  }

  stop(): void {
    if (this.videoElement) {
      this.videoElement.pause();
      this.videoElement.currentTime = 0;
      this.updateState({ status: 'idle', currentTime: 0 });
    }
  }

  seek(seconds: number): void {
    if (this.videoElement) {
      this.videoElement.currentTime = seconds;
    }
  }

  seekRelative(deltaSeconds: number): void {
    if (this.videoElement) {
      this.videoElement.currentTime += deltaSeconds;
    }
  }

  // ============================================
  // AUDIO TRACKS (via Luna Service)
  // ============================================

  getAudioTracks(): AudioTrack[] {
    return [...this.audioTracks];
  }

  setAudioTrack(index: number): void {
    if (!this.mediaId) {
      console.warn('[LG] mediaId não disponível');
      return;
    }

    if (index < 0 || index >= this.audioTracks.length) {
      console.warn('[LG] Invalid audio track index:', index);
      return;
    }

    webOS.service.request('luna://com.webos.media', {
      method: 'selectTrack',
      parameters: {
        mediaId: this.mediaId,
        type: 'audio',
        index: index,
      },
      onSuccess: () => {
        console.log('[LG] Audio track changed to:', index);
        this.currentAudioIndex = index;
        this.updateState({ currentAudioTrack: index });
        this.emit('audiotrackchange', index);
      },
      onFailure: (error: any) => {
        console.error('[LG] Failed to change audio track:', error);
      },
    });
  }

  getCurrentAudioTrack(): number | null {
    return this.currentAudioIndex;
  }

  // ============================================
  // SUBTITLE TRACKS (via Luna Service)
  // ============================================

  getSubtitleTracks(): SubtitleTrack[] {
    return [...this.subtitleTracks];
  }

  setSubtitleTrack(index: number): void {
    if (!this.mediaId) {
      console.warn('[LG] mediaId não disponível');
      return;
    }

    if (index < 0 || index >= this.subtitleTracks.length) {
      console.warn('[LG] Invalid subtitle track index:', index);
      return;
    }

    webOS.service.request('luna://com.webos.media', {
      method: 'selectTrack',
      parameters: {
        mediaId: this.mediaId,
        type: 'text',  // ou 'subtitle'
        index: index,
      },
      onSuccess: () => {
        console.log('[LG] Subtitle track changed to:', index);
        this.currentSubtitleIndex = index;
        this.updateState({ currentSubtitleTrack: index });
        this.emit('subtitletrackchange', index);

        // Garantir que legendas estão habilitadas
        if (!this.subtitlesEnabled) {
          this.setSubtitlesEnabled(true);
        }
      },
      onFailure: (error: any) => {
        console.error('[LG] Failed to change subtitle track:', error);
      },
    });
  }

  getCurrentSubtitleTrack(): number | null {
    return this.currentSubtitleIndex;
  }

  setSubtitlesEnabled(enabled: boolean): void {
    if (!this.mediaId) {
      console.warn('[LG] mediaId não disponível');
      return;
    }

    webOS.service.request('luna://com.webos.media', {
      method: 'setSubtitleEnable',
      parameters: {
        mediaId: this.mediaId,
        enable: enabled,
      },
      onSuccess: () => {
        console.log('[LG] Subtitles enabled:', enabled);
        this.subtitlesEnabled = enabled;
        this.updateState({ subtitlesEnabled: enabled });

        if (!enabled) {
          this.emit('subtitletrackchange', null);
        } else if (this.currentSubtitleIndex !== null) {
          this.emit('subtitletrackchange', this.currentSubtitleIndex);
        }
      },
      onFailure: (error: any) => {
        console.error('[LG] Failed to set subtitle enable:', error);
      },
    });
  }

  setSubtitleStyle(style: Partial<SubtitleStyle>): void {
    if (!this.mediaId) return;

    // Tamanho da fonte
    if (style.fontSize !== undefined) {
      const fontSizeMap: Record<string, number> = {
        'tiny': 0,
        'small': 1,
        'normal': 2,
        'large': 3,
        'huge': 4,
      };

      webOS.service.request('luna://com.webos.media', {
        method: 'setSubtitleFontSize',
        parameters: {
          mediaId: this.mediaId,
          fontSize: fontSizeMap[style.fontSize] ?? 2,
        },
        onSuccess: () => console.log('[LG] Font size changed'),
        onFailure: (error: any) => console.error('[LG] Font size error:', error),
      });
    }

    // Cor da fonte
    if (style.color !== undefined) {
      const colorMap: Record<string, number> = {
        'yellow': 0,
        'red': 1,
        'white': 2,
        'green': 3,
        'cyan': 4,
      };

      webOS.service.request('luna://com.webos.media', {
        method: 'setSubtitleColor',
        parameters: {
          mediaId: this.mediaId,
          color: colorMap[style.color] ?? 2,
        },
        onSuccess: () => console.log('[LG] Color changed'),
        onFailure: (error: any) => console.error('[LG] Color error:', error),
      });
    }

    // Posição
    if (style.position !== undefined) {
      const positionValue = style.position === 'top' ? 4 : 0;

      webOS.service.request('luna://com.webos.media', {
        method: 'setSubtitlePosition',
        parameters: {
          mediaId: this.mediaId,
          position: positionValue,
        },
        onSuccess: () => console.log('[LG] Position changed'),
        onFailure: (error: any) => console.error('[LG] Position error:', error),
      });
    }
  }

  // ============================================
  // VOLUME & PLAYBACK RATE
  // ============================================

  setVolume(level: number): void {
    if (this.videoElement) {
      this.videoElement.volume = level / 100;
      this.updateState({ volume: level });
    }
  }

  getVolume(): number {
    return this.videoElement ? this.videoElement.volume * 100 : this.state.volume;
  }

  setMuted(muted: boolean): void {
    if (this.videoElement) {
      this.videoElement.muted = muted;
      this.updateState({ muted });
    }
  }

  isMuted(): boolean {
    return this.videoElement?.muted ?? this.state.muted;
  }

  setPlaybackRate(rate: number): void {
    if (this.videoElement) {
      this.videoElement.playbackRate = rate;
      this.updateState({ playbackRate: rate });
    }
  }

  // ============================================
  // STATE
  // ============================================

  getState(): PlayerState {
    return { ...this.state };
  }

  getDuration(): number {
    return this.videoElement?.duration ?? this.state.duration;
  }

  getCurrentTime(): number {
    return this.videoElement?.currentTime ?? this.state.currentTime;
  }

  isPlaying(): boolean {
    return this.state.status === 'playing';
  }

  // ============================================
  // EVENTS
  // ============================================

  on<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
  }

  off<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void {
    this.eventHandlers.get(event)?.delete(handler);
  }

  once<K extends keyof PlayerEventMap>(
    event: K,
    handler: PlayerEventHandler<K>
  ): void {
    const onceHandler = (data: PlayerEventMap[K]) => {
      handler(data);
      this.off(event, onceHandler as PlayerEventHandler<K>);
    };
    this.on(event, onceHandler as PlayerEventHandler<K>);
  }

  private emit<K extends keyof PlayerEventMap>(
    event: K,
    data: PlayerEventMap[K]
  ): void {
    this.eventHandlers.get(event)?.forEach((handler) => {
      try {
        (handler as PlayerEventHandler<K>)(data);
      } catch (error) {
        console.error(`[LG] Error in event handler for ${event}:`, error);
      }
    });
  }

  // ============================================
  // HELPERS
  // ============================================

  private updateState(partial: Partial<PlayerState>): void {
    this.state = { ...this.state, ...partial };
    this.emit('statechange', this.state);
  }
}
```

---

## 6. Player Factory

```typescript
// src/player/PlayerFactory.ts

import { IPlayerAdapter } from './adapters/IPlayerAdapter';
import { SamsungAVPlayAdapter } from './adapters/SamsungAVPlayAdapter';
import { LGWebOSAdapter } from './adapters/LGWebOSAdapter';

export type Platform = 'tizen' | 'webos' | 'browser' | 'unknown';

/**
 * Detecta a plataforma atual
 */
export function detectPlatform(): Platform {
  // Samsung Tizen
  if (typeof window !== 'undefined' && 'webapis' in window) {
    return 'tizen';
  }

  // LG webOS
  if (typeof window !== 'undefined' && 'webOS' in window) {
    return 'webos';
  }

  // Browser genérico (para desenvolvimento)
  if (typeof window !== 'undefined') {
    return 'browser';
  }

  return 'unknown';
}

/**
 * Cria instância do player adapter apropriado para a plataforma
 */
export function createPlayer(): IPlayerAdapter {
  const platform = detectPlatform();

  switch (platform) {
    case 'tizen':
      console.log('[PlayerFactory] Creating Samsung AVPlay adapter');
      return new SamsungAVPlayAdapter();

    case 'webos':
      console.log('[PlayerFactory] Creating LG webOS adapter');
      return new LGWebOSAdapter();

    case 'browser':
      // Para desenvolvimento, usar LG adapter (usa HTML5 video)
      console.log('[PlayerFactory] Browser mode - using LG adapter');
      return new LGWebOSAdapter();

    default:
      throw new Error(`Plataforma não suportada: ${platform}`);
  }
}

/**
 * Verifica se a plataforma atual é suportada
 */
export function isPlatformSupported(): boolean {
  const platform = detectPlatform();
  return platform === 'tizen' || platform === 'webos' || platform === 'browser';
}
```

---

## 7. React Hook: usePlayer

```typescript
// src/player/hooks/usePlayer.ts

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  IPlayerAdapter,
  PlayerState,
  AudioTrack,
  SubtitleTrack,
  PlayerError
} from '../types';
import { createPlayer } from '../PlayerFactory';

interface UsePlayerReturn {
  // State
  state: PlayerState;
  audioTracks: AudioTrack[];
  subtitleTracks: SubtitleTrack[];
  error: PlayerError | null;

  // Refs
  containerRef: React.RefObject<HTMLDivElement>;

  // Actions
  load: (url: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;
  seek: (seconds: number) => void;
  seekRelative: (delta: number) => void;

  // Tracks
  setAudioTrack: (index: number) => void;
  setSubtitleTrack: (index: number) => void;
  toggleSubtitles: () => void;

  // Volume
  setVolume: (level: number) => void;
  toggleMute: () => void;
}

export function usePlayer(): UsePlayerReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<IPlayerAdapter | null>(null);

  const [state, setState] = useState<PlayerState>({
    status: 'idle',
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 100,
    muted: false,
    playbackRate: 1,
    currentAudioTrack: null,
    currentSubtitleTrack: null,
    subtitlesEnabled: true,
  });

  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [error, setError] = useState<PlayerError | null>(null);

  // Inicializar player
  useEffect(() => {
    if (!containerRef.current) return;

    const player = createPlayer();
    playerRef.current = player;

    // Setup event listeners
    player.on('statechange', setState);
    player.on('error', setError);
    player.on('tracksready', ({ audio, subtitles }) => {
      setAudioTracks(audio);
      setSubtitleTracks(subtitles);
    });

    // Inicializar
    player.initialize(containerRef.current);

    // Cleanup
    return () => {
      player.destroy();
      playerRef.current = null;
    };
  }, []);

  // Actions
  const load = useCallback(async (url: string) => {
    if (!playerRef.current) return;
    setError(null);
    await playerRef.current.load(url);
  }, []);

  const play = useCallback(() => {
    playerRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const togglePlay = useCallback(() => {
    if (state.status === 'playing') {
      pause();
    } else {
      play();
    }
  }, [state.status, play, pause]);

  const stop = useCallback(() => {
    playerRef.current?.stop();
  }, []);

  const seek = useCallback((seconds: number) => {
    playerRef.current?.seek(seconds);
  }, []);

  const seekRelative = useCallback((delta: number) => {
    playerRef.current?.seekRelative(delta);
  }, []);

  const setAudioTrack = useCallback((index: number) => {
    playerRef.current?.setAudioTrack(index);
  }, []);

  const setSubtitleTrack = useCallback((index: number) => {
    playerRef.current?.setSubtitleTrack(index);
  }, []);

  const toggleSubtitles = useCallback(() => {
    playerRef.current?.setSubtitlesEnabled(!state.subtitlesEnabled);
  }, [state.subtitlesEnabled]);

  const setVolume = useCallback((level: number) => {
    playerRef.current?.setVolume(level);
  }, []);

  const toggleMute = useCallback(() => {
    playerRef.current?.setMuted(!state.muted);
  }, [state.muted]);

  return {
    state,
    audioTracks,
    subtitleTracks,
    error,
    containerRef,
    load,
    play,
    pause,
    togglePlay,
    stop,
    seek,
    seekRelative,
    setAudioTrack,
    setSubtitleTrack,
    toggleSubtitles,
    setVolume,
    toggleMute,
  };
}
```

---

## 8. Componente PlayerContainer

```typescript
// src/ui/player/PlayerContainer.tsx

import React, { useEffect } from 'react';
import { usePlayer } from '../../player/hooks/usePlayer';
import { PlayerControls } from './PlayerControls';
import { PlayerOverlay } from './PlayerOverlay';
import { AudioSelector } from './AudioSelector';
import { SubtitleSelector } from './SubtitleSelector';
import { BufferingIndicator } from './BufferingIndicator';
import { useRemoteControl } from '../../hooks/useRemoteControl';
import styles from './PlayerContainer.module.css';

interface PlayerContainerProps {
  url: string;
  title?: string;
  onBack?: () => void;
}

export const PlayerContainer: React.FC<PlayerContainerProps> = ({
  url,
  title,
  onBack,
}) => {
  const {
    state,
    audioTracks,
    subtitleTracks,
    error,
    containerRef,
    load,
    play,
    pause,
    togglePlay,
    seek,
    seekRelative,
    setAudioTrack,
    setSubtitleTrack,
    toggleSubtitles,
  } = usePlayer();

  const [showControls, setShowControls] = React.useState(true);
  const [showAudioSelector, setShowAudioSelector] = React.useState(false);
  const [showSubtitleSelector, setShowSubtitleSelector] = React.useState(false);

  const controlsTimeoutRef = React.useRef<number>();

  // Carregar mídia
  useEffect(() => {
    load(url).then(() => play());
  }, [url, load, play]);

  // Auto-hide controls
  useEffect(() => {
    if (showControls) {
      controlsTimeoutRef.current = window.setTimeout(() => {
        if (state.status === 'playing') {
          setShowControls(false);
        }
      }, 5000);
    }

    return () => {
      if (controlsTimeoutRef.current) {
        clearTimeout(controlsTimeoutRef.current);
      }
    };
  }, [showControls, state.status]);

  // Controle remoto
  useRemoteControl({
    onOK: () => {
      if (showAudioSelector || showSubtitleSelector) return;
      togglePlay();
      setShowControls(true);
    },
    onBack: () => {
      if (showAudioSelector) {
        setShowAudioSelector(false);
      } else if (showSubtitleSelector) {
        setShowSubtitleSelector(false);
      } else {
        onBack?.();
      }
    },
    onLeft: () => {
      seekRelative(-10);
      setShowControls(true);
    },
    onRight: () => {
      seekRelative(10);
      setShowControls(true);
    },
    onUp: () => setShowControls(true),
    onDown: () => setShowControls(true),
    onRed: () => {
      setShowAudioSelector(true);
      setShowSubtitleSelector(false);
    },
    onGreen: () => {
      setShowSubtitleSelector(true);
      setShowAudioSelector(false);
    },
    onPlay: play,
    onPause: pause,
  });

  return (
    <div className={styles.container}>
      {/* Video Container */}
      <div ref={containerRef} className={styles.videoContainer} />

      {/* Buffering Indicator */}
      {state.status === 'buffering' && <BufferingIndicator />}

      {/* Controls Overlay */}
      {showControls && (
        <PlayerOverlay
          title={title}
          currentTime={state.currentTime}
          duration={state.duration}
          isPlaying={state.status === 'playing'}
          currentAudio={audioTracks[state.currentAudioTrack ?? 0]?.label}
          currentSubtitle={
            state.subtitlesEnabled
              ? subtitleTracks[state.currentSubtitleTrack ?? 0]?.label
              : 'Desativado'
          }
          onSeek={seek}
        />
      )}

      {/* Audio Selector Modal */}
      {showAudioSelector && (
        <AudioSelector
          tracks={audioTracks}
          currentIndex={state.currentAudioTrack ?? 0}
          onSelect={(index) => {
            setAudioTrack(index);
            setShowAudioSelector(false);
          }}
          onClose={() => setShowAudioSelector(false)}
        />
      )}

      {/* Subtitle Selector Modal */}
      {showSubtitleSelector && (
        <SubtitleSelector
          tracks={subtitleTracks}
          currentIndex={state.currentSubtitleTrack}
          subtitlesEnabled={state.subtitlesEnabled}
          onSelect={(index) => {
            setSubtitleTrack(index);
            setShowSubtitleSelector(false);
          }}
          onToggle={toggleSubtitles}
          onClose={() => setShowSubtitleSelector(false)}
        />
      )}

      {/* Error Display */}
      {error && (
        <div className={styles.error}>
          <p>Erro: {error.message}</p>
          <button onClick={onBack}>Voltar</button>
        </div>
      )}
    </div>
  );
};
```

---

## 9. Estrutura de Arquivos Final

```
src/
├── player/
│   ├── adapters/
│   │   ├── IPlayerAdapter.ts          # Interface principal
│   │   ├── SamsungAVPlayAdapter.ts    # Implementação Samsung
│   │   ├── LGWebOSAdapter.ts          # Implementação LG
│   │   └── index.ts                   # Exports
│   │
│   ├── types/
│   │   └── index.ts                   # Types compartilhados
│   │
│   ├── hooks/
│   │   ├── usePlayer.ts               # Hook principal
│   │   ├── usePlayerControls.ts       # Hook para controles
│   │   └── usePlayerTracks.ts         # Hook para tracks
│   │
│   ├── PlayerFactory.ts               # Factory + platform detection
│   └── index.ts                       # Exports públicos
│
├── ui/
│   └── player/
│       ├── PlayerContainer.tsx        # Container principal
│       ├── PlayerControls.tsx         # Barra de controles
│       ├── PlayerOverlay.tsx          # Overlay com info
│       ├── ProgressBar.tsx            # Barra de progresso
│       ├── AudioSelector.tsx          # Modal seleção áudio
│       ├── SubtitleSelector.tsx       # Modal seleção legendas
│       ├── BufferingIndicator.tsx     # Loading spinner
│       └── *.module.css               # Estilos
│
└── hooks/
    └── useRemoteControl.ts            # Hook controle remoto
```

---

## 10. Mapeamento de Teclas do Controle Remoto

```typescript
// src/hooks/useRemoteControl.ts

export const KEY_CODES = {
  // Samsung Tizen
  SAMSUNG: {
    ENTER: 13,
    BACK: 10009,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    REWIND: 412,
    FAST_FORWARD: 417,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
    INFO: 457,
  },

  // LG webOS
  WEBOS: {
    ENTER: 13,
    BACK: 461,
    LEFT: 37,
    UP: 38,
    RIGHT: 39,
    DOWN: 40,
    PLAY: 415,
    PAUSE: 19,
    STOP: 413,
    REWIND: 412,
    FAST_FORWARD: 417,
    RED: 403,
    GREEN: 404,
    YELLOW: 405,
    BLUE: 406,
    INFO: 457,
  },
};
```

---

## 11. Referências Técnicas

### 11.1 Samsung Tizen
- [AVPlay API Reference](https://developer.samsung.com/smarttv/develop/api-references/samsung-product-api-references/avplay-api.html)
- [Subtitles Guide](https://developer.samsung.com/smarttv/develop/guides/multimedia/subtitles.html)
- [Media Playback Best Practices](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html)

### 11.2 LG webOS
- [Luna Service Introduction](https://webostv.developer.lge.com/develop/references/luna-service-introduction)
- [Media Playback Guide](https://webostv.developer.lge.com/develop/app-developer-guide/media-app)
- [com.webos.media API (OSE)](https://www.webosose.org/docs/reference/ls2-api/com-webos-media/)
- [Luna Media API Gist](https://gist.github.com/aabytt/bddbb1bcf031a050d89a89aeee3a6737)

### 11.3 Comunidade
- [LG webOS Forum](https://forum.webostv.developer.lge.com/)
- [LG webOS Community](https://www.lgwebos.com/)

---

## 12. Nota sobre APIs Partner-Level

A Luna Service API `com.webos.media` é classificada como **Partner-level**. Para apps publicados na LG Content Store:

1. O app precisa ser submetido para revisão
2. LG avalia se o uso das APIs é adequado
3. Apps IPTV estabelecidos (SS IPTV, Smart IPTV) já usam essas APIs

Para desenvolvimento local e testes, as APIs funcionam normalmente.

---

> **Versão**: 2.0
> **Última Atualização**: 2025-01-26
> **Autor**: Gerado com auxílio de IA para AtivePlay
