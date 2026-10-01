declare const __YUDIA_WEB__: boolean;

/**
 * Website: while something is playing, reloading / closing the page asks first ("Leave site?"), so a stray
 * F5, pull-to-refresh or tap doesn't cut the music. (Phones may still close a page in the background; the
 * music player then resumes where it was — see MusicPlayer.)
 */
export function installLeaveGuard() {
  if (typeof __YUDIA_WEB__ === 'undefined' || !__YUDIA_WEB__) return;
  window.addEventListener('beforeunload', (e) => {
    const playing = Array.from(document.querySelectorAll('audio, video')).some((m) => {
      const el = m as HTMLMediaElement;
      return !el.paused && !el.ended && el.currentTime > 0;
    });
    if (playing) {
      e.preventDefault();
      e.returnValue = ''; // required by some browsers to show the prompt
    }
  });
}
