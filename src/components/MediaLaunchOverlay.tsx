import React from 'react';
import { Film, Sparkles, Tv, Clapperboard, Play } from 'lucide-react';
import { MediaItem } from '../mockData';

interface MediaLaunchOverlayProps {
  item: MediaItem;
  isFadingOut: boolean;
}

export const MediaLaunchOverlay: React.FC<MediaLaunchOverlayProps> = ({
  item,
  isFadingOut
}) => {
  const bgImage = item.backdropUrl || item.posterUrl;
  const isTv = item.type === 'tv' || !!item.seriesName;

  return (
    <div
      className={`media-launch-overlay ${isFadingOut ? 'fade-out' : ''}`}
      style={{
        position: 'absolute',
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex: 9040,
        backgroundColor: '#05070c',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        pointerEvents: isFadingOut ? 'none' : 'auto'
      }}
    >
      {/* 1. Ken-Burns Ambient Blurred Cinema Backdrop */}
      {bgImage && (
        <div
          className="media-launch-backdrop"
          style={{
            position: 'absolute',
            top: '-10%', right: '-10%', bottom: '-10%', left: '-10%',
            backgroundImage: `url(${bgImage})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            zIndex: 1
          }}
        />
      )}

      {/* 2. Dark Cinema Radial & Linear Vignettes */}
      <div
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          background: 'radial-gradient(circle at center, rgba(5, 7, 12, 0.72) 0%, rgba(5, 7, 12, 0.95) 75%, #05070c 100%)',
          zIndex: 2
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, transparent 60%, rgba(0,0,0,0.85) 100%)',
          zIndex: 2
        }}
      />

      {/* 3. Center Cinematic Launch Card */}
      <div
        className="media-launch-card"
        style={{
          position: 'relative',
          zIndex: 5,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          maxWidth: '720px',
          padding: '40px',
          gap: '24px'
        }}
      >
        {/* Glowing Media Poster with Pulsing Aperture Ring */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {/* Cyan / Purple Pulsing Halo */}
          <div
            className="media-launch-halo"
            style={{
              position: 'absolute',
              width: '180px',
              height: '180px',
              borderRadius: '50%',
              zIndex: 1
            }}
          />

          {/* Floating Poster Avatar */}
          <div
            style={{
              position: 'relative',
              width: '120px',
              height: '160px',
              borderRadius: '16px',
              overflow: 'hidden',
              border: '2px solid rgba(var(--accent-rgb), 0.6)',
              boxShadow: '0 16px 45px rgba(0, 0, 0, 0.85), 0 0 25px rgba(var(--accent-rgb), 0.4)',
              zIndex: 2,
              backgroundColor: '#0a0d14'
            }}
          >
            <img decoding="async"
              src={item.posterUrl || bgImage}
              alt={item.title}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            <div
              style={{
                position: 'absolute',
                top: 0, right: 0, bottom: 0, left: 0,
                background: 'linear-gradient(to top, rgba(0,0,0,0.6) 0%, transparent 60%)'
              }}
            />
            <div
              style={{
                position: 'absolute',
                bottom: '8px',
                left: '8px',
                right: '8px',
                display: 'flex',
                justifyContent: 'center'
              }}
            >
              <div
                style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  backgroundColor: 'var(--accent)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 2px 10px rgba(var(--accent-rgb), 0.8)'
                }}
              >
                <Play size={14} fill="var(--accent-contrast)" color="var(--accent-contrast)" style={{ marginLeft: '2px' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Media Badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span
            style={{
              backgroundColor: '#e50914',
              color: '#ffffff',
              fontSize: '0.72rem',
              fontWeight: 800,
              letterSpacing: '1.2px',
              padding: '3px 9px',
              borderRadius: '6px',
              textTransform: 'uppercase'
            }}
          >
            {isTv ? 'SERIES' : 'FEATURE FILM'}
          </span>
          {item.rating && (
            <span
              style={{
                backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
                color: 'var(--accent)',
                border: '1px solid rgba(var(--accent-rgb), 0.35)',
                fontSize: '0.75rem',
                fontWeight: 700,
                padding: '3px 10px',
                borderRadius: '6px'
              }}
            >
              {item.rating}
            </span>
          )}
        </div>

        {/* Title Information */}
        <div>
          <h1
            style={{
              fontSize: '2.5rem',
              fontWeight: 900,
              color: '#ffffff',
              margin: '0 0 8px 0',
              lineHeight: 1.15,
              letterSpacing: '-0.5px',
              textShadow: '0 4px 20px rgba(0,0,0,0.9)'
            }}
          >
            {item.title}
          </h1>

          {item.seriesName && (
            <p
              style={{
                fontSize: '1.05rem',
                color: 'var(--accent)',
                fontWeight: 600,
                margin: 0
              }}
            >
              {item.episodeName ? item.episodeName : `Season ${item.seasonNumber || 1}`}
            </p>
          )}

          {!item.seriesName && item.year && (
            <p
              style={{
                fontSize: '0.95rem',
                color: 'rgba(255, 255, 255, 0.7)',
                margin: 0
              }}
            >
              {item.year} • {item.genres?.slice(0, 3).join(' • ') || 'Cinematic Experience'}
            </p>
          )}
        </div>

        {/* Shimmering Cinema Loading Bar & Status */}
        <div style={{ width: '280px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '100%',
              height: '4px',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              borderRadius: '2px',
              overflow: 'hidden',
              position: 'relative'
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                background: 'linear-gradient(90deg, var(--accent) 0%, #7c4dff 50%, var(--accent) 100%)',
                backgroundSize: '200% 100%',
                animation: 'mediaLaunchShimmer 1.5s infinite linear',
                borderRadius: '2px',
                boxShadow: '0 0 12px rgba(var(--accent-rgb), 0.7)'
              }}
            />
          </div>

          <span
            style={{
              fontSize: '0.78rem',
              fontWeight: 700,
              letterSpacing: '1px',
              color: 'rgba(255, 255, 255, 0.65)',
              textTransform: 'uppercase'
            }}
          >
            Starting Playback...
          </span>
        </div>
      </div>
    </div>
  );
};
