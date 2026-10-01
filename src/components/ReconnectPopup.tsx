import React, { useEffect, useState } from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { focusInside } from '../navigation/pageFocus';
import { RefreshCw, LogIn, Server } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { FocusableButton } from './FocusableButton';
import { SadJellyfish } from './SadJellyfish';
import { hasAnyDownload } from '../services/downloads';
import { useDownloadsVersion } from '../hooks/useDownloads';

/**
 * "Reconnect required": shown when the server gave back no media at all ('empty') or the library could not be
 * loaded ('error' — sign-in expired, server unreachable). Offers sign in again / change server / try again.
 */
export const ReconnectPopup: React.FC = () => {
  const {
    libraryStatus,
    refreshLibrary,
    setIsProfileSwitcherOpen,
    setIsServerConnectOpen,
    isProfileSwitcherOpen,
    isServerConnectOpen,
    isLoadingData,
    activeTab,
    setActiveTab
  } = useAppState();
  const [dismissed, setDismissed] = useState(false);
  useDownloadsVersion(); // re-check once the downloads list has loaded
  // Offline (server unreachable) but there are downloads: open them instead of asking to reconnect
  const offlineWithDownloads = libraryStatus === 'error' && hasAnyDownload();
  useEffect(() => {
    if (offlineWithDownloads && activeTab !== 'downloads') setActiveTab('downloads');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offlineWithDownloads]);
  const visible =
    (libraryStatus === 'empty' || libraryStatus === 'error') &&
    !offlineWithDownloads &&
    !dismissed &&
    !isProfileSwitcherOpen &&
    !isServerConnectOpen;

  // A new result (e.g. after "Try again") can show the pop-up again
  useEffect(() => setDismissed(false), [libraryStatus]);

  const { ref, focusKey } = useFocusable({ focusKey: 'RECONNECT_POPUP', isFocusBoundary: true, focusable: visible });
  // Retry until the remote is really inside: at start-up the app's own "focus the home page" runs after us
  useEffect(() => {
    if (visible) focusInside('RECONNECT_POPUP', ['RECONNECT_SIGNIN_BTN'], 14, 150);
  }, [visible]);

  if (!visible) return null;

  const empty = libraryStatus === 'empty';
  return (
    <FocusContext.Provider value={focusKey}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="reconnect-title"
        style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, zIndex: 9700, background: 'rgba(5, 7, 12, 0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
      >
        <div
          ref={ref}
          data-focus-key="RECONNECT_POPUP"
          style={{
            width: '100%',
            maxWidth: 480,
            background: '#0f131d',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 26,
            padding: '28px 28px 24px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 12,
            boxShadow: '0 30px 80px rgba(0,0,0,0.7)'
          }}
        >
          <SadJellyfish size={170} />
          <h2 id="reconnect-title" style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: '#fff' }}>
            Reconnect required
          </h2>
          <p style={{ margin: 0, fontSize: '0.98rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.7)' }}>
            {empty
              ? 'Your server answered, but there are no movies, series or music for this profile. Sign in again, or choose another server.'
              : 'Yudia couldn’t load your library: the sign-in may have expired, or the server is unreachable.'}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 8 }}>
            <FocusableButton
              focusKey="RECONNECT_SIGNIN_BTN"
              onPress={() => {
                setDismissed(true);
                setIsProfileSwitcherOpen(true);
              }}
              style={{ background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)', color: 'var(--accent-contrast)', border: 'none', fontWeight: 800 }}
            >
              <LogIn size={18} /> <span>Sign in again</span>
            </FocusableButton>
            <FocusableButton
              focusKey="RECONNECT_SERVER_BTN"
              onPress={() => {
                setDismissed(true);
                setIsServerConnectOpen(true);
              }}
            >
              <Server size={18} /> <span>Change server</span>
            </FocusableButton>
            <FocusableButton focusKey="RECONNECT_RETRY_BTN" onPress={() => refreshLibrary()} disabled={isLoadingData}>
              <RefreshCw size={18} /> <span>{isLoadingData ? 'Checking…' : 'Try again'}</span>
            </FocusableButton>
          </div>
        </div>
      </div>
    </FocusContext.Provider>
  );
};
