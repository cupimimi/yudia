import { setFocus } from '@noriginmedia/norigin-spatial-navigation';

/**
 * Where the remote lands when it enters a page (from the sidebar, or after switching tab). Each page lists its
 * preferred item first and fallbacks after it: an empty page (no movies, no live channels…) must never leave the
 * remote pointing at an item that doesn't exist — that freezes navigation.
 */
const ENTRY: Record<string, string[]> = {
  home: ['HERO_PLAY_BTN', 'HOME_GENRE_BAR'],
  movies: ['ROW_ALL_MOVIES', 'MOVIES_GENRE_BAR'],
  tv: ['ROW_TV_SHOWS', 'TV_GENRE_BAR'],
  live: ['LIVE_TV_VIEW'],
  music: ['MUSIC_HUB_VIEW'],
  downloads: ['DOWNLOADS_VIEW'],
  settings: ['SETTING_CAT_playback']
};

/**
 * Put the remote on `keys[0]` inside a pop-up (fallbacks after it, then the pop-up itself = its first item),
 * retrying for a moment: pop-up content often appears a render or two after the call, and a remote aimed at an
 * item that isn't there yet stays on the hidden page behind (arrows then do nothing).
 * `scope` is the pop-up's focus key; its element needs data-focus-key="<scope>".
 */
/** True while a pop-up window is on screen: page-focus rules must not pull the remote out from under it. */
export const popupOpen = () => !!document.querySelector('[aria-modal="true"]');

export function focusInside(scope: string, keys: string[], tries = 12, delay = 40) {
  const order = [...keys, scope];
  let attempt = 0;
  const run = () => {
    setFocus(order[attempt % order.length]); // cycle: the preferred item may simply appear a little later
    setTimeout(() => {
      const f = document.querySelector('.focused');
      const box = document.querySelector(`[data-focus-key="${scope}"]`);
      if (f && box && box.contains(f)) return; // landed
      attempt++;
      if (attempt < tries) run();
    }, 90);
  };
  setTimeout(run, delay);
}

export function focusPage(tab: string) {
  if (popupOpen()) return; // a pop-up (e.g. Reconnect required) owns the remote
  const keys = ENTRY[tab] || ENTRY.home;
  let i = 0;
  const tryNext = () => {
    if (i >= keys.length) return;
    setFocus(keys[i++]);
    // Did the remote actually land on something inside the page? If not, try the next choice.
    setTimeout(() => {
      const el = document.querySelector('.focused');
      if (!el || !document.querySelector('main')?.contains(el)) tryNext();
    }, 50);
  };
  tryNext();
}
