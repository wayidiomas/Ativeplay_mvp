/**
 * Player Factory
 * Cria o adapter correto baseado na plataforma detectada
 */

import type { IPlayerAdapter } from './adapters/IPlayerAdapter';
import { SamsungAVPlayAdapter } from './adapters/SamsungAVPlayAdapter';
import { LGWebOSAdapter } from './adapters/LGWebOSAdapter';
import { BrowserAdapter } from './adapters/BrowserAdapter';

export type PlatformType = 'samsung' | 'lg' | 'browser' | 'unknown';

/**
 * Detecta a plataforma atual
 */
export function detectPlatform(): PlatformType {
  if (typeof window === 'undefined') {
    return 'unknown';
  }

  // Samsung Tizen
  if (
    typeof (window as { tizen?: unknown }).tizen !== 'undefined' ||
    typeof (window as { webapis?: { avplay?: unknown } }).webapis?.avplay !== 'undefined'
  ) {
    return 'samsung';
  }

  // LG webOS
  if (typeof (window as { webOS?: unknown }).webOS !== 'undefined') {
    return 'lg';
  }

  return 'browser';
}

export interface PlayerFactoryOptions {
  containerId?: string;
  forcePlatform?: PlatformType;
}

/**
 * Cria uma instancia do player adapter apropriado
 */
export function createPlayer(options: PlayerFactoryOptions = {}): IPlayerAdapter {
  const platform = options.forcePlatform || detectPlatform();

  console.log(`[PlayerFactory] Creating player for platform: ${platform}`);

  switch (platform) {
    case 'samsung':
      return new SamsungAVPlayAdapter();

    case 'lg':
      return new LGWebOSAdapter(options.containerId);

    case 'browser':
    default:
      return new BrowserAdapter(options.containerId);
  }
}

/**
 * Singleton para o player principal
 */
let mainPlayerInstance: IPlayerAdapter | null = null;

export function getMainPlayer(options: PlayerFactoryOptions = {}): IPlayerAdapter {
  if (!mainPlayerInstance) {
    mainPlayerInstance = createPlayer(options);
  }
  return mainPlayerInstance;
}

export function destroyMainPlayer(): void {
  if (mainPlayerInstance) {
    mainPlayerInstance.destroy();
    mainPlayerInstance = null;
  }
}

export default {
  detectPlatform,
  createPlayer,
  getMainPlayer,
  destroyMainPlayer,
};
