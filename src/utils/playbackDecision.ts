/**
 * Decide how to stream an item so it always plays WITH sound on this device, and build the Jellyfin URL.
 *
 *  direct    → /Videos/{id}/stream?static=true — original file, byte-range seekable. Only when this device can
 *              decode the container, video AND audio codec (e.g. most MKVs here carry E-AC3, which desktop browsers
 *              can't decode → silent video).
 *  remux     → copy the video untouched, convert audio to AAC. Cheap for the server, full picture quality.
 *  transcode → quality cap (videoBitRate + maxHeight) or a video codec the device can't decode.
 *
 * Note: /Videos/{id}/stream ignores `maxStreamingBitrate`; the parameters that actually cap quality are
 * `videoBitRate` and `maxHeight` (verified against jellyfin.example.com).
 */

export type StreamMode = 'direct' | 'remux' | 'transcode';

export interface MediaInfo {
  container?: string;
  videoCodec?: string;
  mediaSourceId?: string;
}

const probe = (() => {
  let el: HTMLVideoElement | null = null;
  return (type: string): boolean => {
    try {
      el ??= document.createElement('video');
      return el.canPlayType(type) !== '';
    } catch {
      return false;
    }
  };
})();

const isTizen = (): boolean =>
  typeof window !== 'undefined' && (!!(window as any).tizen || /Tizen/i.test(navigator.userAgent));

function canPlayContainer(container = ''): boolean {
  const c = container.toLowerCase();
  if (c.includes('mp4') || c.includes('m4v') || c.includes('mov')) return probe('video/mp4');
  if (c.includes('webm')) return probe('video/webm');
  if (c.includes('mkv') || c.includes('matroska')) return isTizen() || probe('video/x-matroska');
  return false;
}

function canPlayVideo(codec = ''): boolean {
  switch (codec.toLowerCase()) {
    case 'h264':
    case 'avc':
      return probe('video/mp4; codecs="avc1.640028"');
    case 'hevc':
    case 'h265':
      return probe('video/mp4; codecs="hvc1.1.6.L120.90"') || probe('video/mp4; codecs="hev1.1.6.L120.90"');
    case 'vp9':
      return probe('video/webm; codecs="vp9"');
    case 'av1':
      return probe('video/mp4; codecs="av01.0.08M.08"');
    default:
      return false;
  }
}

export function canPlayAudio(codec = ''): boolean {
  switch (codec.toLowerCase()) {
    case 'aac':
      return probe('audio/mp4; codecs="mp4a.40.2"');
    case 'mp3':
      return probe('audio/mpeg');
    case 'ac3':
      return probe('audio/mp4; codecs="ac-3"');
    case 'eac3':
      return probe('audio/mp4; codecs="ec-3"');
    case 'opus':
      return probe('audio/webm; codecs="opus"');
    case 'vorbis':
      return probe('audio/webm; codecs="vorbis"');
    case 'flac':
      return probe('audio/flac');
    default:
      return false; // dts, truehd, pcm variants…
  }
}

export function decideStreamMode(opts: {
  media: MediaInfo;
  audioCodec?: string;
  /** Selected audio track is the file's default one (direct play can only play the default track). */
  audioIsDefault: boolean;
  maxBitrate: number;
  forceServerSide?: boolean;
}): StreamMode {
  const { media, audioCodec, audioIsDefault, maxBitrate, forceServerSide } = opts;
  if (maxBitrate > 0) return 'transcode';
  const videoOk = canPlayVideo(media.videoCodec);
  if (!videoOk) return 'transcode';
  if (!forceServerSide && canPlayContainer(media.container) && canPlayAudio(audioCodec) && audioIsDefault) {
    return 'direct';
  }
  return 'remux';
}

export function buildVideoStreamUrl(opts: {
  serverUrl: string;
  token: string;
  deviceId?: string;
  itemId: string;
  mode: StreamMode;
  media: MediaInfo;
  audioStreamIndex?: number;
  maxBitrate?: number;
  maxHeight?: number;
  startTimeTicks?: number;
}): string {
  const base = opts.serverUrl.replace(/\/$/, '');
  const p = new URLSearchParams();
  p.set('ApiKey', opts.token);
  if (opts.media.mediaSourceId) p.set('MediaSourceId', opts.media.mediaSourceId);

  if (opts.mode === 'direct') {
    p.set('static', 'true');
    return `${base}/Videos/${opts.itemId}/stream?${p.toString()}`;
  }

  p.set('static', 'false');
  p.set('container', 'mp4');
  // Output codecs this device can decode; the server copies the source stream when it already matches.
  const videoCodecs = ['h264'];
  if (canPlayVideo('hevc')) videoCodecs.push('hevc');
  p.set('VideoCodec', videoCodecs.join(','));
  p.set('AudioCodec', 'aac');
  p.set('TranscodingMaxAudioChannels', '2');
  p.set('allowAudioStreamCopy', 'true');
  p.set('allowVideoStreamCopy', 'true');
  if (opts.audioStreamIndex !== undefined && opts.audioStreamIndex >= 0) {
    p.set('AudioStreamIndex', String(opts.audioStreamIndex));
  }
  if (opts.mode === 'transcode') {
    const bitrate = opts.maxBitrate && opts.maxBitrate > 0 ? opts.maxBitrate : 20_000_000;
    p.set('videoBitRate', String(bitrate));
    if (opts.maxHeight) p.set('maxHeight', String(opts.maxHeight));
  }
  if (opts.startTimeTicks && opts.startTimeTicks > 0) p.set('StartTimeTicks', String(Math.round(opts.startTimeTicks)));
  if (opts.deviceId) p.set('DeviceId', opts.deviceId);
  return `${base}/Videos/${opts.itemId}/stream.mp4?${p.toString()}`;
}

// ---- Preferred languages (Settings → Subtitles & Audio) ----

const LANGUAGE_CODES: Record<string, string[]> = {
  English: ['eng', 'en'],
  French: ['fre', 'fra', 'fr'],
  German: ['ger', 'deu', 'de'],
  Italian: ['ita', 'it'],
  Spanish: ['spa', 'es'],
  Japanese: ['jpn', 'ja']
};

export interface StreamingLanguagePrefs {
  audioLanguage: string;    // 'Original' | 'English' | …
  subtitleLanguage: string; // 'Off' | 'English' | …
}

export function readLanguagePrefs(): StreamingLanguagePrefs {
  try {
    const saved = JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}');
    return {
      audioLanguage: saved.audioLanguage || 'English',
      subtitleLanguage: saved.subtitleLanguage || 'Off'
    };
  } catch {
    return { audioLanguage: 'English', subtitleLanguage: 'Off' };
  }
}

const matchesLanguage = (lang: string | undefined, pref: string): boolean =>
  !!lang && (LANGUAGE_CODES[pref] || []).includes(lang.toLowerCase());

/** Preferred language → else the file's default track → else the first track. */
export function pickAudioTrack<T extends { language: string; isDefault?: boolean }>(tracks: T[], pref: string): T | undefined {
  return (
    (pref !== 'Original' ? tracks.find((t) => matchesLanguage(t.language, pref)) : undefined) ||
    tracks.find((t) => t.isDefault) ||
    tracks[0]
  );
}

/** 'Off' → none. Otherwise a full (non-forced) track in the preferred language, or none. */
export function pickSubtitleTrack<T extends { language: string; isForced?: boolean }>(tracks: T[], pref: string): T | undefined {
  if (pref === 'Off') return undefined;
  const inLang = tracks.filter((t) => matchesLanguage(t.language, pref));
  return inLang.find((t) => !t.isForced) || inLang[0];
}
