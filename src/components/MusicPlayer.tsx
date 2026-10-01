import React, { useRef, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useFocusable, FocusContext, setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Minimize2,
  Maximize2,
  FileText,
  ListMusic,
  Disc3,
  Volume2,
  ChevronDown,
  Cast,
  ListPlus
} from 'lucide-react';
import { openPlaylistPicker } from './PlaylistPicker';
import { useAppState } from '../state/AppStateContext';
import { jellyfinClient } from '../api/jellyfin';
import { jellyfinTvService } from '../services/jellyfinTvService';
import { registerPlayer, takePendingAudioStart } from '../services/playerBridge';
import { getConnectState, subscribeConnect, livePosition, remotePlaystate, refreshDevices, RemoteCommand } from '../services/remoteSessions';
import { getDownload, getOfflineMediaUrl, getOfflineImageUrl } from '../services/downloads';
import { FocusableButton } from './FocusableButton';
import { CastButton, useCast } from './CastButton';
import { ConnectButton } from './ConnectSheet';
import { castMedia, castPause, castPlay, castSeek } from '../services/cast';
import '../styles/player.css';
import { focusPage } from '../navigation/pageFocus';

type PlayerMode = 'player' | 'lyrics' | 'queue';
const MODES: PlayerMode[] = ['player', 'lyrics', 'queue'];

export const MusicPlayer: React.FC = () => {
  const {
    activeAudio,
    isAudioPlaying,
    toggleAudioPlayPause,
    nextAudioTrack,
    prevAudioTrack,
    isMusicFullScreen,
    setIsMusicFullScreen,
    audioQueue,
    audioQueueIndex,
    playAudio,
    setAudioProgress,
    isAudioMuted,
    toggleAudioMute,
    activeTab
  } = useAppState();
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const audioRef = useRef<HTMLAudioElement>(null);
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  // Real lyrics from Jellyfin for the current song (synced .lrc → highlighted line that follows the music)
  const [lyrics, setLyrics] = useState<{ time: number; text: string }[]>([]);
  const [lyricsSynced, setLyricsSynced] = useState(false);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const lastLyricIdxRef = useRef(-1);
  useEffect(() => {
    setLyrics([]);
    setLyricsSynced(false);
    lastLyricIdxRef.current = -1;
    if (!activeAudio?.id) return;
    const ctrl = new AbortController();
    // Downloaded song: the lyrics saved with it (works offline)
    const saved = getDownload(activeAudio.id)?.lyrics;
    if (saved && saved.lines.length) {
      setLyrics(saved.lines);
      setLyricsSynced(saved.synced);
      setLyricsLoading(false);
      return;
    }
    setLyricsLoading(true);
    jellyfinClient.getLyrics(activeAudio.id, ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      setLyrics(r.lines);
      setLyricsSynced(r.synced);
      setLyricsLoading(false);
    });
    return () => ctrl.abort();
  }, [activeAudio?.id]);

  // Always a fresh stream address from the id (a saved one can hold an old sign-in → 401)
  // Downloaded songs play from this device (offline too)
  const isOfflineSong = !!(activeAudio?.id && getDownload(activeAudio.id));
  const [offlineAudioSrc, setOfflineAudioSrc] = useState<string | null>(null);
  useEffect(() => {
    setOfflineAudioSrc(null);
    if (!isOfflineSong || !activeAudio?.id) return;
    let alive = true;
    getOfflineMediaUrl(activeAudio.id).then((u) => alive && setOfflineAudioSrc(u));
    return () => {
      alive = false;
    };
  }, [activeAudio?.id, isOfflineSong]);
  // One fixed address per song: a library refresh / new sign-in when you come back to the app must not change it
  // (a different address made the player load the song again — from the beginning).
  const onlineUrl = useMemo(
    () => (activeAudio?.id ? jellyfinClient.getStreamUrl(activeAudio.id, 'audio') : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeAudio?.id]
  );
  const streamUrl = isOfflineSong ? offlineAudioSrc || '' : onlineUrl;

  // ---- Keep the place in the song: saved every few seconds and when the app goes to the background, so if the
  // phone closes the page while you're away, the song comes back where you were (not from the start).
  const POS_KEY = 'yudia_audio_position';
  const restoreRef = useRef<{ id: string; t: number } | null>(
    (() => {
      try {
        return JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      } catch {
        return null;
      }
    })()
  );
  const lastSavedRef = useRef(0);
  const savePosition = (force = false) => {
    const a = audioRef.current;
    if (!a || !activeAudio?.id || !(a.currentTime > 0)) return;
    const now = Date.now();
    if (!force && now - lastSavedRef.current < 3000) return;
    lastSavedRef.current = now;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify({ id: activeAudio.id, t: a.currentTime }));
    } catch {}
  };
  useEffect(() => {
    const onHide = () => savePosition(true);
    const onVis = () => document.visibilityState === 'hidden' && savePosition(true);
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onVis);
    };
  });
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isShuffle, setIsShuffle] = useState(false);
  const [isRepeat, setIsRepeat] = useState(false);
  const [activeTabMode, setActiveTabMode] = useState<PlayerMode>('player');

  // Open / close animation: stay mounted while sliding down, then unmount
  const [fsRendered, setFsRendered] = useState(isMusicFullScreen);
  const [fsClosing, setFsClosing] = useState(false);
  // Where the remote was before the player opened: it goes back there when the player closes
  const focusBeforeRef = useRef<string | null>(null);
  useEffect(() => {
    if (isMusicFullScreen) {
      const before = getCurrentFocusKey();
      if (before && !before.startsWith('MP_')) focusBeforeRef.current = before;
      setFsRendered(true);
      setFsClosing(false);
      const t = setTimeout(() => setFocus('MP_PLAY'), 150);
      return () => clearTimeout(t);
    }
    if (!fsRendered) return;
    setFsClosing(true);
    const back = focusBeforeRef.current;
    // Leave the (disappearing) player right away so the next key press isn't lost
    if (back) setFocus(back);
    const t = setTimeout(() => {
      setFsRendered(false);
      setFsClosing(false);
      // Still nothing focused (the old item is gone)? Land on the page instead.
      if (!document.querySelector('.focused')) focusPage(activeTabRef.current);
    }, 380);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMusicFullScreen]);

  // Mode change animation (FLIP): remember where cover / title / controls were, switch layout, then glide
  // each one from its old spot to its new one.
  const artRef = useRef<HTMLDivElement>(null);
  const metaRef = useRef<HTMLDivElement>(null);
  const ctrlRef = useRef<HTMLDivElement>(null);
  const flipFrom = useRef<Record<string, DOMRect> | null>(null);
  const changeMode = (mode: PlayerMode) => {
    if (mode === activeTabMode) return;
    const snap: Record<string, DOMRect> = {};
    const els: [string, React.RefObject<HTMLDivElement>][] = [['art', artRef], ['meta', metaRef], ['ctrl', ctrlRef]];
    els.forEach(([k, r]) => {
      if (r.current) snap[k] = r.current.getBoundingClientRect();
    });
    flipFrom.current = snap;
    lastLyricIdxRef.current = -1; // re-centre the current lyric line when lyrics open
    setActiveTabMode(mode);
  };
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!from) return;
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    } catch {}
    const els: [string, HTMLDivElement | null][] = [['art', artRef.current], ['meta', metaRef.current], ['ctrl', ctrlRef.current]];
    els.forEach(([k, el]) => {
      const prev = from[k];
      if (!el || !prev || !prev.width) return;
      const next = el.getBoundingClientRect();
      if (!next.width) return;
      const dx = prev.left - next.left;
      const dy = prev.top - next.top;
      const sc = k === 'ctrl' ? 1 : prev.width / next.width; // cover and title grow/shrink, controls just move
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(sc - 1) < 0.01) return;
      el.style.transition = 'none';
      el.style.transformOrigin = 'top left';
      el.style.transform = `translate(${dx}px, ${dy}px) scale(${sc})`;
      void el.offsetWidth; // apply the start position before animating
      el.style.transition = 'transform 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transform = '';
      window.setTimeout(() => {
        el.style.transition = '';
      }, 650);
    });
  }, [activeTabMode]);

  // Full screen: a focus boundary, so the remote can't wander onto the (hidden) page behind it
  const { ref, focusKey } = useFocusable({
    focusKey: 'MUSIC_PLAYER',
    isFocusBoundary: true,
    focusable: fsRendered && !fsClosing
  });
  const lyricsFocusedRef = useRef(false);

  // Audio Playback effect
  // ---- Google Cast (website): the song plays on the TV, this device stays silent and acts as the remote
  const cast = useCast();
  const casting = cast.connected;
  const castRequestedRef = useRef<string | null>(null);
  const lastCastTimeRef = useRef(0);
  const resumeLocalAtRef = useRef<number | null>(null);
  useEffect(() => {
    if (!casting) {
      castRequestedRef.current = null;
      return;
    }
    if (!activeAudio || cast.mediaId === activeAudio.id || castRequestedRef.current === activeAudio.id) return;
    castRequestedRef.current = activeAudio.id;
    const from = audioRef.current && !audioRef.current.ended ? audioRef.current.currentTime : 0;
    audioRef.current?.pause();
    castMedia(activeAudio, { startSeconds: from }).then((ok) => {
      if (ok && !isAudioPlaying) castPause();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, activeAudio?.id, cast.mediaId]);
  // play / pause pressed here → the TV follows
  useEffect(() => {
    if (!casting || cast.mediaId !== activeAudio?.id) return;
    if (isAudioPlaying) castPlay();
    else castPause();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioPlaying, casting]);
  // the TV's position drives the progress bar
  useEffect(() => {
    if (!casting || cast.mediaId !== activeAudio?.id) return;
    lastCastTimeRef.current = cast.currentTime;
    setCurrentTime(cast.currentTime);
    if (cast.duration > 0) setDuration(cast.duration);
    setAudioProgress(cast.currentTime, cast.duration || duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast.currentTime, cast.duration, casting]);
  // the song ended on the TV → next one (or again, on repeat)
  const finishedSeenRef = useRef(cast.finished);
  useEffect(() => {
    if (cast.finished === finishedSeenRef.current) return;
    finishedSeenRef.current = cast.finished;
    if (!casting) return;
    if (isRepeat) {
      castSeek(0);
      castPlay();
    } else {
      nextAudioTrack();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast.finished]);
  // casting stopped → carry on here from where the TV was
  const wasCastingRef = useRef(false);
  useEffect(() => {
    if (wasCastingRef.current && !casting) resumeLocalAtRef.current = lastCastTimeRef.current;
    wasCastingRef.current = casting;
  }, [casting]);

  // ---- Yudia Connect (receiver): other devices see what plays here and can control it
  const live = useRef({ isAudioPlaying, toggleAudioPlayPause, nextAudioTrack, prevAudioTrack, toggleAudioMute, isAudioMuted, casting });
  live.current = { isAudioPlaying, toggleAudioPlayPause, nextAudioTrack, prevAudioTrack, toggleAudioMute, isAudioMuted, casting };
  useEffect(
    () =>
      registerPlayer({
        kind: 'audio',
        pause: () => live.current.isAudioPlaying && live.current.toggleAudioPlayPause(),
        unpause: () => !live.current.isAudioPlaying && live.current.toggleAudioPlayPause(),
        togglePause: () => live.current.toggleAudioPlayPause(),
        seek: (secs) => {
          if (live.current.casting) castSeek(secs);
          else if (audioRef.current) audioRef.current.currentTime = Math.max(0, secs);
        },
        next: () => live.current.nextAudioTrack(),
        previous: () => live.current.prevAudioTrack(),
        stop: () => live.current.isAudioPlaying && live.current.toggleAudioPlayPause(),
        setVolume: (pct) => {
          const a = audioRef.current;
          if (!a) return;
          a.volume = pct === -1 ? Math.min(1, a.volume + 0.1) : pct === -2 ? Math.max(0, a.volume - 0.1) : Math.min(1, Math.max(0, pct / 100));
          reportNow();
        },
        toggleMute: (mute) => {
          if (mute === undefined || mute !== live.current.isAudioMuted) live.current.toggleAudioMute();
        }
      }),
    []
  );
  const reportedIdRef = useRef<string | null>(null);
  const lastReportRef = useRef(0);
  const sessionExtra = () => ({
    VolumeLevel: Math.round((audioRef.current?.volume ?? 1) * 100),
    IsMuted: !!audioRef.current?.muted,
    NowPlayingQueue: audioQueue.slice(0, 300).map((q, i) => ({ Id: q.id, PlaylistItemId: `q${i}` })),
    PlaylistItemId: `q${audioQueueIndex}`
  });
  const reportNow = () => {
    const a = audioRef.current;
    const id = reportedIdRef.current;
    if (!a || !id || live.current.casting) return;
    lastReportRef.current = Date.now();
    jellyfinTvService.reportPlaybackProgress(id, Math.floor(a.currentTime * 1e7), a.paused, undefined, undefined, sessionExtra());
  };
  // song starts → "playing", song changes → "stopped" for the previous one
  useEffect(() => {
    const prev = reportedIdRef.current;
    if (prev && prev !== activeAudio?.id) jellyfinTvService.reportPlaybackStop(prev, 0);
    reportedIdRef.current = activeAudio?.id || null;
    if (activeAudio?.id && !casting) jellyfinTvService.reportPlaybackStart(activeAudio.id, 0, undefined, undefined, { ...sessionExtra(), IsPaused: !isAudioPlaying });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudio?.id]);
  // pause / play / mute → report right away
  useEffect(() => {
    const t = setTimeout(reportNow, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioPlaying, isAudioMuted]);

  // Audio Playback effect with automatic stream resolution and universal fallback
  useEffect(() => {
    if (!audioRef.current || !activeAudio) return;
    if (casting) {
      audioRef.current.pause(); // the TV is playing it
      return;
    }

    const targetUrl = streamUrl;
    if (!targetUrl) return;

    if (audioRef.current.src !== targetUrl) {
      audioRef.current.src = targetUrl;
      audioRef.current.load();
    }
    if (resumeLocalAtRef.current !== null) {
      const at = resumeLocalAtRef.current;
      resumeLocalAtRef.current = null;
      const a = audioRef.current;
      if (a.readyState >= 1) a.currentTime = at;
      else a.addEventListener('loadedmetadata', () => (a.currentTime = at), { once: true });
    }

    if (isAudioPlaying) {
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch((e) => {
          console.warn('Direct stream play error, attempting fallback:', e);
          const config = jellyfinClient.getConfig();
          if (config.serverUrl && config.accessToken && activeAudio.id) {
            const fallbackUrl = `${config.serverUrl.replace(/\/$/, '')}/Audio/${activeAudio.id}/stream?static=true&ApiKey=${config.accessToken}`; // 2nd try: original file
            if (audioRef.current && audioRef.current.src !== fallbackUrl) {
              audioRef.current.src = fallbackUrl;
              audioRef.current.play().catch(() => {});
            }
          }
        });
      }
    } else {
      audioRef.current.pause();
    }
  }, [isAudioPlaying, activeAudio?.id, streamUrl, casting]);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.muted = isAudioMuted;
    }
  }, [isAudioMuted]);

  const handleTimeUpdate = () => {
    if (!audioRef.current || casting) return;
    const cur = audioRef.current.currentTime;
    const dur = audioRef.current.duration || 0;
    setCurrentTime(cur);
    setAudioProgress(cur, dur);
    updatePositionState();

    // Synced lyrics: keep the current line centred — scroll only when the line changes
    if (activeTabMode === 'lyrics' && lyricsSynced && lyricsContainerRef.current && !lyricsFocusedRef.current) {
      let idx = -1;
      for (let i = 0; i < lyrics.length && cur >= lyrics[i].time; i++) idx = i;
      if (idx !== lastLyricIdxRef.current) {
        lastLyricIdxRef.current = idx;
        const el = lyricsContainerRef.current.children[idx] as HTMLElement | undefined;
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs) || secs <= 0) return '0:00';
    const totalSecs = Math.floor(secs);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  /* ---------------------------------------------------------------------------------------------
   * System media controls (Media Session API): the song shows up on the Android notification / lock
   * screen, the iPhone lock screen & Control Center, macOS Now Playing and the Windows media overlay,
   * and their play / pause / next / previous / seek buttons (and keyboard media keys, headphones,
   * Bluetooth, car) control Yudia.
   * ------------------------------------------------------------------------------------------- */
  const sessionActions = useRef({ toggle: toggleAudioPlayPause, next: nextAudioTrack, prev: prevAudioTrack, playing: isAudioPlaying });
  sessionActions.current = { toggle: toggleAudioPlayPause, next: nextAudioTrack, prev: prevAudioTrack, playing: isAudioPlaying };
  const hasMediaSession = typeof navigator !== 'undefined' && 'mediaSession' in navigator;

  // Yudia Connect: while another device is chosen, this device's lock screen / notification / media keys show
  // and control THAT device (like Spotify Connect).
  const connect = useSyncExternalStore(subscribeConnect, getConnectState);
  const remote = connect.target;
  const remoteKey = remote ? `${remote.sessionId}|${remote.nowPlaying?.id || ''}` : '';
  useEffect(() => {
    if (!hasMediaSession || !remote) return;
    const ms = navigator.mediaSession;
    const n = remote.nowPlaying;
    try {
      ms.metadata = n
        ? new MediaMetadata({
            title: n.title,
            artist: n.subtitle ? `${n.subtitle} · on ${remote.name}` : `on ${remote.name}`,
            album: `Playing on ${remote.name}`,
            artwork: n.image ? [96, 192, 256, 384].map((w) => ({ src: n.image.replace(/maxWidth=\d+/, `maxWidth=${w}`), sizes: `${w}x${w}` })) : []
          })
        : new MediaMetadata({ title: `Connected to ${remote.name}`, artist: 'Nothing playing', album: 'Yudia' });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteKey, hasMediaSession]);
  // Play / pause state, progress bar, and the silent sound that keeps the controls on the lock screen
  useEffect(() => {
    if (!remote) {
      silentKeepAlive(false);
      return;
    }
    const playing = !!remote.nowPlaying && !remote.isPaused;
    silentKeepAlive(!!remote.nowPlaying, playing);
    if (!hasMediaSession) return;
    navigator.mediaSession.playbackState = remote.nowPlaying ? (playing ? 'playing' : 'paused') : 'none';
    const dur = remote.nowPlaying ? remote.nowPlaying.runTimeTicks / 1e7 : 0;
    if (dur > 0 && 'setPositionState' in navigator.mediaSession) {
      try {
        navigator.mediaSession.setPositionState({ duration: dur, playbackRate: 1, position: Math.min(dur, livePosition(remote)) });
      } catch {}
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteKey, remote?.isPaused, remote?.positionTicks, hasMediaSession]);

  // Song info + cover (several sizes: each system picks the one it needs)
  useEffect(() => {
    if (!hasMediaSession || remote) return; // controlling another device: its info is shown instead
    const ms = navigator.mediaSession;
    if (!activeAudio) {
      ms.metadata = null;
      ms.playbackState = 'none';
      return;
    }
    const apply = (cover: string | undefined, local: boolean) => {
      // A downloaded song uses its saved cover (one local file); online: the server's cover in several sizes
      const artwork = !cover
        ? [{ src: new URL('favicon.svg', document.baseURI).href, sizes: '512x512', type: 'image/svg+xml' }]
        : local
        ? [{ src: cover, sizes: '400x400', type: 'image/jpeg' }]
        : [96, 192, 256, 384, 512].map((w) => ({
            src: cover.replace(/maxWidth=\d+/, `maxWidth=${w}`),
            sizes: `${w}x${w}`,
            type: /format=webp/.test(cover) ? 'image/webp' : 'image/jpeg'
          }));
      try {
        ms.metadata = new MediaMetadata({ title: activeAudio.title, artist: activeAudio.artist || '', album: activeAudio.album || '', artwork });
      } catch (e) {
        console.warn('Media Session metadata not supported', e);
      }
    };
    const onlineCover = activeAudio.backdropUrl || activeAudio.posterUrl;
    if (getDownload(activeAudio.id)?.hasPoster) {
      getOfflineImageUrl(activeAudio.id, 'poster').then((u) => apply(u || onlineCover, !!u));
    } else {
      apply(onlineCover, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAudio?.id, hasMediaSession, !!remote]);

  useEffect(() => {
    if (hasMediaSession && activeAudio && !remote) navigator.mediaSession.playbackState = isAudioPlaying ? 'playing' : 'paused';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAudioPlaying, activeAudio?.id, hasMediaSession, !!remote]);

  // Buttons from the system → the player (registered once; they read the latest actions from the ref)
  useEffect(() => {
    if (!hasMediaSession) return;
    const ms = navigator.mediaSession;
    const seekBy = (delta: number) => {
      const a = audioRef.current;
      if (!a) return;
      a.currentTime = Math.max(0, Math.min((a.duration || 0) - 0.5, a.currentTime + delta));
    };
    // Another device chosen → the button goes to it
    const viaRemote = (cmd: RemoteCommand, secs?: number) => {
      const t = getConnectState().target;
      if (!t) return false;
      remotePlaystate(t.sessionId, cmd, secs)
        .then(() => setTimeout(refreshDevices, 500))
        .catch(() => {});
      return true;
    };
    const remotePos = () => {
      const t = getConnectState().target;
      return t ? livePosition(t) : 0;
    };
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => viaRemote('Unpause') || (!sessionActions.current.playing && sessionActions.current.toggle())],
      ['pause', () => viaRemote('Pause') || (sessionActions.current.playing && sessionActions.current.toggle())],
      ['stop', () => viaRemote('Pause') || (sessionActions.current.playing && sessionActions.current.toggle())],
      ['nexttrack', () => viaRemote('NextTrack') || sessionActions.current.next()],
      ['previoustrack', () => {
        if (viaRemote('PreviousTrack')) return;
        // Like every music app: restart the song unless we're at its very beginning
        const a = audioRef.current;
        if (a && a.currentTime > 3) a.currentTime = 0;
        else sessionActions.current.prev();
      }],
      ['seekbackward', (d) => viaRemote('Seek', Math.max(0, remotePos() - (d.seekOffset || 10))) || seekBy(-(d.seekOffset || 10))],
      ['seekforward', (d) => viaRemote('Seek', remotePos() + (d.seekOffset || 10)) || seekBy(d.seekOffset || 10)],
      ['seekto', (d) => {
        if (d.seekTime != null && viaRemote('Seek', d.seekTime)) return;
        const a = audioRef.current;
        if (!a || d.seekTime == null) return;
        if (d.fastSeek && 'fastSeek' in a) (a as any).fastSeek(d.seekTime);
        else a.currentTime = d.seekTime;
      }]
    ];
    handlers.forEach(([action, fn]) => {
      try {
        ms.setActionHandler(action, fn);
      } catch {
        /* action not supported by this browser */
      }
    });
    return () =>
      handlers.forEach(([action]) => {
        try {
          ms.setActionHandler(action, null);
        } catch {}
      });
  }, [hasMediaSession]);

  // Progress bar on the lock screen / notification (updated every few seconds and on seek)
  const lastPositionRef = useRef(0);
  const updatePositionState = (force = false) => {
    if (!hasMediaSession || !('setPositionState' in navigator.mediaSession) || getConnectState().target) return;
    const a = audioRef.current;
    if (!a || !(a.duration > 0) || !isFinite(a.duration)) return;
    const now = Date.now();
    if (!force && now - lastPositionRef.current < 5000) return;
    lastPositionRef.current = now;
    try {
      navigator.mediaSession.setPositionState({
        duration: a.duration,
        playbackRate: a.playbackRate || 1,
        position: Math.min(a.currentTime, a.duration)
      });
    } catch {}
  };

  const seekTo = (t: number) => {
    const a = audioRef.current;
    if (!a || !(duration > 0)) return;
    const target = Math.max(0, Math.min(duration - 0.5, t));
    if (casting) castSeek(target);
    else a.currentTime = target;
    setCurrentTime(target);
    setAudioProgress(target, duration);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clampedX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = rect.width > 0 ? clampedX / rect.width : 0;
    if (audioRef.current && duration > 0) {
      const targetTime = percent * duration;
      if (casting) castSeek(targetTime);
      else audioRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
      setAudioProgress(targetTime, duration);
    }
  };

  if (!activeAudio) return null;

  const progressPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const art = activeAudio.backdropUrl || activeAudio.posterUrl;

  // Find active lyric line index based on currentTime
  let activeLyricIdx = -1;
  for (let i = 0; lyricsSynced && i < lyrics.length; i++) {
    if (currentTime >= lyrics[i].time) {
      activeLyricIdx = i;
    } else {
      break;
    }
  }

  return (
    <FocusContext.Provider value={focusKey}>
      {/* HTML5 Audio Element */}
      <audio
        ref={audioRef}
        src={streamUrl || undefined}
        onTimeUpdate={() => {
          handleTimeUpdate();
          savePosition();
          if (Date.now() - lastReportRef.current > 10_000) reportNow();
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (d && !isNaN(d) && isFinite(d)) setDuration(d);
          // Started from another device at a given time
          const remoteStart = takePendingAudioStart(activeAudio.id);
          if (remoteStart > 0 && remoteStart < e.currentTarget.duration - 1) {
            e.currentTarget.currentTime = remoteStart;
            restoreRef.current = null;
            return;
          }
          // Page was reopened: continue this song where it was
          const r = restoreRef.current;
          if (r && r.id === activeAudio.id && r.t > 1 && e.currentTarget.duration > r.t + 2) e.currentTarget.currentTime = r.t;
          restoreRef.current = null;
        }}
        // The phone paused the music (call, other app…): show Play, not Pause
        onPause={(e) => {
          if (!e.currentTarget.ended && isAudioPlaying && !casting && document.visibilityState === 'hidden') toggleAudioPlayPause();
        }}
        onSeeked={() => {
          updatePositionState(true);
          reportNow();
        }}
        onPlaying={() => updatePositionState(true)}
        onDurationChange={(e) => {
          const d = e.currentTarget.duration;
          if (d && !isNaN(d) && isFinite(d) && d > 0) setDuration(d);
        }}
        onError={() => {
          if (isOfflineSong) return;
          const config = jellyfinClient.getConfig();
          if (audioRef.current && config.serverUrl && config.accessToken && activeAudio.id) {
            const fallbackUrl = `${config.serverUrl.replace(/\/$/, '')}/Audio/${activeAudio.id}/stream?static=true&ApiKey=${config.accessToken}`; // 2nd try: original file
            if (audioRef.current.src !== fallbackUrl) {
              audioRef.current.src = fallbackUrl;
              audioRef.current.play().catch(() => {});
            }
          }
        }}
        onEnded={() => {
          if (isRepeat) {
            if (audioRef.current) audioRef.current.currentTime = 0;
            audioRef.current?.play();
          } else {
            nextAudioTrack();
          }
        }}
      />

      {/* FULL SCREEN PLAYER — one layout whose parts glide between modes:
          Artwork: big cover, title, progress bar + buttons beside it.
          Lyrics / Queue: cover shrinks to the corner, the progress bar + buttons slide down to the bottom,
          and the lyrics (or queue) fade in where they were. Opens by sliding up, closes by sliding down. */}
      {fsRendered ? (
        <div ref={ref} className={`mp mp--${activeTabMode} ${fsClosing ? 'is-closing' : ''} ${isAudioPlaying ? '' : 'is-paused'}`} role="dialog" aria-label="Now playing">
          {/* Ambient background from the cover (cross-fades on song change) */}
          <div key={`bg-${activeAudio.id}`} className="mp__bg" style={{ backgroundImage: art ? `url("${art}")` : undefined }} />
          <div className="mp__shade" />

          <div className="mp__top">
            <FocusableButton
              focusKey="MP_CLOSE"
              onPress={() => setIsMusicFullScreen(false)}
              className="mp__close"
              onArrowPress={(dir) => {
                // → always reaches the mode switch (the lyrics panel sits closer and used to take it)
                if (dir === 'right') {
                  setFocus(`MP_MODE_${activeTabMode}`);
                  return false;
                }
                return true;
              }}
            >
              <ChevronDown size={22} /> <span>Library</span>
            </FocusableButton>

            {/* Mode switch with a sliding highlight */}
            <div className="mp__seg" role="tablist">
              <span className="mp__seg-pill" style={{ transform: `translateX(${MODES.indexOf(activeTabMode) * 100}%)` }} />
              <FocusableButton focusKey="MP_MODE_player" onPress={() => changeMode('player')} className={`mp__seg-btn ${activeTabMode === 'player' ? 'is-active' : ''}`}>
                <Disc3 size={17} /> <span>Artwork</span>
              </FocusableButton>
              <FocusableButton focusKey="MP_MODE_lyrics" onPress={() => changeMode('lyrics')} className={`mp__seg-btn ${activeTabMode === 'lyrics' ? 'is-active' : ''}`}>
                <FileText size={17} /> <span>Lyrics</span>
              </FocusableButton>
              <FocusableButton focusKey="MP_MODE_queue" onPress={() => changeMode('queue')} className={`mp__seg-btn ${activeTabMode === 'queue' ? 'is-active' : ''}`}>
                <ListMusic size={17} /> <span>Queue</span>
              </FocusableButton>
            </div>
            <span className="mp__top-spacer">
              <ConnectButton focusKey="MP_CONNECT" className="mp__close" />
              <CastButton focusKey="MP_CAST" className="mp__close" />
            </span>
          </div>

          <div ref={artRef} className="mp__art">
            <div key={`art-${activeAudio.id}`} className="mp__art-inner">
              {art ? <img decoding="async" src={art} alt="" /> : <Disc3 size={64} />}
            </div>
          </div>

          <div ref={metaRef} className="mp__meta">
            <h1 key={`t-${activeAudio.id}`} className="mp__title">{activeAudio.title}</h1>
            <p className="mp__artist">
              {activeAudio.artist || 'Unknown artist'}
              {activeAudio.album ? <span> · {activeAudio.album}</span> : null}
            </p>
            {casting && (
              <p className="mp__casting">
                <Cast size={16} /> Playing on {cast.deviceName || 'your TV'}
              </p>
            )}
          </div>

          <div ref={ctrlRef} className="mp__controls">
            <ScrubBar
              percent={progressPercent}
              onClick={handleSeek}
              onStep={(dir) => seekTo((audioRef.current?.currentTime || 0) + dir * 10)}
              onEnter={toggleAudioPlayPause}
            />
            <div className="mp__times">
              <span>{formatTime(currentTime)}</span>
              <span>-{formatTime(Math.max(0, duration - currentTime))}</span>
            </div>
            <div className="mp__transport">
              <FocusableButton focusKey="MP_SHUFFLE" onPress={() => setIsShuffle(!isShuffle)} className={`mp__icon ${isShuffle ? 'is-on' : ''}`}>
                <Shuffle size={20} />
              </FocusableButton>
              <FocusableButton focusKey="MP_PREV" onPress={prevAudioTrack} className="mp__icon mp__icon--lg">
                <SkipBack size={26} fill="currentColor" />
              </FocusableButton>
              <FocusableButton focusKey="MP_PLAY" onPress={toggleAudioPlayPause} className="mp__play">
                {isAudioPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" style={{ marginLeft: 3 }} />}
              </FocusableButton>
              <FocusableButton focusKey="MP_NEXT" onPress={nextAudioTrack} className="mp__icon mp__icon--lg">
                <SkipForward size={26} fill="currentColor" />
              </FocusableButton>
              <FocusableButton focusKey="MP_REPEAT" onPress={() => setIsRepeat(!isRepeat)} className={`mp__icon ${isRepeat ? 'is-on' : ''}`}>
                <Repeat size={20} />
              </FocusableButton>
              <FocusableButton focusKey="MP_ADD_PL" onPress={() => openPlaylistPicker([activeAudio])} className="mp__icon">
                <span title="Add to playlist" style={{ display: 'inline-flex' }}>
                  <ListPlus size={20} />
                </span>
              </FocusableButton>
            </div>
          </div>

          {/* Lyrics / queue panel: fades + slides in when its mode opens */}
          {activeTabMode === 'lyrics' && (
            <div key="lyrics" className="mp__panel">
              <LyricsPanel
                containerRef={lyricsContainerRef}
                lyrics={lyrics}
                synced={lyricsSynced}
                loading={lyricsLoading}
                activeIdx={activeLyricIdx}
                focusedRef={lyricsFocusedRef}
                onSeek={(t) => seekTo(t)}
                onExitUp={() => setFocus('MP_MODE_lyrics')}
              />
            </div>
          )}

          {activeTabMode === 'queue' && (
            <div key="queue" className="mp__panel">
              <h2 className="mp__panel-title">Playing next</h2>
              <div className="mp__queue">
                {audioQueue.map((track, idx) => (
                  <QueueItemRow
                    key={`${track.id}-${idx}`}
                    track={track}
                    isCurrent={idx === audioQueueIndex}
                    onSelect={() => playAudio(track, audioQueue)}
                    onUp={idx === 0 ? () => setFocus('MP_MODE_queue') : undefined}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </FocusContext.Provider>
  );
};

const QueueItemRow: React.FC<{
  track: any;
  isCurrent: boolean;
  onSelect: () => void;
  onUp?: () => void;
}> = ({ track, isCurrent, onSelect, onUp }) => {
  const { ref, focused } = useFocusable({
    onEnterPress: onSelect,
    onArrowPress: (dir) => {
      if (dir === 'up' && onUp) {
        onUp();
        return false;
      }
      return true;
    }
  });
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '12px 18px',
        borderRadius: '14px',
        backgroundColor: focused
          ? 'rgba(255, 255, 255, 0.22)'
          : isCurrent
          ? 'rgba(var(--accent-rgb), 0.16)'
          : 'rgba(255, 255, 255, 0.04)',
        border: focused ? '2px solid #ffffff' : isCurrent ? '1px solid var(--accent)' : '1px solid transparent',
        cursor: 'pointer'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
        <img decoding="async"
          src={track.posterUrl || track.backdropUrl}
          alt={track.title}
          style={{ width: '42px', height: '42px', borderRadius: '8px', objectFit: 'cover' }}
        />
        <div>
          <h4 style={{ fontSize: '0.98rem', fontWeight: 700, color: isCurrent ? 'var(--accent)' : '#fff' }}>
            {track.title}
          </h4>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)' }}>{track.artist}</p>
        </div>
      </div>

      <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)' }}>{track.duration}</span>
    </div>
  );
};

/** Progress bar: click to seek; with the remote, focus it and use ← / → to jump 10 s, OK = play / pause. */
const ScrubBar: React.FC<{
  percent: number;
  onClick: (e: React.MouseEvent<HTMLDivElement>) => void;
  onStep: (dir: -1 | 1) => void;
  onEnter: () => void;
}> = ({ percent, onClick, onStep, onEnter }) => {
  const { ref, focused } = useFocusable({
    focusKey: 'MP_SCRUB',
    onEnterPress: onEnter,
    onArrowPress: (dir) => {
      if (dir === 'left' || dir === 'right') {
        onStep(dir === 'left' ? -1 : 1);
        return false;
      }
      return true;
    }
  });
  return (
    <div ref={ref} className={`mp__scrub ${focused ? 'focused' : ''}`} onClick={onClick} role="slider" aria-label="Song position" aria-valuenow={Math.round(percent)}>
      <div className="mp__scrub-fill" style={{ width: `${percent}%` }} />
      <div className="mp__scrub-knob" style={{ left: `${percent}%` }} />
      {focused && <span className="mp__scrub-hint">◀ 10 s · 10 s ▶</span>}
    </div>
  );
};

/**
 * Lyrics: tap a line to jump there. With the remote the whole panel is one stop: ↑ / ↓ move a cursor
 * over the lines (starting at the line being sung), OK jumps the song there; ↑ on the first line / ↓ on
 * the last leaves the panel.
 */
const LyricsPanel: React.FC<{
  containerRef: React.RefObject<HTMLDivElement>;
  lyrics: { time: number; text: string }[];
  synced: boolean;
  loading: boolean;
  activeIdx: number;
  focusedRef: React.MutableRefObject<boolean>;
  onSeek: (t: number) => void;
  onExitUp: () => void;
}> = ({ containerRef, lyrics, synced, loading, activeIdx, focusedRef, onSeek, onExitUp }) => {
  const [cursor, setCursor] = useState(0);
  const cursorRef = useRef(0);
  const move = (to: number) => {
    cursorRef.current = to;
    setCursor(to);
    const el = containerRef.current?.children[to] as HTMLElement | undefined;
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const { ref, focused } = useFocusable({
    focusKey: 'MP_LYRICS',
    focusable: synced && lyrics.length > 0,
    onFocus: () => {
      focusedRef.current = true;
      move(Math.max(0, activeIdx));
    },
    onBlur: () => {
      focusedRef.current = false;
    },
    onEnterPress: () => {
      const line = lyrics[cursorRef.current];
      if (line) onSeek(line.time);
    },
    onArrowPress: (dir) => {
      if (dir === 'up') {
        if (cursorRef.current > 0) move(cursorRef.current - 1);
        else onExitUp(); // above the first line: the Artwork / Lyrics / Queue switch
        return false;
      }
      if (dir === 'down' && cursorRef.current < lyrics.length - 1) {
        move(cursorRef.current + 1);
        return false;
      }
      return true;
    }
  });
  return (
    <div ref={ref} className={`mp__lyrics-wrap ${focused ? 'focused' : ''}`}>
      <div ref={containerRef} className={`mp__lyrics ${synced ? 'is-synced' : ''}`}>
        {lyrics.length === 0 && <div className="mp__lyrics-empty">{loading ? 'Loading lyrics…' : 'No lyrics for this song'}</div>}
        {lyrics.map((line, idx) => {
          const isActive = idx === activeIdx;
          const past = synced && idx < activeIdx;
          return (
            <div
              key={idx}
              className={`mp__line ${isActive ? 'active-lyric is-active' : ''} ${past ? 'is-past' : ''} ${line.text ? '' : 'is-gap'} ${focused && idx === cursor ? 'is-cursor' : ''}`}
              onClick={() => synced && onSeek(line.time)}
            >
              {line.text}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * A silent sound on loop while controlling another device: phones only keep the media controls on the lock
 * screen / in the notification while the page itself is "playing". Paused together with the other device.
 */
let silentEl: HTMLAudioElement | null = null;
function silentKeepAlive(active: boolean, playing = false) {
  if (!active) {
    silentEl?.pause();
    return;
  }
  if (!silentEl) {
    // 1 s of silence, 8 kHz mono 8-bit WAV
    const n = 8000;
    const b = new Uint8Array(44 + n);
    const dv = new DataView(b.buffer);
    const str = (o: number, t: string) => t.split('').forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
    str(0, 'RIFF'); dv.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true); dv.setUint32(24, 8000, true);
    dv.setUint32(28, 8000, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true); str(36, 'data'); dv.setUint32(40, n, true);
    b.fill(128, 44);
    silentEl = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
    silentEl.loop = true;
  }
  if (playing) silentEl.play().catch(() => {});
  else silentEl.pause();
}
