import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useFocusable, FocusContext, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { MonitorSpeaker, Smartphone, Laptop, Tv, X, Play, Pause, SkipBack, SkipForward, Volume1, Volume2, Check, Loader2, Music2, Film, Pencil } from 'lucide-react';
import { FocusableInput } from './FocusableInput';
import { cleanDeviceName, hasCustomDeviceName } from '../config/server';
import { FocusableButton } from './FocusableButton';
import { useAppState } from '../state/AppStateContext';
import { jellyfinClient } from '../api/jellyfin';
import { MediaItem } from '../mockData';
import { focusInside } from '../navigation/pageFocus';
import { setPendingAudioStart } from '../services/playerBridge';
import {
  RemoteDevice,
  chooseDevice,
  getConnectState,
  livePosition,
  refreshDevices,
  restartReceiver,
  remotePlay,
  remotePlaystate,
  remoteVolume,
  subscribeConnect,
  watchDevices
} from '../services/remoteSessions';
import '../styles/connect.css';

export const useConnect = () => useSyncExternalStore(subscribeConnect, getConnectState);

// ---------------------------------------------------------------- open from anywhere
let open = false;
let returnTo: string | null = null;
const openListeners = new Set<() => void>();
export function openConnect() {
  returnTo = getCurrentFocusKey();
  open = true;
  openListeners.forEach((l) => l());
}
function closeConnect() {
  open = false;
  openListeners.forEach((l) => l());
  const back = returnTo;
  if (back) setTimeout(() => setFocus(back), 60);
}
const useOpen = () =>
  useSyncExternalStore(
    (fn) => {
      openListeners.add(fn);
      return () => openListeners.delete(fn);
    },
    () => open
  );

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
};

const deviceIcon = (d: RemoteDevice, size = 22) => {
  const n = `${d.name} ${d.client}`.toLowerCase();
  if (/tv|tizen|samsung|freestyle|android tv|webos|roku|fire/.test(n)) return <Tv size={size} />;
  if (/phone|android|iphone|ios|mobile/.test(n)) return <Smartphone size={size} />;
  return <Laptop size={size} />;
};

/** Moves the "progress" a little every second between the 2.5 s updates. */
function useTick(active: boolean) {
  const [, setT] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setT((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [active]);
}

const MODAL = 'CONNECT_SHEET';

/**
 * "Play on…" (Spotify Connect style): this device + your other devices signed in to the server.
 * Choosing one moves what's playing there; while one is chosen this sheet is its remote.
 */
export const ConnectSheet: React.FC = () => {
  const isOpen = useOpen();
  const c = useConnect();
  const { activeAudio, isAudioPlaying, toggleAudioPlayPause, audioQueue, audioQueueIndex, playAudio } = useAppState();
  const { ref, focusKey } = useFocusable({ focusKey: MODAL, isFocusBoundary: true, focusable: isOpen, trackChildren: true });
  const [busy, setBusy] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [, bumpName] = useState(0);
  useTick(isOpen && !!c.target?.nowPlaying && !c.target.isPaused);

  useEffect(() => {
    if (!isOpen) return;
    const stop = watchDevices();
    focusInside(MODAL, [c.target ? 'CONNECT_PLAYPAUSE' : 'CONNECT_THIS', 'CONNECT_CLOSE']);
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.keyCode === 27 || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        closeConnect();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      stop();
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;
  const t = c.target;
  const thisName = jellyfinClient.getConfig().deviceName || 'This device';

  const saveName = async (name: string) => {
    setBusy('rename');
    try {
      await jellyfinClient.renameDevice(name);
      restartReceiver(); // the server (and your other devices) see the new name
      setTimeout(refreshDevices, 1500);
    } finally {
      setBusy(null);
      setRenaming(false);
      bumpName((x) => x + 1);
      setTimeout(() => setFocus('CONNECT_RENAME'), 80);
    }
  };

  /** Pick a device: what plays here moves there (same song, same spot) */
  const pick = async (d: RemoteDevice) => {
    if (t?.sessionId === d.sessionId) return;
    setBusy(d.sessionId);
    try {
      const audio = document.querySelector('audio');
      if (activeAudio && isAudioPlaying && audio) {
        await remotePlay(d.sessionId, audioQueue.map((q) => q.id), Math.max(0, audioQueueIndex), audio.currentTime);
        toggleAudioPlayPause(); // quiet here
      }
      chooseDevice(d);
      setTimeout(refreshDevices, 900);
      setTimeout(() => setFocus('CONNECT_PLAYPAUSE'), 300);
    } catch {
      alert(`Couldn't reach ${d.name}.`);
    } finally {
      setBusy(null);
    }
  };

  /** Back to this device: take over the song (and its queue) where the other device is */
  const pickThis = async () => {
    const from = t;
    chooseDevice(null);
    if (!from?.nowPlaying || from.nowPlaying.type !== 'music') return;
    setBusy('this');
    try {
      const ids = from.queueIds.length ? from.queueIds : [from.nowPlaying.id];
      const { userId } = jellyfinClient.getConfig();
      const base = (jellyfinClient.getConfig().serverUrl || '').replace(/\/$/, '');
      const res = await fetch(`${base}/Users/${userId}/Items?Ids=${ids.slice(0, 200).join(',')}&Fields=RunTimeTicks`, {
        headers: jellyfinClient.getRequestHeaders()
      });
      const raw: any[] = (await res.json()).Items || [];
      const byId = new Map(raw.map((i) => [i.Id, jellyfinClient.mapToMediaItem(i) as MediaItem]));
      const queue = ids.map((id) => byId.get(id)).filter(Boolean) as MediaItem[];
      const item = byId.get(from.nowPlaying.id);
      if (item) {
        setPendingAudioStart(item.id, livePosition(from));
        playAudio(item, queue.length ? queue : [item]);
      }
      remotePlaystate(from.sessionId, 'Stop').catch(() => {});
    } catch {
      alert(`Couldn't take over from ${from.name}.`);
    } finally {
      setBusy(null);
    }
  };

  const pos = t ? livePosition(t) : 0;
  const dur = t?.nowPlaying ? t.nowPlaying.runTimeTicks / 1e7 : 0;
  const cmd = (command: Parameters<typeof remotePlaystate>[1], secs?: number) =>
    t && remotePlaystate(t.sessionId, command, secs).then(() => setTimeout(refreshDevices, 400)).catch(() => {});
  const vol = (delta: number) => t && remoteVolume(t.sessionId, Math.min(100, Math.max(0, (t.volume ?? 50) + delta))).then(() => setTimeout(refreshDevices, 400));

  return (
    <FocusContext.Provider value={focusKey}>
      <div className="cx-backdrop" onClick={closeConnect}>
        <div ref={ref} data-focus-key={MODAL} className="cx" role="dialog" aria-modal="true" aria-label="Play on another device" onClick={(e) => e.stopPropagation()}>
          <div className="cx__head">
            <h2 className="cx__title">
              <MonitorSpeaker size={22} /> Play on…
            </h2>
            <FocusableButton focusKey="CONNECT_CLOSE" onPress={closeConnect} style={{ padding: 8, borderRadius: '50%' }}>
              <X size={20} />
            </FocusableButton>
          </div>

          {/* Remote for the chosen device */}
          {t && (
            <div className="cx__remote">
              <div className="cx__now">
                <span className="cx__art">
                  {t.nowPlaying?.image ? <img src={t.nowPlaying.image} alt="" /> : t.nowPlaying?.type === 'music' ? <Music2 size={26} /> : <Film size={26} />}
                </span>
                <span className="cx__nowtext">
                  <span className="cx__on">Playing on {t.name}</span>
                  <span className="cx__song">{t.nowPlaying ? t.nowPlaying.title : 'Nothing playing — pick something to play'}</span>
                  {t.nowPlaying?.subtitle && <span className="cx__artist">{t.nowPlaying.subtitle}</span>}
                </span>
              </div>
              {t.nowPlaying && (
                <>
                  <div
                    className="cx__bar"
                    onClick={(e) => {
                      const r = e.currentTarget.getBoundingClientRect();
                      if (dur) cmd('Seek', ((e.clientX - r.left) / r.width) * dur);
                    }}
                  >
                    <span style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
                  </div>
                  <div className="cx__times">
                    <span>{fmt(pos)}</span>
                    <span>{fmt(dur)}</span>
                  </div>
                  <div className="cx__controls">
                    <FocusableButton focusKey="CONNECT_PREV" onPress={() => cmd('PreviousTrack')} className="cx__btn">
                      <SkipBack size={22} fill="currentColor" />
                    </FocusableButton>
                    <FocusableButton focusKey="CONNECT_PLAYPAUSE" onPress={() => cmd('PlayPause')} className="cx__btn cx__btn--main">
                      {t.isPaused ? <Play size={28} fill="currentColor" /> : <Pause size={28} fill="currentColor" />}
                    </FocusableButton>
                    <FocusableButton focusKey="CONNECT_NEXT" onPress={() => cmd('NextTrack')} className="cx__btn">
                      <SkipForward size={22} fill="currentColor" />
                    </FocusableButton>
                  </div>
                  {t.volume !== null && (
                    <div className="cx__volume">
                      <FocusableButton focusKey="CONNECT_VOL_DOWN" onPress={() => vol(-10)} className="cx__btn cx__btn--sm">
                        <Volume1 size={18} />
                      </FocusableButton>
                      <span className="cx__volbar">
                        <span style={{ width: `${t.isMuted ? 0 : t.volume}%` }} />
                      </span>
                      <FocusableButton focusKey="CONNECT_VOL_UP" onPress={() => vol(10)} className="cx__btn cx__btn--sm">
                        <Volume2 size={18} />
                      </FocusableButton>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="cx__list">
            <div className="cx__thisrow">
              <FocusableButton focusKey="CONNECT_THIS" onPress={pickThis} className={`cx__dev ${!t ? 'is-on' : ''}`}>
                <span className="cx__devicon">
                  <Laptop size={22} />
                </span>
                <span className="cx__devtext">
                  <span className="cx__devname">This device</span>
                  <span className="cx__devsub">{thisName}</span>
                </span>
                {busy === 'this' ? <Loader2 size={18} className="animate-spin" /> : !t ? <Check size={18} /> : null}
              </FocusableButton>
              <FocusableButton
                focusKey="CONNECT_RENAME"
                onPress={() => {
                  setNameDraft(hasCustomDeviceName() ? thisName : '');
                  setRenaming(true);
                  focusInside(MODAL, ['CONNECT_NAME_INPUT']);
                }}
                className="cx__rename"
              >
                <span title="Rename this device" aria-label="Rename this device" style={{ display: 'inline-flex' }}>
                  <Pencil size={18} />
                </span>
              </FocusableButton>
            </div>
            {renaming && (
              <div className="cx__renamebox">
                <span className="cx__devsub">Name shown on your other devices and on the server (e.g. “Projector”, “My phone”)</span>
                <div className="cx__renamerow">
                  <FocusableInput
                    focusKeyId="CONNECT_NAME_INPUT"
                    value={nameDraft}
                    placeholder={thisName}
                    maxLength={40}
                    autoFocus
                    onChange={(e) => setNameDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveName(nameDraft);
                    }}
                  />
                  <FocusableButton focusKey="CONNECT_NAME_SAVE" onPress={() => saveName(nameDraft)} disabled={busy === 'rename' || !cleanDeviceName(nameDraft)}>
                    {busy === 'rename' ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} <span>Save</span>
                  </FocusableButton>
                </div>
                {hasCustomDeviceName() && (
                  <FocusableButton focusKey="CONNECT_NAME_RESET" onPress={() => saveName('')} style={{ alignSelf: 'flex-start', padding: '6px 12px', fontSize: '0.85rem' }}>
                    <span>Automatic name</span>
                  </FocusableButton>
                )}
              </div>
            )}

            {c.devices.map((d) => (
              <FocusableButton key={d.sessionId} focusKey={`CONNECT_DEV_${d.sessionId}`} onPress={() => pick(d)} className={`cx__dev ${t?.sessionId === d.sessionId ? 'is-on' : ''}`}>
                <span className="cx__devicon">{deviceIcon(d)}</span>
                <span className="cx__devtext">
                  <span className="cx__devname">{d.name}</span>
                  <span className="cx__devsub">
                    {d.nowPlaying ? `${d.isPaused ? 'Paused' : 'Playing'}: ${d.nowPlaying.title}` : d.client}
                  </span>
                </span>
                {busy === d.sessionId ? <Loader2 size={18} className="animate-spin" /> : t?.sessionId === d.sessionId ? <Check size={18} /> : null}
              </FocusableButton>
            ))}
            {c.loading && <p className="cx__note">Looking for your devices…</p>}
            {!c.loading && !c.devices.length && (
              <p className="cx__note">
                No other device found. Open Yudia (or another Jellyfin app) on your TV, projector, laptop or phone with this account, and it shows up here.
              </p>
            )}
            {c.error && <p className="cx__note cx__note--err">{c.error}</p>}
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

/** Devices button (speaker icon); accent while another device is chosen. */
export const ConnectButton: React.FC<{ focusKey?: string; className?: string; style?: React.CSSProperties; plain?: boolean }> = ({
  focusKey,
  className,
  style,
  plain
}) => {
  const c = useConnect();
  const label = c.target ? `Playing on ${c.target.name}` : 'Play on another device';
  const icon = <MonitorSpeaker size={plain ? 22 : 20} color={c.target ? 'var(--accent)' : undefined} />;
  if (plain)
    return (
      <button className={className} style={style} aria-label={label} title={label} onClick={openConnect}>
        {icon}
      </button>
    );
  return (
    <FocusableButton focusKey={focusKey} onPress={openConnect} className={className} style={{ ...(c.target ? { borderColor: 'var(--accent)' } : {}), ...style }}>
      <span aria-label={label} title={label} style={{ display: 'inline-flex' }}>
        {icon}
      </span>
    </FocusableButton>
  );
};

/** Bottom bar while another device is chosen: what it plays + play/pause; tap opens the remote. */
export const ConnectBar: React.FC = () => {
  const c = useConnect();
  const t = c.target;
  useTick(!!t?.nowPlaying && !t.isPaused);
  if (!t) return null;
  const pos = livePosition(t);
  const dur = t.nowPlaying ? t.nowPlaying.runTimeTicks / 1e7 : 0;
  return (
    <div className="cx-bar" role="button" tabIndex={0} onClick={openConnect} aria-label={`Playing on ${t.name}. Open remote`}>
      <span className="cx-bar__progress" style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
      <span className="cx__art cx-bar__art">{t.nowPlaying?.image ? <img src={t.nowPlaying.image} alt="" /> : <MonitorSpeaker size={20} />}</span>
      <span className="cx-bar__text">
        <span className="cx-bar__title">{t.nowPlaying?.title || 'Nothing playing'}</span>
        <span className="cx-bar__on">
          <MonitorSpeaker size={13} /> {t.name}
        </span>
      </span>
      {t.nowPlaying && (
        <button
          className="cx-bar__btn"
          aria-label={t.isPaused ? 'Play' : 'Pause'}
          onClick={(e) => {
            e.stopPropagation();
            remotePlaystate(t.sessionId, 'PlayPause').then(() => setTimeout(refreshDevices, 400));
          }}
        >
          {t.isPaused ? <Play size={22} fill="currentColor" /> : <Pause size={22} fill="currentColor" />}
        </button>
      )}
    </div>
  );
};
