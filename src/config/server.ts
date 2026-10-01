/**
 * Which Jellyfin server Yudia connects to, and how this device identifies itself to it.
 */

// Set per build in vite.config.ts: the TV build pre-fills the owner's server; the website ships with none, so
// anyone who gets the link connects to their own server.
declare const __YUDIA_DEFAULT_SERVER__: string;
export const DEFAULT_SERVER_URL: string = typeof __YUDIA_DEFAULT_SERVER__ === 'string' ? __YUDIA_DEFAULT_SERVER__ : '';

/**
 * Turn whatever people paste into a server base URL:
 *   "jellyfin.example.com"                      → https://jellyfin.example.com
 *   "192.168.1.20:8096"                         → http://192.168.1.20:8096   (local addresses default to http)
 *   "https://x.com/web/index.html#!/home.html"  → https://x.com
 *   "https://x.com/jellyfin/"                   → https://x.com/jellyfin     (sub-path installs are kept)
 */
export function normalizeServerUrl(input: string): string {
  let s = input.trim();
  if (!s) return '';
  if (!/^https?:\/\//i.test(s)) {
    const host = s.split(/[/:]/)[0];
    const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || /\.local$/i.test(host);
    s = `${local ? 'http' : 'https'}://${s}`;
  }
  try {
    const u = new URL(s);
    let path = u.pathname.replace(/\/web(\/.*)?$/i, '').replace(/\/+$/, '');
    if (path === '/') path = '';
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return s.replace(/\/+$/, '');
  }
}

/** A secure (https) page can't talk to an http server — browsers block it as "mixed content". */
export function isBlockedMixedContent(serverUrl: string): boolean {
  return typeof location !== 'undefined' && location.protocol === 'https:' && /^http:\/\//i.test(serverUrl);
}

const isTizen = () => typeof window !== 'undefined' && (!!(window as any).tizen || /Tizen/i.test(navigator.userAgent));

/**
 * Stable per-device identity. Jellyfin keys sign-ins and sessions by DeviceId — if every copy of the app used the
 * same one (as before), friends on the website would sign each other out.
 */
export function deviceIdentity(): { deviceId: string; deviceName: string } {
  let deviceId = '';
  try {
    deviceId = localStorage.getItem('yudia_device_id') || '';
    if (!deviceId) {
      const rand = (globalThis.crypto?.getRandomValues?.(new Uint32Array(2)) || [Date.now(), Math.random() * 1e9]) as ArrayLike<number>;
      deviceId = `yudia-${Array.from(rand, (n) => Math.floor(n).toString(36)).join('')}`;
      localStorage.setItem('yudia_device_id', deviceId);
    }
  } catch {
    deviceId = `yudia-${Date.now().toString(36)}`;
  }

  let deviceName = 'Samsung TV / Freestyle';
  if (!isTizen()) {
    const ua = navigator.userAgent;
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
    deviceName = `Yudia Web (${browser}${os ? ` on ${os}` : ''})`;
  }
  // The name read from the device itself (model: "Pixel 9 Pro XL", "The Freestyle"… — see deviceName.ts),
  // and above all a name chosen by the user ("Projector", "My phone"…)
  try {
    const auto = localStorage.getItem(AUTO_DEVICE_NAME_KEY);
    if (auto) deviceName = auto;
    const custom = localStorage.getItem(DEVICE_NAME_KEY);
    if (custom) deviceName = custom;
  } catch {}
  return { deviceId, deviceName };
}

const DEVICE_NAME_KEY = 'yudia_device_name';
export const AUTO_DEVICE_NAME_KEY = 'yudia_auto_device_name';

/**
 * Clean a device name for the sign-in header the server reads it from: no quotes / backslashes, only
 * characters a header can carry (accents are fine, emoji are not), 40 characters max.
 */
export function cleanDeviceName(name: string): string {
  return name
    .replace(/["\\]/g, '')
    .replace(/[^\x20-\xFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
}

/** Save (or with '' reset) this device's name. Returns the name now in use. */
export function saveDeviceName(name: string): string {
  const clean = cleanDeviceName(name);
  try {
    if (clean) localStorage.setItem(DEVICE_NAME_KEY, clean);
    else localStorage.removeItem(DEVICE_NAME_KEY);
  } catch {}
  return deviceIdentity().deviceName;
}

export const hasCustomDeviceName = (): boolean => {
  try {
    return !!localStorage.getItem(DEVICE_NAME_KEY);
  } catch {
    return false;
  }
};
