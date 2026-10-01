/**
 * Offline downloads (website on phones / laptops — not on the TV, which has little storage and is always home).
 *
 * Files live in the browser's Cache Storage (persistent, survives restarts, streamed straight to disk while
 * downloading). Next to each file we keep what the players normally ask the server for — tracks, subtitles,
 * intro/credits markers, age rating, lyrics, pictures — so a download plays exactly like the online title with no
 * connection at all.
 *
 *  • Videos: "Original" = the untouched file when this device can play it (best quality, largest), otherwise the
 *    server converts to H.264 + AAC stereo MP4 at the chosen size (1080p / 720p / 480p) — plays on every phone.
 *  • Songs: the original file when this device can play its format, otherwise MP3 320 kbit/s.
 *  • One download at a time (the server may be converting — kind to a small home server).
 *
 * Auto-downloads (rules):
 *  • Series: keep the next N unwatched episodes downloaded; watched ones are removed (optional).
 *  • Playlist / album: keep every song downloaded, new songs included.
 * Rules run at start-up, every 30 min, when the connection comes back and after an episode ends.
 *
 * Watch progress made offline is queued and sent to the server when it's reachable again.
 */
import { jellyfinClient } from '../api/jellyfin';
import { fetchEpisodeMarkers, EpisodeMarkers } from '../api/introSkipper';
import { fetchContentAdvisory, ContentAdvisory } from '../utils/contentAdvisory';
import { MediaItem, SubtitleTrack, AudioTrack } from '../mockData';
import { isTizen } from '../theme/performance';
import { canPlayAudio, pickAudioTrack, readLanguagePrefs } from '../utils/playbackDecision';

// ------------------------------------------------------------------------------------------------ types

export type DownloadKind = 'movie' | 'episode' | 'song';
export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'error';

export interface DownloadEntry {
  id: string;
  kind: DownloadKind;
  item: MediaItem; // snapshot (for listing and offline playback)
  status: DownloadStatus;
  bytes: number;
  totalBytes: number; // estimate while downloading (0 = unknown)
  error?: string;
  quality: string; // what was downloaded: 'original' | '1080p' | '720p' | '480p' | 'mp3' | 'original-audio'
  addedAt: number;
  finishedAt?: number;
  /** Set when an auto-download rule added it (series / playlist / album id). */
  ruleId?: string;
  watched?: boolean;
  // offline metadata
  container?: string;
  videoCodec?: string;
  audioTracks?: AudioTrack[];
  subtitles?: { track: SubtitleTrack; stored: boolean }[];
  markers?: EpisodeMarkers | null;
  advisory?: ContentAdvisory | null;
  lyrics?: { lines: { time: number; text: string }[]; synced: boolean };
  hasPoster?: boolean;
  hasBackdrop?: boolean;
  hasSeriesPoster?: boolean;
}

export interface AutoRule {
  id: string; // series / playlist / album id
  type: 'series' | 'playlist' | 'album';
  name: string;
  /** Series: how many upcoming episodes to keep. */
  keep?: number;
  createdAt: number;
  lastRun?: number;
}

export interface DownloadSettings {
  quality: 'original' | '1080p' | '720p' | '480p';
  wifiOnly: boolean; // auto-downloads only (manual ones always start)
  keepEpisodes: number; // default for new series rules
  deleteWatched: boolean;
}

const QUALITIES: Record<string, { maxHeight: number; bitrate: number }> = {
  '1080p': { maxHeight: 1080, bitrate: 8_000_000 },
  '720p': { maxHeight: 720, bitrate: 3_500_000 },
  '480p': { maxHeight: 480, bitrate: 1_500_000 }
};

const MEDIA_CACHE = 'yudia-offline-media-v1';
const META_KEY = '/__yudia/offline/index.json';
const k = {
  media: (id: string) => `/__yudia/offline/media/${id}`,
  img: (id: string, kind: string) => `/__yudia/offline/img/${id}/${kind}`,
  sub: (id: string, index: number) => `/__yudia/offline/sub/${id}/${index}.vtt`
};

// ------------------------------------------------------------------------------------------------ support

/** Downloads work where the browser offers Cache Storage (https websites). Never on the TV. */
export const downloadsSupported = (): boolean =>
  typeof window !== 'undefined' && 'caches' in window && !isTizen() && window.isSecureContext !== false;

export function readDownloadSettings(): DownloadSettings {
  try {
    const s = JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}');
    return {
      quality: ['original', '1080p', '720p', '480p'].includes(s.downloadQuality) ? s.downloadQuality : '720p',
      wifiOnly: s.downloadWifiOnly !== false,
      keepEpisodes: [1, 2, 3, 5].includes(Number(s.downloadKeepEpisodes)) ? Number(s.downloadKeepEpisodes) : 2,
      deleteWatched: s.downloadDeleteWatched !== false
    };
  } catch {
    return { quality: '720p', wifiOnly: true, keepEpisodes: 2, deleteWatched: true };
  }
}

// ------------------------------------------------------------------------------------------------ state

let entries = new Map<string, DownloadEntry>();
let rules = new Map<string, AutoRule>();
/** Episodes finished on this device (maybe offline, before the server knows): never re-downloaded by a rule. */
let finishedHere = new Set<string>();
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
let version = 0;

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export const getVersion = () => version;

let emitTimer: ReturnType<typeof setTimeout> | null = null;
function emit(now = false) {
  const fire = () => {
    emitTimer = null;
    version++;
    listeners.forEach((l) => l());
  };
  if (now) {
    if (emitTimer) clearTimeout(emitTimer);
    fire();
  } else if (!emitTimer) {
    emitTimer = setTimeout(fire, 250); // progress updates: at most 4 per second
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const body = JSON.stringify({ entries: [...entries.values()], rules: [...rules.values()], finished: [...finishedHere].slice(-500) });
      await cache.put(META_KEY, new Response(body, { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) {
      console.warn('[downloads] could not save the list', e);
    }
  }, 400);
}

/** Load the saved list once (call early; everything else waits for it). */
export function initDownloads(): Promise<void> {
  if (!downloadsSupported()) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      const cache = await caches.open(MEDIA_CACHE);
      const res = await cache.match(META_KEY);
      if (res) {
        const data = await res.json();
        entries = new Map((data.entries || []).map((e: DownloadEntry) => [e.id, e]));
        rules = new Map((data.rules || []).map((r: AutoRule) => [r.id, r]));
        finishedHere = new Set(data.finished || []);
      }
    } catch (e) {
      console.warn('[downloads] could not read the list', e);
    }
    // A download cut short by closing the app starts again from the beginning.
    entries.forEach((e) => {
      if (e.status === 'downloading') e.status = 'queued';
      if (e.status === 'error' && /fetch|network/i.test(e.error || '')) {
        e.status = 'queued';
        e.error = undefined;
      }
    });
    loaded = true;
    emit(true);
    try {
      await (navigator.storage as any)?.persist?.(); // ask the browser not to clear downloads when space runs low
    } catch {}
    pump();
    window.addEventListener('online', () => {
      pausedUntil = 0;
      flushPendingProgress();
      pump();
      runAutoDownloads();
    });
    setInterval(() => runAutoDownloads(), 30 * 60_000);
  })();
  return loading;
}

export const isLoaded = () => loaded;
export const listDownloads = (): DownloadEntry[] => [...entries.values()].sort((a, b) => b.addedAt - a.addedAt);
export const getEntry = (id: string): DownloadEntry | undefined => entries.get(id);
/** Finished download for this item (what the players use). */
export const getDownload = (id: string): DownloadEntry | undefined => {
  const e = entries.get(id);
  return e && e.status === 'done' ? e : undefined;
};
export const hasAnyDownload = () => [...entries.values()].some((e) => e.status === 'done');
export const listRules = (): AutoRule[] => [...rules.values()];
export const getRule = (id: string) => rules.get(id);

// ------------------------------------------------------------------------------------------------ offline URLs

const objectUrls = new Map<string, string>();

async function cachedObjectUrl(key: string): Promise<string | null> {
  const hit = objectUrls.get(key);
  if (hit) return hit;
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const res = await cache.match(key);
    if (!res) return null;
    const url = URL.createObjectURL(await res.blob());
    objectUrls.set(key, url);
    return url;
  } catch {
    return null;
  }
}

function revokeFor(id: string) {
  [...objectUrls.keys()]
    .filter((key) => key.includes(`/${id}`))
    .forEach((key) => {
      URL.revokeObjectURL(objectUrls.get(key)!);
      objectUrls.delete(key);
    });
}

/** Local address of a downloaded file, for <video> / <audio>. */
export const getOfflineMediaUrl = (id: string) => (getDownload(id) ? cachedObjectUrl(k.media(id)) : Promise.resolve(null));
/** 'poster' | 'backdrop' | 'series' */
export const getOfflineImageUrl = (id: string, kind: 'poster' | 'backdrop' | 'series') => cachedObjectUrl(k.img(id, kind));

/**
 * Player metadata for a downloaded title — same shape as jellyfinClient.getItemPlaybackInfo(), with subtitles
 * pointing to the stored files. null when not downloaded.
 */
export async function getOfflinePlaybackInfo(id: string) {
  const e = getDownload(id);
  if (!e) return null;
  const subtitleTracks: SubtitleTrack[] = [];
  for (const s of e.subtitles || []) {
    if (!s.stored) continue;
    const url = await cachedObjectUrl(k.sub(id, s.track.index));
    if (url) subtitleTracks.push({ ...s.track, url });
  }
  return {
    subtitleTracks,
    audioTracks: e.audioTracks || [],
    chapters: e.item.chapters,
    tags: e.item.tags,
    runTimeTicks: e.item.runTimeTicks,
    container: e.container || 'mp4',
    videoCodec: e.videoCodec || 'h264',
    mediaSourceId: undefined as string | undefined,
    size: e.bytes,
    bitrate: undefined as number | undefined
  };
}

// ------------------------------------------------------------------------------------------------ public actions

/** Add a title to the downloads (no-op if already there). Manual downloads always start (even on mobile data). */
export async function downloadItem(item: MediaItem, opts: { ruleId?: string } = {}): Promise<void> {
  if (!downloadsSupported()) return;
  await initDownloads();
  const existing = entries.get(item.id);
  if (existing && existing.status !== 'error') return;
  const kind: DownloadKind = item.type === 'music' ? 'song' : item.type === 'tv' ? 'episode' : 'movie';
  entries.set(item.id, {
    id: item.id,
    kind,
    item: { ...item, videoUrl: undefined, audioUrl: undefined },
    status: 'queued',
    bytes: 0,
    totalBytes: 0,
    quality: '',
    addedAt: Date.now(),
    ruleId: opts.ruleId ?? existing?.ruleId
  });
  persist();
  emit(true);
  pump();
}

export async function downloadMany(items: MediaItem[], opts: { ruleId?: string } = {}) {
  for (const it of items) await downloadItem(it, opts);
}

/** Remove a download (or cancel it while queued / downloading). */
export async function removeDownload(id: string): Promise<void> {
  if (active?.id === id) active.ctrl.abort();
  entries.delete(id);
  revokeFor(id);
  persist();
  emit(true);
  try {
    const cache = await caches.open(MEDIA_CACHE);
    const keys = await cache.keys();
    await Promise.all(keys.filter((r) => new URL(r.url).pathname.includes(`/${id}`)).map((r) => cache.delete(r)));
  } catch {}
}

export async function removeAllDownloads(): Promise<void> {
  if (active) active.ctrl.abort();
  entries.clear();
  rules.clear();
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls.clear();
  emit(true);
  try {
    await caches.delete(MEDIA_CACHE);
  } catch {}
  persist();
}

export function retryDownload(id: string) {
  const e = entries.get(id);
  if (!e) return;
  e.status = 'queued';
  e.error = undefined;
  e.bytes = 0;
  persist();
  emit(true);
  pump();
}

export async function storageEstimate(): Promise<{ used: number; quota: number; downloads: number }> {
  const downloadsBytes = [...entries.values()].reduce((s, e) => s + (e.status === 'done' ? e.bytes : 0), 0);
  try {
    const est = await navigator.storage.estimate();
    return { used: est.usage || 0, quota: est.quota || 0, downloads: downloadsBytes };
  } catch {
    return { used: downloadsBytes, quota: 0, downloads: downloadsBytes };
  }
}

// ------------------------------------------------------------------------------------------------ the queue

let active: { id: string; ctrl: AbortController } | null = null;
/** Server unreachable: the queue waits (instead of failing every download) and retries in a minute. */
let pausedUntil = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

function pump() {
  if (!loaded || active) return;
  if (Date.now() < pausedUntil) return;
  const next = [...entries.values()].filter((e) => e.status === 'queued').sort((a, b) => a.addedAt - b.addedAt)[0];
  if (!next) return;
  const ctrl = new AbortController();
  active = { id: next.id, ctrl };
  next.status = 'downloading';
  next.bytes = 0;
  emit(true);
  runDownload(next, ctrl.signal)
    .then(() => {
      next.status = 'done';
      next.finishedAt = Date.now();
    })
    .catch((err) => {
      if (!entries.has(next.id)) return; // removed while downloading
      if (ctrl.signal.aborted) return;
      // No connection / server unreachable (fetch itself failed): back in the queue, the queue pauses
      const unreachable = navigator.onLine === false || err instanceof TypeError;
      if (unreachable) {
        next.status = 'queued';
        next.error = navigator.onLine === false ? 'No connection — continues when you are back online' : 'Waiting for your server…';
        pausedUntil = Date.now() + 60_000;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = setTimeout(() => {
          pausedUntil = 0;
          pump();
        }, 60_000);
      } else {
        next.status = 'error';
        next.error = String(err?.message || err);
      }
    })
    .finally(() => {
      active = null;
      if (next.status === 'done') next.error = undefined;
      persist();
      emit(true);
      if (Date.now() >= pausedUntil) setTimeout(pump, 300);
    });
}

function base() {
  return (jellyfinClient.getConfig().serverUrl || '').replace(/\/$/, '');
}

async function fetchToCache(url: string, key: string, signal: AbortSignal, onBytes?: (got: number, total: number) => void) {
  const res = await fetch(url, { signal, headers: jellyfinClient.getRequestHeaders() });
  if (!res.ok || !res.body) throw new Error(`Server answered ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;
  let got = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      got += chunk.byteLength;
      onBytes?.(got, total);
      ctrl.enqueue(chunk);
    }
  });
  const cache = await caches.open(MEDIA_CACHE);
  await cache.put(
    key,
    new Response(res.body.pipeThrough(counter), {
      headers: { 'Content-Type': res.headers.get('content-type') || 'application/octet-stream' }
    })
  );
  return got;
}

async function storeSmall(url: string, key: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { signal, headers: jellyfinClient.getRequestHeaders() });
    if (!res.ok) return false;
    const blob = await res.blob();
    if (blob.size < 20) return false;
    const cache = await caches.open(MEDIA_CACHE);
    await cache.put(key, new Response(blob, { headers: { 'Content-Type': res.headers.get('content-type') || blob.type } }));
    return true;
  } catch {
    return false;
  }
}

const AUDIO_MIME: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/mp4',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg; codecs="opus"',
  webm: 'audio/webm',
  wav: 'audio/wav'
};

async function runDownload(e: DownloadEntry, signal: AbortSignal) {
  const { accessToken, deviceId } = jellyfinClient.getConfig();
  const server = base();
  if (!server || !accessToken) throw new Error('Not signed in');
  const info = await jellyfinClient.getItemPlaybackInfo(e.id);
  const seconds = (info.runTimeTicks || e.item.runTimeTicks || 0) / 1e7;
  const progress = (got: number, total: number) => {
    e.bytes = got;
    if (total) e.totalBytes = total;
    emit();
  };

  // ---- pictures (small, first: the Downloads page shows them right away)
  const imgs: Promise<void>[] = [];
  const img = (id: string, type: 'Primary' | 'Backdrop', w: number, kind: string, flag: 'hasPoster' | 'hasBackdrop' | 'hasSeriesPoster') =>
    imgs.push(
      storeSmall(jellyfinClient.getImageUrl(id, type, w), k.img(e.id, kind), signal).then((ok) => {
        e[flag] = ok;
      })
    );
  if (e.kind === 'song') {
    const src = e.item.posterUrl?.match(/\/Items\/([^/]+)\/Images/)?.[1] || e.item.albumId || e.id;
    img(src, 'Primary', 400, 'poster', 'hasPoster');
  } else {
    img(e.id, 'Primary', e.kind === 'episode' ? 480 : 400, 'poster', 'hasPoster');
    img(e.kind === 'episode' && e.item.seriesId ? e.item.seriesId : e.id, 'Backdrop', 1280, 'backdrop', 'hasBackdrop');
    if (e.kind === 'episode' && e.item.seriesId) img(e.item.seriesId, 'Primary', 400, 'series', 'hasSeriesPoster');
  }
  await Promise.all(imgs);

  if (e.kind === 'song') {
    // ---- music: original when this device plays the format, else MP3 320
    const container = (info.container || '').split(',')[0].toLowerCase();
    const mime = AUDIO_MIME[container];
    let playable = false;
    try {
      playable = !!mime && document.createElement('audio').canPlayType(mime) !== '';
    } catch {}
    const url = playable
      ? `${server}/Audio/${e.id}/stream?static=true&ApiKey=${accessToken}`
      : `${server}/Audio/${e.id}/stream.mp3?static=false&audioCodec=mp3&audioBitRate=320000&maxAudioChannels=2&ApiKey=${accessToken}&DeviceId=${encodeURIComponent(deviceId || '')}`;
    e.quality = playable ? 'original-audio' : 'mp3';
    e.totalBytes = playable ? info.size || 0 : Math.round(seconds * 40_000);
    await fetchToCache(url, k.media(e.id), signal, progress);
    try {
      e.lyrics = await jellyfinClient.getLyrics(e.id, signal);
    } catch {}
    return;
  }

  // ---- video
  const settings = readDownloadSettings();
  const prefs = readLanguagePrefs();
  const audio = pickAudioTrack(info.audioTracks, prefs.audioLanguage);
  const defaultAudio = info.audioTracks.find((a) => a.isDefault) || info.audioTracks[0];
  const canDirect =
    settings.quality === 'original' &&
    /mp4|m4v|mov|webm/.test((info.container || '').toLowerCase()) &&
    /h264|avc|vp9|av1/.test((info.videoCodec || '').toLowerCase()) &&
    canPlayAudio(defaultAudio?.codec) &&
    (!audio || audio.id === defaultAudio?.id);

  let url: string;
  if (canDirect) {
    url = `${server}/Videos/${e.id}/stream?static=true&ApiKey=${accessToken}${info.mediaSourceId ? `&MediaSourceId=${info.mediaSourceId}` : ''}`;
    e.quality = 'original';
    e.container = info.container;
    e.videoCodec = info.videoCodec;
    e.audioTracks = info.audioTracks;
    e.totalBytes = info.size || 0;
  } else {
    const q = QUALITIES[settings.quality] || QUALITIES['1080p'];
    const p = new URLSearchParams({
      ApiKey: accessToken,
      static: 'false',
      container: 'mp4',
      VideoCodec: 'h264',
      AudioCodec: 'aac',
      videoBitRate: String(q.bitrate),
      maxHeight: String(q.maxHeight),
      audioBitRate: '192000',
      TranscodingMaxAudioChannels: '2',
      allowVideoStreamCopy: 'true',
      allowAudioStreamCopy: 'false',
      DeviceId: deviceId || '',
      PlaySessionId: `dl-${e.id}-${Date.now()}`
    });
    if (info.mediaSourceId) p.set('MediaSourceId', info.mediaSourceId);
    if (audio) p.set('AudioStreamIndex', String(audio.index));
    url = `${server}/Videos/${e.id}/stream.mp4?${p.toString()}`;
    e.quality = settings.quality === 'original' ? '1080p' : settings.quality;
    e.container = 'mp4';
    e.videoCodec = 'h264';
    e.audioTracks = [
      { id: 'aud-0', index: 0, language: audio?.language || 'und', displayTitle: audio?.displayTitle || 'Audio', codec: 'aac', isDefault: true }
    ];
    e.totalBytes = Math.round(seconds * (q.bitrate + 192_000) / 8);
  }

  // Subtitles + markers + age rating (small; a failure here never fails the download)
  e.subtitles = [];
  for (const t of info.subtitleTracks) {
    const ok = await storeSmall(
      `${server}/Videos/${e.id}/${info.mediaSourceId || e.id}/Subtitles/${t.index}/0/Stream.vtt?ApiKey=${accessToken}`,
      k.sub(e.id, t.index),
      signal
    );
    e.subtitles.push({ track: { ...t, url: undefined }, stored: ok });
  }
  try {
    e.markers = e.kind === 'episode' ? await fetchEpisodeMarkers(e.id) : null;
  } catch {}
  try {
    e.advisory = await fetchContentAdvisory(e.id);
  } catch {}
  if (info.chapters) e.item = { ...e.item, chapters: info.chapters, runTimeTicks: info.runTimeTicks || e.item.runTimeTicks };

  await fetchToCache(url, k.media(e.id), signal, progress);
}

// ------------------------------------------------------------------------------------------------ auto-downloads

export function setRule(rule: Omit<AutoRule, 'createdAt'> | null, id?: string) {
  if (!rule) {
    if (id) rules.delete(id);
  } else {
    rules.set(rule.id, { ...rule, createdAt: rules.get(rule.id)?.createdAt || Date.now() });
  }
  persist();
  emit(true);
  if (rule) runAutoDownloads([rule.id]);
}

const onMobileData = () => {
  const c = (navigator as any).connection;
  return !!c && (c.type === 'cellular' || c.saveData === true);
};

let autoRunning = false;
/** Bring every rule (or the given ones) up to date. Safe to call often. */
/** The server is reachable again (library loaded): resume a paused queue right away. */
export function resumeQueue() {
  pausedUntil = 0;
  pump();
}

export async function runAutoDownloads(only?: string[]) {
  resumeQueue();
  if (!downloadsSupported() || autoRunning || navigator.onLine === false) return;
  await initDownloads();
  if (!jellyfinClient.getConfig().accessToken) return;
  if (readDownloadSettings().wifiOnly && onMobileData()) return;
  autoRunning = true;
  try {
    for (const rule of rules.values()) {
      if (only && !only.includes(rule.id)) continue;
      try {
        if (rule.type === 'series') await syncSeries(rule);
        else await syncTracks(rule);
        rule.lastRun = Date.now();
      } catch (e) {
        console.warn('[downloads] auto-download failed for', rule.name, e);
      }
    }
    persist();
  } finally {
    autoRunning = false;
  }
}

async function userItems(query: string): Promise<any[]> {
  const { userId } = jellyfinClient.getConfig();
  const res = await fetch(`${base()}/Users/${userId}/Items?${query}`, { headers: jellyfinClient.getRequestHeaders() });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  return (await res.json()).Items || [];
}

async function syncSeries(rule: AutoRule) {
  const { userId } = jellyfinClient.getConfig();
  const res = await fetch(
    `${base()}/Shows/${rule.id}/Episodes?userId=${userId}&Fields=Overview,UserData,RunTimeTicks,Chapters&IsMissing=false`,
    { headers: jellyfinClient.getRequestHeaders() }
  );
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  const episodes: any[] = ((await res.json()).Items || []).filter((ep: any) => ep.LocationType !== 'Virtual');
  const keep = rule.keep || readDownloadSettings().keepEpisodes;
  const settings = readDownloadSettings();

  // Start after the last watched episode; take the next `keep` unwatched ones.
  let lastWatched = -1;
  const played = (ep: any) => !!ep.UserData?.Played || finishedHere.has(ep.Id);
  episodes.forEach((ep, i) => {
    if (played(ep)) lastWatched = i;
  });
  const wanted = episodes.slice(lastWatched + 1).filter((ep) => !played(ep)).slice(0, keep);
  const wantedIds = new Set(wanted.map((ep) => ep.Id));

  // Remove watched episodes this rule downloaded
  if (settings.deleteWatched) {
    for (const ep of episodes) {
      const e = entries.get(ep.Id);
      if (e && e.ruleId === rule.id && played(ep) && !wantedIds.has(ep.Id)) await removeDownload(ep.Id);
    }
  }
  for (const ep of wanted) {
    if (!entries.has(ep.Id)) await downloadItem(jellyfinClient.mapToMediaItem(ep), { ruleId: rule.id });
  }
}

async function syncTracks(rule: AutoRule) {
  let items: any[];
  if (rule.type === 'playlist') {
    const { userId } = jellyfinClient.getConfig();
    const res = await fetch(`${base()}/Playlists/${rule.id}/Items?userId=${userId}&Fields=RunTimeTicks`, {
      headers: jellyfinClient.getRequestHeaders()
    });
    if (!res.ok) throw new Error(`Server answered ${res.status}`);
    items = ((await res.json()).Items || []).filter((i: any) => i.Type === 'Audio');
  } else {
    items = await userItems(`ParentId=${rule.id}&IncludeItemTypes=Audio&Recursive=true&SortBy=ParentIndexNumber,IndexNumber&Fields=RunTimeTicks`);
  }
  const ids = new Set(items.map((i) => i.Id));
  // Songs removed from the playlist go away too (only the ones this rule added)
  for (const e of [...entries.values()]) {
    if (e.ruleId === rule.id && !ids.has(e.id)) await removeDownload(e.id);
  }
  for (const i of items) {
    if (!entries.has(i.Id)) await downloadItem(jellyfinClient.mapToMediaItem(i), { ruleId: rule.id });
  }
}

/** Called when an episode is finished (≥ 90 %): mark it, drop it if the rule says so, fetch the next ones. */
export function onEpisodeFinished(id: string, seriesId?: string) {
  finishedHere.add(id);
  persist();
  const e = entries.get(id);
  if (e) {
    e.watched = true;
    persist();
  }
  const rule = seriesId ? rules.get(seriesId) : undefined;
  if (rule) {
    if (e && e.ruleId === rule.id && readDownloadSettings().deleteWatched) {
      // keep it until the viewer has left the player; removed on the next rule run
      setTimeout(() => removeDownload(id), 5000);
    }
    setTimeout(() => runAutoDownloads([rule.id]), 6000);
  }
  emit(true);
}

/** Next downloaded episode of the same series (offline "Next episode"). */
export function nextDownloadedEpisode(seriesId: string | undefined, season: number, episode: number): DownloadEntry | undefined {
  if (!seriesId) return undefined;
  return [...entries.values()]
    .filter((e) => e.status === 'done' && e.kind === 'episode' && e.item.seriesId === seriesId)
    .filter((e) => {
      const s = e.item.seasonNumber || 0;
      const n = e.item.episodeNumber || 0;
      return s > season || (s === season && n > episode);
    })
    .sort((a, b) => (a.item.seasonNumber || 0) - (b.item.seasonNumber || 0) || (a.item.episodeNumber || 0) - (b.item.episodeNumber || 0))[0];
}

// ------------------------------------------------------------------------------------------------ offline progress

const PENDING_KEY = 'yudia_pending_progress';

/** Remember a stop position that couldn't reach the server (sent later by flushPendingProgress). */
export function queueProgress(itemId: string, positionTicks: number, at = Date.now()) {
  try {
    const all = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    // Reports fail in any order: keep the one that was MADE last, not the one that failed last
    if (all[itemId] && all[itemId].at > at) return;
    all[itemId] = { positionTicks, at };
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } catch {}
}

let flushing = false;
export async function flushPendingProgress() {
  if (flushing || navigator.onLine === false) return;
  let all: Record<string, { positionTicks: number }>;
  try {
    all = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
  } catch {
    return;
  }
  const ids = Object.keys(all);
  if (!ids.length || !jellyfinClient.getConfig().accessToken) return;
  flushing = true;
  try {
    for (const id of ids) {
      const body = JSON.stringify({ ItemId: id, PositionTicks: all[id].positionTicks });
      const headers = jellyfinClient.getRequestHeaders({ 'Content-Type': 'application/json' });
      try {
        await fetch(`${base()}/Sessions/Playing`, { method: 'POST', headers, body });
        const res = await fetch(`${base()}/Sessions/Playing/Stopped`, { method: 'POST', headers, body });
        if (res.ok) delete all[id];
      } catch {
        break; // still offline
      }
    }
    localStorage.setItem(PENDING_KEY, JSON.stringify(all));
  } finally {
    flushing = false;
  }
}
