/**
 * Google Cast (Chromecast / Google TV / Android TV / Nest Hub) — website only.
 *
 * Loads Google's Cast sender library only on the website build, never on the TV app, and only in browsers that
 * can cast (Chrome, Edge, Android Chrome). The Cast button stays hidden until a device is found on the network.
 * Uses Google's Default Media Receiver: the Cast device plays the stream straight from the Jellyfin server
 * (the URLs carry the sign-in token, like the app's own player).
 *
 *  • Video: the original file when the Cast device can play it (MP4/WebM with H.264/VP9 + AAC/MP3/Opus),
 *    otherwise Jellyfin converts it to HLS (H.264 + AAC stereo, seekable). Text subtitles are sent along.
 *  • Music: the original file (FLAC, MP3, AAC, Opus…) or MP3 320 when the format isn't supported.
 */
import { jellyfinClient } from '../api/jellyfin';
import { MediaItem } from '../mockData';
import { isTizen } from '../theme/performance';
import { getPlaybackInfoCached } from './preloadService';
import { pickAudioTrack, readLanguagePrefs } from '../utils/playbackDecision';

declare const __YUDIA_WEB__: boolean;
const w = window as any;

export interface CastState {
  ready: boolean; // SDK loaded
  available: boolean; // a Cast device is on the network
  connected: boolean;
  connecting: boolean;
  deviceName: string;
  mediaId: string | null; // Yudia item currently loaded on the Cast device
  isPaused: boolean;
  currentTime: number;
  duration: number;
  playerState: string; // PLAYING | PAUSED | BUFFERING | IDLE
  finished: number; // increments every time a title plays to the end on the Cast device
}

let state: CastState = {
  ready: false,
  available: false,
  connected: false,
  connecting: false,
  deviceName: '',
  mediaId: null,
  isPaused: true,
  currentTime: 0,
  duration: 0,
  playerState: 'IDLE',
  finished: 0
};
const listeners = new Set<() => void>();
export const getCastState = () => state;
export function subscribeCast(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(patch: Partial<CastState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Website + a browser that can cast. */
export const castSupported = (): boolean =>
  typeof __YUDIA_WEB__ !== 'undefined' && __YUDIA_WEB__ && !isTizen() && typeof window !== 'undefined' && !!w.chrome && window.isSecureContext;

let player: any = null;
let controller: any = null;

export function initCast() {
  if (!castSupported() || w.__yudiaCastLoading) return;
  w.__yudiaCastLoading = true;
  w.__onGCastApiAvailable = (isAvailable: boolean) => {
    if (!isAvailable) return;
    try {
      const fw = w.cast.framework;
      const ctx = fw.CastContext.getInstance();
      ctx.setOptions({
        receiverApplicationId: w.chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
        autoJoinPolicy: w.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
      player = new fw.RemotePlayer();
      controller = new fw.RemotePlayerController(player);

      const syncCastState = () => {
        const cs = ctx.getCastState();
        const session = ctx.getCurrentSession();
        set({
          available: cs !== fw.CastState.NO_DEVICES_AVAILABLE,
          connected: cs === fw.CastState.CONNECTED,
          connecting: cs === fw.CastState.CONNECTING,
          deviceName: session?.getCastDevice()?.friendlyName || ''
        });
        if (cs !== fw.CastState.CONNECTED) set({ mediaId: null, playerState: 'IDLE' });
      };
      ctx.addEventListener(fw.CastContextEventType.CAST_STATE_CHANGED, syncCastState);
      ctx.addEventListener(fw.CastContextEventType.SESSION_STATE_CHANGED, syncCastState);

      let lastState = 'IDLE';
      controller.addEventListener(fw.RemotePlayerEventType.ANY_CHANGE, () => {
        const mediaInfo = player.mediaInfo;
        const id = mediaInfo?.customData?.yudiaId || null;
        const ps = player.playerState || 'IDLE';
        // Played to the end on the TV (not stopped by the user) → the app moves on (next song / episode)
        const media = w.cast.framework.CastContext.getInstance().getCurrentSession()?.getMediaSession();
        const finished = lastState !== 'IDLE' && ps === 'IDLE' && media?.idleReason === w.chrome.cast.media.IdleReason.FINISHED;
        lastState = ps;
        set({
          mediaId: id,
          isPaused: !!player.isPaused,
          currentTime: player.currentTime || 0,
          duration: player.duration || 0,
          playerState: ps,
          finished: finished ? state.finished + 1 : state.finished
        });
      });
      set({ ready: true });
      syncCastState();
    } catch (e) {
      console.warn('[cast] could not start', e);
    }
  };
  const s = document.createElement('script');
  s.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1';
  s.async = true;
  document.head.appendChild(s);
}

/** Opens the browser's Cast device picker (or its "stop casting" dialog when already connected). */
export function openCastDialog() {
  try {
    w.cast.framework.CastContext.getInstance().requestSession().catch(() => {});
  } catch {}
}

export function stopCasting() {
  try {
    w.cast.framework.CastContext.getInstance().endCurrentSession(true);
  } catch {}
}

// ---------------------------------------------------------------- remote control

export function castTogglePlay() {
  controller?.playOrPause();
}
export function castSeek(seconds: number) {
  if (!player || !controller) return;
  player.currentTime = Math.max(0, seconds);
  controller.seek();
}
export function castPlay() {
  if (player?.isPaused) controller?.playOrPause();
}
export function castPause() {
  if (player && !player.isPaused) controller?.playOrPause();
}

// ---------------------------------------------------------------- loading a title

const CAST_AUDIO: Record<string, string> = {
  mp3: 'audio/mpeg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  webm: 'audio/webm',
  wav: 'audio/wav'
};

function image(url?: string) {
  return url ? [new w.chrome.cast.Image(url)] : [];
}

/**
 * Play a title on the connected Cast device.
 * @param startSeconds where to start (resume point / where the local player was)
 * @param audioStreamIndex / subtitleIndex  the tracks chosen in the player (optional)
 */
export async function castMedia(
  item: MediaItem,
  opts: { startSeconds?: number; audioStreamIndex?: number; subtitleIndex?: number | null } = {}
): Promise<boolean> {
  const session = w.cast?.framework?.CastContext.getInstance().getCurrentSession();
  if (!session) return false;
  const { serverUrl, accessToken, deviceId } = jellyfinClient.getConfig();
  const base = (serverUrl || '').replace(/\/$/, '');
  if (!base || !accessToken) return false;
  const cm = w.chrome.cast.media;
  const info = await getPlaybackInfoCached(item.id).catch(() => null);
  const container = (info?.container || '').split(',')[0].toLowerCase();

  let url: string;
  let contentType: string;
  let metadata: any;
  const tracks: any[] = [];
  let activeTrackIds: number[] | undefined;

  if (item.type === 'music') {
    const mime = CAST_AUDIO[container];
    url = mime
      ? `${base}/Audio/${item.id}/stream?static=true&ApiKey=${accessToken}`
      : `${base}/Audio/${item.id}/stream.mp3?static=false&audioCodec=mp3&audioBitRate=320000&ApiKey=${accessToken}&DeviceId=${encodeURIComponent(deviceId || '')}`;
    contentType = mime || 'audio/mpeg';
    metadata = new cm.MusicTrackMediaMetadata();
    metadata.title = item.title;
    metadata.artist = item.artist || '';
    metadata.albumName = item.album || '';
    metadata.images = image(item.backdropUrl || item.posterUrl);
  } else {
    const audioTracks = info?.audioTracks || [];
    const def = audioTracks.find((a) => a.isDefault) || audioTracks[0];
    const chosen =
      opts.audioStreamIndex !== undefined
        ? audioTracks.find((a) => a.index === opts.audioStreamIndex)
        : pickAudioTrack(audioTracks, readLanguagePrefs().audioLanguage);
    const video = (info?.videoCodec || '').toLowerCase();
    const audio = (chosen?.codec || def?.codec || '').toLowerCase();
    const direct =
      (!chosen || chosen.index === def?.index) &&
      ((/mp4|m4v|mov/.test(container) && /h264|avc/.test(video) && /aac|mp3/.test(audio)) ||
        (/webm/.test(container) && /vp8|vp9/.test(video) && /opus|vorbis/.test(audio)));
    if (direct) {
      url = `${base}/Videos/${item.id}/stream?static=true&ApiKey=${accessToken}${info?.mediaSourceId ? `&MediaSourceId=${info.mediaSourceId}` : ''}`;
      contentType = container.includes('webm') ? 'video/webm' : 'video/mp4';
    } else {
      const p = new URLSearchParams({
        ApiKey: accessToken,
        DeviceId: deviceId || 'yudia-cast',
        PlaySessionId: `cast-${item.id}-${Date.now()}`,
        VideoCodec: 'h264',
        AudioCodec: 'aac,mp3',
        TranscodingMaxAudioChannels: '2',
        SegmentContainer: 'ts',
        MinSegments: '1',
        BreakOnNonKeyFrames: 'true',
        VideoBitrate: '10000000',
        AudioBitrate: '192000',
        MaxHeight: '1080'
      });
      if (info?.mediaSourceId) p.set('MediaSourceId', info.mediaSourceId);
      if (chosen) p.set('AudioStreamIndex', String(chosen.index));
      url = `${base}/Videos/${item.id}/master.m3u8?${p.toString()}`;
      contentType = 'application/x-mpegURL';
    }

    if (item.type === 'tv') {
      metadata = new cm.TvShowMediaMetadata();
      metadata.title = item.episodeName || item.title;
      metadata.seriesTitle = item.seriesName || '';
      metadata.season = item.seasonNumber;
      metadata.episode = item.episodeNumber;
    } else {
      metadata = new cm.MovieMediaMetadata();
      metadata.title = item.title;
      metadata.subtitle = [item.year, item.rating].filter(Boolean).join(' · ');
    }
    metadata.images = image(item.backdropUrl || item.posterUrl);

    // Text subtitles (image-based ones can't be sent)
    (info?.subtitleTracks || []).forEach((s, i) => {
      const t = new cm.Track(i + 1, cm.TrackType.TEXT);
      t.trackContentId = `${base}/Videos/${item.id}/${info?.mediaSourceId || item.id}/Subtitles/${s.index}/0/Stream.vtt?ApiKey=${accessToken}`;
      t.trackContentType = 'text/vtt';
      t.subtype = cm.TextTrackType.SUBTITLES;
      t.name = s.displayTitle;
      t.language = s.language;
      tracks.push(t);
      if (opts.subtitleIndex !== undefined && opts.subtitleIndex !== null && s.index === opts.subtitleIndex) activeTrackIds = [i + 1];
    });
  }

  const mediaInfo = new cm.MediaInfo(url, contentType);
  mediaInfo.streamType = cm.StreamType.BUFFERED;
  mediaInfo.metadata = metadata;
  mediaInfo.customData = { yudiaId: item.id };
  if (tracks.length) {
    mediaInfo.tracks = tracks;
    const style = new cm.TextTrackStyle();
    style.backgroundColor = '#00000099';
    style.foregroundColor = '#FFFFFFFF';
    mediaInfo.textTrackStyle = style;
  }
  const req = new cm.LoadRequest(mediaInfo);
  req.autoplay = true;
  req.currentTime = Math.max(0, opts.startSeconds || 0);
  if (activeTrackIds) req.activeTrackIds = activeTrackIds;
  try {
    await session.loadMedia(req);
    set({ mediaId: item.id });
    return true;
  } catch (e) {
    console.warn('[cast] load failed', e);
    return false;
  }
}
