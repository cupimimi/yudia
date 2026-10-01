import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useFocusable, FocusContext, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { ListMusic, Plus, Check, X, Loader2 } from 'lucide-react';
import { FocusableButton } from './FocusableButton';
import { FocusableInput } from './FocusableInput';
import { MediaItem } from '../mockData';
import { MusicPlaylist, getPlaylists, addToPlaylist, createPlaylist } from '../services/musicLibrary';
import { focusInside } from '../navigation/pageFocus';

// ---------------------------------------------------------------- open from anywhere

type Request = { items: MediaItem[]; label: string; returnTo: string | null } | null;
let request: Request = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/** "Add to playlist" for one song or several (a whole album). */
export function openPlaylistPicker(items: MediaItem[], label?: string) {
  const songs = items.filter((i) => i.type === 'music');
  if (!songs.length) return;
  request = { items: songs, label: label || (songs.length === 1 ? songs[0].title : `${songs.length} songs`), returnTo: getCurrentFocusKey() };
  emit();
}
const closePicker = () => {
  const back = request?.returnTo;
  request = null;
  emit();
  if (back) setTimeout(() => setFocus(back), 60); // the remote goes back to the button that opened it
};
const useRequest = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => request
  );

const MODAL = 'PLAYLIST_PICKER';

/**
 * The picker: your music playlists (press one to add), or "New playlist" (type a name, OK creates it with the
 * song(s) in it). Works with the remote (focus stays inside, Back closes), mouse and touch.
 */
export const PlaylistPicker: React.FC = () => {
  const req = useRequest();
  const [playlists, setPlaylists] = useState<MusicPlaylist[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ref, focusKey } = useFocusable({ focusKey: MODAL, isFocusBoundary: true, focusable: !!req, trackChildren: true });

  useEffect(() => {
    if (!req) return;
    setPlaylists(null);
    setCreating(false);
    setName('');
    setBusy(null);
    setDone(null);
    setError(null);
    getPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
    focusInside(MODAL, ['PLP_NEW', 'PLP_CLOSE']);
  }, [req]);

  // Back / Esc closes the picker (not the page behind); first Back leaves the name field
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.keyCode === 27 || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (creating) {
          setCreating(false);
          focusInside(MODAL, ['PLP_NEW']);
        } else closePicker();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [req, creating]);

  if (!req) return null;
  const ids = req.items.map((i) => i.id);

  const finish = (msg: string) => {
    setBusy(null);
    setDone(msg);
    setTimeout(closePicker, 1100);
  };
  const add = async (p: MusicPlaylist) => {
    setBusy(p.id);
    setError(null);
    try {
      await addToPlaylist(p.id, ids);
      finish(`Added to “${p.name}”`);
    } catch (e: any) {
      setBusy(null);
      setError(e?.message || 'Could not add to the playlist.');
    }
  };
  const create = async () => {
    const n = name.trim() || req.label;
    setBusy('new');
    setError(null);
    try {
      await createPlaylist(n, ids);
      finish(`Created “${n}”`);
    } catch (e: any) {
      setBusy(null);
      setError(e?.message || 'Could not create the playlist.');
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="plp-backdrop" onClick={closePicker}>
        <div ref={ref} data-focus-key={MODAL} className="plp" role="dialog" aria-modal="true" aria-label="Add to playlist" onClick={(e) => e.stopPropagation()}>
          <div className="plp__head">
            <div>
              <h2 className="plp__title">Add to playlist</h2>
              <p className="plp__sub">{req.label}</p>
            </div>
            <FocusableButton focusKey="PLP_CLOSE" onPress={closePicker} style={{ padding: '8px', borderRadius: '50%' }}>
              <X size={20} />
            </FocusableButton>
          </div>

          {done ? (
            <div className="plp__done">
              <Check size={22} /> {done}
            </div>
          ) : (
            <>
              {creating ? (
                <div className="plp__new">
                  <FocusableInput
                    focusKeyId="PLP_NAME"
                    value={name}
                    placeholder="Playlist name"
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') create();
                    }}
                  />
                  <FocusableButton focusKey="PLP_CREATE" onPress={create} disabled={busy === 'new'} style={{ justifyContent: 'center' }}>
                    {busy === 'new' ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />}
                    <span>Create</span>
                  </FocusableButton>
                </div>
              ) : (
                <FocusableButton
                  focusKey="PLP_NEW"
                  onPress={() => {
                    setCreating(true);
                    focusInside(MODAL, ['PLP_NAME']);
                  }}
                  className="plp__row plp__row--new"
                >
                  <span className="plp__icon">
                    <Plus size={20} />
                  </span>
                  <span>New playlist</span>
                </FocusableButton>
              )}

              <div className="plp__list">
                {playlists === null && <p className="plp__note">Loading your playlists…</p>}
                {playlists?.length === 0 && <p className="plp__note">No playlists yet — create the first one above.</p>}
                {playlists?.map((p) => (
                  <FocusableButton key={p.id} focusKey={`PLP_${p.id}`} onPress={() => add(p)} className="plp__row" disabled={!!busy}>
                    <span className="plp__icon">
                      {p.cover ? <img src={p.cover} alt="" /> : <ListMusic size={20} />}
                    </span>
                    <span className="plp__name">
                      {p.name}
                      <small>{p.count ? `${p.count} songs` : 'Playlist'}</small>
                    </span>
                    {busy === p.id && <Loader2 size={18} className="animate-spin" />}
                  </FocusableButton>
                ))}
              </div>
              {error && <p className="plp__error">{error}</p>}
            </>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
};
