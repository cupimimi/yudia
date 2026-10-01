/**
 * Performance mode (Settings → TV Experience & Display → Performance Mode).
 *
 * TVs and The Freestyle run the app on a small ARM chip with an older browser engine. Effects that are free on a
 * PC GPU — live background blur (backdrop-filter) over playing video, endless decorative animations,
 * "transition: all" on glowing shadows — make them stutter. "Smooth" drops those (see .perf-lite in index.css);
 * the layout and colours stay the same.
 *
 *   auto   → Smooth on Samsung TV / Freestyle (Tizen), Full effects everywhere else
 *   smooth → always Smooth
 *   full   → always Full effects
 */
export type PerformanceMode = 'auto' | 'smooth' | 'full';

export const isTizen = (): boolean =>
  typeof window !== 'undefined' && (!!(window as any).tizen || /Tizen/i.test(navigator.userAgent));

export function readPerformanceMode(): PerformanceMode {
  try {
    const v = JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}').performanceMode;
    return v === 'smooth' || v === 'full' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export const isLiteMode = (mode: PerformanceMode = readPerformanceMode()): boolean =>
  mode === 'smooth' || (mode === 'auto' && isTizen());

/** Apply at startup and whenever the setting changes (no reload needed). */
export function applyPerformanceMode(mode: PerformanceMode = readPerformanceMode()): void {
  document.documentElement.classList.toggle('perf-lite', isLiteMode(mode));
}
