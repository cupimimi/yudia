import { jellyfinClient } from '../api/jellyfin';
import { MediaItem } from '../mockData';

/**
 * Music library browsing (albums, artists, playlists, songs) straight from Jellyfin, for the Spotify / Apple Music
 * style navigator. Results are kept in memory per server + user so moving between pages is instant.
 */

export interface MusicAlbum {
  id: string;
  name: string;
  artist: string;
  artistId?: string;
  year?: number;
  cover: string; // card size
  coverLarge: string; // header size
  hasCover: boolean;
}

export interface MusicArtist {
  id: string;
  name: string;
  image: string;
  imageLarge: string;
  hasImage: boolean;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  count: number;
  cover: string;
  coverLarge: string;
  hasCover: boolean;
}

const cache = new Map<string, Promise<any>>();

function scope(): string {
  const c = jellyfinClient.getConfig();
  return `${c.serverUrl}|${c.userId}`;
}

function base(): string {
  return (jellyfinClient.getConfig().serverUrl || '').replace(/\/$/, '');
}

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${base()}${path}`, { headers: jellyfinClient.getRequestHeaders() });
  if (!res.ok) throw new Error(`Music request failed (${res.status})`);
  return res.json();
}

/** Cached per server/user; a failed request is not cached so "try again" works. */
function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const k = `${scope()}|${key}`;
  let p = cache.get(k);
  if (!p) {
    p = load().catch((e) => {
      cache.delete(k);
      throw e;
    });
    cache.set(k, p);
  }
  return p as Promise<T>;
}

export function clearMusicCache() {
  cache.clear();
}

const img = (id: string, w: number, tag?: string) => jellyfinClient.getImageUrl(id, 'Primary', w, tag);

function toAlbum(i: any): MusicAlbum {
  const tag = i.ImageTags?.Primary;
  return {
    id: i.Id,
    name: i.Name,
    artist: i.AlbumArtist || i.AlbumArtists?.[0]?.Name || i.Artists?.[0] || '',
    artistId: i.AlbumArtists?.[0]?.Id || i.ArtistItems?.[0]?.Id,
    year: i.ProductionYear,
    cover: tag ? img(i.Id, 360, tag) : '',
    coverLarge: tag ? img(i.Id, 720, tag) : '',
    hasCover: !!tag
  };
}

function toArtist(i: any): MusicArtist {
  const tag = i.ImageTags?.Primary;
  return {
    id: i.Id,
    name: i.Name,
    image: tag ? img(i.Id, 360, tag) : '',
    imageLarge: tag ? img(i.Id, 720, tag) : '',
    hasImage: !!tag
  };
}

function toPlaylist(i: any): MusicPlaylist {
  const tag = i.ImageTags?.Primary;
  return {
    id: i.Id,
    name: i.Name,
    count: i.ChildCount || 0,
    cover: tag ? img(i.Id, 360, tag) : '',
    coverLarge: tag ? img(i.Id, 720, tag) : '',
    hasCover: !!tag
  };
}

const toTracks = (items: any[]): MediaItem[] => items.map((i) => jellyfinClient.mapToMediaItem(i));

const userItems = (query: string) => {
  const { userId } = jellyfinClient.getConfig();
  return getJson(`/Users/${userId}/Items?${query}`).then((d) => d.Items || []);
};

const TRACK_FIELDS = 'Fields=RunTimeTicks,Genres,ProductionYear';

/** Albums: 'recent' = recently added, 'name' = A–Z. */
export function getAlbums(sort: 'recent' | 'name' = 'name', limit = 2000): Promise<MusicAlbum[]> {
  const q =
    sort === 'recent' ? 'SortBy=DateCreated,SortName&SortOrder=Descending' : 'SortBy=SortName&SortOrder=Ascending';
  return cached(`albums:${sort}:${limit}`, () =>
    userItems(`IncludeItemTypes=MusicAlbum&Recursive=true&${q}&Limit=${limit}&Fields=ProductionYear&EnableImageTypes=Primary`).then(
      (items) => items.map(toAlbum)
    )
  );
}

export function getArtists(limit = 2000): Promise<MusicArtist[]> {
  const { userId } = jellyfinClient.getConfig();
  return cached(`artists:${limit}`, () =>
    getJson(`/Artists/AlbumArtists?userId=${userId}&SortBy=SortName&SortOrder=Ascending&Limit=${limit}&Fields=PrimaryImageAspectRatio`).then(
      (d) => (d.Items || []).map(toArtist)
    )
  );
}

/** Only playlists that hold music. */
export function getPlaylists(): Promise<MusicPlaylist[]> {
  return cached('playlists', () =>
    userItems('IncludeItemTypes=Playlist&Recursive=true&SortBy=SortName&Fields=ChildCount,MediaType').then((items) =>
      items.filter((i: any) => !i.MediaType || i.MediaType === 'Audio').map(toPlaylist)
    )
  );
}

export function getSongs(limit = 1000): Promise<MediaItem[]> {
  return cached(`songs:${limit}`, () =>
    userItems(`IncludeItemTypes=Audio&Recursive=true&SortBy=SortName&SortOrder=Ascending&Limit=${limit}&${TRACK_FIELDS}`).then(toTracks)
  );
}

/** Most played songs (Jellyfin play counts) — the "On repeat" shelf. */
export function getMostPlayed(limit = 12): Promise<MediaItem[]> {
  return cached(`mostplayed:${limit}`, () =>
    userItems(
      `IncludeItemTypes=Audio&Recursive=true&Filters=IsPlayed&SortBy=PlayCount,DatePlayed&SortOrder=Descending&Limit=${limit}&${TRACK_FIELDS}`
    ).then(toTracks)
  );
}

/** Albums of recently played songs (most recent first), for "Jump back in". Not cached: changes as you listen. */
export async function getRecentlyPlayedAlbums(limit = 8): Promise<MusicAlbum[]> {
  const tracks = await userItems(
    `IncludeItemTypes=Audio&Recursive=true&Filters=IsPlayed&SortBy=DatePlayed&SortOrder=Descending&Limit=60&Fields=ProductionYear`
  );
  const seen = new Set<string>();
  const out: MusicAlbum[] = [];
  for (const t of tracks) {
    if (!t.AlbumId || seen.has(t.AlbumId)) continue;
    seen.add(t.AlbumId);
    out.push({
      id: t.AlbumId,
      name: t.Album || t.Name,
      artist: t.AlbumArtist || t.Artists?.[0] || '',
      artistId: t.AlbumArtists?.[0]?.Id,
      year: t.ProductionYear,
      cover: t.AlbumPrimaryImageTag ? img(t.AlbumId, 360, t.AlbumPrimaryImageTag) : '',
      coverLarge: t.AlbumPrimaryImageTag ? img(t.AlbumId, 720, t.AlbumPrimaryImageTag) : '',
      hasCover: !!t.AlbumPrimaryImageTag
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function getAlbumTracks(albumId: string): Promise<MediaItem[]> {
  return cached(`album:${albumId}`, () =>
    userItems(`ParentId=${albumId}&IncludeItemTypes=Audio&Recursive=true&SortBy=ParentIndexNumber,IndexNumber,SortName&${TRACK_FIELDS}`).then(
      toTracks
    )
  );
}

export function getAlbum(albumId: string): Promise<MusicAlbum | null> {
  const { userId } = jellyfinClient.getConfig();
  return cached(`albuminfo:${albumId}`, () => getJson(`/Users/${userId}/Items/${albumId}`).then(toAlbum)).catch(() => null);
}

export function getArtist(artistId: string): Promise<MusicArtist | null> {
  const { userId } = jellyfinClient.getConfig();
  return cached(`artistinfo:${artistId}`, () => getJson(`/Users/${userId}/Items/${artistId}`).then(toArtist)).catch(() => null);
}

export function getArtistAlbums(artistId: string): Promise<MusicAlbum[]> {
  return cached(`artistalbums:${artistId}`, () =>
    userItems(
      `IncludeItemTypes=MusicAlbum&Recursive=true&AlbumArtistIds=${artistId}&SortBy=ProductionYear,SortName&SortOrder=Descending&Fields=ProductionYear`
    ).then((items) => items.map(toAlbum))
  );
}

/** An artist's songs, most played first (their "Popular" list). */
export function getArtistSongs(artistId: string, limit = 200): Promise<MediaItem[]> {
  return cached(`artistsongs:${artistId}:${limit}`, () =>
    userItems(
      `IncludeItemTypes=Audio&Recursive=true&ArtistIds=${artistId}&SortBy=PlayCount,SortName&SortOrder=Descending&Limit=${limit}&${TRACK_FIELDS}`
    ).then(toTracks)
  );
}

export function getPlaylistTracks(playlistId: string): Promise<MediaItem[]> {
  const { userId } = jellyfinClient.getConfig();
  return cached(`playlist:${playlistId}`, () =>
    getJson(`/Playlists/${playlistId}/Items?userId=${userId}&${TRACK_FIELDS}`).then((d) =>
      (d.Items || [])
        .filter((i: any) => i.Type === 'Audio')
        // keep the playlist entry id: needed to remove this song from the playlist
        .map((i: any) => ({ ...jellyfinClient.mapToMediaItem(i), playlistItemId: i.PlaylistItemId }))
    )
  );
}

// ---------------------------------------------------------------- editing playlists

let changeVersion = 0;
const changeListeners = new Set<() => void>();
/** Bumps whenever a playlist is created / changed here, so open pages reload it. */
export const getPlaylistsVersion = () => changeVersion;
export function subscribePlaylists(fn: () => void) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}
function playlistsChanged(playlistId?: string) {
  const sc = scope();
  [...cache.keys()].forEach((key) => {
    if (key === `${sc}|playlists` || (playlistId && key === `${sc}|playlist:${playlistId}`)) cache.delete(key);
  });
  changeVersion++;
  changeListeners.forEach((l) => l());
}

async function send(method: 'POST' | 'DELETE', path: string, body?: unknown) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: jellyfinClient.getRequestHeaders(body ? { 'Content-Type': 'application/json' } : {}),
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401 || res.status === 403) throw new Error("Your account isn't allowed to change playlists on this server.");
  if (!res.ok) throw new Error(`The server answered ${res.status}`);
  return res;
}

/** Add songs to an existing playlist. */
export async function addToPlaylist(playlistId: string, ids: string[]) {
  const { userId } = jellyfinClient.getConfig();
  await send('POST', `/Playlists/${playlistId}/Items?ids=${ids.join(',')}&userId=${userId}`);
  playlistsChanged(playlistId);
}

/** New music playlist (optionally with songs already in it). Returns its id. */
export async function createPlaylist(name: string, ids: string[] = []): Promise<string> {
  const { userId } = jellyfinClient.getConfig();
  const res = await send('POST', '/Playlists', { Name: name, Ids: ids, UserId: userId, MediaType: 'Audio' });
  const data = await res.json().catch(() => ({}));
  playlistsChanged();
  return data.Id || '';
}

/** Remove songs from a playlist (entry ids from getPlaylistTracks → playlistItemId). */
export async function removeFromPlaylist(playlistId: string, entryIds: string[]) {
  await send('DELETE', `/Playlists/${playlistId}/Items?entryIds=${entryIds.join(',')}`);
  playlistsChanged(playlistId);
}

/** "3 h 12 min" / "42 min" for a list of songs. */
export function totalLength(tracks: MediaItem[]): string {
  const secs = tracks.reduce((s, t) => s + (t.runTimeTicks ? t.runTimeTicks / 1e7 : 0), 0);
  const mins = Math.round(secs / 60);
  if (mins >= 60) return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  return `${mins} min`;
}
