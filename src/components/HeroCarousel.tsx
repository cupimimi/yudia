import React, { useState, useEffect } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Play, Info, Plus, Check } from 'lucide-react';
import { MediaItem } from '../mockData';
import { FocusableButton } from './FocusableButton';

interface HeroCarouselProps {
  items: MediaItem[];
  onPlay: (item: MediaItem) => void;
  onSelectDetails?: (item: MediaItem) => void;
}

export const HeroCarousel: React.FC<HeroCarouselProps> = ({ items, onPlay, onSelectDetails }) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [inWatchlist, setInWatchlist] = useState<Record<string, boolean>>({});

  const { ref, focusKey, hasFocusedChild } = useFocusable({
    focusKey: 'HERO_CAROUSEL'
  });

  const currentItem = items[currentIndex] || items[0];

  // Auto-advance carousel every 7s unless user is focusing on the hero controls
  useEffect(() => {
    if (hasFocusedChild || items.length <= 1) return;
    const timer = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % items.length);
    }, 7000);
    return () => clearInterval(timer);
  }, [hasFocusedChild, items.length]);

  const toggleWatchlist = (id: string) => {
    setInWatchlist((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  if (!currentItem) return null;

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className="hero"
        style={{
          position: 'relative',
          width: '100%',
          height: '56vh',
          minHeight: '420px',
          overflow: 'hidden',
          borderRadius: '24px',
          marginBottom: '20px',
          boxShadow: '0 20px 50px rgba(0,0,0,0.6)'
        }}
      >
        {/* Backdrop Image with Fade Transition */}
        <div
          style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0, left: 0,
            backgroundImage: `url(${currentItem.backdropUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            transition: 'background-image 0.8s ease-in-out'
          }}
        />

        {/* Gradient Overlay Shadows */}
        <div className="hero-gradient-bottom" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />
        <div className="hero-gradient-left" style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }} />

        {/* Hero Content Section */}
        <div
          className="hero__content"
          style={{
            position: 'absolute',
            bottom: '40px',
            left: '48px',
            maxWidth: '680px',
            zIndex: 5,
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          {/* Category Tag */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                backgroundColor: '#e50914',
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 800,
                letterSpacing: '1.5px',
                padding: '4px 10px',
                borderRadius: '4px',
                textTransform: 'uppercase'
              }}
            >
              Featured
            </span>
            <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
              {currentItem.type === 'movie' ? 'Movie' : currentItem.type === 'tv' ? 'TV Series' : 'Music Track'}
            </span>
          </div>

          {/* Title */}
          <h1
            className="hero__title"
            style={{
              fontSize: '3.2rem',
              fontWeight: 800,
              lineHeight: 1.1,
              letterSpacing: '-0.5px',
              textShadow: '0 4px 20px rgba(0,0,0,0.8)'
            }}
          >
            {currentItem.title}
          </h1>

          {/* Metadata Bar */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ color: '#46d369', fontWeight: 700, fontSize: '0.95rem' }}>
              {currentItem.year}
            </span>
            {currentItem.rating && (
              <span
                style={{
                  border: '1px solid rgba(255,255,255,0.4)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                {currentItem.rating}
              </span>
            )}
            {currentItem.type !== 'tv' && currentItem.duration && (
              <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.9rem' }}>
                {currentItem.duration}
              </span>
            )}
            <div style={{ display: 'flex', gap: '6px' }}>
              {currentItem.genres.map((g) => (
                <span
                  key={g}
                  style={{
                    backgroundColor: 'rgba(255,255,255,0.12)',
                    padding: '2px 10px',
                    borderRadius: '12px',
                    fontSize: '0.75rem',
                    color: 'rgba(255,255,255,0.9)'
                  }}
                >
                  {g}
                </span>
              ))}
            </div>
          </div>

          {/* Tagline / Overview */}
          <p
            className="hero__overview"
            style={{
              fontSize: '1rem',
              color: 'rgba(255,255,255,0.85)',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textShadow: '0 2px 8px rgba(0,0,0,0.7)'
            }}
          >
            {currentItem.tagline ? `"${currentItem.tagline}" — ` : ''}
            {currentItem.overview}
          </p>

          {/* Focusable Action Buttons */}
          <div className="hero__actions" style={{ display: 'flex', gap: '14px', marginTop: '12px' }}>
            <FocusableButton
              focusKey="HERO_PLAY_BTN"
              autoFocus
              onPress={() => onPlay(currentItem)}
              onArrowPress={(direction) => {
                if (direction === 'up') {
                  setFocus('NAV_TAB_home');
                  return false;
                }
                return true;
              }}
            >
              <Play size={20} fill="#ffffff" /> Play Now
            </FocusableButton>

            <FocusableButton
              onPress={() => onSelectDetails && onSelectDetails(currentItem)}
              onArrowPress={(direction) => {
                if (direction === 'up') {
                  setFocus('NAV_TAB_home');
                  return false;
                }
                return true;
              }}
            >
              <Info size={20} /> Details
            </FocusableButton>

            <FocusableButton
              onPress={() => toggleWatchlist(currentItem.id)}
              onArrowPress={(direction) => {
                if (direction === 'up') {
                  setFocus('NAV_TAB_home');
                  return false;
                }
                // Remote: → on the last button shows the next featured title (the dots are mouse-only)
                if (direction === 'right' && items.length > 1) {
                  setCurrentIndex((prev) => (prev + 1) % items.length);
                  return false;
                }
                return true;
              }}
            >
              {inWatchlist[currentItem.id] ? <Check size={20} /> : <Plus size={20} />}
              {inWatchlist[currentItem.id] ? 'In Watchlist' : 'Watchlist'}
            </FocusableButton>
          </div>
        </div>

        {/* Carousel Indicators */}
        <div
          className="hero__dots"
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '48px',
            display: 'flex',
            gap: '8px',
            zIndex: 5
          }}
        >
          {items.map((_, idx) => (
            <button
              key={idx}
              onClick={() => setCurrentIndex(idx)}
              style={{
                width: idx === currentIndex ? '32px' : '10px',
                height: '8px',
                borderRadius: '4px',
                backgroundColor: idx === currentIndex ? '#ffffff' : 'rgba(255,255,255,0.3)',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.3s ease'
              }}
            />
          ))}
        </div>
      </div>
    </FocusContext.Provider>
  );
};
