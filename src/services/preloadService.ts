/**
 * Pre-loading: while you look at a title (or during the credits, for the next episode), get it ready so
 * pressing Play starts almost instantly.
 *
 *  1. Metadata the player needs before it can start — codecs/tracks, intro/credits markers, content advisory —
 *     is fetched once and cached (the player reads the same cache).
 *  2. The first N seconds of video (default 60 s, Settings → Streaming & Quality) are downloaded into the
 *     browser's HTTP cache, from the resume point for titles in progress. The <video> element then reads them
 *     from the cache (measured: ~0.75 s → ~0.17 s to first frame, cache hits in <150 ms).
 *
 * Step 2 only runs for direct play (original file, byte-range requests are cacheable). Converted streams
 * (quality cap, unsupported audio) are generated live by the server and can't be pre-downloaded.
 */
import { jellyfinClient } from '../api/jellyfin';
import { EpisodeMarkers, fetchEpisodeMarkers } from '../api/introSkipper';
import { ContentAdvisory, fetchContentAdvisory } from '../utils/contentAdvisory';
import { buildVideoStreamUrl, decideStreamMode, pickAudioTrack, readLanguagePrefs } from '../utils/playbackDecision';
import { getDownload, getOfflinePlaybackInfo } from './downloads';

type PlaybackInfo = Awaited<ReturnType<typeof jellyfinClient.getItemPlaybackInfo>>;

const TTL_MS = 10 * 60_000;
const MAX_PRELOAD_BYTES = 150 * 1024 * 1024; // hard cap whatever the bitrate (TV storage / memory)
const TAIL_BYTES = 1024 * 1024;               // container index at the end of some files (MP4 moov, MKV cues)

// ---------------------------------------------------------------- shared metadata cache

const memo = <T>(fetcher: (id: string) => Promise<T>, isUsable: (v: T) => boolean = () => true) => {
  const cache = new Map<string, { at: number; value: Promise<T> }>();
  return (id: string): Promise<T> => {
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const value = fetcher(id)
      .then((v) => {
        if (!isUsable(v)) cache.delete(id); // empty answer from a server hiccup → ask again next time
        return v;
      })
      .catch((err) => {
        cache.delete(id); // don't cache failures
        throw err;
      });
    cache.set(id, { at: Date.now(), value });
    return value;
  };
};

const onlinePlaybackInfo = memo<PlaybackInfo>(
  (id) => jellyfinClient.getItemPlaybackInfo(id),
  (info) => !!info.container || info.audioTracks.length > 0 // the client returns an empty result on errors
);
const onlineMarkers = memo<EpisodeMarkers | null>((id) => fetchEpisodeMarkers(id));
const onlineAdvisory = memo<ContentAdvisory | null>((id) => fetchContentAdvisory(id));

// Downloaded titles answer from what was saved with the download — works with no connection at all.
export const getPlaybackInfoCached = (id: string): Promise<PlaybackInfo> =>
  getDownload(id) ? (getOfflinePlaybackInfo(id) as Promise<PlaybackInfo>) : onlinePlaybackInfo(id);
export const getMarkersCached = (id: string): Promise<EpisodeMarkers | null> => {
  const d = getDownload(id);
  return d && d.markers !== undefined ? Promise.resolve(d.markers) : onlineMarkers(id);
};
export const getAdvisoryCached = (id: string): Promise<ContentAdvisory | null> => {
  const d = getDownload(id);
  return d && d.advisory !== undefined ? Promise.resolve(d.advisory) : onlineAdvisory(id);
};

// ---------------------------------------------------------------- settings

/** Seconds of video to pre-load (0 = off). Settings → Streaming & Quality → "Pre-load before playing". */
export function preloadSeconds(): number {
  try {
    const v = JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}').preloadSeconds;
    return typeof v === 'number' ? v : Number(v ?? 60) || 0;
  } catch {
    return 60;
  }
}

function selectedQualityId(): string {
  try {
    const saved = JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}');
    return saved.maxBitrate || localStorage.getItem('jellyfin_selected_quality') || 'auto';
  } catch {
    return 'auto';
  }
}

// ---------------------------------------------------------------- video pre-download

let current: { itemId: string; ctrl: AbortController } | null = null;

async function downloadRange(url: string, from: number, to: number, signal: AbortSignal): Promise<number> {
  const res = await fetch(url, { headers: { Range: `bytes=${from}-${to}` }, signal });
  if (res.status !== 206 || !res.body) return 0; // server ignored the range → don't pull a whole file
  const reader = res.body.getReader();
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
  }
  return got;
}

export interface PreloadTarget {
  id: string;
  /** 0–100, where playback will resume (0 = from the start). */
  resumePercent?: number;
}

/**
 * Get a title ready. Safe to call repeatedly (same title = no-op); a new title cancels the previous download.
 * Never throws — pre-loading is best effort.
 */
export function preloadMedia(target: PreloadTarget): void {
  const { serverUrl, accessToken, deviceId } = jellyfinClient.getConfig();
  if (!serverUrl || !accessToken || !target.id || target.id.startsWith('demo-')) return;
  if (current?.itemId === target.id) return;
  if (getDownload(target.id)) return; // already on the device
  cancelPreload();

  const ctrl = new AbortController();
  current = { itemId: target.id, ctrl };

  (async () => {
    // 1. metadata (all in parallel, cached for the player)
    const [info] = await Promise.all([
      getPlaybackInfoCached(target.id),
      getMarkersCached(target.id).catch(() => null),
      getAdvisoryCached(target.id).catch(() => null)
    ]);

    // 2. video bytes — only when the player will direct-play this exact URL
    const seconds = preloadSeconds();
    if (!seconds || ctrl.signal.aborted || selectedQualityId() !== 'auto') return;
    const audio = pickAudioTrack(info.audioTracks, readLanguagePrefs().audioLanguage);
    const defaultAudio = info.audioTracks.find((a) => a.isDefault) || info.audioTracks[0];
    const media = { container: info.container, videoCodec: info.videoCodec, mediaSourceId: info.mediaSourceId };
    const mode = decideStreamMode({
      media,
      audioCodec: audio?.codec,
      audioIsDefault: !audio || audio.id === defaultAudio?.id,
      maxBitrate: 0
    });
    if (mode !== 'direct' || !info.size || !info.bitrate) return;

    // Same builder + inputs as VideoPlayer → identical URL → the <video> hits the cache.
    const url = buildVideoStreamUrl({ serverUrl, token: accessToken, deviceId, itemId: target.id, mode, media });
    const bytes = Math.min(MAX_PRELOAD_BYTES, Math.round((info.bitrate / 8) * seconds));
    const resumeAt = Math.max(0, Math.floor((info.size * (target.resumePercent || 0)) / 100) - 2 * 1024 * 1024);
    const end = Math.min(info.size - 1, resumeAt + bytes);

    const got = await downloadRange(url, resumeAt, end, ctrl.signal);
    if (!ctrl.signal.aborted && info.size > TAIL_BYTES * 4) {
      await downloadRange(url, info.size - TAIL_BYTES, info.size - 1, ctrl.signal);
    }
    if (!ctrl.signal.aborted) {
      console.info(`[preload] ${target.id}: ${(got / 1048576).toFixed(0)} MB ready (${seconds}s)`);
    }
  })()
    .catch(() => {})
    .finally(() => {
      if (current?.ctrl === ctrl) current = null;
    });
}

/** Stop the background download (what's already downloaded stays cached). */
export function cancelPreload(): void {
  current?.ctrl.abort();
  current = null;
}
