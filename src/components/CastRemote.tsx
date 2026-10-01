import React, { useEffect } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Cast, Play, Pause, RotateCcw, RotateCw, ArrowLeft, Loader2, MonitorSmartphone } from 'lucide-react';
import { FocusableButton } from './FocusableButton';
import { MediaItem } from '../mockData';
import { castSeek, castTogglePlay, stopCasting } from '../services/cast';

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};

/**
 * Shown over the video player while casting: what's on the TV and its controls (play / pause, ±10 s, a
 * seekable progress bar, "Stop casting" = continue on this device, Back = leave it playing on the TV).
 */
export const CastRemote: React.FC<{
  item: MediaItem;
  deviceName: string;
  loaded: boolean;
  isPaused: boolean;
  buffering: boolean;
  time: number;
  duration: number;
  onClose: () => void;
}> = ({ item, deviceName, loaded, isPaused, buffering, time, duration, onClose }) => {
  const { ref, focusKey } = useFocusable({ focusKey: 'CAST_REMOTE', isFocusBoundary: true, trackChildren: true });
  useEffect(() => {
    const t = setTimeout(() => setFocus('CAST_PLAYPAUSE_BTN'), 120);
    return () => clearTimeout(t);
  }, []);
  const pct = duration > 0 ? Math.min(100, (time / duration) * 100) : 0;
  const title = item.type === 'tv' ? item.episodeName || item.title : item.title;
  const sub = item.type === 'tv' ? `${item.seriesName || ''} · S${item.seasonNumber || 1}:E${item.episodeNumber || 1}` : [item.year, item.rating].filter(Boolean).join(' · ');

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="cast-remote" role="dialog" aria-label={`Casting to ${deviceName}`}>
        {item.backdropUrl && <div className="cast-remote__bg" style={{ backgroundImage: `url("${item.backdropUrl}")` }} />}
        <div className="cast-remote__card">
          <span className="cast-remote__device">
            <Cast size={18} /> Playing on {deviceName || 'your TV'}
          </span>
          <h2 className="cast-remote__title">{title}</h2>
          {sub && <p className="cast-remote__sub">{sub}</p>}

          <div
            className="cast-remote__bar"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              if (duration > 0) castSeek(((e.clientX - r.left) / r.width) * duration);
            }}
          >
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="cast-remote__times">
            <span>{fmt(time)}</span>
            <span>{loaded ? `-${fmt(Math.max(0, duration - time))}` : 'Starting on the TV…'}</span>
          </div>

          <div className="cast-remote__controls">
            <FocusableButton focusKey="CAST_BACK10_BTN" onPress={() => castSeek(time - 10)} className="cast-remote__btn">
              <RotateCcw size={22} />
            </FocusableButton>
            <FocusableButton focusKey="CAST_PLAYPAUSE_BTN" onPress={castTogglePlay} className="cast-remote__btn cast-remote__btn--main">
              {buffering ? <Loader2 size={30} className="animate-spin" /> : isPaused ? <Play size={30} fill="currentColor" /> : <Pause size={30} fill="currentColor" />}
            </FocusableButton>
            <FocusableButton focusKey="CAST_FWD10_BTN" onPress={() => castSeek(time + 10)} className="cast-remote__btn">
              <RotateCw size={22} />
            </FocusableButton>
          </div>

          <div className="cast-remote__actions">
            <FocusableButton focusKey="CAST_STOP_BTN" onPress={stopCasting}>
              <MonitorSmartphone size={18} /> <span>Stop casting (continue here)</span>
            </FocusableButton>
            <FocusableButton focusKey="CAST_CLOSE_BTN" onPress={onClose}>
              <ArrowLeft size={18} /> <span>Back (keeps playing on the TV)</span>
            </FocusableButton>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
