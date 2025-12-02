/**
 * Device identification service
 *
 * Uses webOS native LGUDID (LG Unique Device ID) for persistent device identification.
 * Falls back to localStorage UUID for browser/development.
 *
 * The LGUDID is:
 * - Unique per physical device
 * - Persists across app reinstalls
 * - Persists across factory resets
 * - Used for device-based playlist and watch history management
 */

const DEVICE_ID_KEY = 'ativeplay-device-id';

// Type-only interfaces for webOS APIs (no global declaration to avoid conflicts)
interface WebOSDevAPI {
  LGUDID: (options: {
    onSuccess: (result: { id: string }) => void;
    onFailure: (error: { errorCode: string; errorText: string }) => void;
  }) => void;
}

interface ConnectionStatus {
  wired?: {
    macAddress?: string;
    state?: string;
  };
  wifi?: {
    macAddress?: string;
    state?: string;
  };
}

interface WebOSServiceRequestParams {
  onSuccess?: (result: ConnectionStatus) => void;
  onFailure?: (error: { errorCode: string; errorText: string }) => void;
}

// Access webOS APIs via any cast to avoid type conflicts with other declarations
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getWebOSDev = (): WebOSDevAPI | undefined => (window as any).webOSDev;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const getWebOS = (): { platform?: { tv: boolean }; service?: { request: (uri: string, params: WebOSServiceRequestParams) => void } } | undefined => (window as any).webOS;

/**
 * Get device ID using webOS native LGUDID
 * Returns a promise that resolves to the unique device ID
 */
function getLGUDID(): Promise<string | null> {
  return new Promise((resolve) => {
    const webOSDev = getWebOSDev();
    if (typeof window === 'undefined' || !webOSDev?.LGUDID) {
      resolve(null);
      return;
    }

    webOSDev.LGUDID({
      onSuccess: (result) => {
        console.log('[Device] Got LGUDID:', result.id.substring(0, 8) + '...');
        resolve(result.id);
      },
      onFailure: (error) => {
        console.warn('[Device] LGUDID failed:', error.errorText);
        resolve(null);
      },
    });
  });
}

/**
 * Get MAC address via Luna Service as fallback
 */
function getMacAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const webOS = getWebOS();
    if (typeof window === 'undefined' || !webOS?.service?.request) {
      resolve(null);
      return;
    }

    try {
      webOS.service.request('luna://com.webos.service.connectionmanager', {
        onSuccess: (result) => {
          // Prefer wired MAC, fallback to WiFi MAC
          const mac = result.wired?.macAddress || result.wifi?.macAddress;
          if (mac) {
            // Normalize MAC to a consistent format (remove colons, lowercase)
            const normalizedMac = mac.replace(/:/g, '').toLowerCase();
            console.log('[Device] Got MAC address:', normalizedMac.substring(0, 6) + '...');
            resolve(normalizedMac);
          } else {
            resolve(null);
          }
        },
        onFailure: (error) => {
          console.warn('[Device] MAC address lookup failed:', error.errorText);
          resolve(null);
        },
      });
    } catch (e) {
      console.warn('[Device] Luna service error:', e);
      resolve(null);
    }
  });
}

/**
 * Generate a fallback UUID for browser/development
 */
function generateFallbackUUID(): string {
  // Use crypto.randomUUID if available (modern browsers)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  // Fallback for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Get or generate device ID from localStorage
 */
function getStoredDeviceId(): string {
  if (typeof localStorage === 'undefined') {
    return generateFallbackUUID();
  }

  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = generateFallbackUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
    console.log('[Device] Generated new fallback device ID');
  }
  return deviceId;
}

// Cached device ID (resolved once at startup)
let cachedDeviceId: string | null = null;
let deviceIdPromise: Promise<string> | null = null;

/**
 * Initialize and get device ID
 *
 * Priority:
 * 1. webOSDev.LGUDID() - Official LG unique device ID
 * 2. MAC address via Luna Service - Hardware identifier
 * 3. localStorage UUID - Fallback for browser/dev
 *
 * The ID is cached after first resolution for performance.
 */
export async function initDeviceId(): Promise<string> {
  // Return cached value if available
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  // Return existing promise if initialization is in progress
  if (deviceIdPromise) {
    return deviceIdPromise;
  }

  deviceIdPromise = (async () => {
    // Try LGUDID first (most reliable)
    const lgudid = await getLGUDID();
    if (lgudid) {
      cachedDeviceId = lgudid;
      // Also store in localStorage for consistency
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DEVICE_ID_KEY, lgudid);
      }
      return lgudid;
    }

    // Try MAC address as fallback
    const mac = await getMacAddress();
    if (mac) {
      cachedDeviceId = mac;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(DEVICE_ID_KEY, mac);
      }
      return mac;
    }

    // Fall back to localStorage UUID
    const storedId = getStoredDeviceId();
    cachedDeviceId = storedId;
    return storedId;
  })();

  return deviceIdPromise;
}

/**
 * Get device ID synchronously (returns cached value or stored fallback)
 *
 * Use this when you need immediate access without async.
 * Call initDeviceId() at app startup to ensure native ID is used.
 */
export function getDeviceId(): string {
  if (cachedDeviceId) {
    return cachedDeviceId;
  }

  // Return stored value while async init completes
  return getStoredDeviceId();
}

/**
 * Check if running on actual webOS TV
 */
export function isWebOSTV(): boolean {
  const webOS = getWebOS();
  return typeof window !== 'undefined' && webOS?.platform?.tv === true;
}
