/**
 * IPlayerAdapter Interface
 * Interface que todos os adapters de player devem implementar
 */

import type {
  PlayerState,
  TrackInfo,
  CurrentTracks,
  PlaybackInfo,
  PlayerOptions,
  PlayerEventCallback,
  VideoRect,
  DisplayMethod,
} from '../types';

export interface IPlayerAdapter {
  // Lifecycle
  /**
   * Abre uma URL de midia para reproducao
   */
  open(url: string, options?: PlayerOptions): Promise<void>;

  /**
   * Prepara o player para reproducao (buffering inicial)
   */
  prepare(): Promise<void>;

  /**
   * Fecha o player e libera recursos
   */
  close(): void;

  /**
   * Destroi o adapter completamente
   */
  destroy(): void;

  // Playback Controls
  /**
   * Inicia reproducao
   */
  play(): void;

  /**
   * Pausa reproducao
   */
  pause(): void;

  /**
   * Para reproducao e reseta para o inicio
   */
  stop(): void;

  /**
   * Busca uma posicao especifica
   * @param position Posicao em milisegundos
   */
  seek(position: number): void;

  /**
   * Avanca X milisegundos
   */
  seekForward(ms: number): void;

  /**
   * Retrocede X milisegundos
   */
  seekBackward(ms: number): void;

  // Track Management
  /**
   * Obtem lista de todas as tracks disponiveis
   */
  getTracks(): TrackInfo;

  /**
   * Obtem tracks selecionadas atualmente
   */
  getCurrentTracks(): CurrentTracks;

  /**
   * Seleciona uma track de audio pelo indice
   */
  setAudioTrack(index: number): void;

  /**
   * Seleciona uma track de legenda pelo indice
   * @param index Indice da track ou -1 para desativar
   */
  setSubtitleTrack(index: number): void;

  /**
   * Ativa/desativa legendas
   */
  setSubtitleEnabled(enabled: boolean): void;

  /**
   * Ajusta estilo de legenda (opcional, se suportado pela plataforma)
   */
  setSubtitleStyle?(style: {
    fontSize?: number;
    color?: 'white' | 'yellow' | 'red' | 'green' | 'cyan';
    position?: 'bottom' | 'top';
  }): void;

  // State & Info
  /**
   * Obtem o estado atual do player
   */
  getState(): PlayerState;

  /**
   * Obtem informacoes de playback atuais
   */
  getPlaybackInfo(): PlaybackInfo;

  /**
   * Verifica se o player esta reproduzindo
   */
  isPlaying(): boolean;

  // Volume
  /**
   * Define o volume (0-100)
   */
  setVolume(volume: number): void;

  /**
   * Obtem o volume atual (0-100)
   */
  getVolume(): number;

  /**
   * Ativa/desativa mute
   */
  setMuted(muted: boolean): void;

  /**
   * Verifica se esta no mudo
   */
  isMuted(): boolean;

  // Display
  /**
   * Define a area de exibicao do video
   */
  setDisplayRect(rect: VideoRect): void;

  /**
   * Define o metodo de exibicao (fullscreen, letterbox)
   */
  setDisplayMethod(method: DisplayMethod): void;

  // Events
  /**
   * Adiciona um listener de eventos
   */
  addEventListener(callback: PlayerEventCallback): void;

  /**
   * Remove um listener de eventos
   */
  removeEventListener(callback: PlayerEventCallback): void;

  // Platform-specific
  /**
   * Suspende o player (para quando app vai para background)
   */
  suspend(): void;

  /**
   * Restaura o player (para quando app volta do background)
   */
  restore(): void;
}

export default IPlayerAdapter;
