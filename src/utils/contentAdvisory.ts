/**
 * Content advisory ("13+ · violence, language" + photosensitive warning) shown when a title starts playing.
 *
 * Everything is derived at play time from Jellyfin metadata, so newly added media gets an advisory
 * automatically — nothing is stored in the app:
 *   - Age:     CustomRating (admin override) → OfficialRating, of the item or, for episodes, of its series.
 *   - Topics:  matched from TMDB keywords (Jellyfin Tags), Genres and the synopsis.
 *   - Admin:   add a tag in Jellyfin to force a topic / warning, e.g. "advisory:violence",
 *              "advisory:strong language", "warning:flashing lights". Tag "advisory:none" hides topics.
 *
 * Jellyfin/TMDB carry no official content descriptors or epilepsy flags, so topics are an inference;
 * the admin tags are the way to correct or complete them.
 */
import { jellyfinClient } from '../api/jellyfin';

export interface ContentAdvisory {
  /** e.g. "13+", "All ages" — only when the rating itself states the age. */
  ageLabel?: string;
  /** Minimum age for the colour code (can be higher than the rating when the title is tagged explicit). */
  ageValue?: number;
  /** Official rating as stored, e.g. "PG-13", "TV-MA", "FSK-16". */
  rating?: string;
  /** Lower-case topics, most serious first, e.g. ["violence", "language"]. */
  topics: string[];
  photosensitive: boolean;
  /** DoesTheDogDie data is on screen → "Powered by DoesTheDogDie.com" must be shown (their API terms). */
  attribution: { topics: boolean; photosensitive: boolean };
}

interface Topic {
  label: string;
  /** Matched against tags + genres (whole words/phrases). */
  tags: RegExp;
  /** Matched against the synopsis — only unambiguous words. */
  text?: RegExp;
}

// Most serious first — that's the display order.
const TOPICS: Topic[] = [
  { label: 'suicide', tags: /\b(suicide|self[- ]harm)\b/, text: /\bsuicid\w*/ },
  { label: 'sexual violence', tags: /\b(rape|sexual (abuse|assault|violence))\b/, text: /\b(rape[ds]?|sexual(ly)? (abuse|assault)\w*)\b/ },
  { label: 'violence', tags: /\b(violence|violent|murder|gore|massacre|torture|brutality|war|battle|shootout|gunfight|serial killer|assassin|slasher|killing)\b/, text: /\b(murder\w*|killer|massacre|slaughter\w*|serial killer)\b/ },
  { label: 'fear', tags: /\b(horror|ghost|demon|zombie|haunted|possession|monster|supernatural horror|jump scare|creature feature)\b|^horror$/, text: /\b(haunt\w*|demon\w*|possessed|zombies?)\b/ },
  { label: 'sex', tags: /\b(sex|sexual(ity)?|erotic|erotica|sex scene)\b/ },
  { label: 'nudity', tags: /\b(nudity|nude|naked)\b/ },
  { label: 'drugs', tags: /\b(drugs?|drug (use|abuse|addiction|dealer|cartel|trafficking)|cocaine|heroin|meth(amphetamine)?|overdose|addiction)\b/, text: /\b(drug (dealer|addict\w*|lord|cartel)|cocaine|heroin|overdos\w*)\b/ },
  { label: 'alcohol', tags: /\b(alcohol(ism|ic)?|drunk(enness)?)\b/ },
  { label: 'smoking', tags: /\b(smoking|cigarette)\b/ },
  { label: 'language', tags: /\b(profanity|swearing|foul language|strong language|crude humor|vulgarity)\b/ },
  { label: 'abuse', tags: /\b(abuse|domestic violence|child abuse|bullying)\b/, text: /\b(abus(e|ed|ive)|bully\w*)\b/ },
  { label: 'death', tags: /\b(death of (a )?(parent|father|mother|child)|grief|terminal illness)\b/ }
];

/** TMDB keywords / genres that mark explicit sexual content. */
const EXPLICIT = /\b(erotic|erotica|hentai|pornograph\w*|porn|softcore|hardcore|unsimulated sex|explicit sex|sexploitation|adult film)\b|^(adult|xxx)$/i;

/** Ratings that mean "adults only" even though the number in them (if any) isn't 18 — e.g. NC-17 = "no one 17 and under". */
const ADULTS_ONLY = /^(NC-?17|X|XX|XXX|AO|R-?18\+?|X18\+?|ADULT|ADULTS ONLY)$/;

/**
 * European age for a rating (scale 0 / 6 / 12 / 16 / 18, as FSK in Germany/Switzerland).
 *  - Real European ratings (FSK 16, DE-16, CH-12, FR-10, PEGI 18, GB-15…) keep their own number.
 *  - US ratings are converted to their usual FSK equivalent:
 *      G / TV-G / TV-Y → 0 · TV-Y7 / PG / TV-PG → 6 · PG-13 / TV-14 → 12 · R / TV-MA → 16 · NC-17 / X / AO → 18
 *  - `explicit`: a title with the top US rating (R / TV-MA) tagged as explicit → 18
 *    (the US scale stops at "17", so explicit titles never reach 18 on their own).
 */
export function euAgeFromRating(rating?: string, explicit = false): number | undefined {
  if (!rating) return undefined;
  const r = rating.trim().toUpperCase();
  if (ADULTS_ONLY.test(r)) return 18;
  if (['G', 'TV-G', 'TV-Y', 'U', 'ALL', 'E', 'TP', 'APPROVED'].includes(r)) return 0;
  if (['TV-Y7', 'TV-Y7-FV', 'PG', 'TV-PG', 'UC'].includes(r)) return 6;
  if (['PG-13', 'TV-14'].includes(r)) return 12;
  if (r === 'R' || r === 'TV-MA') return explicit ? 18 : 16;
  const n = r.match(/(\d{1,2})/); // FSK-16, DE-16, CH-12, PEGI 18, FR-10, 15…
  return n ? parseInt(n[1], 10) : undefined;
}

/** Kept for callers that only have a rating (no tags): same European scale. */
export const ageValueFromRating = (rating?: string): number | undefined => euAgeFromRating(rating);

/** Label shown in the popup: "All ages", "6+", "12+", "16+", "18+". */
export function ageLabelFromAge(age?: number): string | undefined {
  if (age === undefined) return undefined;
  return age === 0 ? 'All ages' : `${age}+`;
}

/** Traffic-light colour on the European scale: green → yellow → orange → red → crimson. */
export function ageColor(age?: number): string {
  if (age === undefined) return '#00e5ff'; // unrated: app accent
  if (age <= 5) return '#22c55e';  // All ages
  if (age <= 11) return '#facc15'; // 6+ (…10+)
  if (age <= 15) return '#fb923c'; // 12+ (…15+)
  if (age <= 17) return '#ef4444'; // 16+
  return '#ff1f4b';                // 18+
}

/** Rating string → label, European scale. */
export function ageFromRating(rating?: string): string | undefined {
  return ageLabelFromAge(euAgeFromRating(rating));
}

const PHOTOSENSITIVE = /\b(flash(ing)? lights?|strobe\w*|photosensitiv\w*|epilep\w*|seizures?)\b/;

export function buildAdvisory(meta: { rating?: string; tags: string[]; genres: string[]; overview?: string }): ContentAdvisory {
  const tags = meta.tags.map((t) => t.toLowerCase().trim());
  const genres = meta.genres.map((g) => g.toLowerCase().trim());
  const overview = (meta.overview || '').toLowerCase();

  // Admin overrides: "advisory:<topic>", "warning:<text>", "advisory:none"
  const adminTopics: string[] = [];
  let hideInferred = false;
  let photosensitive = false;
  for (const t of tags) {
    const m = t.match(/^(advisory|warning)\s*:\s*(.+)$/);
    if (!m) continue;
    const value = m[2].trim();
    if (value === 'none') hideInferred = true;
    else if (PHOTOSENSITIVE.test(value)) photosensitive = true;
    else adminTopics.push(value);
  }

  // "ddd:<topic>" tags written by the server-side DoesTheDogDie tagger (ddd-tagger/). Community-voted,
  // so when present they replace the keyword guesses below. "ddd:checked:<date>" is bookkeeping.
  const dddTags = tags
    .filter((t) => t.startsWith('ddd:') && !t.startsWith('ddd:checked:'))
    .map((t) => t.slice(4).trim())
    .filter(Boolean);
  // Only flashing lights / strobing trigger the warning; "someone has a seizure" stays a normal topic.
  const dddPhoto = dddTags.some((t) => /flash|strob/.test(t));
  const dddTopics = dddTags.filter((t) => !/flash|strob/.test(t));

  const plainTags = tags.filter((t) => !/^(advisory|warning|ddd)\s*:/.test(t));
  const keywordPhoto = plainTags.some((t) => PHOTOSENSITIVE.test(t));

  const inferred =
    hideInferred || dddTopics.length > 0
      ? []
      : TOPICS.filter(
          (topic) => [...plainTags, ...genres].some((t) => topic.tags.test(t)) || (!!topic.text && topic.text.test(overview))
        ).map((t) => t.label);

  const topics = [...new Set([...adminTopics, ...(hideInferred ? [] : dddTopics), ...inferred])].slice(0, 4);

  // US ratings top out at TV-MA (TV, "under 17") and R (films), so explicit titles never reach 18 on their own.
  // A title that already has the top US rating AND is tagged explicit is shown as 18+ (rating still displayed).
  const explicit = [...tags, ...genres].some((t) => EXPLICIT.test(t));
  return {
    ageLabel: ageLabelFromAge(euAgeFromRating(meta.rating, explicit)),
    ageValue: euAgeFromRating(meta.rating, explicit),
    rating: meta.rating || undefined,
    topics,
    photosensitive: photosensitive || dddPhoto || keywordPhoto,
    attribution: {
      topics: topics.some((t) => dddTopics.includes(t) && !adminTopics.includes(t)),
      // Credit DDD for the warning only when it is the only source of it.
      photosensitive: dddPhoto && !photosensitive && !keywordPhoto
    }
  };
}

/** Fetch item (+ its series for episodes) and build the advisory. null for demo items / errors / nothing to show. */
export async function fetchContentAdvisory(itemId: string, signal?: AbortSignal): Promise<ContentAdvisory | null> {
  const { serverUrl, accessToken, userId } = jellyfinClient.getConfig();
  if (!serverUrl || !accessToken || !itemId || itemId.startsWith('demo-')) return null;
  const base = serverUrl.replace(/\/$/, '');
  const headers = { Accept: 'application/json', Authorization: `MediaBrowser Token="${accessToken}"` };
  const fields = 'Tags,Genres,OfficialRating,CustomRating,Overview,SeriesId';
  const get = async (id: string) => {
    try {
      const r = await fetch(`${base}/Items?Ids=${id}&userId=${userId}&Fields=${fields}`, { headers, signal });
      return r.ok ? (await r.json()).Items?.[0] ?? null : null;
    } catch {
      return null;
    }
  };

  const item = await get(itemId);
  if (!item) return null;
  const series = item.Type === 'Episode' && item.SeriesId ? await get(item.SeriesId) : null;

  const advisory = buildAdvisory({
    rating: item.CustomRating || item.OfficialRating || series?.CustomRating || series?.OfficialRating,
    tags: [...(item.Tags || []), ...(series?.Tags || [])],
    genres: [...(item.Genres || []), ...(series?.Genres || [])],
    overview: `${item.Overview || ''} ${series?.Overview || ''}`
  });
  return advisory.rating || advisory.topics.length || advisory.photosensitive ? advisory : null;
}
