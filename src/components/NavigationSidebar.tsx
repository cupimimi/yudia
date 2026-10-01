import React, { useState, useEffect } from 'react';
import { AvatarImg } from './AvatarImg';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { focusPage } from '../navigation/pageFocus';
import { Home, Film, Tv, Radio, Music, Download, MonitorSpeaker, Settings, Search, User, Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2 } from 'lucide-react';
import { useAppState, TabType } from '../state/AppStateContext';
import { JellyfinUser } from '../api/jellyfin';
import { useAccent } from '../theme/accent';
import { downloadsSupported } from '../services/downloads';
import { openConnect, useConnect } from './ConnectSheet';

interface SidebarItem {
  id: TabType;
  label: string;
  icon: (color: string) => React.ReactNode;
  accentColor: string;
}

export const NavigationSidebar: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    isAudioPlaying,
    currentUser,
    setIsProfileSwitcherOpen,
    setIsSearchOpen,
    isProfileSwitcherOpen,
    isSearchOpen,
    activeVideo,
    isServerConnectOpen
  } = useAppState();

  const isModalActive = isProfileSwitcherOpen || isSearchOpen || !!activeVideo || isServerConnectOpen;

  const { ref, focusKey } = useFocusable({
    focusKey: 'NAVIGATION_BOTTOM_DOCK',
    focusable: !isModalActive
  });

  const accent = useAccent();

  const navItems: SidebarItem[] = [
    {
      id: 'home',
      label: 'Home',
      accentColor: accent.color,
      icon: (color) => <Home size={20} color={color} strokeWidth={2.2} />
    },
    {
      id: 'movies',
      label: 'Movies',
      accentColor: '#ff334b',
      icon: (color) => <Film size={20} color={color} strokeWidth={2.2} />
    },
    {
      id: 'tv',
      label: 'TV Shows',
      accentColor: '#c084fc',
      icon: (color) => <Tv size={20} color={color} strokeWidth={2.2} />
    },
    {
      id: 'live',
      label: 'Live TV',
      accentColor: accent.color,
      icon: (color) => <Radio size={20} color={color} strokeWidth={2.2} />
    },
    {
      id: 'music',
      label: 'Music',
      accentColor: '#fa2d48',
      icon: (color) => <Music size={20} color={color} strokeWidth={2.2} />
    },
    // Downloads: website only (phones / laptops) — hidden on the TV
    ...(downloadsSupported()
      ? [
          {
            id: 'downloads' as TabType,
            label: 'Downloads',
            accentColor: accent.color,
            icon: (color: string) => <Download size={20} color={color} strokeWidth={2.2} />
          }
        ]
      : []),
    {
      id: 'settings',
      label: 'Settings',
      accentColor: '#34d399',
      icon: (color) => <Settings size={20} color={color} strokeWidth={2.2} />
    }
  ];

  return (
    <FocusContext.Provider value={focusKey}>
      {/* Left Sidebar Container */}
      <nav
        style={{
          position: 'fixed',
          top: '50%',
          left: '24px',
          transform: 'translateY(-50%)',
          zIndex: 8700,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: isModalActive ? 'none' : 'auto'
        }}
        aria-hidden={isModalActive ? true : undefined}
      >
        <div
          ref={ref}
          className="liquid-glass-dock"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            padding: '14px 10px',
            borderRadius: '40px',
            position: 'relative'
          }}
        >
          {/* 0. Now Playing Circle Widget (Sitting directly on top of Profile Picture) */}
          <NowPlayingCircleWidget />

          {/* 1. Profile Picture Button (Replaces Logo - allows switching/connecting profiles) */}
          <ProfileAvatarButton
            currentUser={currentUser}
            onSelect={() => setIsProfileSwitcherOpen(true)}
          />

          {/* Navigation Items in a Vertical Row */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '6px',
              position: 'relative',
              zIndex: 2,
              marginTop: '12px',
              marginBottom: '12px'
            }}
          >
            {navItems.map((item) => (
              <BottomDockButton
                key={item.id}
                item={item}
                isActive={activeTab === item.id}
                isAudioPlaying={isAudioPlaying}
                onSelect={() => setActiveTab(item.id)}
              />
            ))}
          </div>

          {/* 2. Search Button (Replaces Green Flashing Dot) */}
          <SearchDockButton onSelect={() => setIsSearchOpen(true)} />

          {/* 3. Devices (Yudia Connect): play on / control another device */}
          <ConnectDockButton />
        </div>
      </nav>
    </FocusContext.Provider>
  );
};

interface ProfileAvatarButtonProps {
  currentUser: JellyfinUser | null;
  onSelect: () => void;
}

const ProfileAvatarButton: React.FC<ProfileAvatarButtonProps> = ({ currentUser, onSelect }) => {
  const { activeTab } = useAppState();
  const [isShaking, setIsShaking] = useState(false);
  const [bubbleStatus, setBubbleStatus] = useState<'entering' | 'visible' | 'exiting' | 'hidden'>('hidden');

  // Trigger playful welcome back animation when user is already connected
  useEffect(() => {
    if (!currentUser) return;

    const timer = setTimeout(() => {
      setIsShaking(true);
      setBubbleStatus('entering');

      const shakeEndTimer = setTimeout(() => {
        setIsShaking(false);
        setBubbleStatus('visible');
      }, 850);

      const hideTimer = setTimeout(() => {
        setBubbleStatus('exiting');
        setTimeout(() => setBubbleStatus('hidden'), 350);
      }, 4800);

      return () => {
        clearTimeout(shakeEndTimer);
        clearTimeout(hideTimer);
      };
    }, 600);

    return () => clearTimeout(timer);
  }, [currentUser?.id, currentUser?.name]);

  const { ref, focused } = useFocusable({
    focusKey: 'NAV_PROFILE_AVATAR',
    onEnterPress: onSelect,
    onArrowPress: (direction) => {
      if (direction === 'up') {
        setFocus('NAV_NOW_PLAYING');
        return false;
      }
      if (direction === 'down') {
        setFocus('NAV_TAB_home');
        return false;
      }
      if (direction === 'right') {
        focusPage(activeTab);
        return false;
      }
      return true;
    }
  });

  return (
    <div style={{ position: 'relative', zIndex: 100 }}>
      <button
        ref={ref}
        onClick={onSelect}
        className={`focusable ${focused ? 'focused' : ''} ${isShaking ? 'avatar-shaking' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '44px',
          height: '44px',
          padding: '0',
          border: focused ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.18)',
          borderRadius: '50%',
          backgroundColor: focused ? 'rgba(255, 255, 255, 0.22)' : 'rgba(255, 255, 255, 0.06)',
          cursor: 'pointer',
          position: 'relative',
          zIndex: 2,
          transform: focused ? 'scale(1.08)' : 'scale(1)',
          boxShadow: focused ? '0 0 18px rgba(var(--accent-rgb), 0.6), 0 0 30px rgba(255, 255, 255, 0.4)' : 'none',
          transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}
        title="Switch Profile"
      >
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '50%',
            overflow: 'hidden',
            backgroundColor: '#12151c',
            border: '1.5px solid var(--accent)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0
          }}
        >
          {currentUser?.avatarUrl ? (
            <AvatarImg
              src={currentUser.avatarUrl}
              alt={currentUser.name}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <User size={18} color="var(--accent)" />
          )}
        </div>
      </button>

      {/* EXPANDING WELCOME BACK SPEECH BUBBLE */}
      {bubbleStatus !== 'hidden' && currentUser && (
        <div
          className={bubbleStatus === 'entering' ? 'welcome-bubble-enter' : 'welcome-bubble-exit'}
          style={{
            position: 'absolute',
            left: '54px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            padding: '8px 16px',
            borderRadius: '18px',
            background: 'linear-gradient(135deg, rgba(16, 22, 34, 0.96) 0%, rgba(9, 13, 22, 0.98) 100%)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            border: '1px solid rgba(var(--accent-rgb), 0.45)',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.75), 0 0 25px rgba(var(--accent-rgb), 0.35)',
            whiteSpace: 'nowrap',
            zIndex: 9999,
            pointerEvents: 'none',
            color: '#ffffff'
          }}
        >
          {/* Triangular Pointer Tail pointing towards avatar */}
          <div
            style={{
              position: 'absolute',
              left: '-6px',
              top: '50%',
              transform: 'translateY(-50%) rotate(45deg)',
              width: '10px',
              height: '10px',
              backgroundColor: 'rgba(16, 22, 34, 0.98)',
              borderLeft: '1px solid rgba(var(--accent-rgb), 0.45)',
              borderBottom: '1px solid rgba(var(--accent-rgb), 0.45)'
            }}
          />

          <span style={{ fontSize: '1.2rem', lineHeight: 1 }} className="animate-bounce">
            👋
          </span>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <span
              style={{
                fontSize: '0.68rem',
                textTransform: 'uppercase',
                letterSpacing: '0.8px',
                color: 'var(--accent)',
                fontWeight: 800
              }}
            >
              Welcome back
            </span>
            <span style={{ fontSize: '0.92rem', fontWeight: 800, color: '#ffffff' }}>
              {currentUser.name}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

const SearchDockButton: React.FC<{ onSelect: () => void }> = ({ onSelect }) => {
  const { activeTab } = useAppState();
  const { ref, focused } = useFocusable({
    focusKey: 'NAV_SEARCH_BTN',
    onEnterPress: onSelect,
    onArrowPress: (direction) => {
      if (direction === 'up') {
        setFocus('NAV_TAB_settings');
        return false;
      }
      if (direction === 'down') {
        setFocus('NAV_CONNECT_BTN');
        return false;
      }
      if (direction === 'right') {
        focusPage(activeTab);
        return false;
      }
      return true;
    }
  });

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '42px',
        height: '42px',
        borderRadius: '50%',
        border: focused ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.2)',
        backgroundColor: focused ? 'rgba(var(--accent-rgb), 0.35)' : 'rgba(255, 255, 255, 0.08)',
        color: focused ? '#ffffff' : 'rgba(255, 255, 255, 0.85)',
        cursor: 'pointer',
        position: 'relative',
        zIndex: 2,
        transform: focused ? 'scale(1.12)' : 'scale(1)',
        boxShadow: focused ? '0 0 16px rgba(var(--accent-rgb), 0.7)' : 'none',
        transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
      }}
      title="Search Jellyfin Media"
    >
      <Search size={18} strokeWidth={2.4} />
    </button>
  );
};

/** Sidebar "Devices" button (Yudia Connect). Accent-coloured while another device is chosen. */
const ConnectDockButton: React.FC = () => {
  const { activeTab } = useAppState();
  const connect = useConnect();
  const on = !!connect.target;
  const { ref, focused } = useFocusable({
    focusKey: 'NAV_CONNECT_BTN',
    onEnterPress: openConnect,
    onArrowPress: (direction) => {
      if (direction === 'up') {
        setFocus('NAV_SEARCH_BTN');
        return false;
      }
      if (direction === 'right') {
        focusPage(activeTab);
        return false;
      }
      return direction !== 'down';
    }
  });
  const label = on ? `Playing on ${connect.target!.name}` : 'Play on another device';
  return (
    <button
      ref={ref}
      onClick={openConnect}
      className={`focusable ${focused ? 'focused' : ''}`}
      aria-label={label}
      title={label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '42px',
        height: '42px',
        borderRadius: '50%',
        border: focused ? '2px solid #ffffff' : on ? '1.5px solid var(--accent)' : '1px solid rgba(255, 255, 255, 0.2)',
        backgroundColor: focused ? 'rgba(var(--accent-rgb), 0.35)' : on ? 'rgba(var(--accent-rgb), 0.18)' : 'rgba(255, 255, 255, 0.08)',
        color: on ? 'var(--accent)' : focused ? '#ffffff' : 'rgba(255, 255, 255, 0.85)',
        cursor: 'pointer',
        position: 'relative',
        zIndex: 2,
        transform: focused ? 'scale(1.12)' : 'scale(1)',
        boxShadow: focused ? '0 0 16px rgba(var(--accent-rgb), 0.7)' : on ? '0 0 12px rgba(var(--accent-rgb), 0.45)' : 'none',
        transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
      }}
    >
      <MonitorSpeaker size={18} strokeWidth={2.2} />
    </button>
  );
};

interface BottomDockButtonProps {
  item: SidebarItem;
  isActive: boolean;
  isAudioPlaying: boolean;
  onSelect: () => void;
}

const BottomDockButton: React.FC<BottomDockButtonProps> = ({
  item,
  isActive,
  isAudioPlaying,
  onSelect
}) => {
  const { activeTab } = useAppState();
  const { ref, focused } = useFocusable({
    focusKey: 'NAV_TAB_' + item.id,
    onEnterPress: onSelect,
    onArrowPress: (direction) => {
      if (direction === 'right') {
        if (activeTab === 'home') document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' });
        focusPage(activeTab);
        return false;
      }
      if (direction === 'up' && item.id === 'home') {
        setFocus('NAV_PROFILE_AVATAR');
        return false;
      }
      if (direction === 'down' && item.id === 'settings') {
        setFocus('NAV_SEARCH_BTN');
        return false;
      }
      return true;
    }
  });

  const activeColor = focused ? '#ffffff' : isActive ? item.accentColor : 'rgba(255,255,255,0.7)';

  return (
    <button
      ref={ref}
      onClick={onSelect}
      data-accent-color={item.accentColor}
      className={`focusable liquid-nav-btn ${focused ? 'focused' : ''} ${isActive ? 'nav-active' : ''}`}
      title={item.label}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '42px',
        height: '42px',
        borderRadius: '50%',
        border: focused ? '1.5px solid #ffffff' : isActive ? '1px solid rgba(255,255,255,0.3)' : '1px solid transparent',
        backgroundColor: focused
          ? 'linear-gradient(135deg, rgba(255,255,255,0.35) 0%, rgba(255,255,255,0.15) 100%)'
          : isActive
          ? 'rgba(255, 255, 255, 0.14)'
          : 'transparent',
        cursor: 'pointer',
        transition: 'all 0.25s cubic-bezier(0.2, 0.9, 0.2, 1)'
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: isActive || focused ? `drop-shadow(0 0 10px ${item.accentColor}99)` : 'none',
          transition: 'filter 0.25s ease'
        }}
      >
        {item.icon(activeColor)}
      </div>

      {item.id === 'music' && isAudioPlaying && (
        <div className="sound-bars" style={{ position: 'absolute', bottom: '4px' }}>
          <div className="sound-bar" />
          <div className="sound-bar" />
          <div className="sound-bar" />
        </div>
      )}
    </button>
  );
};

interface NowPlayingCommandButtonProps {
  focusKey: string;
  title: string;
  onPress: () => void;
  onLeft?: () => void;
  onRight?: () => void;
  onDown?: () => void;
  isPrimary?: boolean;
  onFocusedChange: (focused: boolean) => void;
  children: React.ReactNode;
}

const NowPlayingCommandButton: React.FC<NowPlayingCommandButtonProps> = ({
  focusKey,
  title,
  onPress,
  onLeft,
  onRight,
  onDown,
  isPrimary,
  onFocusedChange,
  children
}) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onPress,
    onArrowPress: (direction) => {
      if (direction === 'left' && onLeft) {
        onLeft();
        return false;
      }
      if (direction === 'right' && onRight) {
        onRight();
        return false;
      }
      if (direction === 'down' && onDown) {
        onDown();
        return false;
      }
      return true;
    }
  });

  useEffect(() => {
    onFocusedChange(focused);
  }, [focused]);

  return (
    <button
      ref={ref}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      className={`focusable now-playing-cmd-btn ${focused ? 'focused' : ''}`}
      style={{
        width: isPrimary ? '38px' : '32px',
        height: isPrimary ? '38px' : '32px',
        background: isPrimary
          ? 'linear-gradient(135deg, rgba(250, 45, 72, 0.85) 0%, rgba(220, 20, 60, 0.9) 100%)'
          : 'rgba(255, 255, 255, 0.1)',
        border: focused
          ? '2px solid #ffffff'
          : isPrimary
          ? '1px solid rgba(255,255,255,0.4)'
          : '1px solid rgba(255, 255, 255, 0.2)',
        boxShadow: isPrimary ? '0 0 14px rgba(250, 45, 72, 0.5)' : 'none',
        flexShrink: 0
      }}
      title={title}
    >
      {children}
    </button>
  );
};

export const NowPlayingCircleWidget: React.FC = () => {
  const {
    activeAudio,
    isAudioPlaying,
    toggleAudioPlayPause,
    nextAudioTrack,
    prevAudioTrack,
    audioCurrentTime,
    audioDuration,
    setIsMusicFullScreen,
    setActiveTab,
    isAudioMuted,
    toggleAudioMute,
    activeTab
  } = useAppState();

  const [isHovered, setIsHovered] = useState(false);
  const [focusedCmdKey, setFocusedCmdKey] = useState<string | null>(null);
  const [isManualExpanded, setIsManualExpanded] = useState(false);

  const handleCmdFocus = (key: string, isFocused: boolean) => {
    if (isFocused) {
      setFocusedCmdKey(key);
    } else {
      setFocusedCmdKey((current) => (current === key ? null : current));
    }
  };

  const { ref, focused: isCircleFocused } = useFocusable({
    focusKey: 'NAV_NOW_PLAYING',
    // Only while a song is loaded: hidden, it caught ← from every page and the remote never reached the sidebar
    focusable: !!activeAudio,
    onEnterPress: () => {
      toggleAudioPlayPause();
      setIsManualExpanded((prev) => !prev);
    },
    onArrowPress: (direction) => {
      if (direction === 'down') {
        setFocus('NAV_PROFILE_AVATAR');
        return false;
      }
      if (direction === 'right') {
        setFocusedCmdKey('NOW_PLAYING_PLAY_PAUSE');
        setFocus('NOW_PLAYING_PLAY_PAUSE');
        return false;
      }
      return true;
    }
  });

  if (!activeAudio) return null;

  const isExpanded = isCircleFocused || focusedCmdKey !== null || isHovered || isManualExpanded;

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = audioDuration > 0 ? Math.min(100, Math.max(0, (audioCurrentTime / audioDuration) * 100)) : 0;

  return (
    <div
      style={{ position: 'relative', zIndex: 110 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* 1. CIRCULAR DISC BUTTON (Sitting directly on top of Profile Picture) */}
      <button
        ref={ref}
        onClick={() => {
          setIsManualExpanded((prev) => !prev);
        }}
        className={`focusable ${isCircleFocused ? 'focused' : ''}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '44px',
          height: '44px',
          padding: '0',
          borderRadius: '50%',
          border: isCircleFocused
            ? '2px solid #ffffff'
            : isAudioPlaying
            ? '1.5px solid rgba(250, 45, 72, 0.8)'
            : '1px solid rgba(255, 255, 255, 0.2)',
          backgroundColor: isCircleFocused
            ? 'rgba(250, 45, 72, 0.3)'
            : 'rgba(255, 255, 255, 0.06)',
          cursor: 'pointer',
          position: 'relative',
          zIndex: 2,
          transform: isCircleFocused ? 'scale(1.12)' : 'scale(1)',
          boxShadow: isCircleFocused
            ? '0 0 20px rgba(250, 45, 72, 0.9), 0 0 35px rgba(255, 255, 255, 0.5)'
            : isAudioPlaying
            ? '0 0 14px rgba(250, 45, 72, 0.45)'
            : 'none',
          transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
        }}
        title={`Now Playing: ${activeAudio.title} by ${activeAudio.artist || 'Unknown'}`}
      >
        {/* Rotating Vinyl Disc with Album Cover */}
        <div
          className={`spin-vinyl ${isAudioPlaying ? '' : 'paused'}`}
          style={{
            width: '34px',
            height: '34px',
            borderRadius: '50%',
            overflow: 'hidden',
            position: 'relative',
            backgroundColor: '#0a0d14',
            border: '1px solid rgba(255,255,255,0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          <img decoding="async"
            src={activeAudio.posterUrl || activeAudio.backdropUrl}
            alt={activeAudio.title}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
          {/* Spindle hole */}
          <div
            style={{
              position: 'absolute',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              backgroundColor: '#070a10',
              border: '1.5px solid #fa2d48',
              boxShadow: '0 0 4px rgba(250, 45, 72, 0.8)',
              zIndex: 3
            }}
          />
        </div>

        {/* Small corner badge (Equalizer or Play icon) */}
        <div
          style={{
            position: 'absolute',
            bottom: '-2px',
            right: '-2px',
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            backgroundColor: isAudioPlaying ? '#fa2d48' : 'rgba(30, 36, 50, 0.95)',
            border: '1.5px solid #0d0f17',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 0 8px rgba(250, 45, 72, 0.7)',
            zIndex: 4
          }}
        >
          {isAudioPlaying ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1.5px', height: '8px' }}>
              <div className="equalizer-bar" style={{ width: '2px', background: '#fff' }} />
              <div className="equalizer-bar" style={{ width: '2px', background: '#fff', animationDelay: '0.2s' }} />
              <div className="equalizer-bar" style={{ width: '2px', background: '#fff', animationDelay: '0.4s' }} />
            </div>
          ) : (
            <Play size={9} fill="#fff" color="#fff" style={{ marginLeft: '1px' }} />
          )}
        </div>
      </button>

      {/* 2. EXTENDED COMMAND PANEL (When on it) */}
      {isExpanded && (
        <div
          className="now-playing-panel-enter"
          style={{
            position: 'absolute',
            left: '56px',
            top: '50%',
            transform: 'translateY(-50%)',
            display: 'flex',
            flexDirection: 'column',
            gap: '8px',
            padding: '12px 16px',
            borderRadius: '20px',
            background: 'linear-gradient(135deg, rgba(16, 22, 34, 0.97) 0%, rgba(9, 13, 22, 0.98) 100%)',
            backdropFilter: 'blur(28px) saturate(200%)',
            WebkitBackdropFilter: 'blur(28px) saturate(200%)',
            border: '1px solid rgba(250, 45, 72, 0.5)',
            boxShadow: '0 16px 40px rgba(0, 0, 0, 0.85), 0 0 28px rgba(250, 45, 72, 0.28)',
            whiteSpace: 'nowrap',
            zIndex: 9999,
            minWidth: '340px',
            maxWidth: '410px',
            color: '#ffffff'
          }}
        >
          {/* Triangular pointer tail pointing to circle */}
          <div
            style={{
              position: 'absolute',
              left: '-6px',
              top: '50%',
              transform: 'translateY(-50%) rotate(45deg)',
              width: '10px',
              height: '10px',
              backgroundColor: 'rgba(16, 22, 34, 0.98)',
              borderLeft: '1px solid rgba(250, 45, 72, 0.5)',
              borderBottom: '1px solid rgba(250, 45, 72, 0.5)'
            }}
          />

          {/* Top Row: Track Artwork + Info + Duration */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img decoding="async"
              src={activeAudio.posterUrl || activeAudio.backdropUrl}
              alt={activeAudio.title}
              style={{
                width: '38px',
                height: '38px',
                borderRadius: '8px',
                objectFit: 'cover',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.5)',
                flexShrink: 0
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    fontSize: '0.88rem',
                    fontWeight: 800,
                    color: '#ffffff',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    maxWidth: '160px'
                  }}
                >
                  {activeAudio.title}
                </span>
                {isAudioPlaying && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '2px', height: '10px' }}>
                    <div className="equalizer-bar" style={{ width: '2px' }} />
                    <div className="equalizer-bar" style={{ width: '2px', animationDelay: '0.2s' }} />
                    <div className="equalizer-bar" style={{ width: '2px', animationDelay: '0.4s' }} />
                  </div>
                )}
              </div>
              <span
                style={{
                  fontSize: '0.74rem',
                  color: 'rgba(255, 255, 255, 0.65)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  maxWidth: '160px'
                }}
              >
                {activeAudio.artist || 'Audio Track'}
              </span>
            </div>

            {/* Time Display */}
            <div
              style={{
                fontSize: '0.7rem',
                fontWeight: 700,
                color: '#fa2d48',
                backgroundColor: 'rgba(250, 45, 72, 0.14)',
                padding: '3px 8px',
                borderRadius: '10px',
                border: '1px solid rgba(250, 45, 72, 0.3)',
                whiteSpace: 'nowrap'
              }}
            >
              {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
            </div>
          </div>

          {/* Middle Row: Progress Bar */}
          <div
            style={{
              position: 'relative',
              height: '4px',
              borderRadius: '2px',
              backgroundColor: 'rgba(255, 255, 255, 0.12)',
              overflow: 'hidden',
              width: '100%',
              margin: '2px 0 6px 0'
            }}
          >
            <div
              style={{
                height: '100%',
                width: `${progressPercent}%`,
                background: 'linear-gradient(90deg, #fa2d48 0%, var(--accent) 100%)',
                borderRadius: '2px',
                boxShadow: '0 0 8px rgba(250, 45, 72, 0.7)'
              }}
            />
          </div>

          {/* Bottom Row: Useful Commands (Navigable with Remote D-Pad) */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px'
            }}
          >
            {/* Prev Track */}
            <NowPlayingCommandButton
              focusKey="NOW_PLAYING_PREV"
              title="Previous Track"
              onPress={prevAudioTrack}
              onLeft={() => {
                setFocusedCmdKey(null);
                setFocus('NAV_NOW_PLAYING');
              }}
              onRight={() => setFocus('NOW_PLAYING_PLAY_PAUSE')}
              onDown={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                setFocus('NAV_PROFILE_AVATAR');
              }}
              onFocusedChange={(f) => handleCmdFocus('NOW_PLAYING_PREV', f)}
            >
              <SkipBack size={15} />
            </NowPlayingCommandButton>

            {/* Play/Pause (Prominent) */}
            <NowPlayingCommandButton
              focusKey="NOW_PLAYING_PLAY_PAUSE"
              title={isAudioPlaying ? 'Pause' : 'Play'}
              isPrimary
              onPress={toggleAudioPlayPause}
              onLeft={() => setFocus('NOW_PLAYING_PREV')}
              onRight={() => setFocus('NOW_PLAYING_NEXT')}
              onDown={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                setFocus('NAV_PROFILE_AVATAR');
              }}
              onFocusedChange={(f) => handleCmdFocus('NOW_PLAYING_PLAY_PAUSE', f)}
            >
              {isAudioPlaying ? <Pause size={17} fill="#fff" /> : <Play size={17} fill="#fff" style={{ marginLeft: 2 }} />}
            </NowPlayingCommandButton>

            {/* Next Track */}
            <NowPlayingCommandButton
              focusKey="NOW_PLAYING_NEXT"
              title="Next Track"
              onPress={nextAudioTrack}
              onLeft={() => setFocus('NOW_PLAYING_PLAY_PAUSE')}
              onRight={() => setFocus('NOW_PLAYING_MUTE')}
              onDown={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                setFocus('NAV_PROFILE_AVATAR');
              }}
              onFocusedChange={(f) => handleCmdFocus('NOW_PLAYING_NEXT', f)}
            >
              <SkipForward size={15} />
            </NowPlayingCommandButton>

            {/* Mute/Unmute */}
            <NowPlayingCommandButton
              focusKey="NOW_PLAYING_MUTE"
              title={isAudioMuted ? 'Unmute' : 'Mute'}
              onPress={toggleAudioMute}
              onLeft={() => setFocus('NOW_PLAYING_NEXT')}
              onRight={() => setFocus('NOW_PLAYING_EXPAND')}
              onDown={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                setFocus('NAV_PROFILE_AVATAR');
              }}
              onFocusedChange={(f) => handleCmdFocus('NOW_PLAYING_MUTE', f)}
            >
              {isAudioMuted ? <VolumeX size={15} color="#ff334b" /> : <Volume2 size={15} />}
            </NowPlayingCommandButton>

            {/* Full Screen Ambient Player & Lyrics */}
            <NowPlayingCommandButton
              focusKey="NOW_PLAYING_EXPAND"
              title="Full Screen & Lyrics"
              onPress={() => setIsMusicFullScreen(true)}
              onLeft={() => setFocus('NOW_PLAYING_MUTE')}
              onRight={() => setFocus('NOW_PLAYING_MUSIC_HUB')}
              onDown={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                setFocus('NAV_PROFILE_AVATAR');
              }}
              onFocusedChange={(f) => handleCmdFocus('NOW_PLAYING_EXPAND', f)}
            >
              <Maximize2 size={14} />
            </NowPlayingCommandButton>

            {/* Open Music Library Tab */}
            <NowPlayingCommandButton
              focusKey="NOW_PLAYING_MUSIC_HUB"
              title="Music Library"
              onPress={() => setActiveTab('music')}
              onLeft={() => setFocus('NOW_PLAYING_EXPAND')}
              onRight={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                focusPage(activeTab);
              }}
              onDown={() => {
                setFocusedCmdKey(null);
                setIsManualExpanded(false);
                setFocus('NAV_PROFILE_AVATAR');
              }}
              onFocusedChange={(f) => handleCmdFocus('NOW_PLAYING_MUSIC_HUB', f)}
            >
              <Music size={14} />
            </NowPlayingCommandButton>
          </div>
        </div>
      )}
    </div>
  );
};
