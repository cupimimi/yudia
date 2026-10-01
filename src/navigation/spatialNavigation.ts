import { init, setKeyMap, setFocus, getCurrentFocusKey, GetBoundingClientRectAdapter, SpatialNavigation } from '@noriginmedia/norigin-spatial-navigation';

// Dev server only: lets an automated check walk the remote navigation (never in the TV / website builds)
if ((import.meta as any).env?.DEV && typeof window !== 'undefined') (window as any).__sn = { setFocus, getCurrentFocusKey, service: (SpatialNavigation as any) };

/**
 * Samsung Tizen Remote Key Codes Reference:
 * - Left: 37
 * - Up: 38
 * - Right: 39
 * - Down: 40
 * - Enter: 13
 * - Return / Back: 10009 (Tizen Specific)
 * - Play: 415
 * - Pause: 19
 * - Play/Pause toggle: 10252
 * - FastForward: 417
 * - Rewind: 412
 */

export const TIZEN_KEY_CODES = {
  LEFT: 37,
  UP: 38,
  RIGHT: 39,
  DOWN: 40,
  ENTER: 13,
  BACK: 10009,
  PLAY: 415,
  PAUSE: 19,
  PLAY_PAUSE: 10252,
  REWIND: 412,
  FAST_FORWARD: 417
};

export const initializeSpatialNavigation = (onBackKey?: () => void) => {
  // Initialize norigin spatial navigation engine
  init({
    debug: false,
    visualDebug: false,
    throttle: 60, // Smooth TV remote d-pad repeat rate
    shouldFocusDOMNode: true,
    // Measure items where they really are on screen (scrolled pages, pop-ups, animated players). The default
    // offset-based measuring got positions wrong inside scrolling windows: ↓ on a series page skipped episodes.
    layoutAdapter: GetBoundingClientRectAdapter
  } as any);

  // Customize key map to include both hardware keycodes and modern DOM key strings
  setKeyMap({
    left: [37, 'ArrowLeft'],
    up: [38, 'ArrowUp'],
    right: [39, 'ArrowRight'],
    down: [40, 'ArrowDown'],
    enter: [13, 'Enter']
  });

  // Register Samsung Tizen input keys if webapis window object is present
  if (typeof window !== 'undefined' && (window as any).tizen) {
    try {
      const tvKeyRegister = [
        'MediaPlay',
        'MediaPause',
        'MediaPlayPause',
        'MediaStop',
        'MediaFastForward',
        'MediaRewind',
        'ChannelUp',   // Live TV zapping (keyCode 427)
        'ChannelDown', // (428)
        'Info',        // Live TV banner (457)
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ];
      // One by one: remotes without a key (e.g. The Freestyle's has no number pad) make registerKey throw,
      // and that must not stop the other keys from being registered.
      const supported = new Set(((window as any).tizen.tvinputdevice.getSupportedKeys?.() || []).map((k: any) => k.name));
      tvKeyRegister.forEach((keyName) => {
        if (supported.size && !supported.has(keyName)) return;
        try {
          (window as any).tizen.tvinputdevice.registerKey(keyName);
        } catch (err) {
          console.warn('Tizen key not available on this device:', keyName);
        }
      });
    } catch (e) {
      console.warn('Tizen TV input device registration error or non-Tizen environment:', e);
    }
  }

  // Global keydown event listener for Back key (10009 or Escape)
  const handleKeyDown = (event: KeyboardEvent) => {
    const keyCode = event.keyCode || event.which;

    if (keyCode === TIZEN_KEY_CODES.BACK || keyCode === 27) { // 10009 or Escape
      event.preventDefault();
      event.stopPropagation();
      if (onBackKey) {
        onBackKey();
      }
    }
  };

  window.addEventListener('keydown', handleKeyDown);

  return () => {
    window.removeEventListener('keydown', handleKeyDown);
  };
};
