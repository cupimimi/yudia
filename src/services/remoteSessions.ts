/**
 * Yudia Connect — control your other devices, like Spotify Connect, using Jellyfin's own remote control.
 *
 * Every signed-in Yudia (TV, projector, website, phone) is a Jellyfin session:
 *  • Receiver: it tells the server it can be remote-controlled (capabilities), keeps a WebSocket open and obeys
 *    Play / Playstate / volume commands sent to it. The players report what's playing, so others can see it.
 *  • Controller: lists the other sessions you can control (other Yudias, and other Jellyfin apps that accept
 *    remote control), shows what they play, and sends them commands.
 */
import { jellyfinClient } from '../api/jellyfin';
import { MediaItem } from '../mockData';
import { activePlayer, setPendingAudioStart } from './playerBridge';
import { isTizen } from '../theme/performance';

// ================================================================ receiver

export interface ReceiverActions {
  playAudio: (item: MediaItem, queue: MediaItem[]) => void;
  playVideo: (item: MediaItem) => void;
  showMessage?: (text: string) => void;
}

let socket: WebSocket | null = null;
let keepAlive: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let receiverActions: ReceiverActions | null = null;
let connectedFor = ''; // server|token the socket belongs to
let retries = 0;

const cfg = () => jellyfinClient.getConfig();
const base = () => (cfg().serverUrl || '').replace(/\/$/, '');

async function api(method: 'GET' | 'POST', path: string, body?: unknown) {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: jellyfinClient.getRequestHeaders(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  return res;
}

async function reportCapabilities() {
  await api('POST', '/Sessions/Capabilities/Full', {
    PlayableMediaTypes: ['Audio', 'Video'],
    SupportedCommands: ['SetVolume', 'VolumeUp', 'VolumeDown', 'Mute', 'Unmute', 'ToggleMute', 'DisplayMessage'],
    SupportsMediaControl: true,
    SupportsPersistentIdentifier: true
  });
}

async function fetchItems(ids: string[]): Promise<MediaItem[]> {
  const { userId } = cfg();
  const res = await api('GET', `/Users/${userId}/Items?Ids=${ids.join(',')}&Fields=Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags,SeriesName`);
  const items: any[] = (await res.json()).Items || [];
  const byId = new Map(items.map((i) => [i.Id, jellyfinClient.mapToMediaItem(i) as MediaItem]));
  return ids.map((id) => byId.get(id)).filter(Boolean) as MediaItem[];
}

async function onMessage(msg: any) {
  const p = activePlayer();
  switch (msg.MessageType) {
    case 'ForceKeepAlive': {
      const secs = Math.max(10, Number(msg.Data) || 60);
      if (keepAlive) clearInterval(keepAlive);
      keepAlive = setInterval(() => socket?.readyState === 1 && socket.send(JSON.stringify({ MessageType: 'KeepAlive' })), (secs * 1000) / 2);
      break;
    }
    case 'Play': {
      const d = msg.Data || {};
      const ids: string[] = d.ItemIds || [];
      if (!ids.length || !receiverActions) return;
      const items = await fetchItems(ids);
      const start = Math.min(Math.max(0, d.StartIndex || 0), items.length - 1);
      const item = items[start];
      if (!item) return;
      const startSecs = (d.StartPositionTicks || 0) / 1e7;
      if (item.type === 'music') {
        setPendingAudioStart(item.id, startSecs);
        receiverActions.playAudio(item, items.filter((i) => i.type === 'music'));
      } else {
        const pct = startSecs && item.runTimeTicks ? Math.min(99, (startSecs * 1e7 * 100) / item.runTimeTicks) : 0;
        receiverActions.playVideo({ ...item, playbackPercent: pct || undefined });
      }
      break;
    }
    case 'Playstate': {
      const d = msg.Data || {};
      if (!p) return;
      switch (d.Command) {
        case 'Pause':
          p.pause();
          break;
        case 'Unpause':
          p.unpause();
          break;
        case 'PlayPause':
          p.togglePause();
          break;
        case 'Stop':
          p.stop();
          break;
        case 'NextTrack':
          p.next?.();
          break;
        case 'PreviousTrack':
          p.previous?.();
          break;
        case 'Seek':
          p.seek((d.SeekPositionTicks || 0) / 1e7);
          break;
      }
      break;
    }
    case 'GeneralCommand': {
      const d = msg.Data || {};
      const args = d.Arguments || {};
      switch (d.Name) {
        case 'SetVolume':
          p?.setVolume?.(Number(args.Volume));
          break;
        case 'VolumeUp':
          p?.setVolume?.(-1);
          break;
        case 'VolumeDown':
          p?.setVolume?.(-2);
          break;
        case 'Mute':
          p?.toggleMute?.(true);
          break;
        case 'Unmute':
          p?.toggleMute?.(false);
          break;
        case 'ToggleMute':
          p?.toggleMute?.();
          break;
        case 'DisplayMessage':
          receiverActions?.showMessage?.(args.Header ? `${args.Header}: ${args.Text || ''}` : args.Text || '');
          break;
      }
      break;
    }
  }
}

/** Start (or restart after a new sign-in) listening for remote commands. Safe to call often. */
export function startReceiver(actions: ReceiverActions) {
  receiverActions = actions;
  const { serverUrl, accessToken, deviceId } = cfg();
  if (!serverUrl || !accessToken) return;
  const key = `${serverUrl}|${accessToken}`;
  if (socket && connectedFor === key && socket.readyState <= 1) return;
  stopReceiver();
  connectedFor = key;
  reportCapabilities().catch(() => {});
  const wsUrl = `${base().replace(/^http/, 'ws')}/socket?ApiKey=${encodeURIComponent(accessToken)}&deviceId=${encodeURIComponent(deviceId || '')}`;
  try {
    socket = new WebSocket(wsUrl);
  } catch {
    return;
  }
  socket.onopen = () => {
    retries = 0;
  };
  socket.onmessage = (ev) => {
    try {
      onMessage(JSON.parse(ev.data));
    } catch {}
  };
  socket.onclose = () => {
    if (keepAlive) clearInterval(keepAlive);
    keepAlive = null;
    if (connectedFor !== key) return; // replaced on purpose
    socket = null;
    // reconnect: 2 s, 4 s … up to 60 s
    const delay = Math.min(60_000, 2000 * 2 ** retries++);
    reconnectTimer = setTimeout(() => {
      connectedFor = '';
      if (receiverActions) startReceiver(receiverActions);
    }, delay);
  };
}

export function stopReceiver() {
  connectedFor = '';
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (keepAlive) clearInterval(keepAlive);
  keepAlive = null;
  try {
    socket?.close();
  } catch {}
  socket = null;
}

// ================================================================ controller

export interface RemoteDevice {
  sessionId: string;
  deviceId: string;
  name: string;
  client: string;
  canControl: boolean;
  nowPlaying: null | {
    id: string;
    type: 'music' | 'movie' | 'tv';
    title: string;
    subtitle: string;
    image: string;
    runTimeTicks: number;
  };
  positionTicks: number;
  isPaused: boolean;
  volume: number | null;
  isMuted: boolean;
  queueIds: string[];
  queueIndex: number;
  lastUpdate: number; // when we fetched it (to move the progress bar between updates)
}

function toDevice(s: any): RemoteDevice {
  const n = s.NowPlayingItem;
  const queue: any[] = s.NowPlayingQueue || [];
  const ps = s.PlayState || {};
  const isAudio = n?.Type === 'Audio';
  const imgId = n ? (isAudio && !n.ImageTags?.Primary && n.AlbumId ? n.AlbumId : n.Id) : '';
  const imgTag = n ? (imgId === n.Id ? n.ImageTags?.Primary : n.AlbumPrimaryImageTag) : undefined;
  return {
    sessionId: s.Id,
    deviceId: s.DeviceId,
    name: s.DeviceName || s.Client || 'Device',
    client: s.Client || '',
    canControl: !!s.SupportsRemoteControl,
    nowPlaying: n
      ? {
          id: n.Id,
          type: isAudio ? 'music' : n.Type === 'Episode' ? 'tv' : 'movie',
          title: n.Name,
          subtitle: isAudio ? [n.AlbumArtist || n.Artists?.[0], n.Album].filter(Boolean).join(' · ') : n.SeriesName || n.ProductionYear || '',
          image: imgId ? jellyfinClient.getImageUrl(imgId, 'Primary', 300, imgTag) : '',
          runTimeTicks: n.RunTimeTicks || 0
        }
      : null,
    positionTicks: ps.PositionTicks || 0,
    isPaused: !!ps.IsPaused,
    volume: typeof ps.VolumeLevel === 'number' ? ps.VolumeLevel : null,
    isMuted: !!ps.IsMuted,
    queueIds: queue.map((q) => q.Id),
    queueIndex: Math.max(0, queue.findIndex((q) => q.Id === n?.Id)),
    lastUpdate: Date.now()
  };
}

/** Other devices you can control (this one excluded), most recently active first. */
export async function listDevices(): Promise<RemoteDevice[]> {
  const { userId, deviceId } = cfg();
  const res = await api('GET', `/Sessions?ControllableByUserId=${userId}&ActiveWithinSeconds=900`);
  const all: any[] = await res.json();
  return all
    .filter((s) => s.DeviceId !== deviceId && s.SupportsRemoteControl)
    .sort((a, b) => (b.NowPlayingItem ? 1 : 0) - (a.NowPlayingItem ? 1 : 0) || String(b.LastActivityDate).localeCompare(String(a.LastActivityDate)))
    .map(toDevice);
}

export async function remotePlay(sessionId: string, itemIds: string[], startIndex = 0, startSeconds = 0) {
  // Keep the URL reasonable: the songs around the chosen one
  const from = Math.max(0, startIndex - 20);
  const ids = itemIds.slice(from, from + 150);
  const q = new URLSearchParams({ playCommand: 'PlayNow', itemIds: ids.join(','), startIndex: String(startIndex - from) });
  if (startSeconds > 0) q.set('startPositionTicks', String(Math.round(startSeconds * 1e7)));
  await api('POST', `/Sessions/${sessionId}/Playing?${q.toString()}`);
}

export type RemoteCommand = 'PlayPause' | 'Pause' | 'Unpause' | 'Stop' | 'NextTrack' | 'PreviousTrack' | 'Seek';
export async function remotePlaystate(sessionId: string, command: RemoteCommand, seekSeconds?: number) {
  const q = command === 'Seek' ? `?seekPositionTicks=${Math.round((seekSeconds || 0) * 1e7)}` : '';
  await api('POST', `/Sessions/${sessionId}/Playing/${command}${q}`);
}

export async function remoteVolume(sessionId: string, percent: number) {
  await api('POST', `/Sessions/${sessionId}/Command`, { Name: 'SetVolume', Arguments: { Volume: String(Math.round(percent)) } });
}

// ---------------------------------------------------------------- chosen device (shared state)

export interface ConnectState {
  target: RemoteDevice | null; // null = this device
  devices: RemoteDevice[];
  loading: boolean;
  error: string | null;
}
let cstate: ConnectState = { target: null, devices: [], loading: false, error: null };
const listeners = new Set<() => void>();
export const getConnectState = () => cstate;
export function subscribeConnect(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function setC(patch: Partial<ConnectState>) {
  cstate = { ...cstate, ...patch };
  listeners.forEach((l) => l());
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let watchers = 0;

export async function refreshDevices() {
  if (!cfg().accessToken) return;
  try {
    const devices = await listDevices();
    let t = cstate.target ? devices.find((d) => d.sessionId === cstate.target!.sessionId) || null : null;
    // Attached automatically and that device stopped playing → let go
    if (t && autoChosen && !t.nowPlaying) {
      t = null;
      autoChosen = false;
    }
    // The chosen device went away (app closed) → back to this device
    setC({ devices, target: cstate.target && !t ? null : t, error: null, loading: false });
  } catch (e: any) {
    setC({ loading: false, error: e?.message || 'Could not reach the server' });
  }
}

/** Keep the device list fresh while something shows it (sheet open, or a device is chosen). */
export function watchDevices(): () => void {
  watchers++;
  if (!pollTimer) {
    setC({ loading: !cstate.devices.length });
    refreshDevices();
    pollTimer = setInterval(refreshDevices, 2500);
  }
  return () => {
    watchers--;
    if (watchers <= 0 && pollTimer && !cstate.target) {
      clearInterval(pollTimer);
      pollTimer = null;
      watchers = 0;
    }
  };
}

let autoChosen = false;
let followSuppressedUntil = 0;

/**
 * Choose the device to play on / control (null = this device).
 * @param auto chosen by auto-attach (released again when that device stops playing)
 */
export function chooseDevice(d: RemoteDevice | null, auto = false) {
  autoChosen = !!d && auto;
  // You picked "This device" yourself: don't attach to another one again for 30 minutes
  if (!d && !auto) followSuppressedUntil = Date.now() + 30 * 60_000;
  setC({ target: d });
  if (d && !pollTimer) pollTimer = setInterval(refreshDevices, 2500);
  if (!d && watchers <= 0 && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/** Position of the chosen device now (moves between the 2.5 s updates while playing). */
export function livePosition(d: RemoteDevice): number {
  const secs = d.positionTicks / 1e7;
  return d.isPaused || !d.nowPlaying ? secs : secs + (Date.now() - d.lastUpdate) / 1000;
}

/** Reconnect the live connection (e.g. after renaming this device, so the server shows the new name). */
export function restartReceiver() {
  const actions = receiverActions;
  stopReceiver();
  if (actions) startReceiver(actions);
}

/**
 * Auto-attach (phones / laptops, not the TV): when nothing plays here and one of your devices is playing,
 * this one becomes its remote — its lock screen and media keys then control that device (like Spotify).
 */
export function startAutoFollow(isPlayingHere: () => boolean) {
  if (isTizen() || (window as any).__yudiaFollow) return;
  (window as any).__yudiaFollow = true;
  const tick = async () => {
    if (document.visibilityState !== 'visible' || cstate.target || Date.now() < followSuppressedUntil || isPlayingHere() || !cfg().accessToken) return;
    try {
      const devices = await listDevices();
      const playing = devices.find((d) => d.nowPlaying && !d.isPaused);
      if (playing && !cstate.target && !isPlayingHere()) {
        setC({ devices });
        chooseDevice(playing, true);
      }
    } catch {}
  };
  setTimeout(tick, 4000);
  setInterval(tick, 15_000);
  document.addEventListener('visibilitychange', tick);
}
