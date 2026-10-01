import { isTizen } from '../theme/performance';
import { cleanDeviceName, hasCustomDeviceName, AUTO_DEVICE_NAME_KEY } from './server';

/**
 * Automatic device name, read from the device itself (a name set with ✎ in Devices always wins):
 *  • Android (Chrome / Edge): the phone model from the browser's client hints, e.g. "Pixel 9 Pro XL"
 *  • Samsung TV / The Freestyle (Tizen): the model code from the TV → "The Freestyle", "Samsung TV QE55Q80T"…
 *  • iPhone / iPad: "iPhone" / "iPad" (Apple doesn't let websites see the model)
 *  • Computers: "Windows PC", "Mac", "Linux PC" (browsers never reveal the computer's own name)
 * The result is remembered, so the next start uses it immediately.
 */
export async function detectDeviceName(): Promise<string> {
  // ---- Samsung TV / projector
  if (isTizen()) {
    const w = window as any;
    let model = '';
    try {
      model = w.webapis?.productinfo?.getRealModel?.() || w.webapis?.productinfo?.getModel?.() || '';
    } catch {}
    if (!model) {
      try {
        model = w.tizen?.systeminfo?.getCapability?.('http://tizen.org/system/model_name') || '';
      } catch {}
    }
    const m = String(model).toUpperCase();
    if (/^SP-?LSP3B|FREESTYLE/.test(m)) return 'The Freestyle';
    if (/^SP-?LFF3|^SP-?LSP3D/.test(m)) return 'The Freestyle 2';
    if (/^SP-?LSP7|PREMIERE/.test(m)) return 'The Premiere';
    if (/^SP-?LSP9/.test(m)) return 'The Premiere 9';
    return m ? `Samsung TV ${m}` : 'Samsung TV';
  }

  const ua = navigator.userAgent;
  const uad = (navigator as any).userAgentData;
  // ---- Android: real model through client hints (the user-agent string itself is reduced to "K")
  if (uad?.getHighEntropyValues) {
    try {
      const h = await uad.getHighEntropyValues(['model', 'platform']);
      if (h.model && h.model !== 'K') return h.model;
      if (h.platform === 'Windows') return 'Windows PC';
      if (h.platform === 'macOS') return 'Mac';
      if (h.platform === 'Chrome OS' || h.platform === 'ChromeOS') return 'Chromebook';
      if (h.platform === 'Linux') return 'Linux PC';
      if (h.platform === 'Android') return 'Android phone';
    } catch {}
  }
  // Older Android browsers still put the model in the user-agent: "...; Android 14; SM-S921B) ..."
  const androidModel = /Android [\d.]+; ([^;)]+)\)/.exec(ua)?.[1]?.trim();
  if (androidModel && androidModel !== 'K') return androidModel.replace(/ Build\/.*$/, '');
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'iPad';
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Mac OS X/.test(ua)) return 'Mac';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Linux/.test(ua)) return 'Linux PC';
  return 'Web browser';
}

/**
 * Detect and remember the automatic name. Calls onChange(name) when it differs from the one in use and no
 * custom name is set (so the server and other devices can be updated right away).
 */
export async function refreshAutoDeviceName(current: string, onChange: (name: string) => void) {
  try {
    const name = cleanDeviceName(await detectDeviceName());
    if (!name) return;
    localStorage.setItem(AUTO_DEVICE_NAME_KEY, name);
    if (!hasCustomDeviceName() && name !== current) onChange(name);
  } catch {}
}
