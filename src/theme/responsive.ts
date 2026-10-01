/**
 * Phone layout. On narrow screens (≤ 820 px, never on the TV) the app swaps the TV sidebar for a top bar with a
 * ☰ menu (MobileTopBar) and `html.is-phone` switches layouts to single-column (see "PHONE" in index.css).
 */
import { useEffect, useState } from 'react';
import { isTizen } from './performance';

const QUERY = '(max-width: 820px)';

const matches = () => typeof window !== 'undefined' && !isTizen() && window.matchMedia(QUERY).matches;

function applyClass(on: boolean) {
  document.documentElement.classList.toggle('is-phone', on);
}

/** Call once at startup; keeps html.is-phone in sync when the window is resized / the phone rotates. */
export function installPhoneLayout(): void {
  if (typeof window === 'undefined') return;
  applyClass(matches());
  window.matchMedia(QUERY).addEventListener?.('change', () => applyClass(matches()));
}

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setPhone(matches());
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return phone;
}
