/**
 * Intro / credits markers for an episode.
 *
 * Source order:
 *   1. GET /MediaSegments/{itemId}            — Jellyfin 10.10+ native segments. Current Intro Skipper
 *                                                versions write here; this is what jellyfin.example.com serves.
 *   2. GET /Episode/{itemId}/IntroTimestamps  — legacy Intro Skipper endpoint (intro, then ?mode=Credits).
 *   3. Chapter names ("Intro", "Opening", "Credits", "Ending"…) — handled by markersFromChapters().
 *
 * Every failure (404, empty body, Valid: false, network error) resolves to null — never throws.
 * All values are in SECONDS.
 */

import { jellyfinClient } from './jellyfin';

const TICKS_PER_SECOND = 10_000_000;

export interface EpisodeMarkers {
  introStart?: number;
  introEnd?: number;
  creditsStart?: number;
  creditsEnd?: number;
  source: 'segments' | 'intro-skipper' | 'chapters';
}

/** Shape returned by the legacy Intro Skipper endpoint. */
interface IntroSkipperResponse {
  Valid?: boolean;
  IntroStart?: number;
  IntroEnd?: number;
  CreditsStart?: number;
  CreditsEnd?: number;
}

interface MediaSegment {
  Type: 'Intro' | 'Outro' | 'Recap' | 'Preview' | 'Commercial' | 'Unknown' | string;
  StartTicks: number;
  EndTicks: number;
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function authHeaders(): Record<string, string> {
  const { accessToken } = jellyfinClient.getConfig();
  return {
    Accept: 'application/json',
    Authorization: `MediaBrowser Token="${accessToken}"`
  };
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: authHeaders(), signal });
    if (!res.ok) return null; // 404 = plugin not installed / episode not analysed
    const text = await res.text();
    return text ? (JSON.parse(text) as T) : null;
  } catch {
    return null;
  }
}

/** Keep only markers that make sense; drop the object entirely if nothing usable is left. */
function sanitize(m: EpisodeMarkers): EpisodeMarkers | null {
  const out: EpisodeMarkers = { source: m.source };
  if (isNum(m.introStart) && isNum(m.introEnd) && m.introEnd > m.introStart) {
    out.introStart = m.introStart;
    out.introEnd = m.introEnd;
  }
  if (isNum(m.creditsStart) && m.creditsStart > 0) {
    out.creditsStart = m.creditsStart;
    if (isNum(m.creditsEnd) && m.creditsEnd > m.creditsStart) out.creditsEnd = m.creditsEnd;
  }
  return out.introEnd !== undefined || out.creditsStart !== undefined ? out : null;
}

export function parseMediaSegments(data: { Items?: MediaSegment[] } | null): EpisodeMarkers | null {
  const items = data?.Items;
  if (!Array.isArray(items) || items.length === 0) return null;

  const intro = items.find((s) => s.Type === 'Intro');
  // Some shows have a mid-episode "Outro" (ending song) and the real end credits later.
  // The credits we want are the LAST outro.
  const outro = items
    .filter((s) => s.Type === 'Outro')
    .sort((a, b) => b.StartTicks - a.StartTicks)[0];

  return sanitize({
    source: 'segments',
    introStart: intro ? intro.StartTicks / TICKS_PER_SECOND : undefined,
    introEnd: intro ? intro.EndTicks / TICKS_PER_SECOND : undefined,
    creditsStart: outro ? outro.StartTicks / TICKS_PER_SECOND : undefined,
    creditsEnd: outro ? outro.EndTicks / TICKS_PER_SECOND : undefined
  });
}

export function parseIntroSkipper(
  intro: IntroSkipperResponse | null,
  credits: IntroSkipperResponse | null
): EpisodeMarkers | null {
  const introOk = intro && intro.Valid !== false;
  const creditsOk = credits && credits.Valid !== false;
  return sanitize({
    source: 'intro-skipper',
    introStart: introOk ? intro.IntroStart : undefined,
    introEnd: introOk ? intro.IntroEnd : undefined,
    // Some plugin versions put credits on the main response, others behind ?mode=Credits
    // (where the credits range is reported as IntroStart/IntroEnd).
    creditsStart: introOk && isNum(intro.CreditsStart)
      ? intro.CreditsStart
      : creditsOk ? credits.IntroStart ?? credits.CreditsStart : undefined,
    creditsEnd: introOk && isNum(intro.CreditsEnd)
      ? intro.CreditsEnd
      : creditsOk ? credits.IntroEnd ?? credits.CreditsEnd : undefined
  });
}

export async function fetchEpisodeMarkers(itemId: string, signal?: AbortSignal): Promise<EpisodeMarkers | null> {
  const { serverUrl, accessToken } = jellyfinClient.getConfig();
  if (!serverUrl || !accessToken || !itemId) return null;
  const base = serverUrl.replace(/\/$/, '');

  const segments = parseMediaSegments(await getJson(`${base}/MediaSegments/${itemId}`, signal));
  if (segments) return segments;

  const [intro, credits] = await Promise.all([
    getJson<IntroSkipperResponse>(`${base}/Episode/${itemId}/IntroTimestamps`, signal),
    getJson<IntroSkipperResponse>(`${base}/Episode/${itemId}/IntroTimestamps?mode=Credits`, signal)
  ]);
  return parseIntroSkipper(intro, credits);
}

/** Fallback when the server has no segments: use named chapters. */
export function markersFromChapters(
  chapters: Array<{ Name?: string; StartPositionTicks?: number }> | undefined,
  durationSecs: number
): EpisodeMarkers | null {
  if (!chapters?.length) return null;
  const m: EpisodeMarkers = { source: 'chapters' };
  chapters.forEach((c, i) => {
    const name = (c.Name || '').toLowerCase().trim();
    const start = (c.StartPositionTicks || 0) / TICKS_PER_SECOND;
    const next = chapters[i + 1];
    if (m.introEnd === undefined && /\b(intro|opening|op)\b/.test(name) && next) {
      m.introStart = start;
      m.introEnd = (next.StartPositionTicks || 0) / TICKS_PER_SECOND;
    }
    if (/\b(credits?|ending|outro|ed)\b/.test(name) && (durationSecs <= 0 || start >= durationSecs * 0.5)) {
      m.creditsStart = start;
    }
  });
  return sanitize(m);
}

/**
 * When the "Next Episode" overlay should appear.
 * Detected credits win if they are plausible (second half of the episode, before the end);
 * otherwise fall back to the last 30 s (or the last 5 % for very short media).
 */
export function resolveCreditsStart(markers: EpisodeMarkers | null, durationSecs: number): number | null {
  if (!(durationSecs > 0)) return null;
  const c = markers?.creditsStart;
  if (isNum(c) && c >= durationSecs * 0.5 && c < durationSecs - 1) return c;
  return Math.max(durationSecs - 30, durationSecs * 0.95);
}
