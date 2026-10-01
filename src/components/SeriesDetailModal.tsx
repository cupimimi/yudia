import React, { useEffect, useState } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Play, ArrowLeft, Heart, RotateCcw, Clapperboard, User, Layers, Sparkles, Check } from 'lucide-react';
import { MediaItem } from '../mockData';
import { FocusableButton } from './FocusableButton';
import { CollectionDownloadButton } from './DownloadButton';
import { useSeriesStore } from '../store/useSeriesStore';
import { EpisodeList } from './EpisodeList';
import { JellyfinEpisode, jellyfinTvService } from '../services/jellyfinTvService';
import { jellyfinClient } from '../api/jellyfin';
import { useAppState } from '../state/AppStateContext';
import { useMediaFormat } from '../utils/mediaFormat';
import { cancelPreload, preloadMedia } from '../services/preloadService';

interface SeriesDetailModalProps {
  series: MediaItem;
  onClose: () => void;
  onPlayEpisode: (episodeItem: MediaItem) => void;
}

const FocusableSeriesCastCard: React.FC<{ actor: any; index: number; onSelect?: () => void }> = ({ actor, index, onSelect }) => {
  const { ref, focused } = useFocusable({
    focusKey: `SERIES_CAST_${actor.name}_${index}`,
    onEnterPress: () => onSelect && onSelect()
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
      <div
        style={{
          width: '76px',
          height: '76px',
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

export const SeriesDetailModal: React.FC<SeriesDetailModalProps> = ({
  series,
  onClose,
  onPlayEpisode
}) => {
  // Real format (from the first episode) + real series status — never a made-up "4K".
  const format = useMediaFormat(series.id, 'series');
  const {
    loadSeries,
    seasons,
    episodes,
    getSmartPlayTarget,
    isFavorite,
    toggleSeriesFavorite
  } = useSeriesStore();

  const { ref, focusKey } = useFocusable({
    focusKey: 'SERIES_DETAIL_MODAL',
    isFocusBoundary: true
  });

  // Load series data on mount
  useEffect(() => {
    loadSeries(series);
  }, [series.id]);

  // Set focus on primary Play or Back button on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setFocus('SERIES_PRIMARY_PLAY_BTN');
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // Handle D-pad Return / Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const smartTarget = getSmartPlayTarget();

  // Get the episode the big Play/Resume button will start ready while the page is open.
  const smartTargetId = smartTarget?.episode.Id;
  const smartTargetResume = smartTarget && smartTarget.episode.RunTimeTicks
    ? (smartTarget.resumeTicks / smartTarget.episode.RunTimeTicks) * 100
    : 0;
  useEffect(() => {
    if (smartTargetId) preloadMedia({ id: smartTargetId, resumePercent: smartTargetResume });
  }, [smartTargetId]);
  useEffect(() => () => cancelPreload(), []);
  const hasActiveResume = smartTarget && smartTarget.reason === 'resume' && (smartTarget.resumeTicks || 0) > 0;

  /** Episode → the item the player / downloads use (with the series id: auto-downloads and offline "next"). */
  const episodeToMediaItem = (ep: JellyfinEpisode): MediaItem => {
    const streamUrl = jellyfinClient.getStreamUrl(ep.Id, 'video');
    const playbackPercent = ep.UserData?.PlaybackPositionTicks && ep.RunTimeTicks
      ? Math.round((ep.UserData.PlaybackPositionTicks / ep.RunTimeTicks) * 100)
      : undefined;

    const mapped: MediaItem = {
      id: ep.Id,
      title: `${series.title} - S${ep.ParentIndexNumber}:E${ep.IndexNumber} ${ep.Name}`,
      seriesName: series.title,
      seriesId: series.id,
      episodeName: ep.Name,
      seasonNumber: ep.ParentIndexNumber,
      episodeNumber: ep.IndexNumber,
      playbackPercent,
      type: 'tv',
      year: series.year,
      rating: series.rating,
      duration: ep.RunTimeTicks ? `${Math.round(ep.RunTimeTicks / 10000000 / 60)}m` : '45m',
      genres: series.genres,
      overview: ep.Overview || 'No description available.',
      backdropUrl: ep.BackdropUrl || series.backdropUrl,
      posterUrl: ep.ImageUrl || series.posterUrl,
      videoUrl: streamUrl,
      subtitleTracks: ep.SubtitleTracks,
      audioTracks: ep.AudioTracks,
      runTimeTicks: ep.RunTimeTicks
    };
    return mapped;
  };

  const handlePlayJellyfinEpisode = (ep: JellyfinEpisode, sourceId?: string) => {
    onPlayEpisode(episodeToMediaItem(ep));
  };

  // Start Again / Restart from Beginning (S1:E1 at 0:00)
  const handleStartAgain = async () => {
    let firstEpisode = episodes.find((e) => e.ParentIndexNumber === 1 && e.IndexNumber === 1) || episodes[0];

    // If season 1 isn't currently loaded, load season 1 episodes
    if (!firstEpisode && seasons.length > 0) {
      const s1 = seasons.find((s) => !s.IsSpecial && s.IndexNumber === 1) || seasons[0];
      if (s1) {
        try {
          const s1Eps = await jellyfinTvService.getEpisodes(series.id, s1.Id);
          if (s1Eps.length > 0) {
            firstEpisode = s1Eps[0];
          }
        } catch (e) {}
      }
    }

    if (firstEpisode) {
      // Force position 0 to start over completely
      const restartedEp: JellyfinEpisode = {
        ...firstEpisode,
        UserData: {
          PlaybackPositionTicks: 0,
          PlayedPercentage: 0,
          Played: false,
          IsFavorite: !!firstEpisode.UserData?.IsFavorite,
          PlayCount: firstEpisode.UserData?.PlayCount || 0
        }
      };
      handlePlayJellyfinEpisode(restartedEp);
    }
  };

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
            backgroundImage: `url(${series.backdropUrl || series.posterUrl})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center top',
            zIndex: 0,
            pointerEvents: 'none'
          }}
        >
          {/* Gradients */}
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
          <FocusableButton focusKey="SERIES_BACK_BTN" onPress={onClose}>
            <ArrowLeft size={20} /> Back to Browse
          </FocusableButton>
        </div>

        {/* Series Info Header Content (In-flow, never collides with back button) */}
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
          {/* Tagline or Series Pill */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                backgroundColor: '#e50914',
                color: '#ffffff',
                fontSize: '0.75rem',
                fontWeight: 800,
                letterSpacing: '1.2px',
                padding: '3px 8px',
                borderRadius: '4px',
                textTransform: 'uppercase'
              }}
            >
              Series
            </span>
            {(format?.resolutionBadge || format?.audioBadge) && (
              <span style={{ color: 'var(--accent)', fontWeight: 700, fontSize: '0.92rem' }}>
                {[format.resolutionBadge, format.hdr, format.audioBadge].filter(Boolean).join(' • ')}
              </span>
            )}
          </div>

          <h1
            style={{
              fontSize: '3.1rem',
              fontWeight: 900,
              lineHeight: 1.1,
              letterSpacing: '-0.5px',
              margin: 0,
              textShadow: '0 4px 20px rgba(0,0,0,0.85)'
            }}
          >
            {series.title}
          </h1>

          {/* Badges & Meta info */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap' }}>
            <span style={{ color: '#46d369', fontWeight: 700, fontSize: '0.95rem' }}>
              {series.year}
            </span>
            {series.rating && (
              <span
                style={{
                  border: '1px solid rgba(255,255,255,0.4)',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '0.8rem',
                  fontWeight: 600
                }}
              >
                {series.rating}
              </span>
            )}
            <span style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.9rem', fontWeight: 600 }}>
              {seasons.length > 0 ? `${seasons.length} Season${seasons.length > 1 ? 's' : ''}` : 'Complete Series'}
            </span>
            <div style={{ display: 'flex', gap: '6px' }}>
              {series.genres?.map((g) => (
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

          <p
            style={{
              fontSize: '0.98rem',
              color: 'rgba(255,255,255,0.85)',
              lineHeight: 1.55,
              margin: 0,
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden'
            }}
          >
            {series.overview}
          </p>

          {/* Action Buttons: Resume / Continue, Start Over, Favorites (Netflix Style) */}
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center', marginTop: '8px', flexWrap: 'wrap' }}>
            {/* 1. Primary Action: Resume or Play Next */}
            {smartTarget && (
              <FocusableButton
                focusKey="SERIES_PRIMARY_PLAY_BTN"
                onPress={() => handlePlayJellyfinEpisode(smartTarget.episode)}
                style={{
                  padding: '14px 32px',
                  background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
                  color: 'var(--accent-contrast)',
                  fontWeight: 800,
                  fontSize: '1rem',
                  boxShadow: '0 6px 20px rgba(var(--accent-rgb), 0.4)',
                  border: 'none',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px'
                }}
              >
                <Play size={20} fill="var(--accent-contrast)" />
                <span>
                  {hasActiveResume
                    ? `Resume S${smartTarget.episode.ParentIndexNumber}:E${smartTarget.episode.IndexNumber} • "${smartTarget.episode.Name}"`
                    : smartTarget.reason === 'next'
                    ? `Play Next: S${smartTarget.episode.ParentIndexNumber}:E${smartTarget.episode.IndexNumber} • "${smartTarget.episode.Name}"`
                    : 'Play Season 1, Episode 1'}
                </span>
              </FocusableButton>
            )}

            {/* 2. Secondary Action: Start Again / Restart from S1:E1 */}
            <FocusableButton
              focusKey="SERIES_RESTART_BTN"
              onPress={handleStartAgain}
              style={{
                padding: '14px 24px',
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '0.95rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <RotateCcw size={18} />
              <span>Start from Beginning (S1:E1)</span>
            </FocusableButton>

            {/* 3. Watchlist / Favorite Button */}
            <FocusableButton
              focusKey="SERIES_FAV_BTN"
              onPress={toggleSeriesFavorite}
              style={{
                padding: '14px 22px',
                borderColor: isFavorite ? '#ff334b' : 'rgba(255,255,255,0.2)',
                backgroundColor: isFavorite ? 'rgba(255, 51, 75, 0.2)' : 'rgba(255,255,255,0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}
            >
              <Heart size={18} fill={isFavorite ? '#ff334b' : 'none'} color={isFavorite ? '#ff334b' : '#fff'} />
              <span>{isFavorite ? 'In Watchlist' : 'Add to Watchlist'}</span>
            </FocusableButton>

            {/* Auto-download: keeps the next unwatched episodes on this device (Settings → Downloads) */}
            <CollectionDownloadButton
              id={series.id}
              name={series.title}
              ruleType="series"
              items={[]}
              focusKey="SERIES_AUTO_DL_BTN"
              style={{ padding: '14px 22px', display: 'flex', alignItems: 'center', gap: '8px' }}
            />
          </div>
        </div>

        {/* Details & Specs Bar */}
        <div
          style={{
            position: 'relative',
            zIndex: 10,
            padding: '12px 64px 24px 64px',
            maxWidth: '1280px'
          }}
        >
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
            {format?.seriesStatus && (
              <div>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Series Status
              </span>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: format.seriesStatus === 'Continuing' ? '#10b981' : '#ffffff', margin: '4px 0 0 0' }}>
                {format.seriesStatus === 'Continuing' ? 'Continuing' : format.seriesStatus === 'Ended' ? 'Ended' : format.seriesStatus}
              </p>
            </div>
            )}

            {format?.audioText && (
              <div>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Audio Format
              </span>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--accent)', margin: '4px 0 0 0' }}>
                {format.audioText}
              </p>
            </div>
            )}

            {format?.resolutionText && (
              <div>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Video Format
              </span>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                {[format.resolutionText, format.hdr].filter(Boolean).join(' • ')}
              </p>
            </div>
            )}

            {format?.subtitlesText && (
              <div>
              <span style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Subtitles
              </span>
              <p style={{ fontSize: '1rem', fontWeight: 700, color: '#ffffff', margin: '4px 0 0 0' }}>
                {format.subtitlesText}
              </p>
            </div>
            )}
          </div>
        </div>

        {/* Netflix-Style Season & Episode Selector */}
        <div style={{ position: 'relative', zIndex: 10, padding: '12px 64px 36px 64px' }}>
          <EpisodeList
            seriesBackdropUrl={series.backdropUrl}
            onPlayEpisode={handlePlayJellyfinEpisode}
            toMediaItem={episodeToMediaItem}
          />
        </div>

        {/* Cast & Characters Section */}
        {series.cast && series.cast.length > 0 && (
          <div style={{ position: 'relative', zIndex: 10, padding: '0 64px 60px 64px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
              <Clapperboard size={20} color="var(--accent)" />
              <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
                Series Cast & Characters
              </h3>
            </div>

            <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px' }}>
              {series.cast.map((actor, idx) => (
                <FocusableSeriesCastCard
                  key={actor.name + idx}
                  actor={actor}
                  index={idx}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
};
