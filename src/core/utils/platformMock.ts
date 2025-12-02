/**
 * Platform Mock para desenvolvimento no browser
 * Simula APIs de Samsung Tizen e LG webOS
 */

export type PlatformType = 'browser' | 'tizen' | 'webos' | 'unknown';

// Detecta a plataforma atual
export function detectPlatform(): PlatformType {
  if (typeof window === 'undefined') return 'unknown';

  // Samsung Tizen
  if (typeof (window as WindowWithTizen).tizen !== 'undefined') {
    return 'tizen';
  }

  // LG webOS
  if (typeof (window as WindowWithWebOS).webOS !== 'undefined') {
    return 'webos';
  }

  return 'browser';
}

// Tipos para plataformas
interface WindowWithTizen extends Window {
  tizen?: {
    application: {
      getCurrentApplication: () => { appInfo: { id: string } };
    };
  };
  webapis?: {
    avplay: AVPlayAPI;
    productinfo?: {
      getModel: () => string;
      getFirmware: () => string;
    };
  };
}

interface WindowWithWebOS extends Window {
  webOS?: {
    platform: {
      tv: boolean;
    };
    service: {
      request: (uri: string, params: unknown) => { cancel: () => void };
    };
    deviceInfo: (callback: (info: WebOSDeviceInfo) => void) => void;
  };
}

interface WebOSDeviceInfo {
  modelName: string;
  version: string;
  sdkVersion: string;
}

// webOSDev library interface (for LGUDID)
interface WebOSDev {
  LGUDID: (options: {
    onSuccess: (result: { id: string }) => void;
    onFailure: (error: { errorCode: string; errorText: string }) => void;
  }) => void;
}

interface WindowWithWebOSDev extends Window {
  webOSDev?: WebOSDev;
}

// Mock do Samsung AVPlay API
interface AVPlayAPI {
  open: (url: string) => void;
  close: () => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  jumpForward: (ms: number) => void;
  jumpBackward: (ms: number) => void;
  seekTo: (ms: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getState: () => string;
  getTotalTrackInfo: () => AVPlayTrackInfo;
  setSelectTrack: (type: string, index: number) => void;
  setListener: (listener: AVPlayListener) => void;
  setDisplayRect: (x: number, y: number, width: number, height: number) => void;
  setDisplayMethod: (method: string) => void;
  prepareAsync: (success: () => void, error: (e: Error) => void) => void;
  setStreamingProperty: (property: string, value: string) => void;
  suspend: () => void;
  restore: () => void;
}

interface AVPlayTrackInfo {
  AUDIO: Array<{
    index: number;
    language: string;
    extra_info: string;
  }>;
  TEXT: Array<{
    index: number;
    language: string;
    extra_info: string;
  }>;
  VIDEO: Array<{
    index: number;
    extra_info: string;
  }>;
}

interface AVPlayListener {
  onbufferingstart?: () => void;
  onbufferingprogress?: (percent: number) => void;
  onbufferingcomplete?: () => void;
  oncurrentplaytime?: (time: number) => void;
  onevent?: (eventType: string, eventData: string) => void;
  onerror?: (error: string) => void;
  onstreamcompleted?: () => void;
  onsubtitlechange?: (duration: number, text: string) => void;
}

// Mock state
let mockState = {
  currentTime: 0,
  duration: 7200000, // 2 hours em ms
  state: 'IDLE' as 'IDLE' | 'READY' | 'PLAYING' | 'PAUSED' | 'NONE',
  buffering: false,
};

// Mock AVPlay
const mockAVPlay: AVPlayAPI = {
  open: (url: string) => {
    console.log('[MOCK AVPlay] open:', url);
    mockState.state = 'IDLE';
  },
  close: () => {
    console.log('[MOCK AVPlay] close');
    mockState.state = 'NONE';
    mockState.currentTime = 0;
  },
  play: () => {
    console.log('[MOCK AVPlay] play');
    mockState.state = 'PLAYING';
  },
  pause: () => {
    console.log('[MOCK AVPlay] pause');
    mockState.state = 'PAUSED';
  },
  stop: () => {
    console.log('[MOCK AVPlay] stop');
    mockState.state = 'IDLE';
    mockState.currentTime = 0;
  },
  jumpForward: (ms: number) => {
    console.log('[MOCK AVPlay] jumpForward:', ms);
    mockState.currentTime = Math.min(mockState.currentTime + ms, mockState.duration);
  },
  jumpBackward: (ms: number) => {
    console.log('[MOCK AVPlay] jumpBackward:', ms);
    mockState.currentTime = Math.max(mockState.currentTime - ms, 0);
  },
  seekTo: (ms: number) => {
    console.log('[MOCK AVPlay] seekTo:', ms);
    mockState.currentTime = Math.max(0, Math.min(ms, mockState.duration));
  },
  getCurrentTime: () => mockState.currentTime,
  getDuration: () => mockState.duration,
  getState: () => mockState.state,
  getTotalTrackInfo: () => ({
    AUDIO: [
      { index: 0, language: 'por', extra_info: 'Portugues' },
      { index: 1, language: 'eng', extra_info: 'English' },
      { index: 2, language: 'spa', extra_info: 'Espanol' },
    ],
    TEXT: [
      { index: 0, language: 'por', extra_info: 'Portugues' },
      { index: 1, language: 'eng', extra_info: 'English' },
    ],
    VIDEO: [
      { index: 0, extra_info: '1080p' },
    ],
  }),
  setSelectTrack: (type: string, index: number) => {
    console.log('[MOCK AVPlay] setSelectTrack:', type, index);
  },
  setListener: (listener: AVPlayListener) => {
    console.log('[MOCK AVPlay] setListener:', listener);
    // Simula callback de tempo
    if (listener.oncurrentplaytime && mockState.state === 'PLAYING') {
      setInterval(() => {
        if (mockState.state === 'PLAYING') {
          mockState.currentTime += 1000;
          listener.oncurrentplaytime?.(mockState.currentTime);
        }
      }, 1000);
    }
  },
  setDisplayRect: (x: number, y: number, width: number, height: number) => {
    console.log('[MOCK AVPlay] setDisplayRect:', x, y, width, height);
  },
  setDisplayMethod: (method: string) => {
    console.log('[MOCK AVPlay] setDisplayMethod:', method);
  },
  prepareAsync: (success: () => void, _error: (e: Error) => void) => {
    console.log('[MOCK AVPlay] prepareAsync');
    setTimeout(() => {
      mockState.state = 'READY';
      success();
    }, 500);
  },
  setStreamingProperty: (property: string, value: string) => {
    console.log('[MOCK AVPlay] setStreamingProperty:', property, value);
  },
  suspend: () => {
    console.log('[MOCK AVPlay] suspend');
  },
  restore: () => {
    console.log('[MOCK AVPlay] restore');
  },
};

// Generate a stable mock device ID based on browser fingerprint
function generateMockDeviceId(): string {
  // Use a stable ID for development (based on user agent + screen)
  const fingerprint = `${navigator.userAgent}-${screen.width}x${screen.height}`;
  let hash = 0;
  for (let i = 0; i < fingerprint.length; i++) {
    const char = fingerprint.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Create a UUID-like string from hash
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `mock-${hex}-${hex}-${hex}-${hex}`;
}

// Mock webOSDev API (for LGUDID)
const mockWebOSDev: WebOSDev = {
  LGUDID: (options) => {
    const mockId = generateMockDeviceId();
    console.log('[MOCK webOSDev] LGUDID:', mockId);
    // Simulate async behavior
    setTimeout(() => {
      options.onSuccess({ id: mockId });
    }, 10);
  },
};

// Mock webOS API
const mockWebOS = {
  platform: { tv: true },
  service: {
    request: (uri: string, params: unknown): { cancel: () => void } => {
      console.log('[MOCK webOS] service.request:', uri, params);
      let cancelled = false;

      // Handle connectionmanager request for MAC address
      if (uri === 'luna://com.webos.service.connectionmanager') {
        const p = params as { onSuccess?: (result: unknown) => void };
        const onSuccess = p.onSuccess;
        if (onSuccess) {
          setTimeout(() => {
            if (!cancelled) {
              onSuccess({
                wired: { macAddress: '00:11:22:33:44:55', state: 'connected' },
                wifi: { macAddress: 'AA:BB:CC:DD:EE:FF', state: 'disconnected' },
              });
            }
          }, 10);
        }
      }

      // Handle media service requests (for Luna Service mock)
      if (uri === 'luna://com.webos.media') {
        const p = params as {
          method?: string;
          parameters?: Record<string, unknown>;
          onSuccess?: (result: unknown) => void;
          onFailure?: (error: unknown) => void;
        };
        console.log('[MOCK webOS] Luna media request:', p.method, p.parameters);

        // Mock Luna Service responses
        const onSuccess = p.onSuccess;
        if (onSuccess) {
          setTimeout(() => {
            if (!cancelled) {
              switch (p.method) {
                case 'load':
                  onSuccess({ returnValue: true, mediaId: 'mock-media-123' });
                  break;
                case 'play':
                case 'pause':
                case 'seek':
                case 'unload':
                case 'selectTrack':
                  onSuccess({ returnValue: true });
                  break;
                case 'subscribe':
                  // Mock state updates
                  onSuccess({ returnValue: true, state: 'playing', currentTime: 0, duration: 7200000 });
                  break;
                default:
                  onSuccess({ returnValue: true });
              }
            }
          }, 50);
        }
      }

      // Return cancel function
      return {
        cancel: () => {
          cancelled = true;
          console.log('[MOCK webOS] Request cancelled for:', uri);
        },
      };
    },
  },
  deviceInfo: (callback: (info: WebOSDeviceInfo) => void) => {
    callback({
      modelName: 'MOCK_LG_TV',
      version: '1.0.0',
      sdkVersion: '1.0.0',
    });
  },
};

// Inicializa mocks se estiver no browser
export function initPlatformMocks(): void {
  const platform = detectPlatform();

  if (platform === 'browser') {
    console.log('[AtivePlay] Running in browser mode with mocks');

    // Injeta mock do Samsung AVPlay
    (window as WindowWithTizen).webapis = {
      avplay: mockAVPlay,
      productinfo: {
        getModel: () => 'MOCK_SAMSUNG_TV',
        getFirmware: () => '1.0.0',
      },
    };

    // Injeta mock do LG webOS
    (window as WindowWithWebOS).webOS = mockWebOS;

    // Injeta mock do webOSDev (para LGUDID)
    (window as WindowWithWebOSDev).webOSDev = mockWebOSDev;
  }
}

// Auto-inicializa em modo dev
if (import.meta.env.DEV) {
  initPlatformMocks();
}

export const platform = detectPlatform();
export { mockAVPlay, mockWebOS, mockWebOSDev };
