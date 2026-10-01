import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { JellyfinEpisode, jellyfinTvService } from '../services/jellyfinTvService';
import { nextDownloadedEpisode, getOfflineImageUrl } from '../services/downloads';
import { useSeriesStore } from '../store/useSeriesStore';
import { EpisodeMarkers, resolveCreditsStart } from '../api/introSkipper';
import { preloadMedia } from '../services/preloadService';

const UP_NEXT_COUNTDOWN_SECS = 10;

interface UseSeriesPlaybackOptions {
  currentEpisode: JellyfinEpisode | null;
  /** Intro / credits markers in seconds (null while loading or when none exist). */
  markers: EpisodeMarkers | null;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  autoSkipIntro: boolean;
  /** Seek in episode time (handles transcode restarts). */
  seek: (seconds: number) => void;
  /** Current position in episode time. */
  getPosition: () => number;
  audioStreamIndex?: number;
  subtitleStreamIndex?: number;
  onPlayNextEpisode: (nextEp: JellyfinEpisode) => void;
}

export interface UseSeriesPlaybackReturn {
  canSkipIntro: boolean;
  canSkipCredits: boolean;
  skipIntro: () => void;
  skipCredits: () => void;
  showUpNext: boolean;
  nextEpisode: JellyfinEpisode | null;
  countdownSeconds: number;
  countdownTotal: number;
  autoPlayNext: boolean;
  playNextNow: () => void;
  cancelUpNext: () => void;
  triggerUpNextScreen: () => void;
  autoSkippedNotice: boolean;
}

function readAutoPlayNext(): boolean {
  try {
    const saved = localStorage.getItem('jellyfin_streaming_settings');
    return saved ? JSON.parse(saved).autoPlayNext !== false : true;
  } catch {
    return true;
  }
}

/**
 * Series playback state machine.
 *
 * Everything time-based is DERIVED from currentTime as booleans (introActive, inCredits); effects
 * depend on those booleans, so they run on the enter/leave edges only — not on every timeupdate tick.
 */
export function useSeriesPlayback({
  currentEpisode,
  markers,
  currentTime,
  duration,
  isPlaying,
  autoSkipIntro,
  seek,
  getPosition,
  audioStreamIndex,
  subtitleStreamIndex,
  onPlayNextEpisode
}: UseSeriesPlaybackOptions): UseSeriesPlaybackReturn {
  const episodeId = currentEpisode?.Id;

  const [nextEpisode, setNextEpisode] = useState<JellyfinEpisode | null>(null);
  const [showUpNext, setShowUpNext] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(UP_NEXT_COUNTDOWN_SECS);
  const [autoPlayNext, setAutoPlayNext] = useState(readAutoPlayNext);
  const [autoSkippedNotice, setAutoSkippedNotice] = useState(false);

  const autoSkippedRef = useRef(false);
  // Up Next may only auto-open after we've seen this episode play *before* the credits point.
  // Stops a stale position from the previous episode instantly re-opening the overlay.
  const armedRef = useRef(false);
  const advancingRef = useRef(false);
  const lastReportedTimeRef = useRef(0);

  // ---- Derived marker state (cheap, no extra renders) ----
  const introStart = markers?.introStart;
  const introEnd = markers?.introEnd;
  const introActive =
    introStart !== undefined && introEnd !== undefined && currentTime >= introStart && currentTime < introEnd;

  const creditsAt = useMemo(() => resolveCreditsStart(markers, duration), [markers, duration]);
  const inCredits = creditsAt !== null && currentTime >= creditsAt;

  // ---- Per-episode reset (episode id only — track changes must not disarm the overlay) ----
  useEffect(() => {
    autoSkippedRef.current = false;
    armedRef.current = false;
    advancingRef.current = false;
    lastReportedTimeRef.current = 0;
    setShowUpNext(false);
    setDismissed(false);
    setCountdownSeconds(UP_NEXT_COUNTDOWN_SECS);
    setAutoPlayNext(readAutoPlayNext());
  }, [episodeId]);

  // ---- Session start/stop reporting ----
  useEffect(() => {
    if (!currentEpisode) return;
    const startTicks = currentEpisode.UserData?.PlaybackPositionTicks || 0;
    jellyfinTvService.reportPlaybackStart(currentEpisode.Id, startTicks, audioStreamIndex, subtitleStreamIndex);

    return () => {
      jellyfinTvService.reportPlaybackStop(currentEpisode.Id, Math.floor(getPosition() * 10000000));
    };
  }, [episodeId, audioStreamIndex, subtitleStreamIndex]);

  // ---- Resolve the real next episode (server first, crossing seasons; loaded store as fallback) ----
  useEffect(() => {
    if (!currentEpisode) return;
    let cancelled = false;
    setNextEpisode(null);

    (async () => {
      let next = await jellyfinTvService.getNextEpisode(currentEpisode.Id, currentEpisode.SeriesId);
      if (!next && useSeriesStore.getState().episodes.some((e) => e.Id === currentEpisode.Id)) {
        next = await useSeriesStore.getState().getNextEpisodeInSequence(currentEpisode.Id);
      }
      // Offline (or the server doesn't know): the next episode of this series that's downloaded
      if (!next) {
        const d = nextDownloadedEpisode(currentEpisode.SeriesId, currentEpisode.ParentIndexNumber || 0, currentEpisode.IndexNumber || 0);
        if (d) {
          const [poster, backdrop] = await Promise.all([getOfflineImageUrl(d.id, 'poster'), getOfflineImageUrl(d.id, 'backdrop')]);
          next = {
            Id: d.id,
            Name: d.item.episodeName || d.item.title,
            SeriesId: d.item.seriesId || currentEpisode.SeriesId,
            SeriesName: d.item.seriesName || currentEpisode.SeriesName,
            SeasonId: '',
            SeasonName: `Season ${d.item.seasonNumber || 1}`,
            IndexNumber: d.item.episodeNumber || 1,
            ParentIndexNumber: d.item.seasonNumber || 1,
            Overview: d.item.overview,
            RunTimeTicks: d.item.runTimeTicks,
            ImageUrl: poster || undefined,
            BackdropUrl: backdrop || undefined
          };
        }
      }
      if (!cancelled) setNextEpisode(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  // ---- Periodic progress reporting (every 10 s of playback) ----
  useEffect(() => {
    if (!currentEpisode || !isPlaying) return;
    const secs = Math.floor(currentTime);
    if (secs > 0 && Math.abs(secs - lastReportedTimeRef.current) >= 10) {
      lastReportedTimeRef.current = secs;
      jellyfinTvService.reportPlaybackProgress(currentEpisode.Id, secs * 10000000, false, audioStreamIndex, subtitleStreamIndex);
    }
  }, [Math.floor(currentTime / 10), isPlaying, episodeId]);

  // ---- Auto-skip intro: once per episode, on entering the intro ----
  useEffect(() => {
    if (!introActive || !autoSkipIntro || autoSkippedRef.current || introEnd === undefined) return;
    autoSkippedRef.current = true;
    seek(introEnd);
    setAutoSkippedNotice(true);
    const t = setTimeout(() => setAutoSkippedNotice(false), 2500);
    return () => clearTimeout(t);
  }, [introActive]);

  // ---- Credits edge: open Up Next on entering, close + re-allow on seeking back out ----
  useEffect(() => {
    if (!inCredits) {
      armedRef.current = true;
      setShowUpNext(false);
      setDismissed(false);
      return;
    }
    if (armedRef.current && nextEpisode && !dismissed) {
      setCountdownSeconds(UP_NEXT_COUNTDOWN_SECS);
      setShowUpNext(true);
    }
  }, [inCredits, nextEpisode, dismissed, episodeId]);

  // ---- Credits reached: get the next episode ready so "Next Episode" starts instantly ----
  useEffect(() => {
    if (inCredits && nextEpisode) preloadMedia({ id: nextEpisode.Id });
  }, [inCredits, nextEpisode?.Id]);

  // ---- Countdown: one interval while the overlay is open ----
  useEffect(() => {
    if (!showUpNext || !autoPlayNext) return;
    const id = setInterval(() => setCountdownSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [showUpNext, autoPlayNext]);

  const playNextNow = useCallback(() => {
    if (!nextEpisode || advancingRef.current) return;
    advancingRef.current = true;
    setShowUpNext(false);
    onPlayNextEpisode(nextEpisode);
  }, [nextEpisode, onPlayNextEpisode]);

  // Side effect lives here, not inside the setState updater (StrictMode would run it twice).
  useEffect(() => {
    if (showUpNext && autoPlayNext && countdownSeconds === 0) playNextNow();
  }, [countdownSeconds, showUpNext, autoPlayNext, playNextNow]);

  const skipIntro = useCallback(() => {
    if (introEnd !== undefined) seek(introEnd);
  }, [seek, introEnd]);

  const triggerUpNextScreen = useCallback(() => {
    if (!nextEpisode) return;
    setDismissed(false);
    setCountdownSeconds(UP_NEXT_COUNTDOWN_SECS);
    setShowUpNext(true);
  }, [nextEpisode]);

  const cancelUpNext = useCallback(() => {
    setShowUpNext(false);
    setDismissed(true);
  }, []);

  return {
    canSkipIntro: introActive,
    // After "Watch Credits", keep a way to jump to the next episode.
    canSkipCredits: inCredits && !showUpNext && !!nextEpisode,
    skipIntro,
    skipCredits: triggerUpNextScreen,
    showUpNext: showUpNext && !!nextEpisode,
    nextEpisode,
    countdownSeconds,
    countdownTotal: UP_NEXT_COUNTDOWN_SECS,
    autoPlayNext,
    playNextNow,
    cancelUpNext,
    triggerUpNextScreen,
    autoSkippedNotice
  };
}
