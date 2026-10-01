import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Play, Pause, Shuffle, Music2, Disc3, User, ListMusic, ChevronLeft, Maximize2, CircleCheck, Loader2, ListPlus, ListMinus, Trash2, MonitorSpeaker } from 'lucide-react';
import { openPlaylistPicker } from './PlaylistPicker';
import { CollectionDownloadButton } from './DownloadButton';
import { openConnect, useConnect } from './ConnectSheet';
import { useDownloadEntry } from '../hooks/useDownloads';
import { EmptyState } from './SadJellyfish';
import '../styles/music.css';
import { useAppState } from '../state/AppStateContext';
import { MediaItem } from '../mockData';
import {
  MusicAlbum,
  MusicArtist,
  MusicPlaylist,
  getAlbums,
  getArtists,
  getPlaylists,
  getSongs,
  getMostPlayed,
  getRecentlyPlayedAlbums,
  getAlbum,
  getAlbumTracks,
  getArtist,
  getArtistAlbums,
  getArtistSongs,
  getPlaylistTracks,
  totalLength,
  subscribePlaylists,
  getPlaylistsVersion,
  removeFromPlaylist
} from '../services/musicLibrary';

/**
 * Music, Spotify / Apple Music style:
 *   Listen Now · Albums · Artists · Songs · Playlists, and album / artist / playlist pages.
 * Everything works with the remote (D-pad + OK, Back returns to the previous page), mouse and touch.
 * The sidebar focuses the MUSIC_HUB_VIEW container, which returns to the last focused item; detail pages start on Play.
 */

type Tab = 'listen' | 'albums' | 'artists' | 'songs' | 'playlists';
type Page =
  | { kind: 'browse' }
  | { kind: 'album'; id: string; seed?: MusicAlbum; back?: string }
  | { kind: 'artist'; id: string; seed?: MusicArtist; back?: string }
  | { kind: 'playlist'; id: string; seed?: MusicPlaylist; back?: string };

const TABS: { id: Tab; label: string }[] = [
  { id: 'listen', label: 'Listen Now' },
  { id: 'albums', label: 'Albums' },
  { id: 'artists', label: 'Artists' },
  { id: 'songs', label: 'Songs' },
  { id: 'playlists', label: 'Playlists' }
];

const ENTRY = 'MUSIC_HERO_PLAY_BTN';

/* ------------------------------------------------------------------ helpers */

function useAsync<T>(load: () => Promise<T>, deps: React.DependencyList): { data: T | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ data: T | null; loading: boolean; failed: boolean }>({ data: null, loading: true, failed: false });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ data: s.data, loading: true, failed: false }));
    load()
      .then((data) => alive && setState({ data, loading: false, failed: false }))
      .catch(() => alive && setState({ data: null, loading: false, failed: true }));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return state;
}

function shuffled<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Same order all day, different tomorrow (for "Artists for you" / "Discover"). */
function dailyShuffle<T>(list: T[]): T[] {
  let seed = Math.floor(Date.now() / 864e5);
  const rand = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
};

/* ------------------------------------------------------------------ building blocks */

interface FocusableProps {
  focusKey?: string;
  onPress: () => void;
  className?: string;
  style?: React.CSSProperties;
  label?: string;
  children: React.ReactNode;
  onArrowPress?: (dir: string) => boolean;
}

/** A remote-focusable, clickable block. Scrolls itself into view (rows and page) when focused. */
const Focusable: React.FC<FocusableProps> = ({ focusKey, onPress, className = '', style, label, children, onArrowPress }) => {
  const { ref, focused } = useFocusable({ focusKey, onEnterPress: onPress, onArrowPress });
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }, [focused]);
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={-1}
      aria-label={label}
      onClick={onPress}
      className={`focusable ${focused ? 'focused' : ''} ${className}`}
      style={style}
    >
      {children}
    </div>
  );
};

const Cover: React.FC<{ src?: string; round?: boolean; icon?: 'album' | 'artist' | 'playlist' | 'song'; className?: string }> = ({
  src,
  round,
  icon = 'album',
  className = ''
}) => {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setBroken(false);
    setLoaded(false);
  }, [src]);
  const Icon = icon === 'artist' ? User : icon === 'playlist' ? ListMusic : icon === 'song' ? Music2 : Disc3;
  return (
    <div className={`music-cover ${round ? 'is-round' : ''} ${loaded ? 'is-loaded' : ''} ${className}`}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} onLoad={() => setLoaded(true)} />
      ) : (
        <span className="music-cover__ph">
          <Icon size={34} />
        </span>
      )}
    </div>
  );
};

const Shelf: React.FC<{ title: string; children: React.ReactNode; hidden?: boolean }> = ({ title, children, hidden }) =>
  hidden ? null : (
    <section className="music-shelf">
      <h2 className="music-shelf__title">{title}</h2>
      <div className="music-shelf__row">{children}</div>
    </section>
  );

const Skeletons: React.FC<{ n?: number; round?: boolean }> = ({ n = 6, round }) => (
  <>
    {Array.from({ length: n }).map((_, i) => (
      <div key={i} className="music-card is-skeleton">
        <div className={`music-cover ${round ? 'is-round' : ''}`} />
        <span className="music-skel-line" />
      </div>
    ))}
  </>
);

const AlbumCard: React.FC<{ album: MusicAlbum; ctx: string; onOpen: (a: MusicAlbum, back: string) => void; sub?: 'artist' | 'year' }> = ({
  album,
  ctx,
  onOpen,
  sub = 'artist'
}) => {
  const key = `MUSIC_ALBUM_${ctx}_${album.id}`;
  return (
    <Focusable focusKey={key} className="music-card" onPress={() => onOpen(album, key)} label={`${album.name}, ${album.artist}`}>
      <Cover src={album.cover} />
      <span className="music-card__title">{album.name}</span>
      <span className="music-card__sub">{sub === 'year' ? album.year || 'Album' : album.artist || 'Unknown artist'}</span>
    </Focusable>
  );
};

const ArtistCard: React.FC<{ artist: MusicArtist; ctx: string; onOpen: (a: MusicArtist, back: string) => void }> = ({ artist, ctx, onOpen }) => {
  const key = `MUSIC_ARTIST_${ctx}_${artist.id}`;
  return (
    <Focusable focusKey={key} className="music-card music-card--artist" onPress={() => onOpen(artist, key)} label={artist.name}>
      <Cover src={artist.image} round icon="artist" />
      <span className="music-card__title">{artist.name}</span>
      <span className="music-card__sub">Artist</span>
    </Focusable>
  );
};

const PlaylistCard: React.FC<{ playlist: MusicPlaylist; ctx: string; onOpen: (p: MusicPlaylist, back: string) => void }> = ({
  playlist,
  ctx,
  onOpen
}) => {
  const key = `MUSIC_PLAYLIST_${ctx}_${playlist.id}`;
  return (
    <Focusable focusKey={key} className="music-card" onPress={() => onOpen(playlist, key)} label={playlist.name}>
      <Cover src={playlist.cover} icon="playlist" />
      <span className="music-card__title">{playlist.name}</span>
      <span className="music-card__sub">
        Playlist{playlist.count ? ` · ${playlist.count} songs` : ''}
      </span>
    </Focusable>
  );
};

/** Song as a square card (On repeat shelf): press plays it, the shelf becomes the queue. */
const SongCard: React.FC<{ track: MediaItem; ctx: string; onPlay: () => void; playing: boolean }> = ({ track, ctx, onPlay, playing }) => (
  <Focusable focusKey={`MUSIC_SONG_${ctx}_${track.id}`} className={`music-card ${playing ? 'is-playing' : ''}`} onPress={onPlay} label={`Play ${track.title}`}>
    <div style={{ position: 'relative' }}>
      <Cover src={track.posterUrl} icon="song" />
      <span className="music-card__play">{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</span>
    </div>
    <span className="music-card__title">{track.title}</span>
    <span className="music-card__sub">{track.artist || 'Unknown artist'}</span>
  </Focusable>
);

/** Spotify "Jump back in": compact horizontal tile. */
const QuickTile: React.FC<{ album: MusicAlbum; onOpen: (a: MusicAlbum, back: string) => void; first?: boolean }> = ({ album, onOpen }) => {
  const key = `MUSIC_QUICK_${album.id}`;
  return (
    <Focusable focusKey={key} className="music-quick" onPress={() => onOpen(album, key)} label={album.name}>
      <Cover src={album.cover} className="music-quick__cover" />
      <span className="music-quick__text">
        <span className="music-quick__title">{album.name}</span>
        <span className="music-quick__sub">{album.artist}</span>
      </span>
    </Focusable>
  );
};

interface RowAction {
  label: string;
  icon: React.ReactNode;
  onPress: () => void;
  danger?: boolean;
}

const TrackRow: React.FC<{
  track: MediaItem;
  number: number;
  ctx: string;
  showCover: boolean;
  showAlbum: boolean;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: () => void;
  action?: RowAction;
}> = ({ track, number, ctx, showCover, showAlbum, isCurrent, isPlaying, onPlay, action }) => {
  const rowKey = `MUSIC_TRACK_${ctx}_${track.id}_${number}`;
  const actKey = `${rowKey}_ACT`;
  return (
  <Focusable
    focusKey={rowKey}
    className={`music-track ${isCurrent ? 'is-current' : ''}`}
    onPress={onPlay}
    label={`${track.title}, ${track.artist || ''}`}
    // → from the song goes to its button (it's inside the row, so position-based navigation wouldn't find it)
    onArrowPress={(dir) => {
      if (dir === 'right' && action) {
        setFocus(actKey);
        return false;
      }
      return true;
    }}
  >
    <span className="music-track__num">
      {isCurrent && isPlaying ? (
        <span className="music-eq">
          <span className="equalizer-bar" />
          <span className="equalizer-bar" style={{ animationDelay: '0.2s' }} />
          <span className="equalizer-bar" style={{ animationDelay: '0.4s' }} />
        </span>
      ) : (
        number
      )}
    </span>
    {showCover && <Cover src={track.posterUrl} icon="song" className="music-track__cover" />}
    <span className="music-track__main">
      <span className="music-track__title">{track.title}</span>
      <span className="music-track__artist">{track.artist || 'Unknown artist'}</span>
    </span>
    {showAlbum && <span className="music-track__album">{track.album}</span>}
    <DownloadedMark id={track.id} />
    <span className="music-track__time">{track.runTimeTicks ? track.duration : ''}</span>
    {action && (
      <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
        <Focusable
          focusKey={actKey}
          className={`music-track__act ${action.danger ? 'is-danger' : ''}`}
          onPress={action.onPress}
          label={action.label}
          onArrowPress={(dir) => {
            if (dir === 'left') {
              setFocus(rowKey);
              return false;
            }
            return dir !== 'right';
          }}
        >
          <span title={action.label} style={{ display: 'inline-flex' }}>
            {action.icon}
          </span>
        </Focusable>
      </span>
    )}
  </Focusable>
  );
};

const TrackList: React.FC<{
  tracks: MediaItem[];
  ctx: string;
  showCover?: boolean;
  showAlbum?: boolean;
  useTrackNumbers?: boolean;
  pageSize?: number;
  onPlay: (index: number) => void;
  /** Button at the end of each song. Default: "Add to playlist". */
  rowAction?: (track: MediaItem) => RowAction | undefined;
}> = ({ tracks, ctx, showCover = true, showAlbum = false, useTrackNumbers = false, pageSize = 100, onPlay, rowAction }) => {
  const { activeAudio, isAudioPlaying } = useAppState();
  const [shown, setShown] = useState(pageSize);
  useEffect(() => setShown(pageSize), [tracks, pageSize]);
  return (
    <div className="music-tracklist">
      {tracks.slice(0, shown).map((t, i) => (
        <TrackRow
          key={`${t.id}_${i}`}
          track={t}
          number={useTrackNumbers && t.indexNumber ? t.indexNumber : i + 1}
          ctx={ctx}
          showCover={showCover}
          showAlbum={showAlbum}
          isCurrent={activeAudio?.id === t.id}
          isPlaying={isAudioPlaying}
          onPlay={() => onPlay(i)}
          action={
            rowAction
              ? rowAction(t)
              : { label: `Add “${t.title}” to a playlist`, icon: <ListPlus size={18} />, onPress: () => openPlaylistPicker([t]) }
          }
        />
      ))}
      {tracks.length > shown && (
        <Focusable focusKey={`MUSIC_MORE_${ctx}`} className="music-more" onPress={() => setShown((s) => s + pageSize)}>
          Show more ({tracks.length - shown} more songs)
        </Focusable>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ main view */

export const MusicHubView: React.FC = () => {
  const { allMusic, activeAudio, isAudioPlaying, playAudio, toggleAudioPlayPause, isMusicFullScreen, setIsMusicFullScreen } = useAppState();
  const { ref, focusKey } = useFocusable({ focusKey: 'MUSIC_HUB_VIEW', trackChildren: true });

  const [tab, setTab] = useState<Tab>('listen');
  const [stack, setStack] = useState<Page[]>([{ kind: 'browse' }]);
  const page = stack[stack.length - 1];
  // Page transition direction: forward = slide in from the right, back = from the left, tab = fade up
  const [dir, setDir] = useState<'forward' | 'back' | 'tab'>('tab');

  const scrollTop = () => document.querySelector('main')?.scrollTo({ top: 0 });

  const open = useCallback((p: Page) => {
    setDir('forward');
    setStack((s) => [...s, p]);
    scrollTop();
    // Focus Play once the page's buttons have registered (again a bit later for slow TVs)
    setTimeout(() => setFocus(ENTRY), 80);
    setTimeout(() => {
      if (!document.querySelector('.music-detail .focused')) setFocus(ENTRY);
    }, 450);
  }, []);

  const goBack = useCallback(() => {
    setDir('back');
    setStack((s) => {
      if (s.length <= 1) return s;
      const leaving = s[s.length - 1];
      const back = leaving.kind !== 'browse' ? leaving.back : undefined;
      setTimeout(() => setFocus(back || 'MUSIC_HUB_VIEW'), 80);
      return s.slice(0, -1);
    });
  }, []);

  // Remote Back / Esc on an album, artist or playlist page → previous page (not out of Music)
  useEffect(() => {
    if (stack.length <= 1) return;
    const onKey = (e: KeyboardEvent) => {
      if (isMusicFullScreen) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.keyCode === 10009 || e.keyCode === 27 || e.key === 'Escape' || (e.keyCode === 8 && !t?.isContentEditable)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        goBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [stack.length, isMusicFullScreen, goBack]);

  const playList = useCallback(
    (tracks: MediaItem[], index = 0, shuffle = false) => {
      if (!tracks.length) return;
      if (shuffle) {
        const q = shuffled(tracks);
        playAudio(q[0], q);
        return;
      }
      const t = tracks[index];
      if (activeAudio?.id === t.id) toggleAudioPlayPause();
      else playAudio(t, tracks);
    },
    [activeAudio?.id, playAudio, toggleAudioPlayPause]
  );

  const openAlbum = useCallback((a: MusicAlbum, back?: string) => open({ kind: 'album', id: a.id, seed: a, back }), [open]);
  const openArtist = useCallback((a: MusicArtist, back?: string) => open({ kind: 'artist', id: a.id, seed: a, back }), [open]);
  const openPlaylist = useCallback((p: MusicPlaylist, back?: string) => open({ kind: 'playlist', id: p.id, seed: p, back }), [open]);

  const nav = { openAlbum, openArtist, openPlaylist, playList };

  const plVersion = useSyncExternalStore(subscribePlaylists, getPlaylistsVersion);
  const playlists = useAsync(() => getPlaylists(), [plVersion]);

  if (allMusic.length === 0 && !activeAudio && !playlists.loading && !(playlists.data && playlists.data.length)) {
    return (
      <FocusContext.Provider value={focusKey}>
        <div ref={ref}>
          <EmptyState
            title="No music found"
            message="Your Jellyfin server has no music this profile can play. Add a music library in Jellyfin (Dashboard → Libraries) and it will show up here."
          />
        </div>
      </FocusContext.Provider>
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="music-hub">
        <div key={`page-${stack.length}-${page.kind === 'browse' ? 'browse' : page.id}`} className={`music-anim music-anim--${dir}`}>
        {page.kind === 'browse' && (
          <>
            <header className="music-hub__head">
              <div>
                <h1 className="music-hub__title">{tab === 'listen' ? greeting() : 'Music'}</h1>
              </div>
              <div className="music-hub__headbtns">
                <DevicesHeaderButton />
                {activeAudio && (
                  <Focusable focusKey="MUSIC_OPEN_PLAYER" className="music-btn music-btn--ghost" onPress={() => setIsMusicFullScreen(true)}>
                    <Maximize2 size={18} /> <span>Now playing &amp; lyrics</span>
                  </Focusable>
                )}
              </div>
            </header>

            <nav className="music-tabs" aria-label="Music sections">
              {TABS.map((t, i) => (
                <Focusable
                  key={t.id}
                  focusKey={`MUSIC_TAB_${t.id}`}
                  className={`music-tab ${t.id === tab ? 'is-active' : ''}`}
                  onPress={() => {
                    if (t.id === tab) return;
                    setDir('tab');
                    setTab(t.id);
                  }}
                  onArrowPress={(dir) => {
                    if (dir === 'left' && i === 0) {
                      setFocus('NAV_TAB_music');
                      return false;
                    }
                    return true;
                  }}
                >
                  {t.label}
                </Focusable>
              ))}
            </nav>

            <div key={tab} className={dir === 'tab' ? 'music-anim music-anim--tab' : undefined}>
              {tab === 'listen' && <ListenNow nav={nav} playlists={playlists.data || []} />}
              {tab === 'albums' && <AlbumsTab nav={nav} />}
              {tab === 'artists' && <ArtistsTab nav={nav} />}
              {tab === 'songs' && <SongsTab nav={nav} />}
              {tab === 'playlists' && <PlaylistsTab nav={nav} playlists={playlists} />}
            </div>
          </>
        )}

        {page.kind !== 'browse' && (
          <Focusable focusKey="MUSIC_BACK" className="music-back" onPress={goBack} label="Back">
            <ChevronLeft size={22} /> <span>Back</span>
          </Focusable>
        )}
        {page.kind === 'album' && <AlbumPage key={page.id} id={page.id} seed={page.seed} nav={nav} />}
        {page.kind === 'artist' && <ArtistPage key={page.id} id={page.id} seed={page.seed} nav={nav} />}
        {page.kind === 'playlist' && <PlaylistPage key={page.id} id={page.id} seed={page.seed} nav={nav} />}
        </div>
      </div>
    </FocusContext.Provider>
  );
};

interface Nav {
  openAlbum: (a: MusicAlbum, back?: string) => void;
  openArtist: (a: MusicArtist, back?: string) => void;
  openPlaylist: (p: MusicPlaylist, back?: string) => void;
  playList: (tracks: MediaItem[], index?: number, shuffle?: boolean) => void;
}

/* ------------------------------------------------------------------ tabs */

const ListenNow: React.FC<{ nav: Nav; playlists: MusicPlaylist[] }> = ({ nav, playlists }) => {
  const { activeAudio, isAudioPlaying } = useAppState();
  const recentPlayed = useAsync(() => getRecentlyPlayedAlbums(8), []);
  const recentAdded = useAsync(() => getAlbums('recent', 24), []);
  const allAlbums = useAsync(() => getAlbums('name'), []);
  const artists = useAsync(() => getArtists(), []);
  const onRepeat = useAsync(() => getMostPlayed(16), []);

  const quick = (recentPlayed.data && recentPlayed.data.length >= 2 ? recentPlayed.data : recentAdded.data || []).slice(0, 8);
  const artistPicks = useMemo(() => dailyShuffle((artists.data || []).filter((a) => a.hasImage)).slice(0, 16), [artists.data]);
  const discover = useMemo(() => {
    const recentIds = new Set((recentAdded.data || []).map((a) => a.id));
    return dailyShuffle((allAlbums.data || []).filter((a) => !recentIds.has(a.id))).slice(0, 16);
  }, [allAlbums.data, recentAdded.data]);

  return (
    <div className="music-page">
      {quick.length > 0 && (
        <div className="music-quickgrid">
          {quick.map((a) => (
            <QuickTile key={a.id} album={a} onOpen={nav.openAlbum} />
          ))}
        </div>
      )}

      <Shelf title="Recently added" hidden={!recentAdded.loading && !(recentAdded.data || []).length}>
        {recentAdded.loading && !recentAdded.data ? <Skeletons /> : (recentAdded.data || []).map((a) => <AlbumCard key={a.id} album={a} ctx="recent" onOpen={nav.openAlbum} />)}
      </Shelf>

      <Shelf title="On repeat" hidden={!(onRepeat.data || []).length}>
        {(onRepeat.data || []).map((t, i) => (
          <SongCard key={t.id} track={t} ctx="repeat" playing={activeAudio?.id === t.id && isAudioPlaying} onPlay={() => nav.playList(onRepeat.data!, i)} />
        ))}
      </Shelf>

      <Shelf title="Artists for you" hidden={!artistPicks.length}>
        {artistPicks.map((a) => (
          <ArtistCard key={a.id} artist={a} ctx="foryou" onOpen={nav.openArtist} />
        ))}
      </Shelf>

      <Shelf title="Your playlists" hidden={!playlists.length}>
        {playlists.map((p) => (
          <PlaylistCard key={p.id} playlist={p} ctx="home" onOpen={nav.openPlaylist} />
        ))}
      </Shelf>

      <Shelf title="Discover in your library" hidden={!discover.length}>
        {discover.map((a) => (
          <AlbumCard key={a.id} album={a} ctx="discover" onOpen={nav.openAlbum} />
        ))}
      </Shelf>
    </div>
  );
};

const AlbumsTab: React.FC<{ nav: Nav }> = ({ nav }) => {
  const [sort, setSort] = useState<'name' | 'recent'>('name');
  const albums = useAsync(() => getAlbums(sort), [sort]);
  return (
    <div className="music-page">
      <div className="music-toolbar">
        <span className="music-count">{albums.data ? `${albums.data.length} albums` : ''}</span>
        <div className="music-toolbar__group">
          <Focusable focusKey="MUSIC_SORT_NAME" className={`music-chip ${sort === 'name' ? 'is-active' : ''}`} onPress={() => setSort('name')}>
            A–Z
          </Focusable>
          <Focusable focusKey="MUSIC_SORT_RECENT" className={`music-chip ${sort === 'recent' ? 'is-active' : ''}`} onPress={() => setSort('recent')}>
            Recently added
          </Focusable>
        </div>
      </div>
      <div className="music-grid">
        {albums.loading && !albums.data ? <Skeletons n={12} /> : (albums.data || []).map((a) => <AlbumCard key={a.id} album={a} ctx="all" onOpen={nav.openAlbum} />)}
      </div>
      {albums.failed && <p className="music-note">Couldn’t load albums from the server.</p>}
    </div>
  );
};

const ArtistsTab: React.FC<{ nav: Nav }> = ({ nav }) => {
  const artists = useAsync(() => getArtists(), []);
  return (
    <div className="music-page">
      <div className="music-toolbar">
        <span className="music-count">{artists.data ? `${artists.data.length} artists` : ''}</span>
      </div>
      <div className="music-grid">
        {artists.loading && !artists.data ? <Skeletons n={12} round /> : (artists.data || []).map((a) => <ArtistCard key={a.id} artist={a} ctx="all" onOpen={nav.openArtist} />)}
      </div>
      {artists.failed && <p className="music-note">Couldn’t load artists from the server.</p>}
    </div>
  );
};

const SongsTab: React.FC<{ nav: Nav }> = ({ nav }) => {
  const songs = useAsync(() => getSongs(), []);
  const list = songs.data || [];
  return (
    <div className="music-page">
      <div className="music-toolbar">
        <span className="music-count">{songs.data ? `${list.length} songs` : 'Loading songs…'}</span>
        <div className="music-toolbar__group">
          <Focusable focusKey="MUSIC_SONGS_PLAY" className="music-btn music-btn--primary" onPress={() => nav.playList(list, 0)}>
            <Play size={18} fill="currentColor" /> <span>Play</span>
          </Focusable>
          <Focusable focusKey="MUSIC_SONGS_SHUFFLE" className="music-btn" onPress={() => nav.playList(list, 0, true)}>
            <Shuffle size={18} /> <span>Shuffle</span>
          </Focusable>
        </div>
      </div>
      <TrackList tracks={list} ctx="songs" showAlbum onPlay={(i) => nav.playList(list, i)} />
    </div>
  );
};

const PlaylistsTab: React.FC<{ nav: Nav; playlists: { data: MusicPlaylist[] | null; loading: boolean } }> = ({ nav, playlists }) => (
  <div className="music-page">
    {!playlists.loading && !(playlists.data || []).length ? (
      <p className="music-note">
        No playlists yet. Create one in Jellyfin (on a song: ⋯ → Add to playlist) and it will appear here.
      </p>
    ) : (
      <div className="music-grid">
        {playlists.loading && !playlists.data ? <Skeletons n={6} /> : (playlists.data || []).map((p) => <PlaylistCard key={p.id} playlist={p} ctx="all" onOpen={nav.openPlaylist} />)}
      </div>
    )}
  </div>
);

/* ------------------------------------------------------------------ detail pages */

const DetailHeader: React.FC<{
  kind: string;
  title: string;
  cover?: string;
  round?: boolean;
  icon: 'album' | 'artist' | 'playlist';
  subtitle?: React.ReactNode;
  meta?: string;
  tracks: MediaItem[];
  nav: Nav;
  /** Album / playlist: Download (and keep in sync) */
  download?: { id: string; name: string; type: 'album' | 'playlist' };
}> = ({ kind, title, cover, round, icon, subtitle, meta, tracks, nav, download }) => {
  const { activeAudio, isAudioPlaying, toggleAudioPlayPause } = useAppState();
  const playingHere = !!activeAudio && tracks.some((t) => t.id === activeAudio.id);
  return (
    <header className="music-detail">
      {cover && <div className="music-detail__glow" style={{ backgroundImage: `url("${cover}")` }} />}
      <Cover src={cover} round={round} icon={icon} className="music-detail__cover" />
      <div className="music-detail__info">
        <span className="music-detail__kind">{kind}</span>
        <h1 className="music-detail__title">{title}</h1>
        {subtitle && <div className="music-detail__sub">{subtitle}</div>}
        {meta && <span className="music-detail__meta">{meta}</span>}
        <div className="music-detail__actions">
          <Focusable
            focusKey={ENTRY}
            className="music-btn music-btn--primary"
            onPress={() => (playingHere ? toggleAudioPlayPause() : nav.playList(tracks, 0))}
          >
            {playingHere && isAudioPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            <span>{playingHere && isAudioPlaying ? 'Pause' : playingHere ? 'Resume' : 'Play'}</span>
          </Focusable>
          <Focusable focusKey="MUSIC_DETAIL_SHUFFLE" className="music-btn" onPress={() => nav.playList(tracks, 0, true)}>
            <Shuffle size={18} /> <span>Shuffle</span>
          </Focusable>
          {download?.type === 'album' && tracks.length > 0 && (
            <Focusable focusKey="MUSIC_DETAIL_ADD_PL" className="music-btn" onPress={() => openPlaylistPicker(tracks, `${title} (${tracks.length} songs)`)}>
              <ListPlus size={18} /> <span>Add to playlist</span>
            </Focusable>
          )}
          {download && tracks.length > 0 && (
            <CollectionDownloadButton
              id={download.id}
              name={download.name}
              ruleType={download.type}
              items={tracks}
              focusKey="MUSIC_DETAIL_DOWNLOAD"
              className="music-btn music-btn--dl"
            />
          )}
        </div>
      </div>
    </header>
  );
};

const AlbumPage: React.FC<{ id: string; seed?: MusicAlbum; nav: Nav }> = ({ id, seed, nav }) => {
  const info = useAsync(() => (seed ? Promise.resolve(seed) : getAlbum(id)), [id]);
  const tracks = useAsync(() => getAlbumTracks(id), [id]);
  const album = info.data || seed;
  const list = tracks.data || [];
  const more = useAsync(() => (album?.artistId ? getArtistAlbums(album.artistId) : Promise.resolve([])), [album?.artistId]);
  const others = (more.data || []).filter((a) => a.id !== id);
  const artistName = album?.artist || list[0]?.artist || '';
  const artistId = album?.artistId || list[0]?.artistId;
  const multiArtist = new Set(list.map((t) => t.artist)).size > 1;

  return (
    <div className="music-page">
      <DetailHeader
        kind="Album"
        title={album?.name || list[0]?.album || 'Album'}
        cover={album?.coverLarge || list[0]?.posterUrl}
        icon="album"
        subtitle={
          artistId ? (
            <Focusable
              focusKey="MUSIC_DETAIL_ARTIST"
              className="music-link"
              onPress={() => nav.openArtist({ id: artistId, name: artistName, image: '', imageLarge: '', hasImage: false }, 'MUSIC_DETAIL_ARTIST')}
            >
              {artistName}
            </Focusable>
          ) : (
            artistName
          )
        }
        meta={[album?.year, list.length ? `${list.length} songs` : '', list.length ? totalLength(list) : ''].filter(Boolean).join(' · ')}
        tracks={list}
        nav={nav}
        download={{ id, name: album?.name || 'Album', type: 'album' }}
      />
      {tracks.loading && !tracks.data && <p className="music-note">Loading songs…</p>}
      <TrackList tracks={list} ctx={`album_${id}`} showCover={false} useTrackNumbers={!multiArtist} onPlay={(i) => nav.playList(list, i)} />
      <Shelf title={`More by ${artistName}`} hidden={!others.length}>
        {others.map((a) => (
          <AlbumCard key={a.id} album={a} ctx={`more_${id}`} sub="year" onOpen={nav.openAlbum} />
        ))}
      </Shelf>
    </div>
  );
};

const ArtistPage: React.FC<{ id: string; seed?: MusicArtist; nav: Nav }> = ({ id, seed, nav }) => {
  const info = useAsync(() => getArtist(id), [id]);
  const artist = info.data || seed;
  const songs = useAsync(() => getArtistSongs(id), [id]);
  const albums = useAsync(() => getArtistAlbums(id), [id]);
  const list = songs.data || [];
  const [allSongs, setAllSongs] = useState(false);

  return (
    <div className="music-page">
      <DetailHeader
        kind="Artist"
        title={artist?.name || 'Artist'}
        cover={artist?.imageLarge || (albums.data || [])[0]?.coverLarge}
        round
        icon="artist"
        meta={[albums.data ? `${albums.data.length} albums` : '', songs.data ? `${list.length} songs` : ''].filter(Boolean).join(' · ')}
        tracks={list}
        nav={nav}
      />
      {list.length > 0 && (
        <section className="music-shelf">
          <h2 className="music-shelf__title">Popular</h2>
          <TrackList tracks={allSongs ? list : list.slice(0, 10)} ctx={`artist_${id}`} showAlbum onPlay={(i) => nav.playList(list, i)} />
          {!allSongs && list.length > 10 && (
            <Focusable focusKey="MUSIC_ARTIST_ALLSONGS" className="music-more" onPress={() => setAllSongs(true)}>
              See all {list.length} songs
            </Focusable>
          )}
        </section>
      )}
      {(albums.data || []).length > 0 && (
        <section className="music-shelf">
          <h2 className="music-shelf__title">Albums</h2>
          <div className="music-grid">
            {(albums.data || []).map((a) => (
              <AlbumCard key={a.id} album={a} ctx={`artist_${id}`} sub="year" onOpen={nav.openAlbum} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
};

const PlaylistPage: React.FC<{ id: string; seed?: MusicPlaylist; nav: Nav }> = ({ id, seed, nav }) => {
  const version = useSyncExternalStore(subscribePlaylists, getPlaylistsVersion);
  const tracks = useAsync(() => getPlaylistTracks(id), [id, version]);
  const [removing, setRemoving] = useState<string | null>(null);
  const list = tracks.data || [];
  return (
    <div className="music-page">
      <DetailHeader
        kind="Playlist"
        title={seed?.name || 'Playlist'}
        cover={seed?.coverLarge || list[0]?.posterUrl}
        icon="playlist"
        meta={list.length ? `${list.length} songs · ${totalLength(list)}` : ''}
        tracks={list}
        nav={nav}
        download={{ id, name: seed?.name || 'Playlist', type: 'playlist' }}
      />
      {tracks.loading && !tracks.data && <p className="music-note">Loading songs…</p>}
      {!tracks.loading && !list.length && <p className="music-note">This playlist has no songs.</p>}
      <TrackList
        tracks={list}
        ctx={`pl_${id}`}
        showAlbum
        onPlay={(i) => nav.playList(list, i)}
        rowAction={(t) =>
          t.playlistItemId
            ? {
                label: removing === t.playlistItemId ? `Press again to remove “${t.title}”` : `Remove “${t.title}” from this playlist`,
                icon: removing === t.playlistItemId ? <Trash2 size={18} color="#ff6b6b" /> : <ListMinus size={18} />,
                danger: true,
                // press twice: a stray OK never removes a song
                onPress: () => {
                  if (removing !== t.playlistItemId) {
                    setRemoving(t.playlistItemId!);
                    setTimeout(() => setRemoving((r) => (r === t.playlistItemId ? null : r)), 3000);
                    return;
                  }
                  setRemoving(null);
                  removeFromPlaylist(id, [t.playlistItemId!]).catch((e) => alert(e?.message || 'Could not remove the song.'));
                }
              }
            : undefined
        }
      />
    </div>
  );
};

/** Small ✓ (or progress) next to a song that's on this device. */
const DownloadedMark: React.FC<{ id: string }> = ({ id }) => {
  const e = useDownloadEntry(id);
  if (!e) return null;
  if (e.status === 'done') return <CircleCheck size={16} className="music-track__dl" aria-label="Downloaded" />;
  if (e.status === 'error') return null;
  return <Loader2 size={16} className="music-track__dl animate-spin" aria-label="Downloading" />;
};

/** Header: Devices (Yudia Connect) — shows which device plays when another one is chosen. */
const DevicesHeaderButton: React.FC = () => {
  const c = useConnect();
  return (
    <Focusable focusKey="MUSIC_DEVICES" className={`music-btn music-btn--ghost ${c.target ? 'is-connected' : ''}`} onPress={openConnect} label="Play on another device">
      <MonitorSpeaker size={18} /> <span>{c.target ? c.target.name : 'Devices'}</span>
    </Focusable>
  );
};
