/**
 * Real media format labels (resolution, HDR, audio, subtitles) from Jellyfin MediaStreams —
 * replaces the hard-coded "4K HDR / Dolby Atmos" badges.
 */
import { useEffect, useState } from 'react';
import { jellyfinClient } from '../api/jellyfin';

export interface MediaFormat {
  /** Short badge, e.g. "4K", "1080p", "720p", "SD". */
  resolutionBadge?: string;
  /** e.g. "3840 × 1636 (4K) • HEVC" */
  resolutionText?: string;
  /** "HDR10", "HDR10+", "Dolby Vision", "HLG", "HDR" — undefined for SDR. */
  hdr?: string;
  /** e.g. "DTS-HD MA 5.1", "Dolby Digital Plus 5.1 • Atmos", "AAC Stereo" */
  audioText?: string;
  /** Short badge for the audio, e.g. "5.1", "ATMOS" */
  audioBadge?: string;
  /** e.g. "English, French, Spanish +2" — undefined when none. */
  subtitlesText?: string;
  /** e.g. "English, French +3" — only when more than one language. */
  audioLanguagesText?: string;
  /** Series only: "Continuing" or "Ended". */
  seriesStatus?: string;
}

const LANGUAGE_NAMES: Record<string, string> = {
  eng: 'English', en: 'English', fre: 'French', fra: 'French', fr: 'French', ger: 'German', deu: 'German',
  de: 'German', ita: 'Italian', it: 'Italian', spa: 'Spanish', es: 'Spanish', jpn: 'Japanese', ja: 'Japanese',
  por: 'Portuguese', pt: 'Portuguese', rus: 'Russian', ukr: 'Ukrainian', dut: 'Dutch', nld: 'Dutch',
  chi: 'Chinese', zho: 'Chinese', kor: 'Korean', ara: 'Arabic', pol: 'Polish', swe: 'Swedish', dan: 'Danish',
  nor: 'Norwegian', nob: 'Norwegian', fin: 'Finnish', tur: 'Turkish', hin: 'Hindi',
  bul: 'Bulgarian', cze: 'Czech', ces: 'Czech', gre: 'Greek', ell: 'Greek', heb: 'Hebrew', hun: 'Hungarian',
  rum: 'Romanian', ron: 'Romanian', slo: 'Slovak', slk: 'Slovak', slv: 'Slovenian', hrv: 'Croatian',
  srp: 'Serbian', tha: 'Thai', vie: 'Vietnamese', ind: 'Indonesian', may: 'Malay', msa: 'Malay',
  fil: 'Filipino', est: 'Estonian', lav: 'Latvian', lit: 'Lithuanian', ice: 'Icelandic', isl: 'Icelandic',
  per: 'Persian', fas: 'Persian', cat: 'Catalan', baq: 'Basque', eus: 'Basque', glg: 'Galician',
  tam: 'Tamil', tel: 'Telugu', ben: 'Bengali', urd: 'Urdu', mal: 'Malayalam', kan: 'Kannada',
  cmn: 'Chinese', yue: 'Cantonese', nb: 'Norwegian', sv: 'Swedish', da: 'Danish', nl: 'Dutch',
  pl: 'Polish', ru: 'Russian', zh: 'Chinese', ko: 'Korean', ar: 'Arabic', tr: 'Turkish'
};

const languageName = (code?: string) => (code ? LANGUAGE_NAMES[code.toLowerCase()] || code.toUpperCase() : undefined);

function languageList(codes: (string | undefined)[], max = 3): string | undefined {
  const names = [...new Set(codes.map(languageName).filter((n): n is string => !!n && n !== 'UND'))];
  if (names.length === 0) return undefined;
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
}

function resolutionBadge(width = 0, height = 0): string | undefined {
  if (!width && !height) return undefined;
  // Judge by width first: scope films are 3840×1600, 1920×800 …
  if (width >= 3200 || height >= 2000) return '4K';
  if (width >= 1800 || height >= 1000) return '1080p';
  if (width >= 1200 || height >= 700) return '720p';
  return 'SD';
}

const VIDEO_CODEC_NAMES: Record<string, string> = { h264: 'H.264', hevc: 'HEVC', h265: 'HEVC', av1: 'AV1', vp9: 'VP9', mpeg2video: 'MPEG-2' };

function hdrLabel(range?: string, rangeType?: string): string | undefined {
  const t = (rangeType || '').toUpperCase();
  if (t.startsWith('DOVI')) return 'Dolby Vision';
  if (t === 'HDR10PLUS') return 'HDR10+';
  if (t === 'HDR10') return 'HDR10';
  if (t === 'HLG') return 'HLG';
  return (range || '').toUpperCase() === 'HDR' ? 'HDR' : undefined;
}

function audioCodecName(codec = '', profile = ''): string {
  const c = codec.toLowerCase();
  if (c === 'dts') return profile && /MA|HD|X/i.test(profile) ? profile : 'DTS';
  const names: Record<string, string> = {
    eac3: 'Dolby Digital Plus', ac3: 'Dolby Digital', truehd: 'Dolby TrueHD', aac: 'AAC', mp3: 'MP3',
    flac: 'FLAC', opus: 'Opus', vorbis: 'Vorbis', alac: 'ALAC'
  };
  return names[c] || codec.toUpperCase();
}

function channelsLabel(channels?: number): string | undefined {
  if (!channels) return undefined;
  if (channels === 1) return 'Mono';
  if (channels === 2) return 'Stereo';
  if (channels === 6) return '5.1';
  if (channels === 8) return '7.1';
  return `${channels}ch`;
}

export function describeMediaStreams(streams: any[] | undefined): MediaFormat | null {
  if (!streams?.length) return null;
  const video = streams.find((s) => s.Type === 'Video');
  const audios = streams.filter((s) => s.Type === 'Audio');
  const audio = audios.find((s) => s.IsDefault) || audios[0];
  const subs = streams.filter((s) => s.Type === 'Subtitle');

  const badge = resolutionBadge(video?.Width, video?.Height);
  const codec = video?.Codec ? VIDEO_CODEC_NAMES[video.Codec.toLowerCase()] || video.Codec.toUpperCase() : undefined;
  const atmos = !!audio && /atmos/i.test(`${audio.Profile || ''} ${audio.DisplayTitle || ''}`);
  const ch = channelsLabel(audio?.Channels);

  return {
    resolutionBadge: badge,
    resolutionText: video?.Width
      ? [`${video.Width} × ${video.Height}${badge ? ` (${badge})` : ''}`, codec].filter(Boolean).join(' • ')
      : undefined,
    hdr: hdrLabel(video?.VideoRange, video?.VideoRangeType),
    audioText: audio ? [audioCodecName(audio.Codec, audio.Profile), ch, atmos ? '• Atmos' : undefined].filter(Boolean).join(' ') : undefined,
    audioBadge: atmos ? 'ATMOS' : ch && ch !== 'Stereo' && ch !== 'Mono' ? ch : undefined,
    subtitlesText: languageList(subs.map((s) => s.Language)),
    audioLanguagesText: new Set(audios.map((s) => languageName(s.Language))).size > 1
      ? languageList(audios.map((s) => s.Language))
      : undefined
  };
}

/**
 * Loads the real format for a movie/episode (its own streams) or a series (its first episode's streams).
 * Returns null while loading, for demo items, or when the server has no stream info.
 */
export function useMediaFormat(itemId: string | undefined, kind: 'item' | 'series'): MediaFormat | null {
  const [format, setFormat] = useState<MediaFormat | null>(null);

  useEffect(() => {
    setFormat(null);
    const { serverUrl, accessToken, userId } = jellyfinClient.getConfig();
    if (!itemId || !serverUrl || !accessToken || itemId.startsWith('demo-')) return;

    const ctrl = new AbortController();
    const base = serverUrl.replace(/\/$/, '');
    const headers = { Accept: 'application/json', Authorization: `MediaBrowser Token="${accessToken}"` };
    const getFirst = (url: string) =>
      fetch(url, { headers, signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d?.Items?.[0] ?? null)
        .catch(() => null);

    const streamsUrl =
      kind === 'series'
        ? `${base}/Shows/${itemId}/Episodes?userId=${userId}&limit=1&Fields=MediaStreams`
        : `${base}/Items?Ids=${itemId}&userId=${userId}&Fields=MediaStreams`;

    Promise.all([
      getFirst(streamsUrl),
      kind === 'series' ? getFirst(`${base}/Items?Ids=${itemId}&userId=${userId}`) : Promise.resolve(null)
    ]).then(([item, series]) => {
      if (ctrl.signal.aborted) return;
      const fmt = describeMediaStreams(item?.MediaStreams);
      const status = series?.Status as string | undefined;
      setFormat(fmt || status ? { ...(fmt || {}), seriesStatus: status } : null);
    });
    return () => ctrl.abort();
  }, [itemId, kind]);

  return format;
}
