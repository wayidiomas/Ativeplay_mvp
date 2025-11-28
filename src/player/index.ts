// Types
export * from './types';

// Adapters
export type { IPlayerAdapter } from './adapters/IPlayerAdapter';
export { SamsungAVPlayAdapter } from './adapters/SamsungAVPlayAdapter';
export { LGWebOSAdapter } from './adapters/LGWebOSAdapter';
export { BrowserAdapter } from './adapters/BrowserAdapter';

// Factory
export {
  createPlayer,
  getMainPlayer,
  destroyMainPlayer,
  detectPlatform,
  type PlatformType,
  type PlayerFactoryOptions,
} from './PlayerFactory';

// Hooks
export { usePlayer, type UsePlayerReturn, type UsePlayerOptions } from './hooks/usePlayer';
