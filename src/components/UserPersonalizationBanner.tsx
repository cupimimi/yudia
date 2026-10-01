import { useAccent } from '../theme/accent';
import { AvatarImg } from './AvatarImg';
import React from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Clock, Tv, ListMusic, Heart, Sparkles, UserCheck } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';

interface StatCardProps {
  focusKeyId: string;
  icon: React.ReactNode;
  value: string;
  label: string;
  subtext: string;
  accentColor: string;
  onClick?: () => void;
}

const StatCard: React.FC<StatCardProps> = ({
  focusKeyId,
  icon,
  value,
  label,
  subtext,
  accentColor,
  onClick
}) => {
  const { ref, focused } = useFocusable({
    focusKey: focusKeyId,
    onEnterPress: () => {
      if (onClick) onClick();
    },
    onArrowPress: (direction) => {
      if (direction === 'up') {
        setFocus('HERO_PLAY_BTN');
        const mainEl = document.querySelector('main');
        if (mainEl) mainEl.scrollTo({ top: 0, behavior: 'smooth' });
        return false;
      }
      return true;
    }
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

  return (
    <div
      ref={ref}
      onClick={onClick}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        flex: 1,
        minWidth: '200px',
        padding: '16px 20px',
        borderRadius: '18px',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.12)' : 'rgba(20, 24, 34, 0.65)',
        backdropFilter: 'blur(24px)',
        border: focused ? `2px solid ${accentColor}` : '1px solid rgba(255, 255, 255, 0.08)',
        boxShadow: focused
          ? `0 12px 30px rgba(0, 0, 0, 0.7), 0 0 24px ${accentColor}44`
          : '0 4px 16px rgba(0, 0, 0, 0.25)',
        transform: focused ? 'scale(1.03) translateY(-2px)' : 'scale(1)',
        transition: 'all 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      {/* Background ambient glow */}
      <div
        style={{
          position: 'absolute',
          top: '-20px',
          right: '-20px',
          width: '90px',
          height: '90px',
          borderRadius: '50%',
          backgroundColor: accentColor,
          opacity: focused ? 0.25 : 0.08,
          filter: 'blur(30px)',
          pointerEvents: 'none',
          transition: 'opacity 0.3s ease'
        }}
      />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
        <div
          style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            backgroundColor: `${accentColor}22`,
            border: `1px solid ${accentColor}55`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: accentColor
          }}
        >
          {icon}
        </div>
        <span
          style={{
            fontSize: '0.7rem',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontWeight: 700,
            color: accentColor,
            backgroundColor: `${accentColor}18`,
            padding: '2px 8px',
            borderRadius: '20px'
          }}
        >
          Personal
        </span>
      </div>

      <div style={{ fontSize: '1.65rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.5px', lineHeight: 1.1 }}>
        {value}
      </div>
      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255, 255, 255, 0.85)', marginTop: '4px' }}>
        {label}
      </div>
      <div style={{ fontSize: '0.72rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '2px' }}>
        {subtext}
      </div>
    </div>
  );
};

export const UserPersonalizationBanner: React.FC<{
  onJumpToSection?: (sectionId: string) => void;
}> = ({ onJumpToSection }) => {
  const { currentUser, userStats, nextUp, userPlaylists, userFavorites } = useAppState();
  const accent = useAccent();

  const { ref, focusKey } = useFocusable({
    focusKey: 'USER_STATS_BANNER'
  });

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const scrollToRow = (selector: string) => {
    const target = document.querySelector(selector);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        style={{
          margin: '28px 0 36px 0',
          padding: '28px 32px',
          borderRadius: '24px',
          background: 'linear-gradient(135deg, rgba(22, 28, 42, 0.85) 0%, rgba(13, 17, 26, 0.95) 100%)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          backdropFilter: 'blur(30px)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
      {/* Decorative background radial light */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: '20%',
          right: '20%',
          height: '1px',
          background: 'linear-gradient(90deg, transparent, rgba(var(--accent-rgb), 0.6), rgba(168, 85, 247, 0.6), transparent)',
          pointerEvents: 'none'
        }}
      />

      {/* Top row: Profile & Greeting */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '22px',
          flexWrap: 'wrap',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
          {/* User Avatar with iridescent ring */}
          <div
            style={{
              position: 'relative',
              width: '56px',
              height: '56px',
              flexShrink: 0, // never squeezed into an oval by a long greeting on phones
              boxSizing: 'border-box',
              borderRadius: '50%',
              padding: '2px',
              background: 'linear-gradient(135deg, var(--accent), #a855f7, #ec4899)',
              boxShadow: '0 4px 18px rgba(var(--accent-rgb), 0.4)'
            }}
          >
            <div
              style={{
                width: '100%',
                height: '100%',
                borderRadius: '50%',
                overflow: 'hidden',
                backgroundColor: '#0a0d14',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {currentUser?.avatarUrl ? (
                <AvatarImg
                  src={currentUser.avatarUrl}
                  alt={currentUser.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                <div
                  style={{
                    fontSize: '1.4rem',
                    fontWeight: 800,
                    background: 'linear-gradient(135deg, var(--accent), #a855f7)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                  }}
                >
                  {currentUser?.name ? currentUser.name[0].toUpperCase() : 'U'}
                </div>
              )}
            </div>
            <div
              style={{
                position: 'absolute',
                bottom: '0',
                right: '0',
                width: '14px',
                height: '14px',
                borderRadius: '50%',
                backgroundColor: '#10b981',
                border: '2px solid #07090e',
                boxShadow: '0 0 8px #10b981'
              }}
            />
          </div>

          {/* User info & greeting */}
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h2
                style={{
                  fontSize: '1.5rem',
                  fontWeight: 800,
                  color: '#ffffff',
                  letterSpacing: '-0.3px',
                  margin: 0
                }}
              >
                {getGreeting()},{' '}
                <span
                  style={{
                    background: 'linear-gradient(90deg, var(--accent), #a855f7)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                  }}
                >
                  {currentUser?.name || 'Personal Cinema'}
                </span>
              </h2>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  fontSize: '0.7rem',
                  fontWeight: 700,
                  color: 'var(--accent)',
                  backgroundColor: 'rgba(var(--accent-rgb), 0.12)',
                  border: '1px solid rgba(var(--accent-rgb), 0.3)',
                  padding: '3px 10px',
                  borderRadius: '20px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                <Sparkles size={11} />
                Your Profile
              </span>
            </div>
            <p
              style={{
                fontSize: '0.85rem',
                color: 'rgba(255, 255, 255, 0.6)',
                margin: '4px 0 0 0',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <UserCheck size={14} color="#10b981" />
              Viewing your customized watch progress, series queue, and curated playlists
            </p>
          </div>
        </div>
      </div>

      {/* 4 Interactive Personalized Statistics Tiles */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '16px'
        }}
      >
        {/* Stat 1: Total Watch Time */}
        <StatCard
          focusKeyId="USER_STAT_TIME"
          icon={<Clock size={20} />}
          value={`${userStats.totalHours} hrs`}
          label="Your Watch Time"
          subtext={`${userStats.moviesWatched} movies • ${userStats.episodesWatched} episodes`}
          accentColor={accent.color}
          onClick={() => scrollToRow('.media-row-continue')}
        />

        {/* Stat 2: Series In Progress */}
        <StatCard
          focusKeyId="USER_STAT_SERIES"
          icon={<Tv size={20} />}
          value={`${nextUp.length} Series`}
          label="Next Up in Queue"
          subtext="Unwatched episodes ready"
          accentColor="#a855f7"
          onClick={() => scrollToRow('.media-row-nextup')}
        />

        {/* Stat 3: Playlists */}
        <StatCard
          focusKeyId="USER_STAT_PLAYLISTS"
          icon={<ListMusic size={20} />}
          value={`${userPlaylists.length} Playlists`}
          label="Curated Playlists"
          subtext="Your customized collections"
          accentColor="#ec4899"
          onClick={() => scrollToRow('.media-row-playlists')}
        />

        {/* Stat 4: Favorites (Only shown if user has favorites) */}
        {userFavorites.length > 0 && (
          <StatCard
            focusKeyId="USER_STAT_FAVORITES"
            icon={<Heart size={20} />}
            value={`${userFavorites.length} Titles`}
            label="Personal Favorites"
            subtext="Liked movies, shows & audio"
            accentColor="#f59e0b"
            onClick={() => scrollToRow('.media-row-favorites')}
          />
        )}
      </div>
      </div>
    </FocusContext.Provider>
  );
};
