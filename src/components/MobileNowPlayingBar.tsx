import React from 'react';
import { Play, Pause, SkipForward } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { useConnect } from './ConnectSheet';

/**
 * Phone "Now Playing" bar, docked at the bottom of the screen while a song is loaded (the TV shows it in the sidebar).
 * Tap the bar → full-screen player with lyrics; play/pause and next work without leaving the page.
 */
export const MobileNowPlayingBar: React.FC = () => {
  const {
    activeAudio,
    isAudioPlaying,
    toggleAudioPlayPause,
    nextAudioTrack,
    audioCurrentTime,
    audioDuration,
    setIsMusicFullScreen
  } = useAppState();

  const connect = useConnect();
  // Controlling another device: its bar (ConnectBar) replaces this one
  if (!activeAudio || connect.target) return null;

  const progress = audioDuration > 0 ? Math.min(100, Math.max(0, (audioCurrentTime / audioDuration) * 100)) : 0;
  const art = activeAudio.posterUrl || activeAudio.backdropUrl;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      className="mobile-nowplaying"
      role="button"
      tabIndex={0}
      aria-label={`Now playing: ${activeAudio.title}. Open player`}
      onClick={() => setIsMusicFullScreen(true)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') setIsMusicFullScreen(true);
      }}
    >
      <div className="mobile-nowplaying__progress" style={{ width: `${progress}%` }} />
      <div className="mobile-nowplaying__art">
        {art && (
          <img
            src={art}
            alt=""
            decoding="async"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        )}
      </div>
      <div className="mobile-nowplaying__text">
        <span className="mobile-nowplaying__title">{activeAudio.title}</span>
        <span className="mobile-nowplaying__artist">{activeAudio.artist || 'Unknown artist'}</span>
      </div>
      <button
        className="mobile-nowplaying__btn"
        aria-label={isAudioPlaying ? 'Pause' : 'Play'}
        onClick={(e) => {
          stop(e);
          toggleAudioPlayPause();
        }}
      >
        {isAudioPlaying ? <Pause size={24} fill="#fff" /> : <Play size={24} fill="#fff" style={{ marginLeft: 2 }} />}
      </button>
      <button
        className="mobile-nowplaying__btn"
        aria-label="Next song"
        onClick={(e) => {
          stop(e);
          nextAudioTrack();
        }}
      >
        <SkipForward size={22} fill="#fff" />
      </button>
    </div>
  );
};
