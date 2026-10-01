import React from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { Play, Music } from 'lucide-react';
import { MediaItem } from '../mockData';

interface MediaCardProps {
  item: MediaItem;
  onSelect: (item: MediaItem) => void;
  aspectRatio?: 'poster' | 'backdrop' | 'square';
}

export const MediaCard: React.FC<MediaCardProps> = ({
  item,
  onSelect,
  aspectRatio = 'poster'
}) => {
  const { ref, focused } = useFocusable({
    onEnterPress: () => onSelect(item)
  });

  React.useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
        inline: 'nearest'
      });
    }
  }, [focused]);

  const isBackdrop = aspectRatio === 'backdrop';
  const isContinueWatching = isBackdrop && (item.playbackPercent !== undefined || item.seriesName !== undefined);

  const getWidthHeight = () => {
    switch (aspectRatio) {
      case 'backdrop':
        return { width: '310px', height: '174px' }; // 16:9 widescreen
      case 'square':
        return { width: '180px', height: '180px' };
      default:
        return { width: '170px', height: '255px' };
    }
  };

  const dims = getWidthHeight();
  // Card-sized image (480 px), not the 1920 px hero backdrop — ~8 MB of RAM saved per card on the TV.
  const imageUrl = isBackdrop ? item.thumbUrl || item.backdropUrl : item.posterUrl;

  // Format episode number label (e.g., "S1:E3" or "EP 3")
  const episodeNumberLabel = item.seasonNumber && item.episodeNumber
    ? `S${item.seasonNumber}:E${item.episodeNumber}`
    : item.episodeNumber
    ? `EP ${item.episodeNumber}`
    : null;

  return (
    <div
      ref={ref}
      onClick={() => onSelect(item)}
      className={`media-card media-card--${aspectRatio} focusable ${focused ? 'focused' : ''}`}
      style={{
        width: dims.width,
        height: dims.height,
        flexShrink: 0,
        position: 'relative',
        borderRadius: '16px',
        overflow: 'hidden',
        cursor: 'pointer',
        border: focused ? '3px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.1)',
        backgroundColor: '#12151c',
        boxShadow: focused
          ? '0 16px 36px rgba(0, 0, 0, 0.85), 0 0 25px rgba(255, 255, 255, 0.45)'
          : '0 6px 18px rgba(0, 0, 0, 0.4)'
      }}
    >
      {/* 1. Episode / Media Image as Full Background */}
      <img
        src={imageUrl}
        alt={item.title}
        decoding="async"
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: focused ? 'scale(1.04)' : 'scale(1)',
          transition: 'transform 0.3s ease'
        }}
        loading="lazy"
      />

      {/* Top Gradient Shadow */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: '60px',
          background: 'linear-gradient(to bottom, rgba(0,0,0,0.7) 0%, transparent 100%)',
          pointerEvents: 'none'
        }}
      />

      {/* 4. Episode Number Badge (Top-Left) */}
      {isContinueWatching && episodeNumberLabel && (
        <div
          style={{
            position: 'absolute',
            top: '12px',
            left: '12px',
            zIndex: 4,
            backgroundColor: 'rgba(0, 0, 0, 0.65)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.25)',
            color: '#ffffff',
            fontSize: '0.72rem',
            fontWeight: 800,
            letterSpacing: '0.5px',
            padding: '3px 8px',
            borderRadius: '6px'
          }}
        >
          {episodeNumberLabel}
        </div>
      )}

      {/* Play Icon in center on focus */}
      {focused && (
        <div
          style={{
            position: 'absolute',
            top: '46%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            backgroundColor: '#ffffff',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#000000',
            boxShadow: '0 4px 20px rgba(0,0,0,0.7)',
            zIndex: 5
          }}
        >
          {item.type === 'music' ? <Music size={22} fill="#000" /> : <Play size={20} fill="#000" style={{ marginLeft: '2px' }} />}
        </div>
      )}

      {/* Bottom Content Gradient Overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0, right: 0, bottom: 0, left: 0,
          background: focused
            ? 'linear-gradient(to top, rgba(7,9,14,0.95) 0%, rgba(7,9,14,0.6) 45%, rgba(0,0,0,0.15) 100%)'
            : 'linear-gradient(to top, rgba(7,9,14,0.92) 0%, rgba(7,9,14,0.5) 40%, transparent 100%)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'flex-end',
          padding: '12px 14px 14px 14px',
          zIndex: 3,
          transition: 'all 0.2s ease'
        }}
      >
        {isContinueWatching ? (
          /* CONTINUE WATCHING SPECIFIC LAYOUT */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: item.playbackPercent ? '6px' : '0' }}>
            {/* 2. Name of the series */}
            <h4
              style={{
                fontSize: '1rem',
                fontWeight: 800,
                color: '#ffffff',
                letterSpacing: '-0.2px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.2
              }}
            >
              {item.seriesName || item.title}
            </h4>

            {/* 3. Episode Name */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '2px' }}>
              <p
                style={{
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.75)',
                  fontWeight: 500,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '100%'
                }}
              >
                {item.episodeName || item.title}
              </p>
            </div>
          </div>
        ) : (
          /* STANDARD MOVIE / MUSIC / GENERAL CARD LAYOUT */
          <div>
            <h4
              style={{
                fontSize: '0.92rem',
                fontWeight: 700,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                color: '#ffffff'
              }}
            >
              {item.title}
            </h4>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'rgba(255, 255, 255, 0.7)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: '2px'
              }}
            >
              <span>{item.artist || item.year}</span>
              {item.type !== 'tv' && item.duration ? (
                <span style={{ fontSize: '0.7rem', color: '#46d369', fontWeight: 600 }}>
                  {item.duration}
                </span>
              ) : null}
            </p>
          </div>
        )}
      </div>

      {/* 5. Colored Progress Bar for Started Episodes */}
      {item.playbackPercent !== undefined && item.playbackPercent > 0 && (
        <div
          style={{
            position: 'absolute',
            bottom: 0,
            left: 0,
            right: 0,
            height: '4px',
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
            zIndex: 10
          }}
        >
          <div
            style={{
              width: `${Math.min(100, item.playbackPercent)}%`,
              height: '100%',
              background: 'linear-gradient(90deg, #e50914 0%, #ff334b 100%)',
              boxShadow: '0 0 10px rgba(229, 9, 20, 0.9)'
            }}
          />
        </div>
      )}
    </div>
  );
};
