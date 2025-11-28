/**
 * Subtitle Renderer
 * Renderizador customizado de legendas para Smart TVs
 *
 * Por que usar Custom Renderer em vez de <track> nativo:
 * - Samsung Tizen: <track> tem suporte limitado e bugs
 * - LG webOS: <track> tem comportamento inconsistente
 * - Controle total sobre estilizacao
 * - Suporte a sincronizacao (offset)
 */

import type { SubtitleCue, SubtitleStyle } from './types';
import { DEFAULT_SUBTITLE_STYLE } from './types';

export class SubtitleRenderer {
  private container: HTMLDivElement;
  private style: SubtitleStyle;
  private cues: SubtitleCue[] = [];
  private visible: boolean = true;
  private currentCues: SubtitleCue[] = [];
  private syncOffset: number = 0;
  private animationFrame: number | null = null;
  private videoElement: HTMLVideoElement | null = null;

  constructor(playerContainer: HTMLElement, initialStyle?: Partial<SubtitleStyle>) {
    // Cria container de legendas
    this.container = document.createElement('div');
    this.container.className = 'ativeplay-subtitle-container';
    this.container.setAttribute('data-subtitle-renderer', 'true');

    // Estilo inicial
    this.style = { ...DEFAULT_SUBTITLE_STYLE, ...initialStyle };

    // Aplica estilos base do container
    this.applyContainerStyles();

    // Adiciona ao player
    playerContainer.appendChild(this.container);

    console.log('[SubtitleRenderer] Inicializado');
  }

  /**
   * Define os cues de legenda
   */
  setCues(cues: SubtitleCue[]): void {
    this.cues = cues;
    console.log(`[SubtitleRenderer] ${cues.length} cues carregados`);
  }

  /**
   * Atualiza estilo das legendas
   */
  setStyle(style: Partial<SubtitleStyle>): void {
    this.style = { ...this.style, ...style };
    this.applyContainerStyles();
    this.render(this.getLastRenderedTime());
  }

  /**
   * Define offset de sincronizacao (em ms)
   * Positivo = legenda aparece depois
   * Negativo = legenda aparece antes
   */
  setSyncOffset(offsetMs: number): void {
    this.syncOffset = offsetMs;
    console.log(`[SubtitleRenderer] Sync offset: ${offsetMs}ms`);
  }

  /**
   * Retorna offset atual
   */
  getSyncOffset(): number {
    return this.syncOffset;
  }

  /**
   * Ajusta offset em incrementos
   */
  adjustSync(deltaMs: number): number {
    this.syncOffset += deltaMs;
    // Limita a +/- 30 segundos
    this.syncOffset = Math.max(-30000, Math.min(30000, this.syncOffset));
    console.log(`[SubtitleRenderer] Sync ajustado: ${this.syncOffset}ms`);
    return this.syncOffset;
  }

  /**
   * Liga/desliga visibilidade
   */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.container.style.display = visible ? 'flex' : 'none';

    if (!visible) {
      this.container.innerHTML = '';
      this.currentCues = [];
    }
  }

  /**
   * Retorna se esta visivel
   */
  isVisible(): boolean {
    return this.visible;
  }

  /**
   * Toggle visibilidade
   */
  toggle(): boolean {
    this.setVisible(!this.visible);
    return this.visible;
  }

  /**
   * Renderiza legendas para o tempo atual (em ms)
   */
  render(currentTimeMs: number): void {
    if (!this.visible || this.cues.length === 0) {
      if (this.container.innerHTML) {
        this.container.innerHTML = '';
        this.currentCues = [];
      }
      return;
    }

    // Aplica offset de sync
    const adjustedTime = currentTimeMs - this.syncOffset;

    // Encontra cues ativos
    const activeCues = this.cues.filter(
      (cue) => cue.startTime <= adjustedTime && adjustedTime < cue.endTime
    );

    // Verifica se mudou
    if (this.cuesEqual(activeCues, this.currentCues)) {
      return;
    }

    this.currentCues = activeCues;

    // Limpa se nao tem cues ativos
    if (activeCues.length === 0) {
      this.container.innerHTML = '';
      return;
    }

    // Renderiza cues
    this.container.innerHTML = activeCues
      .map((cue) => this.renderCue(cue))
      .join('');
  }

  /**
   * Vincula a um elemento video para renderizacao automatica
   */
  bindToVideo(video: HTMLVideoElement): void {
    this.videoElement = video;

    // Usa requestAnimationFrame para performance
    const update = () => {
      if (this.videoElement && !this.videoElement.paused) {
        const currentTimeMs = this.videoElement.currentTime * 1000;
        this.render(currentTimeMs);
      }
      this.animationFrame = requestAnimationFrame(update);
    };

    // Inicia loop
    this.animationFrame = requestAnimationFrame(update);

    // Tambem atualiza em eventos do video
    video.addEventListener('seeked', () => {
      this.render(video.currentTime * 1000);
    });

    console.log('[SubtitleRenderer] Vinculado ao video');
  }

  /**
   * Desvincula do video
   */
  unbindFromVideo(): void {
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.videoElement = null;
  }

  /**
   * Limpa tudo
   */
  clear(): void {
    this.cues = [];
    this.currentCues = [];
    this.syncOffset = 0;
    this.container.innerHTML = '';
  }

  /**
   * Destroi o renderer
   */
  destroy(): void {
    this.unbindFromVideo();
    this.container.remove();
    console.log('[SubtitleRenderer] Destruido');
  }

  // === Metodos privados ===

  private lastRenderedTime: number = 0;

  private getLastRenderedTime(): number {
    if (this.videoElement) {
      return this.videoElement.currentTime * 1000;
    }
    return this.lastRenderedTime;
  }

  private applyContainerStyles(): void {
    const position = this.getPositionStyles();

    this.container.style.cssText = `
      position: absolute;
      left: 0;
      right: 0;
      ${position}
      display: ${this.visible ? 'flex' : 'none'};
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      pointer-events: none;
      z-index: 100;
      padding: 0 10%;
      box-sizing: border-box;
    `;
  }

  private getPositionStyles(): string {
    switch (this.style.position) {
      case 'top':
        return 'top: 40px; bottom: auto;';
      case 'center':
        return 'top: 50%; transform: translateY(-50%);';
      case 'bottom':
      default:
        return 'bottom: 60px; top: auto;';
    }
  }

  private renderCue(cue: SubtitleCue): string {
    const style = this.getCueStyles();
    const text = this.formatText(cue.text);
    return `<div class="subtitle-cue" style="${style}">${text}</div>`;
  }

  private getCueStyles(): string {
    const edgeStyle = this.getEdgeStyle();
    const baseFontSize = 28; // px base para TVs

    return `
      font-size: ${baseFontSize * (this.style.fontSize / 100)}px;
      font-family: ${this.style.fontFamily};
      color: ${this.style.color};
      background-color: ${this.style.backgroundColor};
      padding: 6px 16px;
      margin: 4px 0;
      border-radius: 4px;
      text-align: center;
      max-width: 90%;
      line-height: 1.4;
      opacity: ${this.style.opacity};
      ${edgeStyle}
    `.replace(/\s+/g, ' ').trim();
  }

  private getEdgeStyle(): string {
    const color = this.style.edgeColor;

    switch (this.style.edgeStyle) {
      case 'outline':
        return `text-shadow:
          -2px -2px 0 ${color},
          2px -2px 0 ${color},
          -2px 2px 0 ${color},
          2px 2px 0 ${color},
          -1px 0 0 ${color},
          1px 0 0 ${color},
          0 -1px 0 ${color},
          0 1px 0 ${color};`;
      case 'shadow':
        return `text-shadow: 2px 2px 4px ${color}, 3px 3px 6px rgba(0,0,0,0.5);`;
      case 'raised':
        return `text-shadow: 1px 1px 0 ${color}, 2px 2px 0 rgba(0,0,0,0.3);`;
      case 'depressed':
        return `text-shadow: -1px -1px 0 ${color}, -2px -2px 0 rgba(0,0,0,0.3);`;
      case 'none':
      default:
        return '';
    }
  }

  private formatText(text: string): string {
    return text
      // Escapa HTML
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      // Converte quebras de linha
      .replace(/\n/g, '<br>')
      // Restaura tags de formatacao permitidas
      .replace(/&lt;(\/?)([ibu])&gt;/gi, '<$1$2>');
  }

  private cuesEqual(a: SubtitleCue[], b: SubtitleCue[]): boolean {
    if (a.length !== b.length) return false;
    return a.every((cue, i) => cue.index === b[i]?.index);
  }
}

// === Helper para detectar Smart TV ===

/**
 * Detecta se deve usar custom renderer (recomendado para Smart TVs)
 */
export function shouldUseCustomRenderer(): boolean {
  const ua = navigator.userAgent.toLowerCase();
  return (
    ua.includes('tizen') ||
    ua.includes('webos') ||
    ua.includes('smarttv') ||
    ua.includes('smart-tv') ||
    ua.includes('netcast') ||
    ua.includes('viera') ||
    ua.includes('roku') ||
    ua.includes('firetv') ||
    ua.includes('amazonwebappplatform')
  );
}

/**
 * Cria instancia do renderer se necessario
 */
export function createSubtitleRenderer(
  playerContainer: HTMLElement,
  style?: Partial<SubtitleStyle>
): SubtitleRenderer {
  // Sempre usa custom renderer para consistencia
  return new SubtitleRenderer(playerContainer, style);
}

export default SubtitleRenderer;
