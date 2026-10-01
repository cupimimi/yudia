import React, { useState, useEffect } from 'react';
import { AvatarImg } from './AvatarImg';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import {
  Server,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Sliders,
  Tv,
  MessageSquare,
  Palette,
  HardDrive,
  User,
  LogOut,
  Play,
  Volume2,
  Clock,
  Sparkles,
  Wifi,
  ChevronRight,
  ShieldCheck,
  AlertTriangle,
  Zap,
  Info,
  Download,
  Trash2
} from 'lucide-react';
import { jellyfinClient } from '../api/jellyfin';
import { FocusableButton } from './FocusableButton';
import { FocusableInput } from './FocusableInput';
import { useAppState } from '../state/AppStateContext';
import { RatingsInfoPanel } from './RatingsInfoPanel';
import { downloadsSupported, storageEstimate, listDownloads, removeAllDownloads } from '../services/downloads';
import { useDownloadsVersion, formatBytes } from '../hooks/useDownloads';
import { ACCENTS, applyAccent, resolveAccent } from '../theme/accent';
import { applyPerformanceMode, isTizen, PerformanceMode } from '../theme/performance';

export interface StreamingSettings {
  maxBitrate: string;
  audioOutput: string;
  autoPlayNext: boolean;
  autoSkipIntro: boolean;
  showContentAdvisory: boolean;
  preloadSeconds: number;
  performanceMode: 'auto' | 'smooth' | 'full';
  defaultSpeed: string;
  audioLanguage: string;
  subtitleLanguage: string;
  subtitleSize: string;
  subtitleStyle: string;
  themeColor: string;
  clockFormat: string;
  ambientGlow: string;
  navSounds: boolean;
  downloadQuality: string;
  downloadWifiOnly: boolean;
  downloadKeepEpisodes: number;
  downloadDeleteWatched: boolean;
}

const DEFAULT_SETTINGS: StreamingSettings = {
  maxBitrate: 'auto',
  audioOutput: 'direct',
  autoPlayNext: true,
  autoSkipIntro: true,
  showContentAdvisory: true,
  preloadSeconds: 60,
  performanceMode: 'auto',
  defaultSpeed: '1.0x',
  audioLanguage: 'English',
  subtitleLanguage: 'Off',
  subtitleSize: 'normal',
  subtitleStyle: 'boxed',
  themeColor: 'cyan',
  clockFormat: '24h',
  ambientGlow: 'vibrant',
  navSounds: true,
  downloadQuality: '720p',
  downloadWifiOnly: true,
  downloadKeepEpisodes: 2,
  downloadDeleteWatched: true
};

export const SettingsView: React.FC = () => {
  const {
    refreshLibrary,
    setActiveTab,
    currentUser,
    setIsProfileSwitcherOpen,
    isConnectedToServer
  } = useAppState();

  const [activeCategory, setActiveCategory] = useState<'server' | 'playback' | 'subtitles' | 'ratings' | 'display' | 'downloads' | 'system'>('playback');

  // Load and persist settings
  const [settings, setSettings] = useState<StreamingSettings>(() => {
    try {
      const saved = localStorage.getItem('jellyfin_streaming_settings');
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  });

  const updateSetting = <K extends keyof StreamingSettings>(key: K, value: StreamingSettings[K]) => {
    setSettings((prev) => {
      const updated = { ...prev, [key]: value };
      try {
        localStorage.setItem('jellyfin_streaming_settings', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  // Server credentials & test state
  const [serverUrl, setServerUrl] = useState(() => jellyfinClient.getConfig().serverUrl || '');
  const [username, setUsername] = useState(() => jellyfinClient.getConfig().username || '');
  const [password, setPassword] = useState(() => {
    const config = jellyfinClient.getConfig();
    if (config.username) {
      const cred = jellyfinClient.getStoredUserCredential(config.username);
      return cred?.password || '';
    }
    return '';
  });

  // Auto-fill password when known username typed
  useEffect(() => {
    if (username) {
      const cred = jellyfinClient.getStoredUserCredential(username);
      if (cred && cred.password) {
        setPassword(cred.password);
      }
    }
  }, [username]);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isError, setIsError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pingSuccess, setPingSuccess] = useState<string | null>(null);
  const [cacheCleared, setCacheCleared] = useState(false);

  const { ref, focusKey } = useFocusable({
    focusKey: 'SETTINGS_VIEW'
  });

  const handleTestPing = async () => {
    setLoading(true);
    setStatusMessage(null);
    setPingSuccess(null);
    setIsError(false);

    try {
      const start = Date.now();
      const info = await jellyfinClient.testServer(serverUrl);
      const latency = Date.now() - start;
      setPingSuccess(`Server Online (${latency}ms latency): "${info.serverName}" (v${info.version})`);
      setIsError(false);
    } catch (e: any) {
      setStatusMessage(e.message || 'Cannot reach Jellyfin server');
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleConnect = async () => {
    setLoading(true);
    setStatusMessage(null);
    setPingSuccess(null);
    setIsError(false);

    try {
      await jellyfinClient.authenticate(serverUrl, username, password);
      setStatusMessage(`Authenticated! Syncing library from ${serverUrl}...`);
      setIsError(false);

      await refreshLibrary();
      setStatusMessage(`Synced successfully! Welcome, ${username}.`);

      setTimeout(() => {
        setActiveTab('home');
      }, 1000);
    } catch (e: any) {
      setStatusMessage(e.message || 'Failed to authenticate with Jellyfin');
      setIsError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleClearCache = () => {
    try {
      // Purge cached posters or watch temp
      const keysToKeep = ['jellyfin_server_url', 'jellyfin_access_token', 'jellyfin_user_id', 'jellyfin_username', 'jellyfin_known_users', 'jellyfin_streaming_settings'];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && !keysToKeep.includes(k) && !k.startsWith('jellyfin_auth_')) {
          localStorage.removeItem(k);
        }
      }
      setCacheCleared(true);
      setTimeout(() => setCacheCleared(false), 3000);
    } catch (e) {}
  };

  const categories = [
    { id: 'playback', label: 'Streaming & Quality', icon: <Sliders size={18} /> },
    { id: 'subtitles', label: 'Audio & Subtitles', icon: <MessageSquare size={18} /> },
    { id: 'ratings', label: 'Ratings & Warnings', icon: <AlertTriangle size={18} /> },
    { id: 'display', label: 'TV Experience & Display', icon: <Palette size={18} /> },
    ...(downloadsSupported() ? [{ id: 'downloads' as const, label: 'Downloads', icon: <Download size={18} /> }] : []),
    { id: 'server', label: 'Server & Account', icon: <Server size={18} /> },
    { id: 'system', label: 'System & Diagnostics', icon: <HardDrive size={18} /> }
  ] as const;

  const getFirstPanelFocusKey = (categoryId: string) => {
    switch (categoryId) {
      case 'playback':
        return 'BITRATE_SEG_auto';
      case 'subtitles':
        return 'AUDIO_LANG_SEG_English';
      case 'ratings':
        return 'TOGGLE_Show_Age_Rating_&_Content_Warnings';
      case 'display':
        return 'THEME_cyan';
      case 'downloads':
        return 'DLQ_SEG_original';
      case 'server':
        return currentUser ? 'SETTINGS_SWITCH_USER_BTN' : 'SETTINGS_SERVER_URL';
      case 'system':
        return 'SETTINGS_PURGE_CACHE_BTN';
      default:
        return 'BITRATE_SEG_auto';
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        className="settings-layout"
        style={{
          display: 'flex',
          gap: '36px',
          maxWidth: '1200px',
          margin: '0 auto',
          paddingBottom: '100px',
          minHeight: '680px'
        }}
      >
        {/* LEFT SETTINGS CATEGORIES SIDEBAR */}
        <div
          className="settings-nav"
          style={{
            width: '280px',
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '8px'
          }}
        >
          <div style={{ padding: '0 12px 14px 12px' }}>
            <h1 style={{ fontSize: '1.9rem', fontWeight: 900, color: '#ffffff', letterSpacing: '-0.5px' }}>
              Settings
            </h1>
            <p style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
              Streaming preferences & client setup
            </p>
          </div>

          {categories.map((cat, idx) => {
            const isSelected = activeCategory === cat.id;
            return (
              <FocusableButton
                key={cat.id}
                focusKey={`SETTING_CAT_${cat.id}`}
                onPress={() => setActiveCategory(cat.id)}
                onArrowPress={(direction) => {
                  if (direction === 'left') {
                    setFocus('NAV_TAB_settings');
                    return false;
                  }
                  if (direction === 'right') {
                    setActiveCategory(cat.id);
                    setTimeout(() => {
                      setFocus(getFirstPanelFocusKey(cat.id));
                    }, 40);
                    return false;
                  }
                  return true;
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '14px',
                  padding: '14px 18px',
                  borderRadius: '16px',
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.16)' : 'transparent',
                  color: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.65)',
                  border: isSelected ? '1px solid rgba(255, 255, 255, 0.25)' : '1px solid transparent',
                  justifyContent: 'flex-start',
                  width: '100%',
                  textAlign: 'left'
                }}
              >
                <span style={{ color: isSelected ? 'var(--accent)' : 'inherit' }}>{cat.icon}</span>
                <span style={{ flex: 1 }}>{cat.label}</span>
                {isSelected && <ChevronRight size={16} color="var(--accent)" />}
              </FocusableButton>
            );
          })}

          {/* Connected User Profile Quick Preview */}
          {currentUser && (
            <div
              style={{
                marginTop: 'auto',
                padding: '16px',
                borderRadius: '18px',
                backgroundColor: 'rgba(255, 255, 255, 0.04)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                gap: '12px'
              }}
            >
              <AvatarImg
                src={currentUser.avatarUrl}
                alt={currentUser.name}
                style={{ width: '40px', height: '40px', borderRadius: '50%', objectFit: 'cover' }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <h4 style={{ fontSize: '0.9rem', fontWeight: 800, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {currentUser.name}
                </h4>
                <p style={{ fontSize: '0.72rem', color: '#10b981', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <ShieldCheck size={12} /> Active Profile
                </p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT SETTINGS PANEL CONTENT */}
        <div
          className="settings-panel"
          style={{
            flex: 1,
            backgroundColor: 'rgba(15, 18, 26, 0.75)',
            backdropFilter: 'blur(24px)',
            borderRadius: '28px',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            padding: '32px 36px',
            display: 'flex',
            flexDirection: 'column',
            gap: '28px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.5)'
          }}
        >
          {/* TAB 1: STREAMING & QUALITY */}
          {activeCategory === 'playback' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>Streaming & Playback Quality</h2>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                  Control video bitrates, audio formats, and auto-playback preferences for Smart TV playback.
                </p>
              </div>

              {/* Setting 1: Max Video Bitrate / Quality Mode */}
              <SettingCard
                title="Maximum Streaming Quality"
                description="Auto plays the original file when this TV can decode it, and converts only what it can't (e.g. audio). Pick a limit to save bandwidth."
              >
                <SegmentedControl
                  prefix="BITRATE_SEG"
                  onLeft={() => setFocus('SETTING_CAT_playback')}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: '4k', label: '4K UHD (80 Mbps)' },
                    { value: '1080p', label: '1080p (20 Mbps)' },
                    { value: '720p', label: '720p (8 Mbps)' },
                    { value: '480p', label: '480p (3 Mbps)' }
                  ]}
                  selected={settings.maxBitrate}
                  onSelect={(val) => {
                    updateSetting('maxBitrate', val);
                    try {
                      localStorage.setItem('jellyfin_selected_quality', val);
                    } catch (e) {}
                  }}
                />
              </SettingCard>

              {/* Setting 2: Audio Output Mode */}
              <SettingCard
                title="Audio Format Mode"
                description="Choose between raw lossless audio passthrough or surround sound downmixing."
              >
                <SegmentedControl
                  prefix="AUDIO_OUT_SEG"
                  onLeft={() => setFocus('SETTING_CAT_playback')}
                  options={[
                    { value: 'direct', label: 'Direct Play (Original)' },
                    { value: 'surround', label: 'Dolby 5.1 Surround' },
                    { value: 'stereo', label: 'Stereo (Night Mode)' }
                  ]}
                  selected={settings.audioOutput}
                  onSelect={(val) => updateSetting('audioOutput', val)}
                />
              </SettingCard>

              {/* Pre-load: have the start of a title ready before Play is pressed */}
              <SettingCard
                title="Pre-load Before Playing"
                description="While you look at a title (and during the credits for the next episode), Yudia downloads its first part so playback starts instantly. Uses more data; only for titles played in original quality."
              >
                <SegmentedControl
                  prefix="PRELOAD_SEG"
                  onLeft={() => setFocus('SETTING_CAT_playback')}
                  options={[
                    { value: '0', label: 'Off' },
                    { value: '30', label: '30 seconds' },
                    { value: '60', label: '1 minute' },
                    { value: '120', label: '2 minutes' }
                  ]}
                  selected={String(settings.preloadSeconds)}
                  onSelect={(val) => updateSetting('preloadSeconds', Number(val))}
                />
              </SettingCard>

              {/* Setting 3: Auto-Play Next Episode */}
              <SettingToggleCard
                title="Auto-Play Next Episode"
                description="Automatically begins the next episode in queue when credits begin rolling."
                checked={settings.autoPlayNext}
                onToggle={(val) => updateSetting('autoPlayNext', val)}
                onLeft={() => setFocus('SETTING_CAT_playback')}
              />

              {/* Setting 4: Auto-Skip Intros & Recaps */}
              <SettingToggleCard
                title="Auto-Skip TV Show Intros"
                description="Automatically skip detected opening credits and recap segments."
                checked={settings.autoSkipIntro}
                onToggle={(val) => updateSetting('autoSkipIntro', val)}
                onLeft={() => setFocus('SETTING_CAT_playback')}
              />

              {/* Setting: Content advisory popup */}
              <SettingToggleCard
                title="Show Age Rating & Content Warnings"
                description="When a title starts: its age rating and topics, then a photosensitive warning if it has flashing lights."
                checked={settings.showContentAdvisory}
                onToggle={(val) => updateSetting('showContentAdvisory', val)}
                onLeft={() => setFocus('SETTING_CAT_playback')}
              />

              {/* Setting 5: Default Playback Speed */}
              <SettingCard
                title="Default Playback Speed"
                description="Set the default playback speed for all movies and episodes."
              >
                <SegmentedControl
                  prefix="SPEED_SEG"
                  onLeft={() => setFocus('SETTING_CAT_playback')}
                  options={[
                    { value: '0.75x', label: '0.75x' },
                    { value: '1.0x', label: '1.0x (Normal)' },
                    { value: '1.25x', label: '1.25x' },
                    { value: '1.5x', label: '1.5x' }
                  ]}
                  selected={settings.defaultSpeed}
                  onSelect={(val) => updateSetting('defaultSpeed', val)}
                />
              </SettingCard>
            </div>
          )}

          {/* TAB 2: AUDIO & SUBTITLES */}
          {activeCategory === 'subtitles' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>Audio & Subtitles</h2>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                  Set default spoken track languages and customize subtitle appearance on your TV screen.
                </p>
              </div>

              {/* Setting 1: Preferred Audio Language */}
              <SettingCard
                title="Preferred Audio Language"
                description="Selected automatically when a video has it; otherwise the video's default track plays. Original = always the default track."
              >
                <SegmentedControl
                  prefix="AUDIO_LANG_SEG"
                  onLeft={() => setFocus('SETTING_CAT_subtitles')}
                  options={[
                    { value: 'English', label: 'English' },
                    { value: 'French', label: 'French' },
                    { value: 'German', label: 'German' },
                    { value: 'Italian', label: 'Italian' },
                    { value: 'Spanish', label: 'Spanish' },
                    { value: 'Japanese', label: 'Japanese' },
                    { value: 'Original', label: 'Original' }
                  ]}
                  selected={settings.audioLanguage}
                  onSelect={(val) => updateSetting('audioLanguage', val)}
                />
              </SettingCard>

              {/* Setting 2: Preferred Subtitle Language */}
              <SettingCard
                title="Default Subtitles"
                description="Automatically activate subtitle stream upon opening videos."
              >
                <SegmentedControl
                  prefix="SUB_LANG_SEG"
                  onLeft={() => setFocus('SETTING_CAT_subtitles')}
                  options={[
                    { value: 'Off', label: 'Off by default' },
                    { value: 'English', label: 'English' },
                    { value: 'French', label: 'French' },
                    { value: 'German', label: 'German' },
                    { value: 'Italian', label: 'Italian' },
                    { value: 'Spanish', label: 'Spanish' }
                  ]}
                  selected={settings.subtitleLanguage}
                  onSelect={(val) => updateSetting('subtitleLanguage', val)}
                />
              </SettingCard>

              {/* Setting 3: Subtitle Font Size */}
              <SettingCard
                title="Subtitle Font Size"
                description="Adjust text scaling for optimal legibility across distance."
              >
                <SegmentedControl
                  prefix="SUB_SIZE_SEG"
                  onLeft={() => setFocus('SETTING_CAT_subtitles')}
                  options={[
                    { value: 'normal', label: 'Standard (100%)' },
                    { value: 'medium', label: 'Medium (125%)' },
                    { value: 'large', label: 'Large (150%)' }
                  ]}
                  selected={settings.subtitleSize}
                  onSelect={(val) => updateSetting('subtitleSize', val)}
                />
              </SettingCard>

              {/* Setting 4: Subtitle Presentation Style */}
              <SettingCard
                title="Subtitle Background Box"
                description="Contrast styling for reading over bright scenes."
              >
                <SegmentedControl
                  prefix="SUB_STYLE_SEG"
                  onLeft={() => setFocus('SETTING_CAT_subtitles')}
                  options={[
                    { value: 'boxed', label: 'Semi-Transparent Box' },
                    { value: 'black', label: 'Solid Black Box' },
                    { value: 'shadow', label: 'Drop Shadow Only' }
                  ]}
                  selected={settings.subtitleStyle}
                  onSelect={(val) => updateSetting('subtitleStyle', val)}
                />
              </SettingCard>
            </div>
          )}

          {/* TAB 3: DISPLAY & TV UX */}
          {/* TAB: RATINGS & WARNINGS (info page for the age / content advisory popup) */}
          {activeCategory === 'ratings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>Ratings & Warnings</h2>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                  When a title starts, Yudia shows its age rating and content topics for a few seconds, then a photosensitive
                  warning if it has flashing lights.
                </p>
              </div>

              <SettingToggleCard
                title="Show Age Rating & Content Warnings"
                description="When a title starts: its age rating and topics, then a photosensitive warning if it has flashing lights."
                checked={settings.showContentAdvisory}
                onToggle={(val) => updateSetting('showContentAdvisory', val)}
                onLeft={() => setFocus('SETTING_CAT_ratings')}
              />

              <RatingsInfoPanel onLeft={() => setFocus('SETTING_CAT_ratings')} />
            </div>
          )}

          {activeCategory === 'display' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>TV Experience & Display</h2>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                  Tailor the aesthetic design, theme color accents, and ambient lighting of the TV player.
                </p>
              </div>

              {/* Setting 1: Theme Accent Color */}
              <SettingCard
                title="Interface Accent Color"
                description="Choose the highlight glow color for focused cards and action buttons."
              >
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  {ACCENTS.map((theme, idx) => {
                    const isSelected = resolveAccent(settings.themeColor).id === theme.id;
                    return (
                      <FocusableButton
                        key={theme.id}
                        focusKey={`THEME_${theme.id}`}
                        onPress={() => {
                          updateSetting('themeColor', theme.id);
                          applyAccent(theme.id); // repaint the whole app now
                        }}
                        onArrowPress={(dir) => {
                          if (dir === 'left' && idx === 0) {
                            setFocus('SETTING_CAT_display');
                            return false;
                          }
                          return true;
                        }}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                          padding: '8px 16px',
                          borderRadius: '14px',
                          backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.05)',
                          border: isSelected ? `2px solid ${theme.color}` : '1px solid rgba(255, 255, 255, 0.12)'
                        }}
                      >
                        <span style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: theme.color, boxShadow: `0 0 10px ${theme.color}` }} />
                        <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#fff' }}>{theme.label}</span>
                      </FocusableButton>
                    );
                  })}
                </div>
              </SettingCard>

              {/* Performance: Smooth mode drops GPU-heavy effects on TVs / The Freestyle */}
              <SettingCard
                title="Performance Mode"
                description={`Smooth turns off live background blur and endless decorative animations so the TV stays fluid; Full keeps every effect. Auto picks ${isTizen() ? 'Smooth on this TV' : 'Full on this device'}.`}
              >
                <SegmentedControl
                  prefix="PERF_SEG"
                  onLeft={() => setFocus('SETTING_CAT_display')}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'smooth', label: 'Smooth (TV)' },
                    { value: 'full', label: 'Full effects' }
                  ]}
                  selected={settings.performanceMode}
                  onSelect={(val) => {
                    updateSetting('performanceMode', val as PerformanceMode);
                    applyPerformanceMode(val as PerformanceMode); // takes effect immediately
                  }}
                />
              </SettingCard>

              {/* Setting 2: Clock Format */}
              <SettingCard
                title="Top Clock Display"
                description="Choose time formatting in the header navigation dock."
              >
                <SegmentedControl
                  prefix="CLOCK_SEG"
                  onLeft={() => setFocus('SETTING_CAT_display')}
                  options={[
                    { value: '24h', label: '24-Hour (17:45)' },
                    { value: '12h', label: '12-Hour (5:45 PM)' },
                    { value: 'off', label: 'Hidden' }
                  ]}
                  selected={settings.clockFormat}
                  onSelect={(val) => updateSetting('clockFormat', val)}
                />
              </SettingCard>

              {/* Setting 3: Ambient Backdrop Lighting */}
              <SettingCard
                title="Ambient Movie Backdrop Glow"
                description="Dynamic fluid lighting that mirrors poster and backdrop colors."
              >
                <SegmentedControl
                  prefix="AMBIENT_SEG"
                  onLeft={() => setFocus('SETTING_CAT_display')}
                  options={[
                    { value: 'vibrant', label: 'Vibrant Mesh Glow' },
                    { value: 'subtle', label: 'Subtle Dark' },
                    { value: 'none', label: 'Disabled' }
                  ]}
                  selected={settings.ambientGlow}
                  onSelect={(val) => updateSetting('ambientGlow', val)}
                />
              </SettingCard>

              {/* Setting 4: Remote Navigation Sounds */}
              <SettingToggleCard
                title="Remote Navigation Sound Effects"
                description="Audible click feedback when navigating cards using D-Pad."
                checked={settings.navSounds}
                onToggle={(val) => updateSetting('navSounds', val)}
                onLeft={() => setFocus('SETTING_CAT_display')}
              />
            </div>
          )}

          {/* TAB 4: SERVER & ACCOUNT */}
          {activeCategory === 'server' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>Server & Profile Connection</h2>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                  Manage server credentials, switch user accounts, and test network latency.
                </p>
              </div>

              {/* Active Profile Info Box */}
              {currentUser && (
                <div
                  style={{
                    padding: '20px 24px',
                    borderRadius: '20px',
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <AvatarImg
                      src={currentUser.avatarUrl}
                      alt={currentUser.name}
                      style={{ width: '52px', height: '52px', borderRadius: '50%', objectFit: 'cover', border: '2px solid var(--accent)' }}
                    />
                    <div>
                      <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>{currentUser.name}</h3>
                      <p style={{ fontSize: '0.82rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '5px' }}>
                        <CheckCircle2 size={13} /> Connected & Synchronized
                      </p>
                    </div>
                  </div>

                  <FocusableButton
                    focusKey="SETTINGS_SWITCH_USER_BTN"
                    onPress={() => setIsProfileSwitcherOpen(true)}
                    onArrowPress={(dir) => {
                      if (dir === 'left') {
                        setFocus('SETTING_CAT_server');
                        return false;
                      }
                      return true;
                    }}
                    style={{
                      padding: '10px 20px',
                      borderRadius: '14px',
                      fontSize: '0.9rem',
                      fontWeight: 700,
                      backgroundColor: 'rgba(255, 255, 255, 0.12)',
                      border: '1px solid rgba(255, 255, 255, 0.25)',
                      color: '#ffffff'
                    }}
                  >
                    Switch Profile
                  </FocusableButton>
                </div>
              )}

              {/* Alerts */}
              {pingSuccess && (
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '16px',
                    backgroundColor: 'rgba(52, 211, 153, 0.15)',
                    border: '1px solid #34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: '#ffffff'
                  }}
                >
                  <CheckCircle2 size={20} color="#34d399" />
                  <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{pingSuccess}</span>
                </div>
              )}

              {statusMessage && (
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '16px',
                    backgroundColor: isError ? 'rgba(239, 68, 68, 0.18)' : 'rgba(52, 211, 153, 0.15)',
                    border: `1px solid ${isError ? '#ef4444' : '#34d399'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: '#ffffff'
                  }}
                >
                  {isError ? <AlertCircle size={20} color="#ef4444" /> : <CheckCircle2 size={20} color="#34d399" />}
                  <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>{statusMessage}</span>
                </div>
              )}

              {/* Server URL Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)' }}>
                  Jellyfin Server Host Address
                </label>
                <FocusableInput
                  focusKeyId="SETTINGS_SERVER_URL"
                  type="text"
                  value={serverUrl}
                  onChange={(e) => setServerUrl(e.target.value)}
                  placeholder="https://jellyfin.example.com"
                  onArrowPress={(dir) => {
                    if (dir === 'left') {
                      setFocus('SETTING_CAT_server');
                      return false;
                    }
                    return true;
                  }}
                />
              </div>

              {/* Username Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)' }}>
                  User Profile Name
                </label>
                <FocusableInput
                  focusKeyId="SETTINGS_USERNAME"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  onArrowPress={(dir) => {
                    if (dir === 'left') {
                      setFocus('SETTING_CAT_server');
                      return false;
                    }
                    return true;
                  }}
                />
              </div>

              {/* Password Input */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label style={{ fontSize: '0.9rem', fontWeight: 700, color: 'rgba(255, 255, 255, 0.85)' }}>
                  Password (if set)
                </label>
                <FocusableInput
                  focusKeyId="SETTINGS_PASSWORD"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  onArrowPress={(dir) => {
                    if (dir === 'left') {
                      setFocus('SETTING_CAT_server');
                      return false;
                    }
                    return true;
                  }}
                />
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', gap: '14px', marginTop: '10px' }}>
                <FocusableButton
                  focusKey="SETTINGS_TEST_PING_BTN"
                  onPress={handleTestPing}
                  disabled={loading}
                  onArrowPress={(dir) => {
                    if (dir === 'left') {
                      setFocus('SETTING_CAT_server');
                      return false;
                    }
                    return true;
                  }}
                  style={{
                    flex: 1,
                    padding: '14px',
                    borderRadius: '16px',
                    fontWeight: 700,
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    border: '1px solid rgba(255, 255, 255, 0.2)',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px'
                  }}
                >
                  <Wifi size={18} /> Test Server Reachability
                </FocusableButton>

                <FocusableButton
                  focusKey="SETTINGS_SAVE_CONNECT_BTN"
                  onPress={handleConnect}
                  disabled={loading}
                  onArrowPress={(dir) => {
                    if (dir === 'left') {
                      setFocus('SETTINGS_TEST_PING_BTN');
                      return false;
                    }
                    return true;
                  }}
                  style={{
                    flex: 1.3,
                    padding: '14px',
                    borderRadius: '16px',
                    fontWeight: 800,
                    backgroundColor: 'var(--accent)',
                    color: 'var(--accent-contrast)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '10px',
                    boxShadow: '0 4px 20px rgba(var(--accent-rgb), 0.35)'
                  }}
                >
                  {loading ? <RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18} />}
                  Connect & Synchronize Library
                </FocusableButton>
              </div>
            </div>
          )}

          {/* DOWNLOADS (website only) */}
          {activeCategory === 'downloads' && <DownloadSettingsPanel settings={settings} updateSetting={updateSetting} />}

          {/* TAB 5: SYSTEM & DIAGNOSTICS */}
          {activeCategory === 'system' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
              <div>
                <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>System & Storage Diagnostics</h2>
                <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                  Inspect client build information, storage footprint, and clean local artwork cache.
                </p>
              </div>

              {cacheCleared && (
                <div
                  style={{
                    padding: '14px 18px',
                    borderRadius: '16px',
                    backgroundColor: 'rgba(52, 211, 153, 0.15)',
                    border: '1px solid #34d399',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    color: '#ffffff'
                  }}
                >
                  <CheckCircle2 size={20} color="#34d399" />
                  <span style={{ fontWeight: 600, fontSize: '0.92rem' }}>Local image and metadata cache successfully cleared!</span>
                </div>
              )}

              {/* System Spec Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px' }}>
                <SpecTile label="Application" value="Jellyfin Tizen TV" sub="v2.4.2 Production" />
                <SpecTile label="Target OS" value="Smart TV / Tizen OS" sub="WebEngine 94+" />
                <SpecTile label="Video Engine" value="HTML5 MSE / Direct" sub="H.264, HEVC, AV1" />
                <SpecTile label="Audio Engine" value="Lossless Audio Engine" sub="FLAC, ALAC, AAC, MP3" />
              </div>

              {/* Cache Cleaning Card */}
              <div
                style={{
                  padding: '24px',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.04)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div>
                  <h4 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#ffffff' }}>Cached Posters & Artwork</h4>
                  <p style={{ fontSize: '0.82rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
                    Frees up local TV device storage by wiping downloaded cached thumbnails and temp sessions.
                  </p>
                </div>

                <FocusableButton
                  focusKey="SETTINGS_PURGE_CACHE_BTN"
                  onPress={handleClearCache}
                  onArrowPress={(dir) => {
                    if (dir === 'left') {
                      setFocus('SETTING_CAT_system');
                      return false;
                    }
                    return true;
                  }}
                  style={{
                    padding: '11px 22px',
                    borderRadius: '14px',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    backgroundColor: 'rgba(239, 68, 68, 0.15)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    color: '#ef4444'
                  }}
                >
                  Clear Cached Media
                </FocusableButton>
              </div>

              {/* Session / Token Details */}
              <div
                style={{
                  padding: '18px',
                  borderRadius: '16px',
                  backgroundColor: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                  fontSize: '0.8rem',
                  color: 'rgba(255, 255, 255, 0.5)',
                  lineHeight: 1.6
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Session Device ID:</span>
                  <span style={{ color: 'rgba(255, 255, 255, 0.8)', fontFamily: 'monospace' }}>
                    {jellyfinClient.getConfig().deviceId || 'device-tv-master'}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px' }}>
                  <span>Active Server:</span>
                  <span style={{ color: 'rgba(255, 255, 255, 0.8)' }}>
                    {jellyfinClient.getConfig().serverUrl || 'None'}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </FocusContext.Provider>
  );
};

/* Setting Card Wrapper */
const SettingCard: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => {
  return (
    <div
      style={{
        padding: '20px 24px',
        borderRadius: '20px',
        backgroundColor: 'rgba(255, 255, 255, 0.04)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px'
      }}
    >
      <div>
        <h3 style={{ fontSize: '1.02rem', fontWeight: 700, color: '#ffffff' }}>{title}</h3>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '2px' }}>{description}</p>
      </div>
      <div>{children}</div>
    </div>
  );
};

/* Toggle Setting Card Component */
const SettingToggleCard: React.FC<{
  title: string;
  description: string;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onLeft?: () => void;
}> = ({ title, description, checked, onToggle, onLeft }) => {
  const { ref, focused } = useFocusable({
    focusKey: `TOGGLE_${title.replace(/\s+/g, '_')}`,
    onEnterPress: () => onToggle(!checked),
    onArrowPress: (direction) => {
      if (direction === 'left' && onLeft) {
        onLeft();
        return false;
      }
      return true;
    }
  });

  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focused]);

  return (
    <div
      ref={ref}
      onClick={() => onToggle(!checked)}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        padding: '18px 24px',
        borderRadius: '20px',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.12)' : 'rgba(255, 255, 255, 0.04)',
        border: focused ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.08)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        cursor: 'pointer',
        transition: 'all 0.2s ease'
      }}
    >
      <div>
        <h3 style={{ fontSize: '1.02rem', fontWeight: 700, color: '#ffffff' }}>{title}</h3>
        <p style={{ fontSize: '0.8rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '2px' }}>{description}</p>
      </div>

      {/* Modern Switch Toggle */}
      <div
        style={{
          width: '52px',
          height: '28px',
          borderRadius: '14px',
          backgroundColor: checked ? 'var(--accent)' : 'rgba(255, 255, 255, 0.15)',
          position: 'relative',
          transition: 'background-color 0.25s ease',
          boxShadow: checked ? '0 0 12px rgba(var(--accent-rgb), 0.4)' : 'none',
          flexShrink: 0
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '3px',
            left: checked ? '27px' : '3px',
            width: '22px',
            height: '22px',
            borderRadius: '50%',
            backgroundColor: checked ? '#000000' : '#ffffff',
            transition: 'left 0.25s ease',
            boxShadow: '0 2px 6px rgba(0,0,0,0.4)'
          }}
        />
      </div>
    </div>
  );
};

/* Segmented Control Component */
const SegmentedControl: React.FC<{
  prefix?: string;
  options: { value: string; label: string }[];
  selected: string;
  onSelect: (value: string) => void;
  onLeft?: () => void;
}> = ({ prefix = 'SEG', options, selected, onSelect, onLeft }) => {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '8px'
      }}
    >
      {options.map((opt, idx) => {
        const isSelected = selected === opt.value;
        return (
          <FocusableButton
            key={opt.value}
            focusKey={`${prefix}_${opt.value}`}
            onPress={() => onSelect(opt.value)}
            onArrowPress={(direction) => {
              if (direction === 'left' && idx === 0 && onLeft) {
                onLeft();
                return false;
              }
              return true;
            }}
            style={{
              padding: '8px 16px',
              borderRadius: '12px',
              fontSize: '0.86rem',
              fontWeight: 700,
              backgroundColor: isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.08)',
              color: isSelected ? '#000000' : 'rgba(255, 255, 255, 0.8)',
              border: isSelected ? '1px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.12)',
              boxShadow: isSelected ? '0 2px 10px rgba(255,255,255,0.2)' : 'none'
            }}
          >
            {opt.label}
          </FocusableButton>
        );
      })}
    </div>
  );
};

/* Diagnostic Spec Tile */
const SpecTile: React.FC<{ label: string; value: string; sub: string }> = ({ label, value, sub }) => (
  <div
    style={{
      padding: '16px 20px',
      borderRadius: '16px',
      backgroundColor: 'rgba(255, 255, 255, 0.04)',
      border: '1px solid rgba(255, 255, 255, 0.08)'
    }}
  >
    <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.8px', color: 'rgba(255, 255, 255, 0.45)', fontWeight: 700 }}>
      {label}
    </span>
    <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#fff', marginTop: '4px' }}>{value}</h4>
    <p style={{ fontSize: '0.75rem', color: 'var(--accent)', marginTop: '2px', fontWeight: 600 }}>{sub}</p>
  </div>
);

/** Settings → Downloads: quality, auto-download behaviour, space used, delete all. */
const DownloadSettingsPanel: React.FC<{
  settings: StreamingSettings;
  updateSetting: <K extends keyof StreamingSettings>(key: K, value: StreamingSettings[K]) => void;
}> = ({ settings, updateSetting }) => {
  const version = useDownloadsVersion();
  const [space, setSpace] = useState<{ used: number; quota: number; downloads: number } | null>(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    storageEstimate().then(setSpace);
  }, [version]);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  const back = () => setFocus('SETTING_CAT_downloads');
  const count = listDownloads().filter((e) => e.status === 'done').length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '26px' }}>
      <div>
        <h2 style={{ fontSize: '1.45rem', fontWeight: 800, color: '#ffffff' }}>Downloads</h2>
        <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.6)', marginTop: '4px' }}>
          Keep movies, episodes and music on this device to watch or listen without a connection. Watch progress made offline is sent to your server when you're back online.
        </p>
      </div>

      <SettingCard
        title="Download Quality (video)"
        description="Original = the untouched file when this device can play it (best picture, largest). Otherwise your server converts it to a smaller MP4: 1080p ≈ 3.6 GB per hour, 720p ≈ 1.6 GB, 480p ≈ 0.7 GB. Music always downloads in the best format this device can play."
      >
        <SegmentedControl
          prefix="DLQ_SEG"
          onLeft={back}
          options={[
            { value: 'original', label: 'Original' },
            { value: '1080p', label: '1080p' },
            { value: '720p', label: '720p' },
            { value: '480p', label: '480p' }
          ]}
          selected={settings.downloadQuality}
          onSelect={(val) => updateSetting('downloadQuality', val)}
        />
      </SettingCard>

      <SettingCard
        title="Auto-download: Next Episodes to Keep"
        description="For series with Auto-download on: how many upcoming unwatched episodes stay ready on this device."
      >
        <SegmentedControl
          prefix="DLK_SEG"
          onLeft={back}
          options={[
            { value: '1', label: '1' },
            { value: '2', label: '2' },
            { value: '3', label: '3' },
            { value: '5', label: '5' }
          ]}
          selected={String(settings.downloadKeepEpisodes)}
          onSelect={(val) => updateSetting('downloadKeepEpisodes', Number(val))}
        />
      </SettingCard>

      <SettingToggleCard
        title="Remove Watched Episodes"
        description="Auto-downloaded episodes are removed once watched, and the next one is downloaded in their place."
        checked={settings.downloadDeleteWatched}
        onToggle={(val) => updateSetting('downloadDeleteWatched', val)}
        onLeft={back}
      />

      <SettingToggleCard
        title="Auto-download on Wi-Fi Only"
        description="Auto-downloads wait for Wi-Fi when the phone reports mobile data. Downloads you start yourself always run."
        checked={settings.downloadWifiOnly}
        onToggle={(val) => updateSetting('downloadWifiOnly', val)}
        onLeft={back}
      />

      <SettingCard
        title="Storage"
        description={
          space
            ? `${count} download${count === 1 ? '' : 's'} using ${formatBytes(space.downloads)}${space.quota ? ` · ${formatBytes(Math.max(0, space.quota - space.used))} still available to Yudia on this device` : ''}.`
            : 'Checking…'
        }
      >
        <FocusableButton
          focusKey="DL_DELETE_ALL_BTN"
          onPress={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            removeAllDownloads();
          }}
          onArrowPress={(dir) => {
            if (dir === 'left') {
              back();
              return false;
            }
            return true;
          }}
          style={armed ? { color: '#ff6b6b', borderColor: '#ff6b6b' } : undefined}
        >
          <Trash2 size={18} />
          <span>{armed ? 'Press again to delete everything' : 'Delete all downloads'}</span>
        </FocusableButton>
      </SettingCard>
    </div>
  );
};
