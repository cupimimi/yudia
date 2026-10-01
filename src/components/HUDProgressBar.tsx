import React, { useRef, useState, useEffect } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';

interface HUDProgressBarProps {
  progressPercent: number;
  bufferedPercent: number;
  currentTime: number;
  duration: number;
  formatTime: (secs: number) => string;
  onSeek: (targetSeconds: number) => void;
  onSeekRelative: (deltaSeconds: number) => void;
  onTogglePlayPause: () => void;
  resetControlsTimeout?: () => void;
}

export const HUDProgressBar: React.FC<HUDProgressBarProps> = ({
  progressPercent,
  bufferedPercent,
  currentTime,
  duration,
  formatTime,
  onSeek,
  onSeekRelative,
  onTogglePlayPause,
  resetControlsTimeout
}) => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number | null>(null);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const { ref, focused } = useFocusable({
    focusKey: 'HUD_PROGRESS_BAR',
    onEnterPress: onTogglePlayPause,
    onArrowPress: (direction) => {
      if (direction === 'left') {
        onSeekRelative(-10);
        return false; // prevent spatial navigation from leaving when scrubbing left
      } else if (direction === 'right') {
        onSeekRelative(10);
        return false; // prevent spatial navigation from leaving when scrubbing right
      }
      return true; // allow up / down spatial navigation to other controls
    }
  });

  const getPercentFromClientX = (clientX: number): number => {
    if (!barRef.current) return 0;
    const rect = barRef.current.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const clampedX = Math.max(0, Math.min(clientX - rect.left, rect.width));
    return (clampedX / rect.width) * 100;
  };

  // Pointer scrubbing: while dragging, only the preview (scrubPercent) moves; the seek is committed
  // once on release. Seeking on every mousemove floods the server with range requests (and, on a
  // transcoded stream, restarts the transcode each time).
  const commitSeek = (pct: number) => {
    if (resetControlsTimeout) resetControlsTimeout();
    if (duration > 0) onSeek((pct / 100) * duration);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.button !== 0) return; // primary click only
    e.preventDefault();
    setIsScrubbing(true);
    setScrubPercent(getPercentFromClientX(e.clientX));
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.touches && e.touches[0]) {
      setIsScrubbing(true);
      setScrubPercent(getPercentFromClientX(e.touches[0].clientX));
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const pct = getPercentFromClientX(e.clientX);
    setHoverPosition(pct);
    if (duration > 0) setHoverTime((pct / 100) * duration);
  };

  const handleMouseLeave = () => {
    setHoverPosition(null);
    setHoverTime(null);
  };

  useEffect(() => {
    if (!isScrubbing) return;

    const handleGlobalMove = (e: MouseEvent) => {
      setScrubPercent(getPercentFromClientX(e.clientX));
      if (resetControlsTimeout) resetControlsTimeout();
    };

    const handleGlobalTouchMove = (e: TouchEvent) => {
      if (e.touches && e.touches[0]) setScrubPercent(getPercentFromClientX(e.touches[0].clientX));
    };

    const handleGlobalUp = (e: MouseEvent) => {
      setIsScrubbing(false);
      setScrubPercent(null);
      commitSeek(getPercentFromClientX(e.clientX));
    };

    const handleGlobalTouchEnd = (e: TouchEvent) => {
      setIsScrubbing(false);
      setScrubPercent(null);
      if (e.changedTouches && e.changedTouches[0]) {
        commitSeek(getPercentFromClientX(e.changedTouches[0].clientX));
      }
    };

    window.addEventListener('mousemove', handleGlobalMove);
    window.addEventListener('mouseup', handleGlobalUp);
    window.addEventListener('touchmove', handleGlobalTouchMove);
    window.addEventListener('touchend', handleGlobalTouchEnd);
    return () => {
      window.removeEventListener('mousemove', handleGlobalMove);
      window.removeEventListener('mouseup', handleGlobalUp);
      window.removeEventListener('touchmove', handleGlobalTouchMove);
      window.removeEventListener('touchend', handleGlobalTouchEnd);
    };
  }, [isScrubbing, duration, onSeek]);

  const activePercent = scrubPercent !== null ? scrubPercent : progressPercent;
  const activeTime = scrubPercent !== null && duration > 0 ? (scrubPercent / 100) * duration : currentTime;
  const isInteracting = focused || isScrubbing || hoverPosition !== null;

  return (
    <div
      ref={ref}
      tabIndex={0}
      // App's keepFocusInFront looks for `.focused` inside the player; without it every key press
      // yanked focus from the bar back to Play/Pause, so only the first ←/→ ever reached the bar.
      className={`hud-progress focusable ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '18px',
        padding: '2px 0',
        outline: 'none',
        userSelect: 'none',
        width: '100%'
      }}
    >
      {/* Current Time Display */}
      <span
        style={{
          fontSize: '0.95rem',
          color: focused ? 'var(--accent)' : 'rgba(255,255,255,0.85)',
          fontWeight: 700,
          minWidth: '56px',
          fontVariantNumeric: 'tabular-nums',
          transition: 'color 0.2s ease',
          pointerEvents: 'none'
        }}
      >
        {formatTime(activeTime)}
      </span>

      {/* Interactive Progress Track with 40px Hit Area */}
      <div
        ref={barRef}
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        style={{
          flex: 1,
          height: '40px',
          display: 'flex',
          alignItems: 'center',
          position: 'relative',
          cursor: 'pointer'
        }}
      >
        {/* Visual Track */}
        <div
          style={{
            width: '100%',
            height: isInteracting ? '12px' : '8px',
            backgroundColor: 'rgba(255, 255, 255, 0.22)',
            borderRadius: '6px',
            position: 'relative',
            transition: 'height 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s ease',
            boxShadow: focused ? '0 0 16px rgba(var(--accent-rgb), 0.8), 0 0 0 2px var(--accent)' : 'none',
            pointerEvents: 'none'
          }}
        >
        {/* Buffered Video Bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(100, Math.max(0, bufferedPercent))}%`,
            backgroundColor: 'rgba(255, 255, 255, 0.28)',
            borderRadius: '6px',
            pointerEvents: 'none',
            transition: 'width 0.3s ease'
          }}
        />

        {/* Played Progress Bar */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${Math.min(100, Math.max(0, activePercent))}%`,
            background: 'linear-gradient(90deg, var(--accent) 0%, var(--accent-2) 100%)',
            borderRadius: '6px',
            boxShadow: '0 0 12px rgba(var(--accent-rgb), 0.7)',
            pointerEvents: 'none',
            transition: isScrubbing ? 'none' : 'width 0.15s linear'
          }}
        />

        {/* Hover Ghost Indicator */}
        {hoverPosition !== null && !isScrubbing && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(100, Math.max(0, hoverPosition))}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: '3px',
              height: '14px',
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              borderRadius: '2px',
              pointerEvents: 'none'
            }}
          />
        )}

        {/* Glowing Scrubber Thumb Knob */}
        <div
          style={{
            position: 'absolute',
            left: `${Math.min(100, Math.max(0, activePercent))}%`,
            top: '50%',
            transform: 'translate(-50%, -50%)',
            width: isInteracting ? '18px' : '14px',
            height: isInteracting ? '18px' : '14px',
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            border: '3px solid var(--accent)',
            boxShadow: focused
              ? '0 0 18px rgba(var(--accent-rgb), 1), 0 0 6px rgba(255,255,255,0.9)'
              : '0 0 10px rgba(var(--accent-rgb), 0.8)',
            pointerEvents: 'none',
            transition: isScrubbing ? 'none' : 'transform 0.15s ease, width 0.15s ease, height 0.15s ease'
          }}
        />

        {/* Floating Timestamp Tooltip */}
        {hoverPosition !== null && hoverTime !== null && (
          <div
            style={{
              position: 'absolute',
              bottom: '22px',
              left: `${Math.min(95, Math.max(5, hoverPosition))}%`,
              transform: 'translateX(-50%)',
              backgroundColor: 'rgba(8, 12, 22, 0.95)',
              color: 'var(--accent)',
              padding: '4px 10px',
              borderRadius: '8px',
              fontSize: '0.82rem',
              fontWeight: 700,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              border: '1px solid rgba(var(--accent-rgb), 0.4)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.6)',
              pointerEvents: 'none',
              zIndex: 9999
            }}
          >
            {formatTime(hoverTime)}
          </div>
        )}
        </div>
      </div>

      {/* Remaining & Total Time Display */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minWidth: '120px',
          justifyContent: 'flex-end',
          fontSize: '0.92rem',
          fontVariantNumeric: 'tabular-nums',
          pointerEvents: 'none'
        }}
      >
        <span
          style={{
            color: focused ? 'var(--accent)' : 'rgba(255,255,255,0.7)',
            fontWeight: 600,
            transition: 'color 0.2s ease'
          }}
        >
          -{formatTime(Math.max(0, duration - activeTime))}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.25)', fontWeight: 400 }}>/</span>
        <span
          style={{
            color: 'var(--accent)',
            fontWeight: 700
          }}
        >
          {formatTime(duration)}
        </span>
      </div>
    </div>
  );
};
