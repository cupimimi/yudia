import React, { useRef, useEffect, useState } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Play, CheckCircle2, Circle, Clock, Check, Layers, Sparkles, Download } from 'lucide-react';
import { useSeriesStore } from '../store/useSeriesStore';
import { JellyfinEpisode, JellyfinSeason, EpisodeMediaSource } from '../services/jellyfinTvService';
import { FocusableButton } from './FocusableButton';
import { DownloadButton } from './DownloadButton';
import { MediaItem } from '../mockData';
import { downloadMany, downloadsSupported } from '../services/downloads';

interface EpisodeListProps {
  onPlayEpisode: (episode: JellyfinEpisode, sourceId?: string) => void;
  seriesBackdropUrl?: string;
  /** Episode → MediaItem (for the download buttons). */
  toMediaItem?: (episode: JellyfinEpisode) => MediaItem;
}

export const EpisodeList: React.FC<EpisodeListProps> = ({
  onPlayEpisode,
  seriesBackdropUrl,
  toMediaItem
}) => {
  const {
    seasons,
    selectedSeasonId,
    selectSeason,
    episodes,
    loadingEpisodes,
    toggleEpisodePlayed,
    markSeasonPlayed
  } = useSeriesStore();

  const [versionModalEpisode, setVersionModalEpisode] = useState<JellyfinEpisode | null>(null);

  const { ref, focusKey } = useFocusable({
    focusKey: 'EPISODE_LIST_CONTAINER'
  });

  // Separate regular seasons from Specials / Season 0
  const regularSeasons = seasons.filter((s) => !s.IsSpecial);
  const specialSeasons = seasons.filter((s) => s.IsSpecial);

  const currentSeason = seasons.find((s) => s.Id === selectedSeasonId) || regularSeasons[0] || specialSeasons[0];

  const [isSeasonDropdownOpen, setIsSeasonDropdownOpen] = useState(false);

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Netflix-style Season Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px', position: 'relative' }}>
          <div style={{ position: 'relative' }}>
            <FocusableButton
              focusKey="SEASON_DROPDOWN_TOGGLE"
              onPress={() => setIsSeasonDropdownOpen(!isSeasonDropdownOpen)}
              style={{
                padding: '12px 24px',
                borderRadius: '8px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                fontSize: '1.2rem',
                fontWeight: 700,
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                minWidth: '200px',
                justifyContent: 'space-between'
              }}
            >
              <span>{currentSeason?.Name || 'Select Season'}</span>
              <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>▼</span>
            </FocusableButton>

            {isSeasonDropdownOpen && (
              <SeasonMenu
                seasons={[...regularSeasons, ...specialSeasons]}
                selectedSeasonId={selectedSeasonId}
                onPick={(id) => {
                  selectSeason(id);
                  setIsSeasonDropdownOpen(false);
                  setTimeout(() => setFocus('SEASON_DROPDOWN_TOGGLE'), 150); // after the app's lost-focus rescue (60 ms)
                }}
                onClose={() => {
                  setIsSeasonDropdownOpen(false);
                  setTimeout(() => setFocus('SEASON_DROPDOWN_TOGGLE'), 150); // after the app's lost-focus rescue (60 ms)
                }}
              />
            )}
          </div>

          {/* Mark Season as Watched Action Button */}
          {selectedSeasonId && episodes.length > 0 && (
            <FocusableButton
              focusKey="MARK_SEASON_WATCHED_BTN"
              onPress={() => markSeasonPlayed(selectedSeasonId, true)}
              style={{
                padding: '8px 16px',
                fontSize: '0.85rem',
                backgroundColor: 'rgba(255, 255, 255, 0.06)',
                borderColor: 'rgba(255, 255, 255, 0.15)'
              }}
            >
              <CheckCircle2 size={16} color="var(--accent)" />
              <span>Mark Season as Watched</span>
            </FocusableButton>
          )}
          {toMediaItem && episodes.length > 0 && downloadsSupported() && (
            <FocusableButton
              focusKey="DOWNLOAD_SEASON_BTN"
              onPress={() => downloadMany(episodes.map(toMediaItem))}
              style={{ padding: '8px 16px', fontSize: '0.85rem', backgroundColor: 'rgba(255, 255, 255, 0.06)', borderColor: 'rgba(255, 255, 255, 0.15)' }}
            >
              <Download size={16} color="var(--accent)" />
              <span>Download Season</span>
            </FocusableButton>
          )}
        </div>

        {/* Episodes Row / List */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
            <h3 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: '#ffffff' }}>
              Episodes ({episodes.length})
            </h3>
          </div>

          {loadingEpisodes ? (
            <div style={{ padding: '36px', textAlign: 'center', color: 'rgba(255, 255, 255, 0.5)' }}>
              Loading episodes...
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {episodes.map((ep, idx) => (
                <EpisodeCardItem
                  key={ep.Id}
                  episode={ep}
                  index={ep.IndexNumber || idx + 1}
                  fallbackImage={seriesBackdropUrl}
                  mediaItem={toMediaItem ? toMediaItem(ep) : undefined}
                  onPlay={(episode) => {
                    // Check if episode has multiple media sources/versions
                    if (episode.MediaSources && episode.MediaSources.length > 1) {
                      setVersionModalEpisode(episode);
                    } else {
                      onPlayEpisode(episode);
                    }
                  }}
                  onToggleWatched={(e) => {
                    e.stopPropagation();
                    toggleEpisodePlayed(ep.Id);
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Multi-Version Selector Modal */}
        {versionModalEpisode && (
          <div
            style={{
              position: 'fixed',
              top: 0, right: 0, bottom: 0, left: 0,
              zIndex: 9950,
              backgroundColor: 'rgba(5, 7, 12, 0.88)',
              backdropFilter: 'blur(24px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '24px'
            }}
          >
            <div
              style={{
                width: '100%',
                maxWidth: '460px',
                backgroundColor: '#131620',
                borderRadius: '24px',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                padding: '32px',
                boxShadow: '0 24px 60px rgba(0,0,0,0.85)'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px' }}>
                <Layers size={22} color="var(--accent)" />
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, margin: 0, color: '#fff' }}>
                  Select Episode Version
                </h3>
              </div>
              <p style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.6)', margin: '0 0 20px 0' }}>
                {versionModalEpisode.Name} has multiple video versions available on your server.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {versionModalEpisode.MediaSources?.map((source) => (
                  <FocusableButton
                    key={source.Id}
                    focusKey={`VERSION_${source.Id}`}
                    onPress={() => {
                      const ep = versionModalEpisode;
                      setVersionModalEpisode(null);
                      onPlayEpisode(ep, source.Id);
                    }}
                    style={{ width: '100%', justifyContent: 'space-between' }}
                  >
                    <span>{source.Name || source.Container?.toUpperCase() || 'Standard Version'}</span>
                    {source.Bitrate && (
                      <span style={{ fontSize: '0.8rem', color: 'var(--accent)' }}>
                        {Math.round(source.Bitrate / 1000000)} Mbps
                      </span>
                    )}
                  </FocusableButton>
                ))}

                <FocusableButton
                  focusKey="VERSION_CANCEL_BTN"
                  onPress={() => setVersionModalEpisode(null)}
                  style={{ width: '100%', justifyContent: 'center', marginTop: '8px' }}
                >
                  Cancel
                </FocusableButton>
              </div>
            </div>
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
};


// ---------------------------------------------------------------------------
// Episode Card Item Component
// ---------------------------------------------------------------------------
const EpisodeCardItem: React.FC<{
  episode: JellyfinEpisode;
  index: number;
  fallbackImage?: string;
  onPlay: (episode: JellyfinEpisode) => void;
  onToggleWatched: (e: React.MouseEvent) => void;
  mediaItem?: MediaItem;
}> = ({ episode, index, fallbackImage, onPlay, onToggleWatched, mediaItem }) => {
  const { ref, focused } = useFocusable({
    focusKey: `EPISODE_CARD_${episode.Id}`,
    onEnterPress: () => onPlay(episode)
  });

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }, [focused]);

  const isPlayed = episode.UserData?.Played ?? false;
  const positionTicks = episode.UserData?.PlaybackPositionTicks || 0;
  const runTimeTicks = episode.RunTimeTicks || 0;
  const progressPercent = positionTicks > 0 && runTimeTicks > 0 ? Math.min(100, Math.round((positionTicks / runTimeTicks) * 100)) : 0;
  const durationMinutes = runTimeTicks > 0 ? Math.round(runTimeTicks / 10000000 / 60) : 0;
  const formattedDuration = durationMinutes >= 60
    ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m`
    : durationMinutes > 0
    ? `${durationMinutes}m`
    : '';

  return (
    <div
      ref={ref}
      onClick={() => onPlay(episode)}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '20px',
        padding: '16px 20px',
        borderRadius: '18px',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.04)',
        border: focused ? '2px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.08)',
        cursor: 'pointer',
        boxShadow: focused ? '0 8px 30px rgba(var(--accent-rgb), 0.3)' : 'none',
        transform: focused ? 'scale(1.01)' : 'scale(1)',
        transition: 'all 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)'
      }}
    >
      {/* Thumbnail with Resume Bar */}
      <div
        style={{
          width: '180px',
          height: '100px',
          borderRadius: '12px',
          overflow: 'hidden',
          position: 'relative',
          flexShrink: 0,
          backgroundColor: '#12151c'
        }}
      >
        <img
          src={episode.ImageUrl || fallbackImage}
          alt={episode.Name}
          loading="lazy"
          decoding="async"
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            if (fallbackImage) (e.target as HTMLImageElement).src = fallbackImage;
          }}
        />

        {/* Play Icon Overlay on Hover/Focus */}
        <div
          style={{
            position: 'absolute',
            top: 0, right: 0, bottom: 0, left: 0,
            backgroundColor: focused ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: focused ? 1 : 0.8,
            transition: 'opacity 0.2s ease'
          }}
        >
          <div
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              backgroundColor: 'rgba(var(--accent-rgb), 0.9)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 14px rgba(0,0,0,0.5)'
            }}
          >
            <Play size={18} fill="#000000" color="#000000" style={{ marginLeft: '2px' }} />
          </div>
        </div>

        {/* Progress bar if in-progress */}
        {progressPercent > 0 && !isPlayed && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '4px',
              backgroundColor: 'rgba(0,0,0,0.6)'
            }}
          >
            <div
              style={{
                width: `${progressPercent}%`,
                height: '100%',
                backgroundColor: 'var(--accent)'
              }}
            />
          </div>
        )}
      </div>

      {/* Episode Info */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent)' }}>
            {episode.ParentIndexNumber === 0 ? `Special ${index}` : `S${episode.ParentIndexNumber}:E${index}`}
          </span>
          <span style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {episode.Name}
          </span>
          {episode.MediaSources && episode.MediaSources.length > 1 && (
            <span
              style={{
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '6px',
                backgroundColor: 'rgba(192, 132, 252, 0.2)',
                color: '#c084fc',
                fontWeight: 600
              }}
            >
              Multi-Version
            </span>
          )}
        </div>

        <p
          style={{
            fontSize: '0.85rem',
            color: 'rgba(255, 255, 255, 0.65)',
            lineHeight: 1.4,
            margin: '0 0 8px 0',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}
        >
          {episode.Overview}
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '0.8rem', color: 'rgba(255,255,255,0.5)' }}>
          {formattedDuration ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={14} /> {formattedDuration}
            </span>
          ) : null}
          {episode.IntroMarker && (
            <span style={{ color: 'var(--accent)' }}>• Has Intro Skip</span>
          )}
        </div>
      </div>

      {/* Download this episode */}
      {mediaItem && (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
          <DownloadButton item={mediaItem} compact focusKey={`EPISODE_DL_${episode.Id}`} />
        </span>
      )}

      {/* Watched Status Checkbox Button */}
      <FocusableButton
        focusKey={`WATCHED_TOGGLE_${episode.Id}`}
        onPress={() => {
          onToggleWatched({ stopPropagation: () => {} } as any);
        }}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '8px',
          color: isPlayed ? 'var(--accent)' : 'rgba(255,255,255,0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Override default FocusableButton border/bg
          backgroundColor: 'transparent',
          boxShadow: 'none',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none'
        }}
      >
        {isPlayed ? <CheckCircle2 size={24} /> : <Circle size={24} />}
      </FocusableButton>
    </div>
  );
};

/**
 * Season picker pop-up. While open it holds the remote (focus boundary): ↑ / ↓ between seasons, OK picks one,
 * Back closes just the menu (not the series page). Starts on the season being shown.
 */
const SeasonMenu: React.FC<{
  seasons: { Id: string; Name: string }[];
  selectedSeasonId: string | null | undefined;
  onPick: (id: string) => void;
  onClose: () => void;
}> = ({ seasons, selectedSeasonId, onPick, onClose }) => {
  const { ref, focusKey } = useFocusable({ focusKey: 'SEASON_MENU', isFocusBoundary: true, trackChildren: true });
  useEffect(() => {
    const t = setTimeout(() => setFocus(`SEASON_SELECT_${selectedSeasonId || seasons[0]?.Id}`), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.keyCode === 27 || e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation(); // only the menu closes
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        role="listbox"
        aria-label="Seasons"
        style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          left: 0,
          backgroundColor: '#12151c',
          border: '1px solid rgba(255, 255, 255, 0.15)',
          borderRadius: '8px',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.8)',
          zIndex: 50,
          minWidth: '240px',
          maxHeight: '400px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          padding: '8px'
        }}
      >
        {seasons.map((season, i) => (
          <FocusableButton
            key={season.Id}
            focusKey={`SEASON_SELECT_${season.Id}`}
            onPress={() => onPick(season.Id)}
            // ↑ / ↓ go to the previous / next season by list order, not by screen position: the page scrolls
            // while the menu opens, and position-based navigation then saw Season 2 "not below" Season 1.
            onArrowPress={(dir) => {
              const to = dir === 'down' ? seasons[i + 1] : dir === 'up' ? seasons[i - 1] : undefined;
              if (to) setFocus(`SEASON_SELECT_${to.Id}`);
              return false;
            }}
            style={{
              padding: '12px 16px',
              backgroundColor: selectedSeasonId === season.Id ? 'rgba(var(--accent-rgb), 0.15)' : 'transparent',
              color: selectedSeasonId === season.Id ? 'var(--accent)' : '#ffffff',
              border: 'none',
              borderRadius: '6px',
              justifyContent: 'flex-start',
              fontSize: '1.1rem',
              fontWeight: selectedSeasonId === season.Id ? 700 : 500
            }}
          >
            {season.Name}
          </FocusableButton>
        ))}
      </div>
    </FocusContext.Provider>
  );
};
