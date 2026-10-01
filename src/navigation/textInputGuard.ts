/**
 * While a text field has the keyboard, key presses belong to the field.
 *
 * Remote navigation (spatial navigation) and the app's own shortcuts listen to keydown on window. Without this
 * guard, typing in the server-address / search / password fields broke on a laptop: ← → moved the remote focus
 * instead of the cursor, Backspace and End pulled focus to another button, Enter pressed the focused button.
 *
 * Registered once at startup in the capture phase on window, i.e. before every other handler: for keys typed
 * into an editable element it stops the event from reaching them (the browser still types / deletes / moves
 * the cursor / submits the form — stopping propagation doesn't cancel that).
 * Esc (and the TV remote's Back) leaves the field instead of closing the screen behind it.
 */
const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image']);

function isEditable(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.tagName === 'TEXTAREA') return true;
  return target.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((target as HTMLInputElement).type);
}

let installed = false;

export function installTextInputGuard(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener(
    'keydown',
    (e) => {
      if (!isEditable(e.target)) return;
      // Single-line field: ↑ / ↓ have no use for typing, so they leave the field and move the remote as usual
      // (otherwise, after the TV keyboard closes, the remote looks stuck on the field until Back is pressed).
      if (e.target.tagName === 'INPUT' && (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.keyCode === 38 || e.keyCode === 40)) {
        e.target.blur();
        return;
      }
      if (e.key === 'Escape' || e.keyCode === 27 || e.keyCode === 10009) {
        e.preventDefault();
        e.target.blur(); // back to remote navigation; the screen stays open
      }
      e.stopImmediatePropagation();
    },
    true
  );
}
