#!/usr/bin/env node
/**
 * Jellyfin ← DoesTheDogDie.com content-warning tagger.
 *
 * For every movie and series in Jellyfin, looks the title up on DoesTheDogDie (by IMDb id, then TMDB id,
 * then exact name + year) and writes the topics the community agrees on back as Jellyfin tags:
 *
 *     ddd:violence            ← a topic (DDD "minimalName")
 *     ddd:flashing lights     ← read by the TV app as a photosensitive warning
 *     ddd:checked:2026-09-30  ← bookkeeping: when this title was last looked up
 *
 * Only tags starting with "ddd:" are ever added or removed; your own tags are left alone.
 * Titles are re-checked every RECHECK_DAYS so new community votes are picked up; titles whose ddd: tags
 * were wiped (e.g. by a metadata refresh) are simply tagged again on the next run.
 *
 * Data: Powered by DoesTheDogDie.com — free API tier, non-commercial use only, attribution required.
 * No dependencies: Node 18+ (global fetch).
 */

const env = (name, fallback) => {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback === undefined) throw new Error(`Missing required environment variable ${name}`);
    return fallback;
  }
  return v;
};

const CONFIG = {
  jellyfinUrl: env('JELLYFIN_URL').replace(/\/$/, ''),
  jellyfinKey: env('JELLYFIN_API_KEY'),
  dddKey: env('DDD_API_KEY'),
  minYes: Number(env('MIN_YES_VOTES', '3')),          // at least this many "yes" votes…
  minYesRatio: Number(env('MIN_YES_RATIO', '0.75')),   // …and this share of all votes
  maxTopics: Number(env('MAX_TOPICS_PER_TITLE', '8')),
  recheckDays: Number(env('RECHECK_DAYS', '30')),
  // Safety net: full check every N hours (new media is normally caught instantly by the library watcher).
  intervalHours: Number(env('RUN_EVERY_HOURS', '6')),
  // Listen to Jellyfin's live connection and tag new media as soon as it is added.
  watch: env('WATCH_LIBRARY', 'true') === 'true',
  // Wait this long after media is added, so Jellyfin has fetched its metadata (IMDb/TMDB ids) first.
  watchDelayMinutes: Number(env('NEW_MEDIA_DELAY_MINUTES', '3')),
  runOnce: env('RUN_ONCE', 'false') === 'true',
  dryRun: env('DRY_RUN', 'false') === 'true',
  monthlyReserve: Number(env('DDD_MONTHLY_RESERVE', '100')) // stop before the free 5,000/month cap
};

const DDD_BASE = 'https://www.doesthedogdie.com/api/v3';
const DDD_MIN_GAP_MS = 2200; // free tier: 30 req/min → stay under it
const TAG_PREFIX = 'ddd:';
const CHECKED_PREFIX = 'ddd:checked:';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- DoesTheDogDie client (rate limited)

let lastDddCall = 0;
let dddMonthlyRemaining = Infinity;

class BudgetExhausted extends Error {}

async function ddd(path) {
  if (dddMonthlyRemaining <= CONFIG.monthlyReserve) {
    throw new BudgetExhausted(`DDD monthly budget nearly used (${dddMonthlyRemaining} left) — pausing until next month`);
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = lastDddCall + DDD_MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastDddCall = Date.now();

    const res = await fetch(`${DDD_BASE}${path}`, { headers: { 'X-API-KEY': CONFIG.dddKey } });
    const remaining = Number(res.headers.get('x-ratelimit-remaining-month'));
    if (Number.isFinite(remaining)) dddMonthlyRemaining = remaining;

    if (res.status === 429) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'monthly_limit_exceeded') throw new BudgetExhausted('DDD monthly limit reached');
      const retry = Number(res.headers.get('retry-after')) || 60;
      log(`DDD rate limit hit, waiting ${retry}s`);
      await sleep(retry * 1000);
      continue;
    }
    if (res.status === 404) return null;
    if (res.status === 401) throw new Error('DDD rejected the API key (401) — check DDD_API_KEY');
    if (!res.ok) throw new Error(`DDD ${path} → HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`DDD ${path} → still rate limited after retries`);
}

// ---------------------------------------------------------------- Jellyfin client

async function jf(path, init = {}) {
  const label = `Jellyfin ${init.method || 'GET'} ${path.split('?')[0]}`;
  for (let attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(`${CONFIG.jellyfinUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `MediaBrowser Token="${CONFIG.jellyfinKey}"`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers
        }
      });
    } catch (err) {
      if (attempt >= 4) throw new Error(`${label} → ${err.message}`);
      await sleep(attempt * 3000); // network blip / proxy restart
      continue;
    }
    if (res.status >= 500 && attempt < 4) {
      await sleep(attempt * 3000); // 502/503 from a reverse proxy — retry
      continue;
    }
    if (!res.ok) throw new Error(`${label} → HTTP ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
}

async function getAdminUserId() {
  const users = await jf('/Users');
  const admin = users.find((u) => u.Policy?.IsAdministrator) || users[0];
  if (!admin) throw new Error('No Jellyfin user found (is JELLYFIN_API_KEY an admin API key?)');
  return admin.Id;
}

async function listTitles() {
  const data = await jf('/Items?IncludeItemTypes=Movie,Series&Recursive=true&Fields=ProviderIds,Tags,ProductionYear,DateCreated');
  return data.Items || [];
}

/** Replace only the ddd: tags of an item, keeping everything else exactly as it is. */
async function writeDddTags(userId, itemId, dddTags) {
  const item = await jf(`/Items/${itemId}?userId=${userId}`);
  const kept = (item.Tags || []).filter((t) => !t.toLowerCase().startsWith(TAG_PREFIX));
  item.Tags = [...kept, ...dddTags];
  if (CONFIG.dryRun) return;
  await jf(`/Items/${itemId}`, { method: 'POST', body: JSON.stringify(item) });
}

// ---------------------------------------------------------------- matching & topic selection

function lastChecked(tags = []) {
  const t = tags.find((x) => x.toLowerCase().startsWith(CHECKED_PREFIX));
  const d = t ? new Date(t.slice(CHECKED_PREFIX.length)) : null;
  return d && !isNaN(d) ? d : null;
}

function needsCheck(item) {
  const checked = lastChecked(item.Tags);
  if (!checked) return true;
  return Date.now() - checked.getTime() > CONFIG.recheckDays * 86400_000;
}

async function findOnDdd(item) {
  // DDD item types: 15 = "Movie", 16 = "TV Show" (see /api/v3/itemtypes)
  const wantTypeId = item.Type === 'Series' ? 16 : 15;
  const pick = (results) => (results || []).find((r) => r.itemTypeId === wantTypeId) || null;
  const ids = item.ProviderIds || {};

  if (ids.Imdb) {
    const hit = pick(await ddd(`/items?imdb=${encodeURIComponent(ids.Imdb)}`));
    if (hit) return hit;
  }
  if (ids.Tmdb) {
    // TMDB ids are shared between movies and TV, hence the type check in pick()
    const hit = pick(await ddd(`/items?tmdb=${encodeURIComponent(ids.Tmdb)}`));
    if (hit) return hit;
  }
  const year = item.ProductionYear ? `&releaseYear=${item.ProductionYear}` : '';
  const results = await ddd(`/items?name=${encodeURIComponent(item.Name)}${year}`);
  return pick((results || []).filter((r) => r.name?.toLowerCase() === item.Name.toLowerCase()));
}

function slug(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

// The TV popup shows the first few tags, so serious warnings go first (in this order), then the rest by votes.
const PRIORITY = [
  /sexual assault|rape/, /suicide/, /self[- ]harm/, /child abuse/, /domestic violence/, /torture/,
  /murder|gun violence|violence|shot|stabb/, /gore|blood|mutilation/, /abuse/, /drug|overdose|addiction/,
  /alcohol/, /sexual content|sex|nudity/, /parents? dying|dies|death/, /jump scares?/, /kidnap/
];
// Tropes and "mentioned only" variants ("… is a joke", "black guy dies first") go last, whatever their votes.
const TROPE = /joke|mentioned|forgives|becomes|dies first|trope|stereotyp/;
const priorityOf = (name) => {
  if (TROPE.test(name)) return PRIORITY.length + 1;
  const i = PRIORITY.findIndex((re) => re.test(name));
  return i === -1 ? PRIORITY.length : i;
};

function selectTopics(detail, topicNames) {
  // TV shows list each topic several times: one show-level total plus small per-episode entries.
  // Keep the entry with the most votes per topic (the show-level one).
  const byTopic = new Map();
  for (const s of detail.topicItemStats || []) {
    const prev = byTopic.get(s.topicId);
    if (!prev || s.yesSum + s.noSum > prev.yesSum + prev.noSum) byTopic.set(s.topicId, s);
  }
  return [...byTopic.values()]
    .filter((s) => {
      const total = s.yesSum + s.noSum;
      return s.yesSum >= CONFIG.minYes && total > 0 && s.yesSum / total >= CONFIG.minYesRatio;
    })
    .map((s) => ({ name: slug(topicNames.get(s.topicId) || s.topicName || ''), yes: s.yesSum }))
    .filter((t) => t.name)
    .sort((a, b) => priorityOf(a.name) - priorityOf(b.name) || b.yes - a.yes)
    .map((t) => t.name);
}

/** Photosensitivity topics always survive the MAX_TOPICS cut — they drive the epilepsy warning. */
const PHOTOSENSITIVE = /flash|strob|seizure|epilep/i;

// ---------------------------------------------------------------- main

// DDD topic id → short display name. Fetched only when there is something to tag, refreshed weekly,
// so frequent checks with nothing new cost zero DDD requests.
let topicCache = { names: null, at: 0 };
async function getTopicNames() {
  if (!topicCache.names || Date.now() - topicCache.at > 7 * 86400_000) {
    const topics = await ddd('/topics');
    topicCache = { names: new Map((topics || []).map((t) => [t.id, t.minimalName || t.name])), at: Date.now() };
  }
  return topicCache.names;
}

/** Just added and Jellyfin hasn't fetched its IMDb/TMDB ids yet → try again later instead of "not found". */
function tooNewToJudge(item) {
  const ids = item.ProviderIds || {};
  const ageMs = Date.now() - new Date(item.DateCreated || 0).getTime();
  return !ids.Imdb && !ids.Tmdb && ageMs < 2 * 86400_000;
}

async function runOnce(reason = 'scheduled') {
  const titles = (await listTitles()).filter(needsCheck);
  if (titles.length === 0) {
    log(`[${reason}] nothing new to tag`);
    return;
  }
  log(`[${reason}] ${titles.length} title(s) to check${CONFIG.dryRun ? ' (DRY RUN — nothing is written)' : ''}`);
  const userId = await getAdminUserId();
  const topicNames = await getTopicNames();

  let tagged = 0, notFound = 0, failed = 0, retryLater = 0;
  for (const item of titles) {
    try {
      const match = await findOnDdd(item);
      let dddTags = [];
      if (match) {
        const detail = await ddd(`/items/${match.id}`);
        const all = selectTopics(detail || {}, topicNames);
        const photo = all.filter((t) => PHOTOSENSITIVE.test(t));
        const rest = all.filter((t) => !PHOTOSENSITIVE.test(t)).slice(0, Math.max(0, CONFIG.maxTopics - photo.length));
        dddTags = [...photo, ...rest].map((t) => `${TAG_PREFIX}${t}`);
        log(`✓ ${item.Name} → DDD #${match.id}: ${dddTags.length ? dddTags.join(', ') : '(no agreed topics)'}`);
        tagged++;
      } else if (tooNewToJudge(item)) {
        log(`… ${item.Name}: no IMDb/TMDB id yet (metadata still loading) — will retry`);
        retryLater++;
        continue;
      } else {
        log(`– ${item.Name}: not on DoesTheDogDie`);
        notFound++;
      }
      await writeDddTags(userId, item.Id, [...dddTags, `${CHECKED_PREFIX}${today()}`]);
    } catch (err) {
      if (err instanceof BudgetExhausted) {
        log(err.message);
        break;
      }
      failed++;
      log(`✗ ${item.Name}: ${err.message}`);
    }
  }
  log(`Run finished: ${tagged} matched, ${notFound} not found, ${retryLater} retry later, ${failed} failed. DDD requests left this month: ${Number.isFinite(dddMonthlyRemaining) ? dddMonthlyRemaining : 'unknown'}`);
  if (retryLater > 0) requestRun(30 * 60_000, 'retry new media');
}

// ---------------------------------------------------------------- scheduling (runs never overlap)

let running = false;
let timer = null;
let timerAt = Infinity;
let timerReason = '';

function requestRun(delayMs, reason) {
  const at = Date.now() + delayMs;
  if (timer && timerAt <= at) return; // an earlier run is already planned
  clearTimeout(timer);
  timerAt = at;
  timerReason = reason;
  timer = setTimeout(async () => {
    timer = null;
    timerAt = Infinity;
    if (running) return requestRun(60_000, timerReason); // busy: try again in a minute
    running = true;
    try {
      await runOnce(timerReason);
    } catch (err) {
      log(`Run failed: ${err.message}`);
    } finally {
      running = false;
    }
  }, delayMs);
}

// ---------------------------------------------------------------- live library watcher

/**
 * Jellyfin's WebSocket (the same live channel its apps use) sends "LibraryChanged" with ItemsAdded when new
 * media appears. We only react to additions — our own tag writes show up as updates and must not loop.
 */
function watchLibrary() {
  if (typeof WebSocket === 'undefined') {
    log('No WebSocket support in this Node version — relying on the periodic check only');
    return;
  }
  const url = `${CONFIG.jellyfinUrl.replace(/^http/, 'ws')}/socket?ApiKey=${CONFIG.jellyfinKey}&deviceId=ddd-tagger`;
  let keepAlive = null;

  const connect = () => {
    const ws = new WebSocket(url);
    ws.onopen = () => log('Watching Jellyfin for new media');
    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.MessageType === 'ForceKeepAlive') {
        clearInterval(keepAlive);
        const every = Math.max(5, Number(msg.Data) || 60) * 500; // half the server's timeout
        keepAlive = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ MessageType: 'KeepAlive' })), every);
      } else if (msg.MessageType === 'LibraryChanged' && msg.Data?.ItemsAdded?.length) {
        log(`New media added in Jellyfin (${msg.Data.ItemsAdded.length} item(s)) — tagging in ${CONFIG.watchDelayMinutes} min`);
        requestRun(CONFIG.watchDelayMinutes * 60_000, 'new media');
      }
    };
    ws.onclose = () => {
      clearInterval(keepAlive);
      log('Lost connection to Jellyfin — reconnecting in 30 s');
      setTimeout(connect, 30_000);
    };
    ws.onerror = () => {}; // onclose follows and handles the reconnect
  };
  connect();
}

// ---------------------------------------------------------------- main

async function main() {
  log('Jellyfin DDD tagger — Powered by DoesTheDogDie.com');
  if (CONFIG.runOnce) {
    try {
      await runOnce('manual');
    } catch (err) {
      log(`Run failed: ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }
  if (CONFIG.watch) watchLibrary();
  requestRun(5_000, 'startup');
  setInterval(() => requestRun(0, 'periodic'), CONFIG.intervalHours * 3600_000);
}

main();
