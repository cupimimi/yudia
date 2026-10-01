/**
 * Interface accent colour (Settings → TV Experience & Display → Interface Accent Color).
 *
 * The whole UI uses CSS variables instead of a fixed cyan:
 *   --accent           main colour            e.g. color: var(--accent)
 *   --accent-rgb       "r, g, b" for alpha    e.g. rgba(var(--accent-rgb), 0.2)
 *   --accent-2         deeper shade for gradients
 *   --accent-contrast  readable text on an accent-filled button
 * Changing the setting rewrites these on <html>, so the app repaints instantly — no reload.
 * Brand (Yudia logo) and age-rating colours are intentionally not affected.
 */
import { useEffect, useState } from 'react';

export interface Accent {
  id: string;
  label: string;
  color: string;
  color2: string;
  contrast: string;
}

export const ACCENTS: Accent[] = [
  { id: 'cyan', label: 'Cyan Glow', color: '#00e5ff', color2: '#0077ff', contrast: '#000000' },
  { id: 'red', label: 'Netflix Red', color: '#e50914', color2: '#9f0610', contrast: '#ffffff' },
  { id: 'emerald', label: 'Emerald', color: '#10b981', color2: '#047857', contrast: '#000000' },
  { id: 'purple', label: 'Neon Purple', color: '#a855f7', color2: '#6d28d9', contrast: '#ffffff' },
  { id: 'amber', label: 'Amber Gold', color: '#f59e0b', color2: '#c2410c', contrast: '#000000' }
];

const EVENT = 'yudia-accent-change';

/** The setting stores a hex (older builds saved '#00f0ff' for cyan). */
export function resolveAccent(saved?: string): Accent {
  const s = (saved || '').toLowerCase();
  return ACCENTS.find((a) => a.color === s || a.id === s) || ACCENTS[0];
}

function readSaved(): string | undefined {
  try {
    return JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}').themeColor;
  } catch {
    return undefined;
  }
}

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
};

let active: Accent = resolveAccent(readSaved());

/** Write the CSS variables. Call once at startup and whenever the setting changes. */
export function applyAccent(saved?: string): void {
  active = resolveAccent(saved ?? readSaved());
  const root = document.documentElement.style;
  root.setProperty('--accent', active.color);
  root.setProperty('--accent-rgb', hexToRgb(active.color));
  root.setProperty('--accent-2', active.color2);
  root.setProperty('--accent-2-rgb', hexToRgb(active.color2));
  root.setProperty('--accent-contrast', active.contrast);
  window.dispatchEvent(new Event(EVENT));
}

export const getAccent = (): Accent => active;

/** For the few places that need the actual hex (e.g. building "#rrggbbaa" strings). */
export function useAccent(): Accent {
  const [accent, setAccent] = useState(active);
  useEffect(() => {
    const on = () => setAccent(active);
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return accent;
}
