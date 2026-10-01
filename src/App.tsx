import React, { useState, useEffect, useRef } from 'react';
import { useAppState } from './state/AppStateContext';
import { initializeSpatialNavigation } from './navigation/spatialNavigation';
import { NavigationSidebar } from './components/NavigationSidebar';
import { HeroCarousel } from './components/HeroCarousel';
import { MediaRow } from './components/MediaRow';
import { VideoPlayer } from './components/VideoPlayer';
import { MusicPlayer } from './components/MusicPlayer';
import { MusicHubView } from './components/MusicHubView';
import { SettingsView } from './components/SettingsView';
import { SeriesDetailModal } from './components/SeriesDetailModal';
import { MovieDetailModal } from './components/MovieDetailModal';
import { SearchModal } from './components/SearchModal';
import { ProfileSwitcherModal } from './components/ProfileSwitcherModal';
import { ProfileTransitionOverlay } from './components/ProfileTransitionOverlay';
import { ServerConnectModal } from './components/ServerConnectModal';
import { NetflixGenreBar } from './components/NetflixGenreBar';
import { UserPersonalizationBanner } from './components/UserPersonalizationBanner';
import { setFocus, getCurrentFocusKey } from '@noriginmedia/norigin-spatial-navigation';
import { focusPage, popupOpen } from './navigation/pageFocus';
import { MediaItem } from './mockData';
import { RefreshCw } from 'lucide-react';
import { LiveTvView } from './components/LiveTvView';
import { MobileTopBar } from './components/MobileTopBar';
import { DownloadsView } from './components/DownloadsView';
import { PlaylistPicker } from './components/PlaylistPicker';
import { ConnectSheet, ConnectBar } from './components/ConnectSheet';
import './styles/music.css';
import { MobileNowPlayingBar } from './components/MobileNowPlayingBar';
import { ReconnectPopup } from './components/ReconnectPopup';
import { useIsPhone } from './theme/responsive';

export const AppContent: React.FC = () => {
  const {
    activeTab,
    activeVideo,
    playVideo,
    closeVideo,
    activeAudio,
    isAudioPlaying,
    toggleAudioPlayPause,
    nextAudioTrack,
    prevAudioTrack,
    playAudio,
    isMusicFullScreen,
    closeMusicPlayer,
    isSearchOpen,
    setIsSearchOpen,
    isProfileSwitcherOpen,
    setIsProfileSwitcherOpen,
    transitioningUser,
    transitionPhase,
    transitionStartRect,
    isServerConnectOpen,
    setIsServerConnectOpen,
    currentUser,
    heroItems,
    continueWatching,
    nextUp,
    userFavorites,
    userPlaylists,
    userStats,
    recentMovies,
    allMovies,
    allSeries,
    allMusic,
    isLoadingData,
    isConnectedToServer
  } = useAppState();

  const [selectedSeries, setSelectedSeries] = useState<MediaItem | null>(null);
  const [selectedMovie, setSelectedMovie] = useState<MediaItem | null>(null);
  const [homeGenre, setHomeGenre] = useState<string>('All');
  const [movieGenre, setMovieGenre] = useState<string>('All');
  const [tvGenre, setTvGenre] = useState<string>('All');

  // Set initial focus to the Hero carousel Play Now button on launch so remote works immediately!
  useEffect(() => {
    const timer = setTimeout(() => {
      if (!popupOpen()) setFocus('HERO_PLAY_BTN');
    }, 250);
    return () => clearTimeout(timer);
  }, []);

  // When changing categories/tabs, auto-focus relevant section
  useEffect(() => {
    const timer = setTimeout(() => {
      focusPage(activeTab);
    }, 120);
    return () => clearTimeout(timer);
  }, [activeTab]);

  // Initialize Spatial Navigation & handle Samsung Tizen Return key (10009)
  useEffect(() => {
    const cleanup = initializeSpatialNavigation(() => {
      // Global Back Key (10009 or Escape) handling logic
      if (isSearchOpen) {
        setIsSearchOpen(false);
      } else if (isProfileSwitcherOpen) {
        setIsProfileSwitcherOpen(false);
      } else if (activeVideo) {
        closeVideo();
      } else if (isMusicFullScreen) {
        closeMusicPlayer();
      } else if (selectedMovie) {
        setSelectedMovie(null);
      } else if (selectedSeries) {
        setSelectedSeries(null);
      } else {
        console.log('Tizen Back Key pressed on home screen');
      }
    });

    return cleanup;
  }, [isSearchOpen, isProfileSwitcherOpen, activeVideo, isMusicFullScreen, selectedSeries, selectedMovie]);

  // Enhanced D-Pad vertical navigation helper: ensures user can always return to top hero and jump to categories dock
  useEffect(() => {
    const handleNavigationAssist = (e: KeyboardEvent) => {
      if (activeVideo || isSearchOpen || isProfileSwitcherOpen || selectedSeries || selectedMovie) return;

      const mainEl = document.querySelector('main');

      // Key: ArrowUp (38)
      if (e.keyCode === 38 || e.key === 'ArrowUp') {
        const active = document.querySelector('.focused');
        if (mainEl && mainEl.scrollTop > 30) {
          // If in User Stats banner or Continue Watching / Next Up row, bounce smoothly back to top hero
          const inUpperArea =
            active?.closest('.media-row-continue') ||
            active?.closest('.media-row-nextup') ||
            active?.closest('[data-focus-key="USER_STATS_BANNER"]') ||
            active?.closest('.category-view-container > div:first-child');

          if (inUpperArea) {
            mainEl.scrollTo({ top: 0, behavior: 'smooth' });
            setFocus('HERO_PLAY_BTN');
          }
        }
      }

      // Key: Tab (9) or quick shortcut to jump to Bottom Categories Dock
      if (e.keyCode === 9 || e.key === 'Tab') {
        e.preventDefault();
        setFocus('NAV_TAB_' + activeTab);
      }
    };

    window.addEventListener('keydown', handleNavigationAssist);
    return () => window.removeEventListener('keydown', handleNavigationAssist);
  }, [activeVideo, isSearchOpen, isProfileSwitcherOpen, selectedSeries, activeTab]);

  // TV Remote Hardware Media Keys Handler (Play/Pause, Next Track, Prev Track)
  useEffect(() => {
    const handleRemoteMediaKeys = (e: KeyboardEvent) => {
      if (activeVideo) return;

      const code = e.keyCode || e.which;
      const key = e.key;

      // Play / Pause toggles
      if (
        code === 415 ||
        code === 19 ||
        code === 10252 ||
        key === 'MediaPlayPause' ||
        key === 'MediaPlay' ||
        key === 'MediaPause'
      ) {
        e.preventDefault();
        toggleAudioPlayPause();
      }

      // Next Track
      if (code === 417 || code === 10253 || key === 'MediaTrackNext' || key === 'MediaFastForward') {
        e.preventDefault();
        nextAudioTrack();
      }

      // Previous Track
      if (code === 412 || code === 10254 || key === 'MediaTrackPrevious' || key === 'MediaRewind') {
        e.preventDefault();
        prevAudioTrack();
      }
    };

    window.addEventListener('keydown', handleRemoteMediaKeys);
    return () => window.removeEventListener('keydown', handleRemoteMediaKeys);
  }, [activeVideo, toggleAudioPlayPause, nextAudioTrack, prevAudioTrack]);

  const isPhone = useIsPhone();

  const isForegroundModalActive =
    isProfileSwitcherOpen ||
    isServerConnectOpen ||
    isSearchOpen ||
    !!selectedSeries ||
    !!selectedMovie ||
    !!activeVideo ||
    isMusicFullScreen;

  // Remote: when a full-screen window closes (search, profiles, movie / series page, video), go back to the item
  // that opened it — its own buttons are gone, and a remote pointing at nothing ignores the next key press.
  // (The music player restores its own focus.)
  const overlayOpen = isProfileSwitcherOpen || isServerConnectOpen || isSearchOpen || !!selectedSeries || !!selectedMovie || !!activeVideo;
  const focusBeforeOverlayRef = useRef<string | null>(null);
  const overlayWasOpenRef = useRef(false);
  useEffect(() => {
    if (overlayOpen && !overlayWasOpenRef.current) {
      focusBeforeOverlayRef.current = getCurrentFocusKey();
    } else if (!overlayOpen && overlayWasOpenRef.current) {
      const back = focusBeforeOverlayRef.current;
      setTimeout(() => {
        if (back) setFocus(back);
        setTimeout(() => {
          if (!document.querySelector('.focused')) focusPage(activeTab);
        }, 60);
      }, 60);
    }
    overlayWasOpenRef.current = overlayOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overlayOpen]);

  // Boundary trap: ensure remote cursor never escapes website & stays in front
  useEffect(() => {
    const keepFocusInFront = (e: KeyboardEvent) => {
      // Prevent Tab key from cycling out into browser URL bar
      if (e.key === 'Tab') {
        e.preventDefault();
      }

      // If document window blurs, refocus immediately
      if (!document.hasFocus()) {
        window.focus();
      }

      // Do NOT prevent default for spatial navigation arrow keys or action keys!
      // But DO check if focus was completely lost (e.g. cursor went out of bounds)
      if (
        e.key === 'ArrowUp' ||
        e.key === 'ArrowDown' ||
        e.key === 'ArrowLeft' ||
        e.key === 'ArrowRight' ||
        e.key === 'Enter' ||
        e.key === 'Escape' ||
        e.keyCode === 10009
      ) {
        setTimeout(() => {
          const activeFocused = document.querySelector('.focused');
          if (!activeFocused) {
            // Focus dropped into the void! Recover it based on active view:
            if (isProfileSwitcherOpen) {
              setFocus('PROFILE_CARD_0');
            } else if (isServerConnectOpen) {
              setFocus('CONNECT_SERVER_SUBMIT_BTN');
            } else if (isSearchOpen) {
              setFocus('SEARCH_KEY_A');
            } else if (selectedMovie) {
              setFocus('MOVIE_PLAY_BTN');
            } else if (selectedSeries) {
              setFocus('SERIES_BACK_BTN');
            } else if (activeVideo) {
              setFocus('HUD_PLAYPAUSE_BTN');
            } else {
              focusPage(activeTab); // back into the current page (not Home's hero, which may not exist)
            }
          }
        }, 60);
        return;
      }

      // If foreground modal is active and focus was lost completely due to other reasons (clicks)
      if (isProfileSwitcherOpen) {
        const modalEl = document.querySelector('[data-focus-key="PROFILE_SWITCHER_MODAL"]');
        const activeFocused = document.querySelector('.focused');
        if (!activeFocused || !modalEl?.contains(activeFocused)) {
          setFocus('PROFILE_CARD_0');
        }
      } else if (isServerConnectOpen) {
        const modalEl = document.querySelector('[data-focus-key="SERVER_CONNECT_MODAL"]');
        const activeFocused = document.querySelector('.focused');
        if (!activeFocused || !modalEl?.contains(activeFocused)) {
          setFocus('CONNECT_SERVER_SUBMIT_BTN');
        }
      } else if (isSearchOpen) {
        const modalEl = document.querySelector('[data-focus-key="SEARCH_MODAL_VIEW"]');
        const activeFocused = document.querySelector('.focused');
        if (!activeFocused || !modalEl?.contains(activeFocused)) {
          setFocus('SEARCH_KEY_A');
        }
      } else if (selectedMovie) {
        const modalEl = document.querySelector('[data-focus-key="MOVIE_DETAIL_MODAL"]');
        const activeFocused = document.querySelector('.focused');
        if (!activeFocused || !modalEl?.contains(activeFocused)) {
          setFocus('MOVIE_PLAY_BTN');
        }
      } else if (selectedSeries) {
        const modalEl = document.querySelector('[data-focus-key="SERIES_DETAIL_MODAL"]');
        const activeFocused = document.querySelector('.focused');
        if (!activeFocused || !modalEl?.contains(activeFocused)) {
          setFocus('SERIES_BACK_BTN');
        }
      } else if (activeVideo) {
        const modalEl = document.querySelector('[data-focus-key="VIDEO_PLAYER"]');
        const activeFocused = document.querySelector('.focused');
        if (!activeFocused || !modalEl?.contains(activeFocused)) {
          setFocus('HUD_PLAYPAUSE_BTN');
        }
      }
    };

    window.addEventListener('keydown', keepFocusInFront);
    return () => window.removeEventListener('keydown', keepFocusInFront);
  }, [isProfileSwitcherOpen, isServerConnectOpen, isSearchOpen, selectedSeries, selectedMovie, activeVideo, activeTab]);

  // Immediate Autostart for Continue Watching and Next Up items
  const handleAutostartMedia = (item: MediaItem) => {
    if (item.type === 'music') {
      playAudio(item);
    } else {
      // Directly autostart playing the video/episode immediately!
      playVideo(item);
    }
  };

  const handleMediaSelect = (item: MediaItem) => {
    if (item.type === 'music') {
      playAudio(item);
    } else if (item.type === 'tv') {
      // Open TV series detail with season & episode picker, resume & start over
      setSelectedSeries(item);
    } else if (item.type === 'movie') {
      // Open Movie Detail modal with cast, synopsis, and specs before launching!
      setSelectedMovie(item);
    } else {
      // Autostart movies, episodes, or any playable video
      playVideo(item);
    }
  };

  return (
    <div
      style={{
        width: '100vw',
        height: '100vh',
        backgroundColor: '#07090e',
        color: '#ffffff',
        display: 'flex',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      {/* Floating Bottom Navigation Dock — hidden (and unreachable by the remote) while choosing a profile,
          during the profile switch animation, and on the server connect screen. */}
      {!isProfileSwitcherOpen && !isServerConnectOpen && transitionPhase === 'idle' && (isPhone ? !isForegroundModalActive && <MobileTopBar /> : <NavigationSidebar />)}
      {isPhone && !isForegroundModalActive && transitionPhase === 'idle' && <MobileNowPlayingBar />}

      {/* Main Screen Content View */}
      <main
        className="app-main"
        style={{
          flex: 1,
          height: '100vh',
          overflowY: 'auto',
          paddingLeft: '120px',
          paddingRight: '48px',
          paddingTop: '32px',
          paddingBottom: activeAudio ? '190px' : '120px',
          pointerEvents: isForegroundModalActive ? 'none' : 'auto',
          filter: isForegroundModalActive ? 'brightness(0.6)' : 'none',
          transition: 'filter 0.3s ease'
        }}
        aria-hidden={isForegroundModalActive ? true : undefined}
      >
        {/* Syncing library indicator */}
        {isLoadingData && (
          <div
            className="sync-badge"
            style={{
              position: 'fixed',
              top: '24px',
              right: '24px',
              zIndex: 900,
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              borderRadius: '20px',
              backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
              border: '1px solid rgba(var(--accent-rgb), 0.4)',
              backdropFilter: 'blur(16px)',
              fontSize: '0.85rem',
              color: 'var(--accent)',
              fontWeight: 600
            }}
          >
            <RefreshCw size={16} className="animate-spin" />
            <span>Syncing Jellyfin...</span>
          </div>
        )}

        {/* Dynamic Animated Category View Container */}
        <div key={activeTab} className="category-view-container">
          {/* HOME VIEW */}
          {activeTab === 'home' && (
            <>
              <div>
                <HeroCarousel
                  items={heroItems}
                  onPlay={handleMediaSelect}
                  onSelectDetails={handleMediaSelect}
                />
              </div>

              {/* Netflix-Style Category / Genre Filter Bar */}
              <NetflixGenreBar
                focusKeyId="HOME_GENRE_BAR"
                selectedGenre={homeGenre}
                onSelectGenre={setHomeGenre}
              />

              {homeGenre === 'All' ? (
                <>
                  {/* Personalized User Watch Time & Statistics Highlights */}
                  <UserPersonalizationBanner />

                  {/* 1. Continue Watching (Only shown if user has in-progress items) */}
                  {continueWatching.length > 0 && (
                    <MediaRow
                      className="media-row-continue"
                      rowFocusKey="ROW_CONTINUE_WATCHING"
                      title="Continue Watching"
                      badge="Resume"
                      items={continueWatching}
                      aspectRatio="backdrop"
                      onSelect={handleAutostartMedia}
                    />
                  )}

                  {/* 2. Next Up for User Series */}
                  {nextUp.length > 0 && (
                    <MediaRow
                      className="media-row-nextup"
                      rowFocusKey="ROW_NEXT_UP"
                      title={currentUser ? `Next Up for ${currentUser.name}` : 'Next Up in Your Series'}
                      badge="Next Episodes"
                      items={nextUp}
                      aspectRatio="backdrop"
                      onSelect={handleAutostartMedia}
                    />
                  )}

                  {/* 3. User Custom Playlists */}
                  {userPlaylists.length > 0 && (
                    <MediaRow
                      className="media-row-playlists"
                      rowFocusKey="ROW_PLAYLISTS"
                      title="Your Curated Playlists"
                      badge="Custom Collections"
                      items={userPlaylists}
                      aspectRatio="square"
                      onSelect={handleMediaSelect}
                    />
                  )}

                  {/* 4. User Favorites (Only shown if user has favorites) */}
                  {userFavorites && userFavorites.length > 0 && (
                    <MediaRow
                      className="media-row-favorites"
                      rowFocusKey="ROW_FAVORITES"
                      title="Your Saved Favorites"
                      badge="Top Rated"
                      items={userFavorites}
                      aspectRatio="poster"
                      onSelect={handleMediaSelect}
                    />
                  )}

                  {/* 5. Recently Added Movies */}
                  <MediaRow
                    rowFocusKey="ROW_RECENT_MOVIES"
                    title={isConnectedToServer ? 'Recently Added on Jellyfin' : 'Featured Movies'}
                    items={recentMovies}
                    aspectRatio="poster"
                    onSelect={handleMediaSelect}
                  />

                  {/* 6. TV Series & Shows */}
                  {allSeries.length > 0 && (
                    <MediaRow
                      rowFocusKey="ROW_HOME_SERIES"
                      title="TV Series & Shows"
                      items={allSeries}
                      aspectRatio="backdrop"
                      onSelect={handleMediaSelect}
                    />
                  )}

                  {/* 7. Trending Music */}
                  <MediaRow
                    rowFocusKey="ROW_TRENDING_MUSIC"
                    title={isConnectedToServer ? 'Music Library' : 'Trending Music & Audio'}
                    items={allMusic}
                    aspectRatio="square"
                    onSelect={handleMediaSelect}
                  />
                </>
              ) : (
                /* Dynamic Genre View */
                <div>
                  <MediaRow
                    rowFocusKey="ROW_GENRE_MOVIES"
                    title={`${homeGenre} Movies`}
                    badge="Filtered"
                    items={allMovies.concat(recentMovies).filter((m) => m.genres?.some((g) => g.toLowerCase().includes(homeGenre.toLowerCase())))}
                    aspectRatio="poster"
                    onSelect={handleMediaSelect}
                  />
                  <MediaRow
                    rowFocusKey="ROW_GENRE_SERIES"
                    title={`${homeGenre} Series`}
                    badge="Filtered"
                    items={allSeries.filter((s) => s.genres?.some((g) => g.toLowerCase().includes(homeGenre.toLowerCase())))}
                    aspectRatio="backdrop"
                    onSelect={handleMediaSelect}
                  />
                </div>
              )}
            </>
          )}

          {/* MOVIES TAB */}
          {activeTab === 'movies' && (
            <div>
              <h1 className="page-title" style={{ fontSize: '2.4rem', fontWeight: 800, marginBottom: '16px', letterSpacing: '-0.5px' }}>
                Movies Library
              </h1>
              <NetflixGenreBar
                focusKeyId="MOVIES_GENRE_BAR"
                selectedGenre={movieGenre}
                onSelectGenre={setMovieGenre}
              />
              {movieGenre === 'All' ? (
                <>
                  {userFavorites.filter((f) => f.type === 'movie').length > 0 && (
                    <MediaRow
                      rowFocusKey="ROW_MOVIES_FAVORITES"
                      title="Your Favorite Movies"
                      badge="Liked"
                      items={userFavorites.filter((f) => f.type === 'movie')}
                      aspectRatio="poster"
                      onSelect={handleMediaSelect}
                    />
                  )}
                  <MediaRow
                    rowFocusKey="ROW_ALL_MOVIES"
                    layout="grid"
                    title="All Movies"
                    items={allMovies.length > 0 ? allMovies : recentMovies}
                    aspectRatio="poster"
                    onSelect={handleMediaSelect}
                  />
                  {recentMovies.length > 0 && (
                    <MediaRow
                      rowFocusKey="ROW_RECENT_MOVIES_TAB"
                      title="Recently Added"
                      items={recentMovies}
                      aspectRatio="backdrop"
                      onSelect={handleMediaSelect}
                    />
                  )}
                </>
              ) : (
                <MediaRow
                  rowFocusKey="ROW_FILTERED_MOVIES"
                    layout="grid"
                  title={`${movieGenre} Movies`}
                  badge="Genre"
                  items={allMovies.concat(recentMovies).filter((m) => m.genres?.some((g) => g.toLowerCase().includes(movieGenre.toLowerCase())))}
                  aspectRatio="poster"
                  onSelect={handleMediaSelect}
                />
              )}
            </div>
          )}

          {/* TV SHOWS TAB */}
          {activeTab === 'tv' && (
            <div>
              <h1 className="page-title" style={{ fontSize: '2.4rem', fontWeight: 800, marginBottom: '16px', letterSpacing: '-0.5px' }}>
                TV Series & Shows
              </h1>
              <NetflixGenreBar
                focusKeyId="TV_GENRE_BAR"
                selectedGenre={tvGenre}
                onSelectGenre={setTvGenre}
              />
              {tvGenre === 'All' ? (
                <>
                  {nextUp.length > 0 && (
                    <MediaRow
                      rowFocusKey="ROW_TV_NEXTUP"
                      title="Next Up in Your Series"
                      badge="Up Next"
                      items={nextUp}
                      aspectRatio="backdrop"
                      onSelect={handleMediaSelect}
                    />
                  )}
                  <MediaRow
                    rowFocusKey="ROW_TV_SHOWS"
                    layout="grid"
                    title="All Series"
                    items={allSeries.length > 0 ? allSeries : heroItems.filter((i) => i.type === 'tv')}
                    aspectRatio="backdrop"
                    onSelect={handleMediaSelect}
                  />
                </>
              ) : (
                <MediaRow
                  rowFocusKey="ROW_FILTERED_SERIES"
                    layout="grid"
                  title={`${tvGenre} Series`}
                  badge="Genre"
                  items={allSeries.filter((s) => s.genres?.some((g) => g.toLowerCase().includes(tvGenre.toLowerCase())))}
                  aspectRatio="backdrop"
                  onSelect={handleMediaSelect}
                />
              )}
            </div>
          )}

          {/* LIVE TV TAB (Jellyfin Live TV / IPTV) */}
          {activeTab === 'live' && <LiveTvView />}

          {/* MUSIC TAB */}
          {activeTab === 'music' && <MusicHubView />}

          {/* SETTINGS VIEW */}
          {activeTab === 'downloads' && <DownloadsView />}
          {activeTab === 'settings' && <SettingsView />}
        </div>
      </main>

      {/* Series Detail & Episode Selector Modal */}
      {selectedSeries && (
        <SeriesDetailModal
          series={selectedSeries}
          onClose={() => setSelectedSeries(null)}
          onPlayEpisode={(episode) => {
            setSelectedSeries(null);
            playVideo(episode);
          }}
        />
      )}

      {/* Movie Detail & Cast Credentials Modal */}
      {selectedMovie && (
        <MovieDetailModal
          movie={selectedMovie}
          onClose={() => setSelectedMovie(null)}
          onPlay={(movie) => {
            setSelectedMovie(null);
            playVideo(movie);
          }}
        />
      )}

      {/* Video Player Modal Overlay */}
      {activeVideo && <VideoPlayer item={activeVideo} onClose={closeVideo} />}

      {/* Integrated Music Player (Mini-player & Fullscreen) */}
      <MusicPlayer />

      {/* Search Overlay Modal */}
      {isSearchOpen && (
        <SearchModal
          onClose={() => setIsSearchOpen(false)}
          onSelectMedia={handleMediaSelect}
        />
      )}

      {/* Profile Switcher Modal */}
      {isProfileSwitcherOpen && (
        <ProfileSwitcherModal
          onClose={() => setIsProfileSwitcherOpen(false)}
        />
      )}

      {/* Cinematic Profile Switch Animation Overlay */}
      <ProfileTransitionOverlay
        user={transitioningUser}
        phase={transitionPhase}
        startRect={transitionStartRect}
      />

      {/* Music: Add to playlist (opened from songs, albums and the player) */}
      <PlaylistPicker />

      {/* Yudia Connect: play on / control another device */}
      <ConnectSheet />
      {!activeVideo && !isMusicFullScreen && <ConnectBar />}

      {/* No media at all / library failed to load → "Reconnect required" */}
      <ReconnectPopup />

      {/* First Arrival Server Connect Modal */}
      <ServerConnectModal
        isOpen={isServerConnectOpen}
        onClose={() => setIsServerConnectOpen(false)}
        onConnected={() => setIsServerConnectOpen(false)}
      />

    </div>
  );
};
