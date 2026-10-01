import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  ArrowLeft,
  Settings,
  Subtitles,
  Volume2,
  VolumeX,
  Check,
  X,
  FastForward,
  SkipForward,
  Sliders,
  Sparkles,
  Maximize2
} from 'lucide-react';
import { MediaItem, SubtitleTrack, AudioTrack } from '../mockData';
import { FocusableButton } from './FocusableButton';
import { HUDProgressBar } from './HUDProgressBar';
import { MediaLaunchOverlay } from './MediaLaunchOverlay';
import { ContentAdvisoryOverlay } from './ContentAdvisoryOverlay';
import { jellyfinClient } from '../api/jellyfin';
import { useAppState } from '../state/AppStateContext';
import { parseSubtitles, getActiveCue, SubtitleCue } from '../utils/subtitles';
import { useSeriesPlayback } from '../hooks/useSeriesPlayback';
import { useSeriesStore } from '../store/useSeriesStore';
import { JellyfinEpisode, jellyfinTvService } from '../services/jellyfinTvService';
import { EpisodeMarkers, markersFromChapters } from '../api/introSkipper';
import { cancelPreload, getMarkersCached, getPlaybackInfoCached } from '../services/preloadService';
import { getDownload, getOfflineMediaUrl, onEpisodeFinished } from '../services/downloads';
import { CastButton, useCast } from './CastButton';
import { CastRemote } from './CastRemote';
import { castMedia, getCastState } from '../services/cast';
import { registerPlayer } from '../services/playerBridge';
import {
  MediaInfo,
  buildVideoStreamUrl,
  decideStreamMode,
  pickAudioTrack,
  pickSubtitleTrack,
  readLanguagePrefs
} from '../utils/playbackDecision';

export interface VideoQualityOption {
  id: string;
  label: string;
  badge: string;
  resolution: string;
  bitrate: number;
  maxHeight?: number;
  description: string;
}

export const QUALITY_OPTIONS: VideoQualityOption[] = [
  {
    id: 'auto',
    label: 'Auto',
    badge: 'AUTO',
    resolution: 'Direct Play / Dynamic',
    bitrate: 0,
    description: 'Automatically matches your bandwidth with uncompressed Direct Play.'
  },
  {
    id: '4k',
    label: '4K UHD',
    badge: '4K 2160p',
    resolution: '3840 × 2160',
    bitrate: 80000000,
    maxHeight: 2160,
    description: 'Ultra High Definition master quality for 4K Smart TVs and HDR.'
  },
  {
    id: '1080p',
    label: '1080p FHD',
    badge: 'FHD 1080p',
    resolution: '1920 × 1080',
    bitrate: 20000000,
    maxHeight: 1080,
    description: 'Full High Definition with crisp clarity and uncompressed audio.'
  },
  {
    id: '720p',
    label: '720p HD',
    badge: 'HD 720p',
    resolution: '1280 × 720',
    bitrate: 8000000,
    maxHeight: 720,
    description: 'Smooth High Definition streaming optimized for lower latency.'
  },
  {
    id: '480p',
    label: '480p SD',
    badge: 'SD 480p',
    resolution: '854 × 480',
    bitrate: 3000000,
    maxHeight: 480,
    description: 'Data saver mode for slower connections or metered networks.'
  }
];

// Resilient duration parser for items with format like "45m", "1h 30m", or seconds
const parseDurationSeconds = (durStr?: string): number => {
  if (!durStr) return 0;
  let total = 0;
  const hoursMatch = durStr.match(/(\d+)\s*h/i);
  const minsMatch = durStr.match(/(\d+)\s*m/i);
  const secsMatch = durStr.match(/(\d+)\s*s/i);
  if (hoursMatch) total += parseInt(hoursMatch[1], 10) * 3600;
  if (minsMatch) total += parseInt(minsMatch[1], 10) * 60;
  if (secsMatch) total += parseInt(secsMatch[1], 10);
  if (!hoursMatch && !minsMatch && !secsMatch) {
    const num = parseFloat(durStr);
    if (!isNaN(num) && num > 0) {
      return num > 300 ? num : num * 60;
    }
  }
  return total;
};

interface VideoPlayerProps {
  item: MediaItem;
  onClose: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({ item, onClose }) => {
  const { currentUser, refreshLibrary } = useAppState();
  // Google Cast (website): while connected, the title plays on the TV and this screen becomes its remote
  const cast = useCast();
  const casting = cast.connected;
  const castTimeRef = useRef(0);
  const [currentItem, setCurrentItem] = useState<MediaItem>(item);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);

  // Subtitles & Audio state
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrack[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>([]);
  // Real selections are made from Settings → preferred languages once the item's tracks load.
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('off');
  const [selectedAudioId, setSelectedAudioId] = useState<string>('');
  // Container / video codec of the file — decides direct play vs. server-side conversion. null = still loading.
  const [mediaInfo, setMediaInfo] = useState<MediaInfo | null>(null);
  // Set when direct play failed on this device: stream through the server for the rest of this item.
  const [forceServerSide, setForceServerSide] = useState(false);
  const [subtitleSize, setSubtitleSize] = useState<'normal' | 'large' | 'huge'>('large');
  const [subtitleDelay, setSubtitleDelay] = useState<number>(0);

  // Audio volume & mute state
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [bufferedPercent, setBufferedPercent] = useState<number>(0);

  // Picture: "fit" shows the whole image (4:3 series get side bars, 2.39:1 films get top/bottom bars);
  // "fill" zooms to fill the screen and crops the edges. Remembered across sessions.
  const [videoFit, setVideoFit] = useState<'fit' | 'fill'>(() => {
    try {
      return JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}').videoFit === 'fill' ? 'fill' : 'fit';
    } catch {
      return 'fit';
    }
  });
  const toggleVideoFit = () => {
    const next = videoFit === 'fit' ? 'fill' : 'fit';
    setVideoFit(next);
    try {
      const parsed = JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}');
      parsed.videoFit = next;
      localStorage.setItem('jellyfin_streaming_settings', JSON.stringify(parsed));
    } catch (e) {}
  };

  const [autoSkipIntro, setAutoSkipIntro] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('jellyfin_streaming_settings');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.autoSkipIntro === 'boolean') return parsed.autoSkipIntro;
      }
    } catch (e) {}
    return true;
  });

  // Cinematic Media Launch Animation State
  const [isLaunching, setIsLaunching] = useState<boolean>(true);
  const [launchFadingOut, setLaunchFadingOut] = useState<boolean>(false);
  const launchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finishLaunchAnimation = useCallback(() => {
    setLaunchFadingOut(true);
    setTimeout(() => {
      setIsLaunching(false);
    }, 650);
  }, []);

  useEffect(() => {
    setIsLaunching(true);
    setLaunchFadingOut(false);
    launchTimerRef.current = setTimeout(() => {
      finishLaunchAnimation();
    }, 1800);

    return () => {
      if (launchTimerRef.current) clearTimeout(launchTimerRef.current);
    };
  }, [currentItem.id, finishLaunchAnimation]);

  const handleVideoReady = useCallback(() => {
    if (isLaunching && !launchFadingOut) {
      setTimeout(() => {
        finishLaunchAnimation();
      }, 450);
    }
  }, [isLaunching, launchFadingOut, finishLaunchAnimation]);

  // Jellyfin metadata duration
  const jellyfinDurationSeconds = useMemo(() => {
    if (currentItem.runTimeTicks && currentItem.runTimeTicks > 0) {
      return Math.round(currentItem.runTimeTicks / 10000000);
    }
    return 0;
  }, [currentItem.runTimeTicks]);

  const fallbackDuration = useMemo(() => {
    return parseDurationSeconds(currentItem.duration) || 2700;
  }, [currentItem.duration]);

  // Priority 1: Actual media duration reported by the HTML5 video element.
  // Whenever the video element has loaded and duration is a finite, positive number,
  // that duration is the absolute ground truth for playback, seeking, and timeline timestamps.
  // Priority 2: Jellyfin runTimeTicks or fallback duration while video metadata is loading.
  const effectiveDuration = (duration > 0 && isFinite(duration))
    ? duration
    : (jellyfinDurationSeconds > 0 ? jellyfinDurationSeconds : fallbackDuration);

  const effectiveDurationRef = useRef(0);
  effectiveDurationRef.current = effectiveDuration;

  // ---- Stream position model ----
  // Direct play (static=true) is served with byte ranges, so the <video> clock IS the episode clock.
  // Transcoded streams (quality cap / audio-track switch) are served with Accept-Ranges: none — the browser
  // cannot seek them and their clock starts at 0. For those we restart the transcode at StartTimeTicks and
  // keep the offset: position = streamStart + video.currentTime.
  const [streamStart, setStreamStart] = useState(0);
  const streamStartRef = useRef(0);
  streamStartRef.current = streamStart;
  const isTranscodingRef = useRef(false);
  const pendingSeekRef = useRef<number | null>(null);       // target shown while a transcode restart is pending
  const pendingDirectSeekRef = useRef<number | null>(null); // applied when a new direct-play source has metadata
  const pauseAfterReloadRef = useRef(false);
  const resumeAppliedForRef = useRef<string | null>(null);
  const transcodeSeekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const getPosition = useCallback((): number => {
    if (pendingSeekRef.current !== null) return pendingSeekRef.current;
    const t = videoRef.current?.currentTime ?? 0;
    return isTranscodingRef.current ? streamStartRef.current + t : t;
  }, []);

  const seekTo = useCallback((targetSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const dur = effectiveDurationRef.current;
    const target = Math.max(0, Math.min(targetSeconds, dur > 0 ? dur - 1 : targetSeconds));
    setCurrentTime(target);

    if (!isTranscodingRef.current) {
      try {
        video.currentTime = target;
      } catch (err) {
        console.warn('[VideoPlayer] Seek error:', err);
      }
      return;
    }

    // Transcoded: debounce so a held remote arrow restarts the transcode once, not per press.
    pendingSeekRef.current = target;
    if (transcodeSeekTimerRef.current) clearTimeout(transcodeSeekTimerRef.current);
    transcodeSeekTimerRef.current = setTimeout(() => {
      transcodeSeekTimerRef.current = null;
      if (Math.abs(target - streamStartRef.current) < 0.5) {
        // Same start point: no new URL, just rewind the current session.
        pendingSeekRef.current = null;
        if (videoRef.current) videoRef.current.currentTime = 0;
        return;
      }
      pauseAfterReloadRef.current = !!videoRef.current?.paused;
      setStreamStart(target); // → new activeStreamUrl with StartTimeTicks → reload
    }, 450);
  }, []);

  const seekRelative = useCallback((deltaSeconds: number) => {
    seekTo(getPosition() + deltaSeconds);
  }, [seekTo, getPosition]);

  /** Switch stream variant (quality / audio) keeping the position, whichever mode the new URL ends up in. */
  const keepPositionAcrossReload = useCallback(() => {
    const pos = getPosition();
    pauseAfterReloadRef.current = !!videoRef.current?.paused;
    pendingDirectSeekRef.current = pos; // used if the new source is direct play
    setStreamStart(pos);                // used if the new source is a transcode
  }, [getPosition]);

  // New item: everything position-related starts from scratch.
  useEffect(() => {
    if (transcodeSeekTimerRef.current) clearTimeout(transcodeSeekTimerRef.current);
    pendingSeekRef.current = null;
    pendingDirectSeekRef.current = null;
    setStreamStart(0);
  }, [currentItem.id]);

  const toggleMute = useCallback(() => {
    if (videoRef.current) {
      const nextMute = !videoRef.current.muted;
      videoRef.current.muted = nextMute;
      setIsMuted(nextMute);
    }
  }, []);

  // Quality state (defaults to Auto or saved setting)
  const [selectedQualityId, setSelectedQualityId] = useState<string>(() => {
    try {
      const savedSettings = localStorage.getItem('jellyfin_streaming_settings');
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        if (parsed.maxBitrate) return parsed.maxBitrate;
      }
    } catch (e) {}
    return localStorage.getItem('jellyfin_selected_quality') || 'auto';
  });

  const activeQuality = useMemo(() => {
    return QUALITY_OPTIONS.find((q) => q.id === selectedQualityId) || QUALITY_OPTIONS[0];
  }, [selectedQualityId]);

  const handleSelectQuality = (qualityId: string) => {
    const targetQuality = QUALITY_OPTIONS.find((q) => q.id === qualityId);
    if (!targetQuality) return;

    setSelectedQualityId(targetQuality.id);
    localStorage.setItem('jellyfin_selected_quality', targetQuality.id);

    try {
      const saved = localStorage.getItem('jellyfin_streaming_settings');
      const parsed = saved ? JSON.parse(saved) : {};
      parsed.maxBitrate = targetQuality.id;
      localStorage.setItem('jellyfin_streaming_settings', JSON.stringify(parsed));
    } catch (e) {}

    // activeStreamUrl picks up the new bitrate; keep the playhead where it was.
    if (targetQuality.id !== selectedQualityId) keepPositionAcrossReload();
  };

  // Handler for audio track switching with seamless position retention
  const handleSelectAudioTrack = (audioId: string) => {
    if (audioId !== selectedAudioId) keepPositionAcrossReload();
    setSelectedAudioId(audioId);
  };

  // Active stream URL: direct play only when this device can decode container + video + selected audio;
  // otherwise the server converts the audio to AAC (video copied) or caps quality. See utils/playbackDecision.ts.
  // Downloaded? Play the file stored on this device (works offline); everything else below stays the same.
  const offlineEntry = getDownload(currentItem.id);
  const [offlineSrc, setOfflineSrc] = useState<string | null>(null);
  useEffect(() => {
    setOfflineSrc(null);
    if (!offlineEntry) return;
    let alive = true;
    getOfflineMediaUrl(currentItem.id).then((u) => alive && setOfflineSrc(u));
    return () => {
      alive = false;
    };
  }, [currentItem.id, !!offlineEntry]);

  const isJellyfinItem = !!jellyfinClient.getConfig().serverUrl && !!jellyfinClient.getConfig().accessToken && !currentItem.id.startsWith('demo-');
  const selectedAudioTrack = audioTracks.find((a) => a.id === selectedAudioId);
  const streamMode = useMemo(() => {
    if (offlineEntry) return 'direct' as const; // a local file: seekable, real duration
    if (!mediaInfo) return null;
    const defaultAudio = audioTracks.find((a) => a.isDefault) || audioTracks[0];
    return decideStreamMode({
      media: mediaInfo,
      audioCodec: selectedAudioTrack?.codec,
      audioIsDefault: !selectedAudioTrack || selectedAudioTrack.id === defaultAudio?.id,
      maxBitrate: activeQuality.bitrate,
      forceServerSide
    });
  }, [mediaInfo, selectedAudioTrack, audioTracks, activeQuality.bitrate, forceServerSide, !!offlineEntry]);

  const activeStreamUrl = useMemo(() => {
    if (casting) return ''; // playing on the Cast device: don't download it here too
    if (offlineEntry) return offlineSrc || '';
    if (!isJellyfinItem) {
      return currentItem.videoUrl || '';
    }
    // Wait for the file's codecs before loading anything — otherwise E-AC3 files start silent.
    if (!mediaInfo || !streamMode) return '';
    const config = jellyfinClient.getConfig();
    return buildVideoStreamUrl({
      serverUrl: config.serverUrl,
      token: config.accessToken,
      deviceId: config.deviceId,
      itemId: currentItem.id,
      mode: streamMode,
      media: mediaInfo,
      audioStreamIndex: selectedAudioTrack?.index,
      maxBitrate: activeQuality.bitrate,
      maxHeight: activeQuality.maxHeight,
      // streamStart only matters for server-side streams (StartTimeTicks); direct play seeks natively.
      startTimeTicks: streamMode === 'direct' ? 0 : streamStart * 10000000
    });
  }, [isJellyfinItem, currentItem.id, currentItem.videoUrl, mediaInfo, streamMode, selectedAudioTrack, activeQuality, streamStart, offlineSrc, !!offlineEntry, casting]);
  isTranscodingRef.current = streamMode === 'remux' || streamMode === 'transcode';

  /** Trust <video>.duration only for direct play — a live transcode reports Infinity or a partial length. */
  const syncDurationFromVideo = () => {
    const d = videoRef.current?.duration;
    if (!isTranscodingRef.current && d && isFinite(d) && d > 0) setDuration(d);
  };

  // Drawer / Menu state
  const [drawerMode, setDrawerMode] = useState<'none' | 'subtitles' | 'audio' | 'settings' | 'quality'>('none');

  // Subtitle cue rendering
  const [cues, setCues] = useState<SubtitleCue[]>([]);
  const [activeSubtitleText, setActiveSubtitleText] = useState<string | null>(null);

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { ref, focusKey } = useFocusable({
    focusKey: 'VIDEO_PLAYER',
    isFocusBoundary: true
  });

  // Intro / credits markers (seconds): MediaSegments / Intro Skipper first, named chapters as fallback.
  // null = none known → the hook falls back to "last 30 s" for the Next Episode overlay, and shows no Skip Intro.
  const [serverMarkers, setServerMarkers] = useState<EpisodeMarkers | null>(null);

  useEffect(() => {
    if (currentItem.type !== 'tv') return;
    const ctrl = new AbortController();
    setServerMarkers(null);
    getMarkersCached(currentItem.id).catch(() => null).then((m) => {
      if (!ctrl.signal.aborted) setServerMarkers(m);
    });
    return () => ctrl.abort();
  }, [currentItem.id, currentItem.type]);

  const markers = useMemo<EpisodeMarkers | null>(
    () => serverMarkers ?? markersFromChapters(currentItem.chapters, effectiveDuration),
    [serverMarkers, currentItem.chapters, effectiveDuration]
  );

  // Convert currentItem to JellyfinEpisode context for series playback logic
  const currentEpisode: JellyfinEpisode | null = useMemo(() => {
    if (currentItem.type !== 'tv') return null;
    const existing = useSeriesStore.getState().episodes.find((e) => e.Id === currentItem.id);
    if (existing) return existing;

    return {
      Id: currentItem.id,
      Name: currentItem.episodeName || currentItem.title,
      SeriesId: currentItem.seriesId || '',
      SeriesName: currentItem.seriesName || 'Series',
      SeasonId: '',
      SeasonName: `Season ${currentItem.seasonNumber || 1}`,
      IndexNumber: currentItem.episodeNumber || 1,
      ParentIndexNumber: currentItem.seasonNumber || 1,
      Overview: currentItem.overview,
      RunTimeTicks: currentItem.runTimeTicks,
      SubtitleTracks: currentItem.subtitleTracks,
      AudioTracks: currentItem.audioTracks
    };
  }, [currentItem.id, currentItem.type]);

  // Seamless next episode transition handler
  const handleTransitionToNextEpisode = useCallback((nextEp: JellyfinEpisode) => {
    onEpisodeFinished(currentItem.id, currentItem.seriesId); // auto-downloads: drop it if watched, fetch the next ones
    const streamUrl = jellyfinClient.getStreamUrl(nextEp.Id, 'video');

    const nextMediaItem: MediaItem = {
      id: nextEp.Id,
      title: `${nextEp.SeriesName || currentItem.seriesName || 'Series'} - S${nextEp.ParentIndexNumber}:E${nextEp.IndexNumber} ${nextEp.Name}`,
      seriesName: nextEp.SeriesName || currentItem.seriesName,
      seriesId: nextEp.SeriesId || currentItem.seriesId,
      episodeName: nextEp.Name,
      seasonNumber: nextEp.ParentIndexNumber,
      episodeNumber: nextEp.IndexNumber,
      type: 'tv',
      year: currentItem.year,
      rating: currentItem.rating,
      duration: nextEp.RunTimeTicks ? `${Math.round(nextEp.RunTimeTicks / 10000000 / 60)}m` : '45m',
      genres: currentItem.genres,
      overview: nextEp.Overview || 'No description available.',
      backdropUrl: nextEp.BackdropUrl || currentItem.backdropUrl,
      posterUrl: nextEp.ImageUrl || currentItem.posterUrl,
      videoUrl: streamUrl,
      subtitleTracks: nextEp.SubtitleTracks,
      audioTracks: nextEp.AudioTracks,
      runTimeTicks: nextEp.RunTimeTicks,
      chapters: nextEp.Chapters
    };

    // Swapping currentItem changes the <video> src (activeStreamUrl), which reloads from 0 and autoplays.
    // Reset time + duration so nothing from the previous episode leaks into the credits check.
    setCurrentItem(nextMediaItem);
    setCurrentTime(0);
    setDuration(0);
    setStreamStart(0);
    pendingSeekRef.current = null;
    setIsPlaying(true);
  }, [currentItem]);

  // TV Series Playback Hook: Intro skip, Credits skip, Post-play Up Next countdown
  const {
    canSkipIntro,
    canSkipCredits,
    skipIntro,
    skipCredits,
    showUpNext,
    nextEpisode,
    countdownSeconds,
    countdownTotal,
    autoPlayNext,
    playNextNow,
    cancelUpNext,
    triggerUpNextScreen,
    autoSkippedNotice
  } = useSeriesPlayback({
    currentEpisode,
    markers,
    currentTime,
    duration: effectiveDuration,
    isPlaying,
    autoSkipIntro,
    seek: seekTo,
    getPosition,
    audioStreamIndex: audioTracks.findIndex((a) => a.id === selectedAudioId),
    subtitleStreamIndex: subtitleTracks.findIndex((s) => s.id === selectedSubtitleId),
    onPlayNextEpisode: handleTransitionToNextEpisode
  });

  // ---- Google Cast: send the title (at the current position, with the chosen tracks) when a session is on
  const castRequestedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!casting) {
      castRequestedRef.current = null;
      return;
    }
    if (cast.mediaId === currentItem.id || castRequestedRef.current === currentItem.id) return;
    castRequestedRef.current = currentItem.id;
    const from = videoRef.current && videoRef.current.currentTime > 0 ? getPosition() : ((currentItem.playbackPercent || 0) / 100) * effectiveDurationRef.current;
    videoRef.current?.pause();
    const sub = subtitleTracks.find((t) => t.id === selectedSubtitleId);
    castMedia(currentItem, { startSeconds: from, audioStreamIndex: selectedAudioTrack?.index, subtitleIndex: sub ? sub.index : null });
    setTimeout(() => setFocus('CAST_PLAYPAUSE_BTN'), 150);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting, currentItem.id, cast.mediaId]);
  // Remember where the TV is (for progress reports and to continue here when casting stops)
  useEffect(() => {
    if (casting && cast.mediaId === currentItem.id) castTimeRef.current = cast.currentTime;
  }, [cast.currentTime, casting, cast.mediaId, currentItem.id]);
  // Progress to Jellyfin every 10 s while casting
  useEffect(() => {
    if (!casting) return;
    const t = setInterval(() => {
      if (getCastState().mediaId === currentItem.id)
        jellyfinTvService.reportPlaybackProgress(currentItem.id, Math.floor(castTimeRef.current * 1e7), getCastState().isPaused);
    }, 10_000);
    return () => clearInterval(t);
  }, [casting, currentItem.id]);
  // Casting stopped → carry on here from where the TV was
  const wasCastingRef = useRef(false);
  useEffect(() => {
    if (wasCastingRef.current && !casting && castTimeRef.current > 0) {
      const at = castTimeRef.current;
      resumeAppliedForRef.current = currentItem.id; // don't jump back to the old resume point
      pendingDirectSeekRef.current = at;
      setStreamStart(at);
      setCurrentTime(at);
      setTimeout(() => setFocus('HUD_PLAYPAUSE_BTN'), 150);
    }
    wasCastingRef.current = casting;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casting]);
  // Finished on the TV → next episode (when autoplay is on)
  const castFinishedSeenRef = useRef(cast.finished);
  useEffect(() => {
    if (cast.finished === castFinishedSeenRef.current) return;
    castFinishedSeenRef.current = cast.finished;
    if (!casting) return;
    if (currentItem.type === 'tv') onEpisodeFinished(currentItem.id, currentItem.seriesId);
    if (nextEpisode && autoPlayNext) handleTransitionToNextEpisode(nextEpisode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cast.finished]);

  // Focus Play Next button automatically when the Netflix End Credits screen appears
  // When it closes via "Watch Credits", hand focus to the Skip Credits button so the remote is never stranded.
  const upNextWasShownRef = useRef(false);
  useEffect(() => {
    if (showUpNext) {
      upNextWasShownRef.current = true;
      const t = setTimeout(() => setFocus('UP_NEXT_PLAY_NOW'), 100);
      return () => clearTimeout(t);
    }
    if (upNextWasShownRef.current) {
      upNextWasShownRef.current = false;
      const t = setTimeout(() => setFocus(canSkipCredits ? 'PLAYER_SKIP_CREDITS_BTN' : 'VIDEO_PLAYER'), 100);
      return () => clearTimeout(t);
    }
  }, [showUpNext]);

  // Load tracks + codecs whenever the item changes, then pick audio/subtitles from Settings (English audio by default).
  useEffect(() => {
    let isMounted = true;
    setMediaInfo(null);
    setForceServerSide(false);
    setAudioTracks([]);
    setSubtitleTracks([]);

    // Pressing Play ends any background pre-load (what it downloaded stays in the cache and is used now).
    cancelPreload();
    getPlaybackInfoCached(currentItem.id).then((info) => {
      if (!isMounted) return;
      // Fresh server data wins (it carries codecs); item data is the fallback for demo/offline.
      const subs = info.subtitleTracks.length > 0 ? info.subtitleTracks : currentItem.subtitleTracks || [];
      const auds = info.audioTracks.length > 0 ? info.audioTracks : currentItem.audioTracks || [];

      const prefs = readLanguagePrefs();
      const audio = pickAudioTrack(auds, prefs.audioLanguage);
      const sub = pickSubtitleTrack(subs, prefs.subtitleLanguage);

      setSubtitleTracks(subs);
      setAudioTracks(auds);
      setSelectedAudioId(audio?.id || '');
      setSelectedSubtitleId(sub?.id || 'off');
      setMediaInfo({ container: info.container, videoCodec: info.videoCodec, mediaSourceId: info.mediaSourceId });

      // If Jellyfin returned runTimeTicks, chapters, or tags, ensure currentItem is updated with them!
      if (info.runTimeTicks || info.chapters?.length || info.tags?.length) {
        setCurrentItem((prev) => ({
          ...prev,
          runTimeTicks: info.runTimeTicks || prev.runTimeTicks,
          chapters: info.chapters || prev.chapters,
          tags: info.tags || prev.tags
        }));
      }
    });

    return () => {
      isMounted = false;
    };
  }, [currentItem.id]);

  // Update subtitle cues whenever the selected subtitle changes
  useEffect(() => {
    let isCancelled = false;

    if (selectedSubtitleId === 'off') {
      setCues([]);
      setActiveSubtitleText(null);
      return;
    }

    const currentTrack = subtitleTracks.find((t) => t.id === selectedSubtitleId);
    if (!currentTrack) {
      setCues([]);
      setActiveSubtitleText(null);
      return;
    }

    // Load REAL subtitles from Jellyfin server
    const loadRealSubtitles = async () => {
      const serverConfig = jellyfinClient.getConfig();
      const baseUrl = serverConfig.serverUrl?.replace(/\/$/, '') || '';
      const token = serverConfig.accessToken || '';
      const streamIdx = currentTrack.index;

      const candidateUrls: string[] = [];
      if (currentTrack.url) {
        candidateUrls.push(currentTrack.url);
      }
      if (baseUrl && token) {
        candidateUrls.push(`${baseUrl}/Videos/${currentItem.id}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${token}`);
        candidateUrls.push(`${baseUrl}/Videos/${currentItem.id}/Subtitles/${streamIdx}/0/Stream.vtt?ApiKey=${token}`);
        candidateUrls.push(`${baseUrl}/Videos/${currentItem.id}/Subtitles/${streamIdx}/Stream.srt?ApiKey=${token}`);
        candidateUrls.push(`${baseUrl}/Videos/${currentItem.id}/Subtitles/${streamIdx}/0/Stream.srt?ApiKey=${token}`);
      }

      const authHeaders: Record<string, string> = {
        'Accept': 'text/vtt, text/plain, */*'
      };
      if (token) {
        authHeaders['X-Emby-Token'] = token;
        authHeaders['Authorization'] = `MediaBrowser Client="Yudia", Device="${serverConfig.deviceName}", DeviceId="${serverConfig.deviceId}", Version="1.0.0", Token="${token}"`;
      }

      let loadedCues: SubtitleCue[] = [];

      for (const url of candidateUrls) {
        if (isCancelled) return;
        try {
          const res = await fetch(url, { headers: authHeaders });
          if (res.ok) {
            const rawText = await res.text();
            if (rawText && rawText.trim().length > 10) {
              const parsed = parseSubtitles(rawText);
              if (parsed.length > 0) {
                loadedCues = parsed;
                break;
              }
            }
          }
        } catch (fetchErr) {
          // Continue to next candidate URL
        }
      }

      if (!isCancelled) {
        if (loadedCues.length > 0) {
          setCues(loadedCues);
        } else {
          console.warn(`[Jellyfin] No parseable subtitle text retrieved from server for stream index ${streamIdx}`);
          const lang = currentTrack.language || 'eng';
          setCues([]); // no subtitles rather than made-up ones
        }
      }
    };

    loadRealSubtitles();

    return () => {
      isCancelled = true;
    };
  }, [selectedSubtitleId, subtitleTracks, currentItem.id]);

  // Initial focus on the Play/Pause button for instant remote control
  useEffect(() => {
    setFocus('HUD_PLAYPAUSE_BTN');
  }, []);

  // Safe Exit Handler: reports stop ticks, and returns focus to the episode card just played
  const handleClosePlayer = useCallback(() => {
    if (videoRef.current) {
      const cur = getCastState().connected && getCastState().mediaId === currentItem.id ? castTimeRef.current : getPosition();
      const dur = effectiveDurationRef.current || 1;
      const ticks = Math.floor(cur * 10000000);
      const durTicks = Math.floor(dur * 10000000);
      jellyfinTvService.reportPlaybackStop(currentItem.id, ticks);
      if (currentItem.type === 'tv' && dur > 20 && cur / dur >= 0.9) onEpisodeFinished(currentItem.id, currentItem.seriesId);
      const userId = currentUser?.id || jellyfinClient.getConfig().userId;
      if (userId) {
        jellyfinClient.saveUserWatchProgress(userId, currentItem, ticks, durTicks);
        setTimeout(() => refreshLibrary(), 50);
      }
    }
    onClose();

    // Return focus specifically to the episode card just played
    setTimeout(() => {
      setFocus(`EPISODE_CARD_${currentItem.id}`);
    }, 120);
  }, [currentItem, currentUser?.id, onClose, refreshLibrary]);

  // Yudia Connect (receiver): other devices can pause / seek / stop this video and change its volume
  const remoteCtl = useRef({ seekTo, handleClosePlayer, toggleMute });
  remoteCtl.current = { seekTo, handleClosePlayer, toggleMute };
  useEffect(
    () =>
      registerPlayer({
        kind: 'video',
        pause: () => videoRef.current?.pause(),
        unpause: () => videoRef.current?.play().catch(() => {}),
        togglePause: () => {
          const v = videoRef.current;
          if (v) v.paused ? v.play().catch(() => {}) : v.pause();
        },
        seek: (secs) => remoteCtl.current.seekTo(secs),
        stop: () => remoteCtl.current.handleClosePlayer(),
        setVolume: (pct) => {
          const v = videoRef.current;
          if (!v) return;
          const next = pct === -1 ? v.volume + 0.1 : pct === -2 ? v.volume - 0.1 : pct / 100;
          v.volume = Math.min(1, Math.max(0, next));
          setVolume(v.volume);
        },
        toggleMute: (mute) => {
          const v = videoRef.current;
          if (v && (mute === undefined || mute !== v.muted)) remoteCtl.current.toggleMute();
        }
      }),
    []
  );

  // Movies: position every 10 s and on pause / play (episodes report through useSeriesPlayback), so other devices
  // (Yudia Connect) and the server see where it is
  useEffect(() => {
    if (currentItem.type === 'tv' || getCastState().connected) return;
    const report = () => {
      const v = videoRef.current;
      if (v && v.currentTime > 0) jellyfinTvService.reportPlaybackProgress(currentItem.id, Math.floor(getPosition() * 1e7), v.paused, undefined, undefined, { VolumeLevel: Math.round(v.volume * 100), IsMuted: v.muted });
    };
    const t = setInterval(report, 10_000);
    const v = videoRef.current;
    v?.addEventListener('pause', report);
    v?.addEventListener('play', report);
    return () => {
      clearInterval(t);
      v?.removeEventListener('pause', report);
      v?.removeEventListener('play', report);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem.id]);

  // Report playback start and save progress on close
  useEffect(() => {
    jellyfinTvService.reportPlaybackStart(currentItem.id, 0);
    return () => {
      if (videoRef.current) {
        const cur = getPosition();
        const dur = effectiveDurationRef.current || 1;
        const ticks = Math.floor(cur * 10000000);
        const durTicks = Math.floor(dur * 10000000);
        jellyfinTvService.reportPlaybackStop(currentItem.id, ticks);
        const userId = currentUser?.id || jellyfinClient.getConfig().userId;
        if (userId) {
          jellyfinClient.saveUserWatchProgress(userId, currentItem, ticks, durTicks);
          setTimeout(() => refreshLibrary(), 50);
        }
      }
    };
  }, [currentItem.id, currentUser?.id]);

  // Auto hide controls after 4s inactivity (disabled while drawer is open)
  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (drawerMode !== 'none') return;

    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && drawerMode === 'none') {
        setShowControls(false);
      }
    }, 4000);
  }, [isPlaying, drawerMode]);

  useEffect(() => {
    resetControlsTimeout();
    return () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    };
  }, [isPlaying, drawerMode, resetControlsTimeout]);

  // When drawer opens, focus immediately on the first active item
  useEffect(() => {
    if (drawerMode === 'subtitles') {
      setTimeout(() => {
        setFocus(`SUB_OPTION_${selectedSubtitleId}`);
      }, 50);
    } else if (drawerMode === 'audio') {
      setTimeout(() => {
        setFocus(`AUD_OPTION_${selectedAudioId}`);
      }, 50);
    } else if (drawerMode === 'settings') {
      setTimeout(() => {
        setFocus('DRAWER_SUBTITLE_QUICK_BTN');
      }, 50);
    }
    // Every panel (incl. Quality, and Audio when the file has no track list): if the remote didn't land inside
    // the panel, put it on the panel's first button — never leave it on the hidden top bar.
    if (drawerMode !== 'none') {
      const t = setTimeout(() => {
        const f = document.querySelector('.focused');
        if (!f || !f.closest('.player-drawer-zone')) setFocus('PLAYER_DRAWER_ZONE');
      }, 140);
      return () => clearTimeout(t);
    }
  }, [drawerMode, selectedSubtitleId, selectedAudioId]);

  // Handle D-pad navigation keys and Tizen Remote keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      resetControlsTimeout();

      // Return / Back key (Tizen: 10009, PC: Escape 27)
      if (e.keyCode === 10009 || e.keyCode === 27) {
        if (drawerMode !== 'none') {
          e.preventDefault();
          e.stopImmediatePropagation(); // Back closes only the panel, never the whole player
          const prevMode = drawerMode;
          setDrawerMode('none');
          // After the panel has gone (its closing would otherwise pull the focus back to it)
          const backTo = prevMode === 'subtitles' ? 'TOP_SUBTITLES_BTN' : prevMode === 'audio' ? 'TOP_AUDIO_BTN' : prevMode === 'quality' ? 'TOP_QUALITY_BTN' : 'TOP_SETTINGS_BTN';
          setTimeout(() => setFocus(backTo), 60);
          return;
        }
        handleClosePlayer();
        return;
      }

      // If drawer is open, let spatial navigation handle inside drawer
      if (drawerMode !== 'none') {
        return;
      }

      // Up / Down remote control: Toggle control HUD
      if (e.keyCode === 38 || e.key === 'ArrowUp') {
        if (!showControls) {
          setShowControls(true);
          setFocus('HUD_PLAYPAUSE_BTN');
          return;
        }
      } else if (e.keyCode === 40 || e.key === 'ArrowDown') {
        if (showControls) {
          setShowControls(false);
          return;
        }
      }

      // While the HUD is visible, OK and Left/Right belong to whatever is focused (spatial navigation):
      // the progress bar handles its own ±10 s and play/pause. Handling them here too made every press
      // count twice — 20 s jumps, and OK toggling play/pause twice (i.e. doing nothing).
      const isOk = e.keyCode === 13 || e.key === 'Enter';
      const isLeft = e.keyCode === 37 || e.key === 'ArrowLeft';
      const isRight = e.keyCode === 39 || e.key === 'ArrowRight';

      if (!showControls && isOk) {
        e.preventDefault();
        e.stopPropagation();
        setShowControls(true);
        togglePlayPause();
        setFocus('HUD_PROGRESS_BAR');
        return;
      }

      // HUD hidden: Left/Right seek straight away and bring up the bar, focused, for further scrubbing.
      if (!showControls && (isLeft || isRight)) {
        e.preventDefault();
        e.stopPropagation();
        setShowControls(true);
        seekRelative(isLeft ? -10 : 10);
        setFocus('HUD_PROGRESS_BAR');
        return;
      }

      // Play/Pause hardware remote key (Tizen: 10252)
      if (e.keyCode === 10252) {
        togglePlayPause();
      }
      // Subtitle button on hardware remote (Tizen: 10140)
      else if (e.keyCode === 10140 || (e.key && e.key.toLowerCase() === 'c' && e.ctrlKey)) {
        openSubtitlesDrawer();
      }
    };

    // Capture phase: runs before spatial navigation's (bubble) listener, so stopPropagation above
    // really does keep a hidden-HUD key press from also being handled by the focused control.
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [duration, isPlaying, drawerMode, showControls, selectedSubtitleId, selectedAudioId, handleClosePlayer, resetControlsTimeout]);

  // Drive off the element's real state; onPlay/onPause keep isPlaying in sync (autoplay blocks, stalls, reloads).
  const togglePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  };

  const lastRenderedSecRef = useRef(-1);
  const lastProgressSecRef = useRef(-1);
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const cur = getPosition();
    // Re-render the (large) player at most once per second while the controls are hidden — nothing visible
    // depends on sub-second time then, and TV chips feel every extra render. Full rate when the bar is shown.
    const sec = Math.floor(cur);
    if (showControls || sec !== lastRenderedSecRef.current) {
      lastRenderedSecRef.current = sec;
      setCurrentTime(cur);
    }
    syncDurationFromVideo();

    // Update buffer percentage (buffered ranges are on the stream clock, so add the transcode offset)
    if (videoRef.current.buffered && videoRef.current.buffered.length > 0) {
      try {
        const effDur = effectiveDurationRef.current;
        if (effDur > 0) {
          const offset = isTranscodingRef.current ? streamStartRef.current : 0;
          const end = offset + videoRef.current.buffered.end(videoRef.current.buffered.length - 1);
          // Whole percent: an ever-changing float would force a re-render on every tick
          setBufferedPercent(Math.round(Math.min(100, Math.max(0, (end / effDur) * 100))));
        }
      } catch (e) {}
    }

    // Sync subtitles
    if (selectedSubtitleId !== 'off' && cues.length > 0) {
      const cueText = getActiveCue(cues, cur, subtitleDelay, false);
      setActiveSubtitleText(cueText);
    } else {
      if (activeSubtitleText) setActiveSubtitleText(null);
    }

    // Sync Jellyfin playback progress every ~10s (once — timeupdate fires ~4×/s)
    if (sec % 10 === 0 && sec !== lastProgressSecRef.current) {
      lastProgressSecRef.current = sec;
      const ticks = Math.floor(cur * 10000000);
      jellyfinTvService.reportPlaybackProgress(
        currentItem.id,
        ticks,
        !isPlaying,
        audioTracks.findIndex((a) => a.id === selectedAudioId),
        subtitleTracks.findIndex((s) => s.id === selectedSubtitleId)
      );
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || !isFinite(secs) || secs < 0) return '00:00';
    const totalSecs = Math.floor(secs);
    const h = Math.floor(totalSecs / 3600);
    const m = Math.floor((totalSecs % 3600) / 60);
    const s = totalSecs % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const openSubtitlesDrawer = () => {
    setShowControls(true);
    setDrawerMode('subtitles');
  };

  const openAudioDrawer = () => {
    setShowControls(true);
    setDrawerMode('audio');
  };

  const openQualityDrawer = () => {
    setShowControls(true);
    setDrawerMode('quality');
  };

  const closeDrawer = () => {
    const prev = drawerMode;
    setDrawerMode('none');
    const backTo = prev === 'subtitles' ? 'TOP_SUBTITLES_BTN' : prev === 'audio' ? 'TOP_AUDIO_BTN' : prev === 'quality' ? 'TOP_QUALITY_BTN' : 'TOP_SETTINGS_BTN';
    setTimeout(() => setFocus(backTo), 60); // once the panel is gone
  };

  const progressPercent = effectiveDuration > 0
    ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100))
    : 0;
  const currentSubtitleTrack = subtitleTracks.find((t) => t.id === selectedSubtitleId);
  const currentAudioTrack = audioTracks.find((t) => t.id === selectedAudioId);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        onMouseMove={resetControlsTimeout}
        onClick={(e) => {
          // Only taps on the picture itself (not on buttons / panels)
          const t = e.target as HTMLElement;
          if (t.tagName !== 'VIDEO' && t !== e.currentTarget) return;
          if (window.matchMedia('(pointer: coarse)').matches) {
            if (showControls) setShowControls(false);
            else resetControlsTimeout();
          } else {
            resetControlsTimeout();
          }
        }}
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0, left: 0,
          backgroundColor: '#000000',
          zIndex: 9000,
          overflow: 'hidden'
        }}
      >
        {/* Age rating + topics, then photosensitive warning — once per title, from live Jellyfin metadata */}
        <ContentAdvisoryOverlay
          itemId={currentItem.id}
          active={!isLaunching && isPlaying && !showUpNext}
          controlsVisible={showControls && !showUpNext}
        />

        {/* Cinematic Media Launch Animation Overlay */}
        {isLaunching && (
          <MediaLaunchOverlay
            item={currentItem}
            isFadingOut={launchFadingOut}
          />
        )}

        {/* Up Next: the next episode's picture fills the screen (full-size version of its thumbnail) */}
        {showUpNext && nextEpisode && (
          <div className="upnext-bg" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9005, backgroundColor: '#05070a' }}>
            {(nextEpisode.ImageUrl || nextEpisode.BackdropUrl) && (
              <img
                src={(nextEpisode.ImageUrl || nextEpisode.BackdropUrl)!.replace(/maxWidth=\d+/, 'maxWidth=1920')}
                alt=""
                decoding="async"
                onError={(e) => {
                  const img = e.currentTarget;
                  if (nextEpisode.BackdropUrl && img.src !== nextEpisode.BackdropUrl) img.src = nextEpisode.BackdropUrl;
                  else img.style.display = 'none';
                }}
                style={{ width: '100%', height: '100%', objectFit: 'cover', animation: 'upnextZoom 12s ease-out forwards' }}
              />
            )}
            <div
              style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0, left: 0,
                background:
                  'linear-gradient(to top, rgba(5,7,10,0.92) 0%, rgba(5,7,10,0.35) 45%, rgba(5,7,10,0.15) 100%), linear-gradient(to right, rgba(5,7,10,0.55) 0%, transparent 60%)'
              }}
            />
          </div>
        )}

        {/* Animated Video Canvas Container (Shrinks into square with loading bar when credits arrive) */}
        <div
          className={showUpNext && nextEpisode ? 'netflix-video-card-glow upnext-credits' : ''}
          style={{
            position: 'absolute',
            ...(showUpNext && nextEpisode
              ? {
                  // Credits keep playing in a small window, lower left
                  top: '46%',
                  left: '5%',
                  width: '30vw',
                  height: '16.875vw',
                  borderRadius: '20px',
                  overflow: 'hidden',
                  zIndex: 9020
                }
              : {
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  borderRadius: '0px',
                  overflow: 'hidden',
                  zIndex: 9000
                }),
            transition: 'all 0.7s cubic-bezier(0.16, 1, 0.3, 1)',
            backgroundColor: '#000000',
            cursor: showUpNext && nextEpisode ? 'pointer' : 'default'
          }}
          onClick={showUpNext && nextEpisode ? cancelUpNext : undefined}
        >
          {/* Native Video Element */}
          <video
            ref={videoRef}
            src={activeStreamUrl || undefined}
            autoPlay
            playsInline
            style={{ width: '100%', height: '100%', objectFit: videoFit === 'fill' ? 'cover' : 'contain', background: '#000' }}
            onTimeUpdate={handleTimeUpdate}
            onDurationChange={syncDurationFromVideo}
            onCanPlay={() => {
              handleVideoReady();
              syncDurationFromVideo();
            }}
            onPlaying={handleVideoReady}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onLoadedMetadata={() => {
              const v = videoRef.current;
              if (!v) return;
              v.muted = false;
              v.volume = volume;
              syncDurationFromVideo();
              if (!isTranscodingRef.current && !(v.duration > 0 && isFinite(v.duration))) {
                const fallback = parseDurationSeconds(currentItem.duration);
                if (fallback > 0) setDuration(fallback);
              }

              // Finish a pending reposition from a seek / quality / audio switch.
              if (isTranscodingRef.current) {
                pendingSeekRef.current = null; // the new transcode already starts at the target
              } else if (pendingDirectSeekRef.current !== null) {
                v.currentTime = pendingDirectSeekRef.current;
              }
              pendingDirectSeekRef.current = null;
              if (pauseAfterReloadRef.current) {
                pauseAfterReloadRef.current = false;
                v.pause();
              }

              // Resume point: once per item — not on every reload.
              if (resumeAppliedForRef.current !== currentItem.id) {
                resumeAppliedForRef.current = currentItem.id;
                const pct = currentItem.playbackPercent || 0;
                if (pct > 0 && pct < 98 && effectiveDurationRef.current > 0) {
                  seekTo((pct / 100) * effectiveDurationRef.current);
                }
              }
            }}
            onError={() => {
              // Direct play failed on this device (unsupported container/codec) → let the server convert it.
              if (streamMode === 'direct') {
                console.warn('[VideoPlayer] Direct play failed, switching to server-side stream');
                keepPositionAcrossReload();
                setForceServerSide(true);
              } else if (activeStreamUrl) {
                console.warn('[VideoPlayer] Stream error:', videoRef.current?.error);
              }
            }}
            onEnded={() => {
              if (nextEpisode && autoPlayNext) {
                playNextNow();
              } else if (nextEpisode) {
                triggerUpNextScreen();
              } else {
                handleClosePlayer();
              }
            }}
          >
            {/* External WebVTT Track support */}
            {currentSubtitleTrack?.url && (
              <track
                kind="subtitles"
                src={currentSubtitleTrack.url}
                srcLang={currentSubtitleTrack.language}
                label={currentSubtitleTrack.displayTitle}
                default
              />
            )}
          </video>

          {/* Overlays on the Current Episode Square during End Credits */}
          {showUpNext && nextEpisode && (
            <div
              style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0, left: 0,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                padding: '16px 18px',
                pointerEvents: 'none',
                background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 40%, rgba(0,0,0,0.85) 100%)'
              }}
            >
              {/* Top Header Pill */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                    padding: '6px 12px',
                    borderRadius: '20px',
                    fontSize: '0.75rem',
                    fontWeight: 800,
                    color: '#ffffff',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    backdropFilter: 'blur(10px)'
                  }}
                >
                  <span
                    className="netflix-red-dot"
                    style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#e50914' }}
                  />
                  CURRENT EPISODE • CREDITS
                </span>

                <div
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.7)',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    fontSize: '0.72rem',
                    color: 'rgba(255,255,255,0.8)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Maximize2 size={13} color="var(--accent)" />
                  <span>Click to Expand</span>
                </div>
              </div>

              {/* Bottom Current Episode Info & Animated Progress Loading Bar */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  backgroundColor: 'rgba(8, 10, 15, 0.88)',
                  backdropFilter: 'blur(16px)',
                  padding: '12px 14px',
                  borderRadius: '12px',
                  border: '1px solid rgba(255,255,255,0.1)'
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                    {currentItem.episodeName || currentItem.title}
                  </span>
                  <span style={{ fontSize: '0.75rem', color: 'var(--accent)', fontWeight: 700 }}>
                    {formatTime(currentTime)} / {formatTime(duration)}
                  </span>
                </div>

                {/* Animated loading bar for Current Episode */}
                <div
                  style={{
                    width: '100%',
                    height: '5px',
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    borderRadius: '3px',
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${progressPercent}%`,
                      height: '100%',
                      background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 100%)',
                      borderRadius: '3px',
                      transition: 'width 0.25s linear'
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Auto-Skipped Intro Pill Notification */}
        {autoSkippedNotice && (
          <div
            style={{
              position: 'absolute',
              top: '40px',
              right: '48px',
              backgroundColor: 'rgba(10, 14, 24, 0.94)',
              border: '1px solid var(--accent)',
              color: 'var(--accent)',
              padding: '12px 24px',
              borderRadius: '16px',
              backdropFilter: 'blur(25px)',
              WebkitBackdropFilter: 'blur(25px)',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              fontSize: '1rem',
              fontWeight: 700,
              boxShadow: '0 8px 30px rgba(var(--accent-rgb), 0.45)',
              zIndex: 9050,
              animation: 'fadeInDown 0.3s ease'
            }}
          >
            <FastForward size={20} color="var(--accent)" />
            <span>Auto-Skipped Intro</span>
          </div>
        )}

        {/* Actionable Skip Intro Floating Button via Spatial Navigation */}
        {canSkipIntro && (
          <div
            style={{
              position: 'absolute',
              bottom: showControls ? '210px' : '90px',
              right: '48px',
              zIndex: 9015,
              animation: 'fadeInUp 0.3s ease'
            }}
          >
            <FocusableButton
              focusKey="PLAYER_SKIP_INTRO_BTN"
              onPress={skipIntro}
              style={{
                padding: '12px 24px',
                backgroundColor: 'rgba(10, 14, 24, 0.92)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
                boxShadow: '0 8px 24px rgba(var(--accent-rgb), 0.35)',
                fontWeight: 700,
                fontSize: '1rem',
                borderRadius: '14px'
              }}
            >
              <FastForward size={20} color="var(--accent)" />
              <span>Skip Intro</span>
            </FocusableButton>
          </div>
        )}

        {/* Actionable Skip Credits Floating Button via Spatial Navigation */}
        {canSkipCredits && !showUpNext && (
          <div
            style={{
              position: 'absolute',
              bottom: showControls ? '210px' : '90px',
              right: '48px',
              zIndex: 9015,
              animation: 'fadeInUp 0.3s ease'
            }}
          >
            <FocusableButton
              focusKey="PLAYER_SKIP_CREDITS_BTN"
              onPress={skipCredits}
              style={{
                padding: '12px 24px',
                backgroundColor: 'rgba(10, 14, 24, 0.92)',
                borderColor: '#c084fc',
                color: '#c084fc',
                boxShadow: '0 8px 24px rgba(192, 132, 252, 0.35)',
                fontWeight: 700,
                fontSize: '1rem',
                borderRadius: '14px'
              }}
            >
              <FastForward size={20} color="#c084fc" />
              <span>Skip Credits</span>
            </FocusableButton>
          </div>
        )}

        {/* =========================================================================
            UP NEXT SCREEN — next episode picture full screen, credits in a small window (left),
            episode name + intro (right), [Credits] and [Continue ⏱] buttons below.
           ========================================================================= */}
        {showUpNext && nextEpisode && (
          <div className="upnext-info">
            <span className="upnext-info__kicker">
              Up next · {nextEpisode.SeriesName || currentItem.seriesName || 'Series'}
            </span>
            <h2 className="upnext-info__title">{nextEpisode.Name}</h2>
            <span className="upnext-info__meta">
              S{nextEpisode.ParentIndexNumber || 1} · E{nextEpisode.IndexNumber || 1}
              {nextEpisode.RunTimeTicks ? ` · ${Math.round(nextEpisode.RunTimeTicks / 600000000)} min` : ''}
            </span>
            {nextEpisode.Overview && <p className="upnext-info__intro">{nextEpisode.Overview}</p>}
          </div>
        )}

        {showUpNext && nextEpisode && (
          <div className="upnext-actions">
            <FocusableButton
              focusKey="UP_NEXT_WATCH_CREDITS"
              onPress={cancelUpNext}
              onArrowPress={(dir) => dir === 'right'} // only → to Continue; hidden player buttons are off-limits
              style={{
                padding: '14px 30px',
                borderRadius: '999px',
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                borderColor: 'rgba(255, 255, 255, 0.3)',
                fontSize: '1.05rem',
                fontWeight: 700
              }}
            >
              <Maximize2 size={18} />
              <span>Credits</span>
            </FocusableButton>

            <FocusableButton
              focusKey="UP_NEXT_PLAY_NOW"
              onPress={playNextNow}
              onArrowPress={(dir) => dir === 'left'} // only ← to Credits
              style={{
                padding: '10px 14px 10px 30px',
                borderRadius: '999px',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                color: 'var(--accent-contrast)',
                border: 'none',
                fontSize: '1.1rem',
                fontWeight: 900,
                gap: '14px',
                boxShadow: '0 8px 24px rgba(var(--accent-rgb), 0.45)'
              }}
            >
              <Play size={20} fill="var(--accent-contrast)" />
              <span>Continue</span>
              {/* Timer: ring empties as the countdown runs, seconds in the middle */}
              <span className="upnext-timer" aria-label={autoPlayNext ? `Starts in ${countdownSeconds} seconds` : undefined}>
                {autoPlayNext ? (
                  <>
                    <svg width="40" height="40" viewBox="0 0 40 40" style={{ position: 'absolute', top: 0, left: 0, transform: 'rotate(-90deg)' }}>
                      <circle cx="20" cy="20" r="17" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                      <circle
                        cx="20"
                        cy="20"
                        r="17"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 17}
                        strokeDashoffset={2 * Math.PI * 17 * (1 - countdownSeconds / countdownTotal)}
                        style={{ transition: 'stroke-dashoffset 1s linear' }}
                      />
                    </svg>
                    <span style={{ position: 'relative', fontSize: '0.95rem', fontWeight: 900 }}>{countdownSeconds}</span>
                  </>
                ) : (
                  <SkipForward size={18} />
                )}
              </span>
            </FocusableButton>
          </div>
        )}

        {/* Apple TV / Netflix Synchronized High-Contrast Subtitle Overlay */}
        {selectedSubtitleId !== 'off' && activeSubtitleText && (
          <div
            style={{
              position: 'absolute',
              bottom: showControls ? '185px' : '65px',
              left: '50%',
              transform: 'translateX(-50%)',
              maxWidth: '85%',
              textAlign: 'center',
              pointerEvents: 'none',
              zIndex: 8990,
              transition: 'bottom 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}
          >
            <span
              style={{
                display: 'inline-block',
                backgroundColor: 'rgba(10, 10, 14, 0.82)',
                color: '#ffffff',
                fontSize: subtitleSize === 'huge' ? '2.1rem' : subtitleSize === 'large' ? '1.7rem' : '1.35rem',
                fontWeight: 600,
                letterSpacing: '0.02em',
                lineHeight: 1.4,
                padding: '8px 24px',
                borderRadius: '12px',
                boxShadow: '0 8px 30px rgba(0,0,0,0.85)',
                textShadow: '0 2px 4px rgba(0,0,0,0.95), 0 0 10px rgba(0,0,0,0.8)',
                border: '1px solid rgba(255,255,255,0.12)'
              }}
            >
              {activeSubtitleText}
            </span>
          </div>
        )}

        {/* While casting: this screen is the TV's remote */}
        {casting && (
          <CastRemote
            item={currentItem}
            deviceName={cast.deviceName}
            loaded={cast.mediaId === currentItem.id}
            isPaused={cast.isPaused}
            buffering={cast.playerState === 'BUFFERING' || cast.mediaId !== currentItem.id}
            time={cast.currentTime}
            duration={cast.duration || effectiveDuration}
            onClose={handleClosePlayer}
          />
        )}

        {/* Top Header Bar Overlay */}
        <div className="player-topbar"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            padding: '32px 48px',
            background: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 60%, rgba(0,0,0,0) 100%)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            opacity: showControls && !showUpNext ? 1 : 0,
            pointerEvents: showControls && !showUpNext ? 'auto' : 'none',
            transition: 'opacity 0.4s ease',
            zIndex: 9002
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            <FocusableButton onPress={handleClosePlayer} focusKey="CLOSE_PLAYER_BTN">
              <ArrowLeft size={22} /> Back
            </FocusableButton>
            <div>
              <h2 style={{ fontSize: '1.45rem', fontWeight: 700, color: '#fff', margin: 0 }}>{currentItem.title}</h2>
              <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.65)', margin: '4px 0 0 0' }}>
                {[currentItem.year, currentItem.rating].filter(Boolean).join(' • ')}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            {/* Quick Quality Button in Header */}
            <FocusableButton
              focusKey="TOP_QUALITY_BTN"
              onPress={openQualityDrawer}
              style={{
                borderColor: selectedQualityId !== 'auto' ? 'rgba(var(--accent-rgb), 0.6)' : 'rgba(255,255,255,0.2)',
                background: selectedQualityId !== 'auto' ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255,255,255,0.08)'
              }}
            >
              <Sliders size={20} color={selectedQualityId !== 'auto' ? 'var(--accent)' : '#ffffff'} />
              <span>Quality: {activeQuality.label}</span>
            </FocusableButton>

            {/* Quick Subtitle Button in Header */}
            <FocusableButton
              focusKey="TOP_SUBTITLES_BTN"
              onPress={openSubtitlesDrawer}
              style={{
                borderColor: selectedSubtitleId !== 'off' ? 'rgba(var(--accent-rgb), 0.6)' : 'rgba(255,255,255,0.2)',
                background: selectedSubtitleId !== 'off' ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255,255,255,0.08)'
              }}
            >
              <Subtitles size={20} color={selectedSubtitleId !== 'off' ? 'var(--accent)' : '#ffffff'} />
              <span>Subtitles</span>
            </FocusableButton>

            {/* Quick Audio Button in Header */}
            <FocusableButton focusKey="TOP_AUDIO_BTN" onPress={openAudioDrawer}>
              <Volume2 size={20} />
              <span>Audio</span>
            </FocusableButton>

            {/* General Settings */}
            <FocusableButton focusKey="TOP_SETTINGS_BTN" onPress={() => setDrawerMode('settings')}>
              <Settings size={20} />
            </FocusableButton>

            {/* Google Cast (website only; hidden when no Cast device is around) */}
            <CastButton focusKey="TOP_CAST_BTN" />
          </div>
        </div>

        {/* Apple TV-Inspired Frosted Glass Scrubber & Media Controls HUD */}
        <div className="player-hud"
          style={{
            position: 'absolute',
            bottom: '40px',
            left: '48px',
            right: '48px',
            backgroundColor: 'rgba(15, 17, 23, 0.78)',
            backdropFilter: 'blur(35px) saturate(190%)',
            WebkitBackdropFilter: 'blur(35px) saturate(190%)',
            border: '1px solid rgba(255, 255, 255, 0.18)',
            borderRadius: '24px',
            padding: '24px 36px',
            opacity: showControls && !showUpNext ? 1 : 0,
            transform: showControls && !showUpNext ? 'translateY(0)' : 'translateY(24px)',
            pointerEvents: showControls && !showUpNext ? 'auto' : 'none',
            transition: 'all 0.4s cubic-bezier(0.2, 0.8, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            gap: '18px',
            zIndex: 9002
          }}
        >
          {/* Interactive D-Pad & Mouse Timeline Scrubber Bar */}
          <HUDProgressBar
            progressPercent={progressPercent}
            bufferedPercent={bufferedPercent}
            currentTime={currentTime}
            duration={effectiveDuration}
            formatTime={formatTime}
            onSeek={seekTo}
            onSeekRelative={seekRelative}
            onTogglePlayPause={togglePlayPause}
            resetControlsTimeout={resetControlsTimeout}
          />

          {/* D-Pad Remote Focusable Media Controls Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Spacer keeps the transport controls centred (quality/audio/subtitles live in the top bar) */}
            <div style={{ flex: 1 }} />

            {/* Center Playback Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <FocusableButton
                focusKey="HUD_REWIND_BTN"
                onPress={() => seekRelative(-10)}
              >
                <RotateCcw size={20} /> -10s
              </FocusableButton>

              <FocusableButton
                focusKey="HUD_PLAYPAUSE_BTN"
                onPress={togglePlayPause}
                style={{
                  padding: '14px 32px',
                  backgroundColor: 'rgba(255,255,255,0.18)',
                  border: '1px solid rgba(255,255,255,0.4)'
                }}
              >
                {isPlaying ? <Pause size={24} fill="#fff" /> : <Play size={24} fill="#fff" />}
                <span style={{ fontSize: '1.05rem', fontWeight: 700 }}>{isPlaying ? 'Pause' : 'Play'}</span>
              </FocusableButton>

              <FocusableButton
                focusKey="HUD_FORWARD_BTN"
                onPress={() => seekRelative(10)}
              >
                <RotateCw size={20} /> +10s
              </FocusableButton>

              {/* Direct Skip Intro Button on Player Controls */}
              {canSkipIntro && (
                <FocusableButton
                  focusKey="HUD_SKIP_INTRO_BTN"
                  onPress={skipIntro}
                  style={{
                    backgroundColor: 'rgba(var(--accent-rgb), 0.22)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                    fontWeight: 700,
                    boxShadow: '0 0 16px rgba(var(--accent-rgb), 0.4)'
                  }}
                >
                  <FastForward size={18} color="var(--accent)" />
                  <span>Skip Intro</span>
                </FocusableButton>
              )}
            </div>

            <div style={{ flex: 1, display: 'flex', gap: '12px', alignItems: 'center', justifyContent: 'flex-end' }}>
              <FocusableButton
                focusKey="HUD_MUTE_BTN"
                onPress={toggleMute}
                style={{
                  borderColor: isMuted ? '#ff334b' : 'rgba(255,255,255,0.2)',
                  backgroundColor: isMuted ? 'rgba(255, 51, 75, 0.2)' : 'rgba(255,255,255,0.08)'
                }}
              >
                {isMuted ? <VolumeX size={20} color="#ff334b" /> : <Volume2 size={20} />}
                <span>{isMuted ? 'Unmute' : 'Mute'}</span>
              </FocusableButton>
            </div>
          </div>
        </div>

        {/* Side panels (subtitles / audio / settings / quality): one focus boundary, so while a panel is open the
            remote stays in it instead of slipping onto the player's hidden top bar and controls */}
        <DrawerZone open={drawerMode !== 'none'}>
        {/* =========================================================================
            SUBTITLES SETTINGS DRAWER (Fully Accessible via TV Remote D-Pad)
           ========================================================================= */}
        {drawerMode === 'subtitles' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: '440px',
              backgroundColor: 'rgba(13, 15, 22, 0.94)',
              backdropFilter: 'blur(35px) saturate(200%)',
              WebkitBackdropFilter: 'blur(35px) saturate(200%)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.16)',
              padding: '40px 32px',
              color: '#fff',
              zIndex: 9020,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.8)',
              animation: 'slideInRight 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}
          >
            {/* Drawer Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.3) 0%, rgba(124,77,255,0.3) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(var(--accent-rgb), 0.4)'
                  }}
                >
                  <Subtitles size={20} color="var(--accent)" />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Subtitles & CC</h3>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', margin: '2px 0 0 0' }}>
                    Select subtitle track and size
                  </p>
                </div>
              </div>

              <FocusableButton focusKey="DRAWER_CLOSE_BTN" onPress={closeDrawer} style={{ padding: '8px 14px' }}>
                <X size={18} /> Close
              </FocusableButton>
            </div>

            {/* Scrollable Options Container */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
                paddingRight: '6px'
              }}
            >
              {/* 1. Track Selection */}
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Available Tracks
                </span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px' }}>
                  {/* Turn Subtitles Off option */}
                  <FocusableButton
                    focusKey="SUB_OPTION_off"
                    onPress={() => setSelectedSubtitleId('off')}
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      backgroundColor: selectedSubtitleId === 'off' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.06)',
                      borderColor: selectedSubtitleId === 'off' ? '#ffffff' : 'rgba(255,255,255,0.12)'
                    }}
                  >
                    <span>Off (No Subtitles)</span>
                    {selectedSubtitleId === 'off' && <Check size={18} color="var(--accent)" />}
                  </FocusableButton>

                  {/* Dynamic Subtitle Tracks */}
                  {subtitleTracks.map((sub) => {
                    const isSelected = selectedSubtitleId === sub.id;
                    return (
                      <FocusableButton
                        key={sub.id}
                        focusKey={`SUB_OPTION_${sub.id}`}
                        onPress={() => setSelectedSubtitleId(sub.id)}
                        style={{
                          width: '100%',
                          justifyContent: 'space-between',
                          backgroundColor: isSelected ? 'rgba(var(--accent-rgb), 0.22)' : 'rgba(255, 255, 255, 0.06)',
                          borderColor: isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)'
                        }}
                      >
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                          <span style={{ fontWeight: 600, color: isSelected ? '#ffffff' : 'rgba(255,255,255,0.9)' }}>
                            {sub.displayTitle}
                          </span>
                          <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                            {sub.language.toUpperCase()} {sub.isDefault ? '• Default' : ''}
                          </span>
                        </div>
                        {isSelected && <Check size={18} color="var(--accent)" />}
                      </FocusableButton>
                    );
                  })}
                </div>
              </div>

              {/* 2. Subtitle Size Picker (Essential for 10-foot TV experience) */}
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Subtitle Font Size
                </span>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  {(['normal', 'large', 'huge'] as const).map((size) => {
                    const isSelected = subtitleSize === size;
                    return (
                      <FocusableButton
                        key={size}
                        focusKey={`SUB_SIZE_${size}`}
                        onPress={() => setSubtitleSize(size)}
                        style={{
                          flex: 1,
                          justifyContent: 'center',
                          padding: '10px 0',
                          backgroundColor: isSelected ? 'rgba(var(--accent-rgb), 0.2)' : 'rgba(255,255,255,0.06)',
                          borderColor: isSelected ? 'var(--accent)' : 'rgba(255,255,255,0.12)',
                          fontSize: '0.9rem'
                        }}
                      >
                        {size === 'normal' ? 'Normal' : size === 'large' ? 'Large' : 'Huge'}
                      </FocusableButton>
                    );
                  })}
                </div>
              </div>

              {/* 3. Subtitle Sync Adjuster (±100ms steps) */}
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Subtitle Sync / Delay ({Math.round(subtitleDelay * 1000) >= 0 ? `+${Math.round(subtitleDelay * 1000)}ms` : `${Math.round(subtitleDelay * 1000)}ms`})
                </span>
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <FocusableButton
                    focusKey="SUB_DELAY_MINUS"
                    onPress={() => setSubtitleDelay((d) => Math.max(-5, Math.round((d - 0.1) * 10) / 10))}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    -100ms
                  </FocusableButton>
                  <FocusableButton
                    focusKey="SUB_DELAY_RESET"
                    onPress={() => setSubtitleDelay(0)}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    Reset (0ms)
                  </FocusableButton>
                  <FocusableButton
                    focusKey="SUB_DELAY_PLUS"
                    onPress={() => setSubtitleDelay((d) => Math.min(5, Math.round((d + 0.1) * 10) / 10))}
                    style={{ flex: 1, justifyContent: 'center' }}
                  >
                    +100ms
                  </FocusableButton>
                </div>
              </div>
            </div>

            {/* Remote Navigation Hint */}
            <div
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: '10px',
                backgroundColor: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: '0.8rem',
                color: 'rgba(255,255,255,0.6)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <span style={{ color: 'var(--accent)', fontWeight: 700 }}>Tip:</span> Press Return/Back on your remote to close this menu.
            </div>
          </div>
        )}

        {/* =========================================================================
            AUDIO TRACK DRAWER (Fully Accessible via TV Remote D-Pad)
           ========================================================================= */}
        {drawerMode === 'audio' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: '420px',
              backgroundColor: 'rgba(13, 15, 22, 0.94)',
              backdropFilter: 'blur(35px) saturate(200%)',
              WebkitBackdropFilter: 'blur(35px) saturate(200%)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.16)',
              padding: '40px 32px',
              color: '#fff',
              zIndex: 9020,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.8)',
              animation: 'slideInRight 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, rgba(124,77,255,0.3) 0%, rgba(var(--accent-rgb), 0.3) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(124,77,255,0.4)'
                  }}
                >
                  <Volume2 size={20} color="#7c4dff" />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Audio Track</h3>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', margin: '2px 0 0 0' }}>
                    Select playback sound stream
                  </p>
                </div>
              </div>

              <FocusableButton focusKey="DRAWER_AUDIO_CLOSE_BTN" onPress={closeDrawer} style={{ padding: '8px 14px' }}>
                <X size={18} /> Close
              </FocusableButton>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '12px', flex: 1 }}>
              {audioTracks.map((aud) => {
                const isSelected = selectedAudioId === aud.id;
                return (
                  <FocusableButton
                    key={aud.id}
                    focusKey={`AUD_OPTION_${aud.id}`}
                    onPress={() => handleSelectAudioTrack(aud.id)}
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      backgroundColor: isSelected ? 'rgba(124, 77, 255, 0.25)' : 'rgba(255, 255, 255, 0.06)',
                      borderColor: isSelected ? '#7c4dff' : 'rgba(255, 255, 255, 0.12)'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                      <span style={{ fontWeight: 600, color: isSelected ? '#ffffff' : 'rgba(255,255,255,0.9)' }}>
                        {aud.displayTitle}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                        {aud.codec ? aud.codec.toUpperCase() : 'Surround'}
                      </span>
                    </div>
                    {isSelected && <Check size={18} color="#7c4dff" />}
                  </FocusableButton>
                );
              })}
            </div>
          </div>
        )}

        {/* =========================================================================
            GENERAL SETTINGS DRAWER
           ========================================================================= */}
        {drawerMode === 'settings' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: '400px',
              backgroundColor: 'rgba(13, 15, 22, 0.94)',
              backdropFilter: 'blur(35px) saturate(200%)',
              WebkitBackdropFilter: 'blur(35px) saturate(200%)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.16)',
              padding: '40px 32px',
              color: '#fff',
              zIndex: 9020,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.8)',
              animation: 'slideInRight 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Playback Settings</h3>
              <FocusableButton focusKey="DRAWER_SETTINGS_CLOSE_BTN" onPress={closeDrawer} style={{ padding: '8px 14px' }}>
                <X size={18} />
              </FocusableButton>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', flex: 1 }}>
              <FocusableButton
                focusKey="DRAWER_QUALITY_QUICK_BTN"
                onPress={() => setDrawerMode('quality')}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Sliders size={20} color="var(--accent)" />
                  <span>Stream Quality</span>
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 700 }}>
                  {activeQuality.label}
                </span>
              </FocusableButton>

              <FocusableButton
                focusKey="DRAWER_SUBTITLE_QUICK_BTN"
                onPress={() => setDrawerMode('subtitles')}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Subtitles size={20} color="var(--accent)" />
                  <span>Subtitles & CC</span>
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--accent)' }}>
                  {selectedSubtitleId !== 'off' ? currentSubtitleTrack?.displayTitle : 'Off'}
                </span>
              </FocusableButton>

              <FocusableButton
                focusKey="DRAWER_AUDIO_QUICK_BTN"
                onPress={() => setDrawerMode('audio')}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Volume2 size={20} color="#7c4dff" />
                  <span>Audio Stream</span>
                </div>
                <span style={{ fontSize: '0.85rem', color: '#7c4dff' }}>
                  {currentAudioTrack?.language.toUpperCase() || 'ENG'}
                </span>
              </FocusableButton>

              {/* Auto-Skip Intro Option in Player Settings */}
              <FocusableButton
                focusKey="DRAWER_AUTO_SKIP_INTRO_BTN"
                onPress={() => {
                  const nextVal = !autoSkipIntro;
                  setAutoSkipIntro(nextVal);
                  try {
                    const saved = localStorage.getItem('jellyfin_streaming_settings');
                    const parsed = saved ? JSON.parse(saved) : {};
                    parsed.autoSkipIntro = nextVal;
                    localStorage.setItem('jellyfin_streaming_settings', JSON.stringify(parsed));
                  } catch (e) {}
                }}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <FastForward size={20} color={autoSkipIntro ? 'var(--accent)' : 'rgba(255,255,255,0.5)'} />
                  <span>Auto-Skip Intro</span>
                </div>
                <span
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: autoSkipIntro ? 'var(--accent)' : 'rgba(255,255,255,0.4)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    backgroundColor: autoSkipIntro ? 'rgba(var(--accent-rgb), 0.15)' : 'rgba(255,255,255,0.06)'
                  }}
                >
                  {autoSkipIntro ? 'ON' : 'OFF'}
                </span>
              </FocusableButton>

              {/* Picture: whole image (bars) vs zoom to fill (crops) */}
              <FocusableButton
                focusKey="DRAWER_VIDEO_FIT_BTN"
                onPress={toggleVideoFit}
                style={{ width: '100%', justifyContent: 'space-between' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Maximize2 size={20} color="var(--accent)" />
                  <span>Picture</span>
                </div>
                <span
                  style={{
                    fontSize: '0.85rem',
                    fontWeight: 700,
                    color: 'var(--accent)',
                    padding: '2px 8px',
                    borderRadius: '6px',
                    backgroundColor: 'rgba(var(--accent-rgb), 0.15)'
                  }}
                >
                  {videoFit === 'fit' ? 'Whole picture' : 'Zoom to fill'}
                </span>
              </FocusableButton>

              <FocusableButton
                focusKey="DRAWER_NETFLIX_PREVIEW_BTN"
                onPress={() => {
                  closeDrawer();
                  triggerUpNextScreen();
                }}
                style={{
                  width: '100%',
                  justifyContent: 'flex-start',
                  marginTop: '12px',
                  backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
                  borderColor: 'var(--accent)'
                }}
              >
                <Sparkles size={18} color="var(--accent)" />
                <span>Test Netflix End Credits Screen</span>
              </FocusableButton>
            </div>
          </div>
        )}

        {/* =========================================================================
            STREAMING QUALITY DRAWER (Remote Navigable with Auto Mode & Bitrates)
           ========================================================================= */}
        {drawerMode === 'quality' && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              right: 0,
              bottom: 0,
              width: '460px',
              backgroundColor: 'rgba(13, 15, 22, 0.94)',
              backdropFilter: 'blur(35px) saturate(200%)',
              WebkitBackdropFilter: 'blur(35px) saturate(200%)',
              borderLeft: '1px solid rgba(255, 255, 255, 0.16)',
              padding: '40px 32px',
              color: '#fff',
              zIndex: 9020,
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '-10px 0 40px rgba(0, 0, 0, 0.8)',
              animation: 'slideInRight 0.3s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '38px',
                    height: '38px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, rgba(var(--accent-rgb), 0.3) 0%, rgba(56,189,248,0.3) 100%)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(var(--accent-rgb), 0.4)'
                  }}
                >
                  <Sliders size={20} color="var(--accent)" />
                </div>
                <div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0 }}>Stream Quality</h3>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', margin: '2px 0 0 0' }}>
                    Select resolution & bitrate mode
                  </p>
                </div>
              </div>

              <FocusableButton focusKey="DRAWER_QUALITY_CLOSE_BTN" onPress={closeDrawer} style={{ padding: '8px 14px' }}>
                <X size={18} /> Close
              </FocusableButton>
            </div>

            {/* Quality List */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto', paddingRight: '4px' }}>
              {QUALITY_OPTIONS.map((opt) => {
                const isSelected = selectedQualityId === opt.id;
                return (
                  <FocusableButton
                    key={opt.id}
                    focusKey={`QUALITY_OPTION_${opt.id}`}
                    onPress={() => handleSelectQuality(opt.id)}
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      backgroundColor: isSelected ? 'rgba(var(--accent-rgb), 0.22)' : 'rgba(255, 255, 255, 0.06)',
                      borderColor: isSelected ? 'var(--accent)' : 'rgba(255, 255, 255, 0.12)',
                      padding: '14px 18px',
                      borderRadius: '16px'
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '3px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 700, fontSize: '1.02rem', color: isSelected ? '#ffffff' : 'rgba(255,255,255,0.92)' }}>
                          {opt.label}
                        </span>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            fontWeight: 800,
                            padding: '2px 6px',
                            borderRadius: '4px',
                            backgroundColor: opt.id === 'auto' ? 'rgba(var(--accent-rgb), 0.3)' : 'rgba(255,255,255,0.12)',
                            color: opt.id === 'auto' ? 'var(--accent)' : 'rgba(255,255,255,0.7)'
                          }}
                        >
                          {opt.badge}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.76rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.3 }}>
                        {opt.description}
                      </span>
                    </div>

                    {isSelected && <Check size={20} color="var(--accent)" />}
                  </FocusableButton>
                );
              })}
            </div>

            {/* Tip banner */}
            <div
              style={{
                marginTop: '16px',
                padding: '12px 16px',
                borderRadius: '12px',
                backgroundColor: 'rgba(var(--accent-rgb), 0.08)',
                border: '1px solid rgba(var(--accent-rgb), 0.2)',
                fontSize: '0.8rem',
                color: 'rgba(255,255,255,0.7)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Sparkles size={16} color="var(--accent)" />
              <span>
                <strong>Auto Mode</strong> dynamically matches your bandwidth to prevent buffering while giving you full Direct Play audio & video.
              </span>
            </div>
          </div>
        )}
        </DrawerZone>
      </div>
    </FocusContext.Provider>
  );
};

/** Wraps the player's side panels: while one is open the remote can't leave it (Back closes it). */
const DrawerZone: React.FC<{ open: boolean; children: React.ReactNode }> = ({ open, children }) => {
  const { ref, focusKey } = useFocusable({ focusKey: 'PLAYER_DRAWER_ZONE', isFocusBoundary: true, focusable: open, trackChildren: true });
  if (!open) return <>{children}</>;
  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="player-drawer-zone" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9020, pointerEvents: 'none' }}>
        {children}
      </div>
    </FocusContext.Provider>
  );
};
