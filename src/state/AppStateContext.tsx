import React, { createContext, useContext, useState, useEffect, ReactNode , useRef} from 'react';
import { MediaItem } from '../mockData';
import { getConnectState, remotePlay, refreshDevices, startReceiver, startAutoFollow } from '../services/remoteSessions';
import { flushPendingProgress, runAutoDownloads } from '../services/downloads';
import { jellyfinClient, JellyfinUser } from '../api/jellyfin';
import { setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { TransitionPhase, StartRect } from '../components/ProfileTransitionOverlay';

export type TabType = 'home' | 'movies' | 'tv' | 'live' | 'music' | 'downloads' | 'settings';

export interface LyricLine {
  time: number; // in seconds
  text: string;
}

interface AppStateContextType {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  activeVideo: MediaItem | null;
  playVideo: (item: MediaItem) => void;
  closeVideo: () => void;
  // Audio playback and queue
  activeAudio: MediaItem | null;
  isAudioPlaying: boolean;
  audioQueue: MediaItem[];
  audioQueueIndex: number;
  audioCurrentTime: number;
  audioDuration: number;
  lyrics: LyricLine[];
  playAudio: (item: MediaItem, queue?: MediaItem[]) => void;
  toggleAudioPlayPause: () => void;
  nextAudioTrack: () => void;
  prevAudioTrack: () => void;
  setAudioProgress: (current: number, duration: number) => void;
  isMusicFullScreen: boolean;
  setIsMusicFullScreen: (val: boolean) => void;
  closeMusicPlayer: () => void;
  isAudioMuted: boolean;
  toggleAudioMute: () => void;
  // User Profile & Server Profiles
  currentUser: JellyfinUser | null;
  allUsers: JellyfinUser[];
  loadUsers: () => Promise<void>;
  switchUser: (username: string, password?: string) => Promise<boolean>;
  isProfileSwitcherOpen: boolean;
  setIsProfileSwitcherOpen: (val: boolean) => void;
  // Profile Transition Animation
  transitioningUser: JellyfinUser | null;
  transitionPhase: TransitionPhase;
  transitionStartRect: StartRect | null;
  triggerProfileSwitch: (user: JellyfinUser, password?: string, startRect?: StartRect | null) => Promise<boolean>;
  // Server Connect Modal
  isServerConnectOpen: boolean;
  setIsServerConnectOpen: (val: boolean) => void;
  // Search Overlay
  isSearchOpen: boolean;
  setIsSearchOpen: (val: boolean) => void;
  // Live Jellyfin server media datasets
  heroItems: MediaItem[];
  continueWatching: MediaItem[];
  nextUp: MediaItem[];
  userFavorites: MediaItem[];
  userPlaylists: MediaItem[];
  userStats: { totalHours: number; moviesWatched: number; episodesWatched: number };
  recentMovies: MediaItem[];
  allMovies: MediaItem[];
  allSeries: MediaItem[];
  allMusic: MediaItem[];
  libraryStatus: 'unknown' | 'ok' | 'empty' | 'error';
  isLoadingData: boolean;
  isConnectedToServer: boolean;
  serverName: string;
  refreshLibrary: () => Promise<void>;
}

const AppStateContext = createContext<AppStateContextType | undefined>(undefined);

export const AppStateProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const [activeVideo, setActiveVideo] = useState<MediaItem | null>(null);
  const [activeAudio, setActiveAudio] = useState<MediaItem | null>(() => {
    const saved = localStorage.getItem('jellyfin_active_audio');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return null;
  });
  const [isAudioPlaying, setIsAudioPlaying] = useState<boolean>(false);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [isMusicFullScreen, setIsMusicFullScreen] = useState<boolean>(false);

  // User Profile & Server Switcher State
  const [currentUser, setCurrentUser] = useState<JellyfinUser | null>(() => {
    const config = jellyfinClient.getConfig();
    if (config.userId && config.username) {
      return {
        id: config.userId,
        name: config.username,
        hasPassword: true,
        avatarUrl: jellyfinClient.getUserImageUrl(config.userId)
      };
    }
    return null;
  });
  const [allUsers, setAllUsers] = useState<JellyfinUser[]>([]);
  const [isProfileSwitcherOpen, setIsProfileSwitcherOpen] = useState<boolean>(false);
  const [isSearchOpen, setIsSearchOpen] = useState<boolean>(false);

  // Profile Transition Animation State
  const [transitioningUser, setTransitioningUser] = useState<JellyfinUser | null>(null);
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('idle');
  const [transitionStartRect, setTransitionStartRect] = useState<StartRect | null>(null);

  // Server Connect on first arrival (if no active user session)
  const [isServerConnectOpen, setIsServerConnectOpen] = useState<boolean>(() => {
    const config = jellyfinClient.getConfig();
    return !config.accessToken || !config.userId;
  });

  const loadUsers = async () => {
    try {
      const users = await jellyfinClient.getPublicUsers();
      setAllUsers(users);
      const config = jellyfinClient.getConfig();
      if (config.userId) {
        const found = users.find((u) => u.id === config.userId || u.name.toLowerCase() === config.username.toLowerCase());
        if (found) {
          setCurrentUser(found);
        } else if (config.username) {
          setCurrentUser({
            id: config.userId,
            name: config.username,
            hasPassword: true,
            avatarUrl: jellyfinClient.getUserImageUrl(config.userId)
          });
        }
      }
    } catch (e) {
      console.warn('Failed loading users', e);
    }
  };

  const triggerProfileSwitch = async (user: JellyfinUser, password?: string, startRect?: StartRect | null): Promise<boolean> => {
    try {
      setTransitionStartRect(startRect || null);
      setIsProfileSwitcherOpen(false);
      setTransitioningUser(user);
      setTransitionPhase('center');

      // Animate into spin phase after avatar leaves card and glides to center
      await new Promise((r) => setTimeout(r, 450));
      setTransitionPhase('spin');

      const startTime = Date.now();
      const serverConfig = jellyfinClient.getConfig();
      const stored = jellyfinClient.getStoredUserCredential(user.id) || jellyfinClient.getStoredUserCredential(user.name);

      // Saved token still accepted → reuse it. Rejected (expired / revoked / new device id) → sign in again with the
      // saved password, so profiles stay in sync without asking.
      const tokenOk = !!stored?.token && !password && (await jellyfinClient.isTokenValid(serverConfig.serverUrl, stored!.token));
      if (stored && tokenOk) {
        jellyfinClient.setConfig({
          accessToken: stored.token,
          userId: stored.userId,
          username: stored.username,
          serverUrl: stored.serverUrl || serverConfig.serverUrl
        });
      } else {
        // Authenticate with user credentials
        const pwdToUse = password || stored?.password || '';
        await jellyfinClient.authenticate(serverConfig.serverUrl, user.name, pwdToUse);
      }

      const activeConfig = jellyfinClient.getConfig();
      const userObj: JellyfinUser = {
        id: activeConfig.userId || user.id,
        name: activeConfig.username || user.name,
        hasPassword: user.hasPassword,
        avatarUrl: jellyfinClient.getUserImageUrl(activeConfig.userId || user.id)
      };

      setCurrentUser(userObj);
      setIsConnectedToServer(true);

      // Refresh libraries for this user
      await refreshLibrary();

      // Ensure minimum spin duration (1000ms) for smooth cinematic effect
      const elapsed = Date.now() - startTime;
      if (elapsed < 1000) {
        await new Promise((r) => setTimeout(r, 1000 - elapsed));
      }

      // Phase 3: Float up and reveal homepage
      setTransitionPhase('exit');
      await new Promise((r) => setTimeout(r, 800));

      setTransitionPhase('idle');
      setTransitioningUser(null);

      // Focus hero play button on homepage
      setTimeout(() => {
        setFocus('HERO_PLAY_BTN');
      }, 120);

      return true;
    } catch (e: any) {
      console.error('Profile switch transition error:', e);
      setTransitionPhase('idle');
      setTransitioningUser(null);
      setIsProfileSwitcherOpen(true);
      throw e;
    }
  };

  const switchUser = async (username: string, password = ''): Promise<boolean> => {
    try {
      setIsLoadingData(true);
      const serverConfig = jellyfinClient.getConfig();
      const res = await jellyfinClient.authenticate(serverConfig.serverUrl, username, password);
      if (res.token && res.userId) {
        const userObj: JellyfinUser = {
          id: res.userId,
          name: username,
          hasPassword: !!password,
          avatarUrl: jellyfinClient.getUserImageUrl(res.userId)
        };
        setCurrentUser(userObj);
        setIsConnectedToServer(true);
        setIsProfileSwitcherOpen(false);
        await refreshLibrary();
        return true;
      }
      return false;
    } catch (e: any) {
      console.error('Failed to switch user:', e);
      throw e;
    } finally {
      setIsLoadingData(false);
    }
  };

  // Library — only ever real data from the server (no demo content)
  const [heroItems, setHeroItems] = useState<MediaItem[]>([]);
  const [continueWatching, setContinueWatching] = useState<MediaItem[]>([]);
  const [nextUp, setNextUp] = useState<MediaItem[]>([]);
  const [userFavorites, setUserFavorites] = useState<MediaItem[]>([]);
  const [userPlaylists, setUserPlaylists] = useState<MediaItem[]>([]);
  const [userStats, setUserStats] = useState<{ totalHours: number; moviesWatched: number; episodesWatched: number }>({
    totalHours: 0,
    moviesWatched: 0,
    episodesWatched: 0
  });
  const [recentMovies, setRecentMovies] = useState<MediaItem[]>([]);
  const [allMovies, setAllMovies] = useState<MediaItem[]>([]);
  const [allSeries, setAllSeries] = useState<MediaItem[]>([]);
  const [allMusic, setAllMusic] = useState<MediaItem[]>([]);
  /** 'ok' = media found · 'empty' = server answered with nothing at all · 'error' = couldn't load (sign-in / network) */
  const [libraryStatus, setLibraryStatus] = useState<'unknown' | 'ok' | 'empty' | 'error'>('unknown');

  const [isLoadingData, setIsLoadingData] = useState<boolean>(false);
  const [isConnectedToServer, setIsConnectedToServer] = useState<boolean>(() => jellyfinClient.isAuthenticated());
  const [serverName, setServerName] = useState<string>('Jellyfin Server');

  // The play queue survives the page being closed / reloaded (phones do that to apps in the background)
  const QUEUE_KEY = 'yudia_audio_queue';
  const savedQueue = (() => {
    try {
      return JSON.parse(localStorage.getItem(QUEUE_KEY) || 'null') as { items: MediaItem[]; index: number } | null;
    } catch {
      return null;
    }
  })();
  const [audioQueue, setAudioQueue] = useState<MediaItem[]>(savedQueue?.items || []);
  const [audioQueueIndex, setAudioQueueIndex] = useState<number>(savedQueue?.index || 0);
  useEffect(() => {
    try {
      const slim = audioQueue.slice(0, 500).map(({ subtitleTracks, audioTracks, cast, chapters, ...rest }) => rest);
      localStorage.setItem(QUEUE_KEY, JSON.stringify({ items: slim, index: audioQueueIndex }));
    } catch {}
  }, [audioQueue, audioQueueIndex]);
  const [audioCurrentTime, setAudioCurrentTime] = useState<number>(0);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [lyrics] = useState<LyricLine[]>([]); // no fake lyrics

  /** Plays here (also what remote "Play" commands use). */
  const playVideoLocal = (item: MediaItem) => {
    setIsAudioPlaying(false);
    setActiveVideo(item);
  };
  /** Yudia Connect: when another device is chosen, it plays there. */
  const playVideo = (item: MediaItem) => {
    const target = getConnectState().target;
    if (target) {
      const startSecs = item.playbackPercent && item.runTimeTicks ? (item.playbackPercent / 100) * (item.runTimeTicks / 1e7) : 0;
      remotePlay(target.sessionId, [item.id], 0, startSecs)
        .then(() => setTimeout(refreshDevices, 800))
        .catch(() => alert(`Couldn't start it on ${target.name}.`));
      return;
    }
    playVideoLocal(item);
  };

  const closeVideo = () => {
    setActiveVideo(null);
  };

  const playAudio = (item: MediaItem, queue?: MediaItem[]) => {
    const target = getConnectState().target;
    if (target) {
      // Yudia Connect: the chosen device plays it (this one stays quiet)
      const q = queue && queue.length > 0 ? queue : [item];
      const idx = Math.max(0, q.findIndex((x) => x.id === item.id));
      setIsAudioPlaying(false);
      remotePlay(target.sessionId, q.map((x) => x.id), idx)
        .then(() => setTimeout(refreshDevices, 800))
        .catch(() => alert(`Couldn't start it on ${target.name}.`));
      return;
    }
    playAudioLocal(item, queue);
  };

  /** Plays here (also what remote "Play" commands use). */
  const playAudioLocal = (item: MediaItem, queue?: MediaItem[]) => {
    setActiveVideo(null); // Pause any running video
    const newQueue = queue && queue.length > 0 ? queue : (allMusic.length > 0 ? allMusic : [item]);
    const index = newQueue.findIndex((q) => q.id === item.id);
    setActiveAudio(item);
    setIsAudioPlaying(true);
    setAudioQueue(newQueue);
    setAudioQueueIndex(index >= 0 ? index : 0);
    try {
      localStorage.setItem('jellyfin_active_audio', JSON.stringify(item));
    } catch (e) {}
  };

  const playingHereRef = useRef(false);
  playingHereRef.current = isAudioPlaying || !!activeVideo;
  const receiverRef = useRef({ playAudio: playAudioLocal, playVideo: playVideoLocal });
  receiverRef.current = { playAudio: playAudioLocal, playVideo: playVideoLocal };

  const toggleAudioPlayPause = () => {
    setIsAudioPlaying((prev) => !prev);
  };

  const nextAudioTrack = () => {
    if (audioQueue.length === 0) return;
    const nextIndex = (audioQueueIndex + 1) % audioQueue.length;
    setAudioQueueIndex(nextIndex);
    const nextTrack = audioQueue[nextIndex];
    setActiveAudio(nextTrack);
    setIsAudioPlaying(true);
    try {
      localStorage.setItem('jellyfin_active_audio', JSON.stringify(nextTrack));
    } catch (e) {}
  };

  const prevAudioTrack = () => {
    if (audioQueue.length === 0) return;
    const prevIndex = (audioQueueIndex - 1 + audioQueue.length) % audioQueue.length;
    setAudioQueueIndex(prevIndex);
    const prevTrack = audioQueue[prevIndex];
    setActiveAudio(prevTrack);
    setIsAudioPlaying(true);
    try {
      localStorage.setItem('jellyfin_active_audio', JSON.stringify(prevTrack));
    } catch (e) {}
  };

  const toggleAudioMute = () => {
    setIsAudioMuted((prev) => !prev);
  };

  const setAudioProgress = (current: number, duration: number) => {
    setAudioCurrentTime(current);
    setAudioDuration(duration);
  };

  const closeMusicPlayer = () => {
    setIsMusicFullScreen(false);
  };

  // Fetch all libraries from live Jellyfin server
  const refreshLibrary = async () => {
    // If not currently authenticated, attempt re-authenticating from vault credentials
    if (!jellyfinClient.isAuthenticated()) {
      const reauthed = await jellyfinClient.autoReauthenticate();
      if (!reauthed) {
        if (jellyfinClient.getConfig().serverUrl) setLibraryStatus('error');
        return;
      }
    }

    setIsLoadingData(true);
    try {
      // 1. Check server info
      const serverConfig = jellyfinClient.getConfig();
      try {
        const info = await jellyfinClient.testServer(serverConfig.serverUrl);
        setServerName(info.serverName);
        setIsConnectedToServer(true);
      } catch (e) {}

      // 2. Fetch Continue Watching / Resume strictly linked to this user profile
      const activeUserId = jellyfinClient.getConfig().userId || currentUser?.id || '';
      const userLocalHistory = activeUserId ? jellyfinClient.getUserWatchHistory(activeUserId) : [];
      let combinedResume: MediaItem[] = [];

      try {
        const resumeRaw = await jellyfinClient.getResumeItems(12);
        if (resumeRaw && resumeRaw.length > 0) {
          combinedResume = resumeRaw.map((item: any) => jellyfinClient.mapToMediaItem(item));
        }
      } catch (e: any) {
        console.warn('Failed fetching Jellyfin resume items', e);
        // If unauthorized token, attempt immediate re-auth
        if (e?.message?.includes('401') || e?.message?.includes('Unauthorized')) {
          await jellyfinClient.autoReauthenticate();
        }
      }

      // Merge server items and local profile items
      const existingIds = new Set(combinedResume.map((i) => i.id));
      for (const localItem of userLocalHistory) {
        if (!existingIds.has(localItem.id)) {
          combinedResume.push(localItem);
          existingIds.add(localItem.id);
        }
      }

      // Strictly filter: ONLY media with genuine watch progress (> 0% and < 95%) and valid type (Episode or Movie)
      // Never show unstarted shows or pad this row!
      const validResume = combinedResume.filter((item) => {
        if (item.type === 'tv' && !item.episodeNumber && !item.episodeName) return false;
        if (!item.playbackPercent || item.playbackPercent <= 0 || item.playbackPercent >= 95) return false;
        return true;
      });

      setContinueWatching(validResume);

      // 3. Fetch Latest Movies
      const latestRaw = await jellyfinClient.getLatestItems('Movie', 16);
      const mappedLatest = latestRaw.map((item: any) => jellyfinClient.mapToMediaItem(item));
      setRecentMovies(mappedLatest);
      // Hero: newest movies (falls back to all movies / series below)
      let hero = mappedLatest.slice(0, 5);

      // 4. Fetch All Movies
      const moviesRaw = await jellyfinClient.getItems({
        includeItemTypes: 'Movie',
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        limit: 1000 // "All Movies" is a full grid now
      });
      const mappedMovies = moviesRaw.map((item: any) => jellyfinClient.mapToMediaItem(item));
      setAllMovies(mappedMovies);
      if (hero.length === 0) hero = mappedMovies.slice(0, 5);

      // 5. Fetch All TV Shows
      const seriesRaw = await jellyfinClient.getItems({
        includeItemTypes: 'Series',
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        limit: 1000 // "All Series" is a full grid now
      });
      const mappedSeries = seriesRaw.map((item: any) => jellyfinClient.mapToMediaItem(item));
      setAllSeries(mappedSeries);
      if (hero.length === 0) hero = mappedSeries.slice(0, 5);
      setHeroItems(hero);

      // 6. Fetch Audio Tracks
      const musicRaw = await jellyfinClient.getItems({
        includeItemTypes: 'Audio',
        sortBy: 'DateCreated',
        sortOrder: 'Descending',
        limit: 300
      });
      const mappedMusic = musicRaw.map((item: any) => jellyfinClient.mapToMediaItem(item));
      setAllMusic(mappedMusic);
      // Only a starting queue: never replace the one you're listening to (that happened on every return to the app)
      setAudioQueue((prev) => (prev.length ? prev : mappedMusic));

      // Nothing at all on the server (or nothing this account can see) → "Reconnect required" pop-up
      setLibraryStatus(mappedLatest.length + mappedMovies.length + mappedSeries.length + mappedMusic.length > 0 ? 'ok' : 'empty');
      // Back online / signed in: send watch progress made offline, bring auto-downloads up to date
      flushPendingProgress().then(() => runAutoDownloads()); // progress first: the server then knows what was watched
      // Yudia Connect: other devices can now see and control this one
      startReceiver({
        playAudio: (item, queue) => receiverRef.current.playAudio(item, queue),
        playVideo: (item) => receiverRef.current.playVideo(item)
      });
      startAutoFollow(() => playingHereRef.current);

      // 7. Fetch Personalized Data for User
      try {
        const nextUpRaw = await jellyfinClient.getNextUp(12);
        setNextUp(nextUpRaw.map((item: any) => jellyfinClient.mapToMediaItem(item)));
      } catch (e) {
        console.warn('Failed to fetch next up', e);
      }

      try {
        const playlistsRaw = await jellyfinClient.getUserPlaylists(16);
        setUserPlaylists(playlistsRaw.map((item: any) => jellyfinClient.mapToMediaItem(item)));
      } catch (e) {
        console.warn('Failed to fetch playlists', e);
      }

      try {
        const favsRaw = await jellyfinClient.getUserFavorites(20);
        if (favsRaw && favsRaw.length > 0) {
          setUserFavorites(favsRaw.map((item: any) => jellyfinClient.mapToMediaItem(item)));
        } else {
          setUserFavorites([]);
        }
      } catch (e) {
        setUserFavorites([]);
      }

      try {
        const stats = await jellyfinClient.getUserStats();
        setUserStats(stats);
      } catch (e) {
        console.warn('Failed to fetch user stats', e);
      }

      setIsConnectedToServer(true);
    } catch (e) {
      console.warn('Error syncing Jellyfin libraries:', e);
      setLibraryStatus('error');
    } finally {
      setIsLoadingData(false);
    }
  };

  // Auto-sync with Jellyfin every time the website loads
  useEffect(() => {
    let isMounted = true;

    const performAutoSync = async () => {
      setIsLoadingData(true);
      try {
        const serverConfig = jellyfinClient.getConfig();

        // 1. Ping / Test Server
        try {
          const info = await jellyfinClient.testServer(serverConfig.serverUrl);
          if (isMounted) {
            setServerName(info.serverName);
            setIsConnectedToServer(true);
          }
        } catch (e) {
          console.warn('Initial server reachability ping:', e);
        }

        // 2. Load all users from Jellyfin
        await loadUsers();

        // 3. Ensure active session
        if (!jellyfinClient.isAuthenticated()) {
          await jellyfinClient.autoReauthenticate();
        }

        // 4. If authenticated, update currentUser and sync entire library
        if (jellyfinClient.isAuthenticated()) {
          const config = jellyfinClient.getConfig();
          if (isMounted && config.userId && config.username) {
            setCurrentUser({
              id: config.userId,
              name: config.username,
              hasPassword: true,
              avatarUrl: jellyfinClient.getUserImageUrl(config.userId)
            });
            setIsServerConnectOpen(false);
          }
          await refreshLibrary();
        } else {
          // If no stored token, check if there is a passwordless user to auto-connect
          const publicUsers = await jellyfinClient.getPublicUsers();
          const autoUser = publicUsers.find((u) => !u.hasPassword) || publicUsers[0];
          if (autoUser && !autoUser.hasPassword) {
            try {
              await jellyfinClient.authenticate(serverConfig.serverUrl, autoUser.name, '');
              if (isMounted) {
                setCurrentUser(autoUser);
                setIsServerConnectOpen(false);
              }
              await refreshLibrary();
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn('[AppState] Auto-sync on load error:', err);
      } finally {
        if (isMounted) {
          setIsLoadingData(false);
        }
      }
    };

    performAutoSync();

    // Re-sync when returning to the app window/tab
    let lastSync = Date.now();
    const handleFocusOrVisibility = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync > 30000) {
        lastSync = Date.now();
        refreshLibrary();
      }
    };

    // Periodic background sync every 4 minutes while app is running
    const syncInterval = setInterval(() => {
      if (document.visibilityState === 'visible' && jellyfinClient.isAuthenticated()) {
        lastSync = Date.now();
        refreshLibrary();
      }
    }, 4 * 60 * 1000);

    window.addEventListener('visibilitychange', handleFocusOrVisibility);
    window.addEventListener('focus', handleFocusOrVisibility);

    return () => {
      isMounted = false;
      clearInterval(syncInterval);
      window.removeEventListener('visibilitychange', handleFocusOrVisibility);
      window.removeEventListener('focus', handleFocusOrVisibility);
    };
  }, []);

  // Offline (server unreachable): try again every minute and as soon as the device reconnects, so the app
  // leaves offline mode by itself (and sends the watch progress made offline).
  useEffect(() => {
    if (libraryStatus !== 'error') return;
    const retry = () => {
      if (navigator.onLine !== false && jellyfinClient.getConfig().serverUrl) refreshLibrary();
    };
    const timer = setInterval(retry, 60_000);
    window.addEventListener('online', retry);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', retry);
    };
  }, [libraryStatus]);

  return (
    <AppStateContext.Provider
      value={{
        activeTab,
        setActiveTab,
        activeVideo,
        playVideo,
        closeVideo,
        activeAudio,
        isAudioPlaying,
        audioQueue,
        audioQueueIndex,
        audioCurrentTime,
        audioDuration,
        lyrics,
        playAudio,
        toggleAudioPlayPause,
        nextAudioTrack,
        prevAudioTrack,
        setAudioProgress,
        isMusicFullScreen,
        setIsMusicFullScreen,
        closeMusicPlayer,
        isAudioMuted,
        toggleAudioMute,
        currentUser,
        allUsers,
        loadUsers,
        switchUser,
        isProfileSwitcherOpen,
        setIsProfileSwitcherOpen,
        transitioningUser,
        transitionPhase,
        transitionStartRect,
        triggerProfileSwitch,
        isServerConnectOpen,
        setIsServerConnectOpen,
        isSearchOpen,
        setIsSearchOpen,
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
        libraryStatus,
        isLoadingData,
        isConnectedToServer,
        serverName,
        refreshLibrary
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
};

export const useAppState = () => {
  const context = useContext(AppStateContext);
  if (!context) {
    throw new Error('useAppState must be used within an AppStateProvider');
  }
  return context;
};
