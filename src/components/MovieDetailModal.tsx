import React, { useState, useEffect } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Play, ArrowLeft, Heart, Film, User, Clapperboard, Award, Sparkles, Clock, Calendar } from 'lucide-react';
import { MediaItem } from '../mockData';
import { FocusableButton } from './FocusableButton';
import { DownloadButton } from './DownloadButton';
import { useAppState } from '../state/AppStateContext';
import { useMediaFormat } from '../utils/mediaFormat';
import { cancelPreload, preloadMedia } from '../services/preloadService';

interface MovieDetailModalProps {
  movie: MediaItem;
  onClose: () => void;
  onPlay: (movie: MediaItem) => void;
}

const FocusableCastCard: React.FC<{ actor: any; index: number; onSelect: () => void }> = ({ actor, index, onSelect }) => {
  const { ref, focused } = useFocusable({
    focusKey: `CAST_${actor.name}_${index}`,
    onEnterPress: onSelect
  });

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [focused]);

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        minWidth: '150px',
        maxWidth: '160px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        padding: '16px 12px',
        borderRadius: '16px',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.03)',
        border: focused ? '2px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
        transform: focused ? 'scale(1.05)' : 'scale(1)',
        transition: 'all 0.2s ease',
        cursor: 'pointer'
      }}
    >
      {/* Actor Avatar Photo */}
      <div
        style={{
          width: '80px',
          height: '80px',
          borderRadius: '50%',
          overflow: 'hidden',
          marginBottom: '12px',
          border: focused ? '2px solid var(--accent)' : '2px solid rgba(var(--accent-rgb), 0.4)',
          backgroundColor: '#151922',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: focused ? '0 0 15px rgba(var(--accent-rgb), 0.5)' : 'none',
          transition: 'all 0.2s ease'
        }}
      >
        {actor.avatarUrl ? (
          <img decoding="async"
            src={actor.avatarUrl}
            alt={actor.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <User size={36} color="rgba(255,255,255,0.4)" />
        )}
      </div>

      <span style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff', lineHeight: 1.2 }}>
        {actor.name}
      </span>

      <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '4px', lineHeight: 1.2 }}>
        {actor.role}
      </span>
    </button>
  );
};

export const MovieDetailModal: React.FC<MovieDetailModalProps> = ({ movie, onClose, onPlay }) => {
  const { userFavorites } = useAppState();
  const [isFav, setIsFav] = useState(userFavorites.some((f) => f.id === movie.id));
  // Real resolution / HDR / audio from the file (nothing shown until known — never a made-up "4K").
  const format = useMediaFormat(movie.id, 'item');

  // Get the movie ready while its page is open (from the resume point if started). Leaving the page stops it.
  useEffect(() => {
    preloadMedia({ id: movie.id, resumePercent: movie.playbackPercent });
    return () => cancelPreload();
  }, [movie.id]);

  const { ref, focusKey } = useFocusable({
    focusKey: 'MOVIE_DETAIL_MODAL',
    isFocusBoundary: true
  });

  // Focus Play button on mount for immediate remote interaction
  useEffect(() => {
    const timer = setTimeout(() => {
      setFocus('MOVIE_PLAY_BTN');
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // Handle D-pad Back / Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className="modal-cinematic-container"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 8850,
          backgroundColor: '#07090e',
          overflowY: 'auto',
          color: '#ffffff'
        }}
      >
        {/* High-res Ambient Backdrop Banner with smooth cinematic zoom */}
        <div
          className="modal-cinematic-backdrop"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '75vh',
            minHeight: '520px',
            maxHeight: '700px',
            backgroundImage: `url(${movie.backdropUrl || movie.posterUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            zIndex: 0,
            pointerEvents: 'none'
          }}
        >
          {/* Frosted vignette gradients */}
          <div
            style={{
              position: 'absolute',
              top: 0, right: 0, bottom: 0, left: 0,
              background: 'linear-gradient(to top, #07090e 0%, rgba(7, 9, 14, 0.85) 45%, rgba(7, 9, 14, 0.3) 100%)'
            }}
          />
          <div
            style={{
              position: 'absolute',
              top: 0, right: 0, bottom: 0, left: 0,
              background: 'linear-gradient(to right, #07090e 15%, rgba(7, 9, 14, 0.8) 55%, transparent 100%)'
            }}
          />
        </div>

        {/* Top Bar Back Button (In-flow, clean clearance) */}
        <div
          className="modal-cinematic-topbar"
          style={{
            position: 'relative',
            zIndex: 10,
            padding: '36px 64px 18px 64px',
            display: 'flex',
            alignItems: 'center'
          }}
        >
          <FocusableButton focusKey="MOVIE_BACK_BTN" onPress={onClose}>
            <ArrowLeft size={20} /> Back to Browse
          </FocusableButton>
        </div>

        {/* Header Title & Specs (In-flow, never collides with back button) */}
        <div
          className="modal-cinematic-content"
          style={{
            position: 'relative',
            zIndex: 10,
            padding: '12px 64px 32px 64px',
            maxWidth: '960px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}
        >
          {/* Tagline */}
          {movie.tagline && (
            <span
              style={{
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--accent)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase'
              }}
            >
              {movie.tagline}
            </span>
          )}

          <h1
            style={{
              fontSize: '3.1rem',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              lineHeight: 1.1,
              margin: 0,
              textShadow: '0 4px 20px rgba(0,0,0,0.85)'
            }}
          >
            {movie.title}
          </h1>

          {/* Badges & Meta info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            {movie.rating && (
              <span
                style={{
                  padding: '3px 8px',
                  backgroundColor: 'rgba(255, 255, 255, 0.15)',
                  borderRadius: '4px',
                  fontWeight: 700,
                  fontSize: '0.85rem'
                }}
              >
                {movie.rating}
              </span>
            )}

            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>
              <Calendar size={16} /> {movie.year}
            </span>

            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem' }}>
              <Clock size={16} /> {movie.duration}
            </span>

            {movie.genres && movie.genres.length > 0 && (
              <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>
                • {movie.genres.join(' • ')}
              </span>
            )}

            {/* Quality Pills — from the file's real streams */}
            {format?.resolutionBadge && (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(var(--accent-rgb), 0.2)',
                  color: 'var(--accent)',
                  border: '1px solid rgba(var(--accent-rgb), 0.4)'
                }}
              >
                {[format.resolutionBadge, format.hdr].filter(Boolean).join(' ')}
              </span>
            )}
            {format?.audioBadge && (
              <span
                style={{
                  fontSize: '0.75rem',
                  fontWeight: 700,
                  padding: '3px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(255, 255, 255, 0.1)',
                  color: '#ffffff'
                }}
              >
                {format.audioBadge}
              </span>
            )}
          </div>

          {/* Action Buttons: Play Movie, Add to Favorites, Download */}
          <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
            <FocusableButton
              focusKey="MOVIE_PLAY_BTN"
              onPress={() => onPlay(movie)}
              style={{
                padding: '16px 36px',
                background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                color: 'var(--accent-contrast)',
                fontWeight: 800,
                fontSize: '1.1rem',
                boxShadow: '0 8px 30px rgba(var(--accent-rgb), 0.4)',
                border: 'none',
                display: 'flex',
                alignItems: 'center',
                gap: '10px'
              }}
            >
              <Play size={22} fill="var(--accent-contrast)" />
              <span>{movie.playbackPercent ? `Resume (${movie.playbackPercent}%)` : 'Play Movie'}</span>
            </FocusableButton>

            <FocusableButton
              focusKey="MOVIE_FAV_BTN"
              onPress={() => setIsFav(!isFav)}
              style={{
                borderColor: isFav ? '#ff334b' : 'rgba(255,255,255,0.2)',
                backgroundColor: isFav ? 'rgba(255, 51, 75, 0.2)' : 'rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Heart size={20} fill={isFav ? '#ff334b' : 'none'} color={isFav ? '#ff334b' : '#ffffff'} />
              <span>{isFav ? 'In Favorites' : 'Add to Favorites'}</span>
            </FocusableButton>

            <DownloadButton item={movie} focusKey="MOVIE_DOWNLOAD_BTN" />
          </div>
        </div>

        {/* Details & Credentials Body */}
        <div style={{ position: 'relative', zIndex: 10, padding: '12px 64px 60px 64px', maxWidth: '1280px', display: 'flex', flexDirection: 'column', gap: '32px' }}>
          {/* 1. Overview */}
          <div>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 10px 0', color: '#ffffff' }}>
              Storyline & Overview
            </h3>
            <p style={{ fontSize: '1.05rem', lineHeight: 1.7, color: 'rgba(255,255,255,0.85)', margin: 0, maxWidth: '900px' }}>
              {movie.overview}
            </p>
          </div>

          {/* 2. Key Media Credentials (Director, Writers, Studio) */}
          <div
            style={{
              display: 'flex',
              gap: '48px',
              padding: '20px 28px',
              borderRadius: '18px',
              backgroundColor: 'rgba(255, 255, 255, 0.04)',
              backdropFilter: 'blur(20px)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              flexWrap: 'wrap'
            }}
          >
            {movie.director && (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Director
                </span>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                  {movie.director}
                </p>
              </div>
            )}

            {movie.writers && movie.writers.length > 0 && (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Writers / Screenplay
                </span>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                  {movie.writers.join(', ')}
                </p>
              </div>
            )}

            {format?.audioText && (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Audio Format
                </span>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent)', margin: '4px 0 0 0' }}>
                  {format.audioText}
                </p>
              </div>
            )}

            {format?.resolutionText && (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Resolution
                </span>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                  {[format.resolutionText, format.hdr].filter(Boolean).join(' • ')}
                </p>
              </div>
            )}

            {format?.audioLanguagesText && (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Audio Languages
                </span>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                  {format.audioLanguagesText}
                </p>
              </div>
            )}

            {format?.subtitlesText && (
              <div>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                  Subtitles
                </span>
                <p style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                  {format.subtitlesText}
                </p>
              </div>
            )}
          </div>

          {/* 3. Cast & Character Credentials Section */}
          {movie.cast && movie.cast.length > 0 && (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
                <Clapperboard size={22} color="var(--accent)" />
                <h3 style={{ fontSize: '1.3rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                  Top Cast & Characters
                </h3>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '20px',
                  overflowX: 'auto',
                  paddingBottom: '14px',
                  paddingTop: '6px'
                }}
              >
                {movie.cast.map((actor, idx) => (
                  <FocusableCastCard
                    key={actor.name + idx}
                    actor={actor}
                    index={idx}
                    onSelect={() => {}}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
};
