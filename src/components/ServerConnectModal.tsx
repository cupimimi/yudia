import React, { useState, useEffect } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Server, Sparkles, CheckCircle2, AlertCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { jellyfinClient } from '../api/jellyfin';
import { YudiaLogo } from './YudiaLogo';
import { FocusableInput } from './FocusableInput';
import { isBlockedMixedContent, normalizeServerUrl } from '../config/server';
import { useAppState } from '../state/AppStateContext';
import { FocusableButton } from './FocusableButton';

interface ServerConnectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConnected: () => void;
}

export const ServerConnectModal: React.FC<ServerConnectModalProps> = ({
  isOpen,
  onClose,
  onConnected
}) => {
  const { loadUsers, setIsProfileSwitcherOpen, refreshLibrary } = useAppState();
  // Last server used on this device, or the build's default (none on the website: friends enter their own).
  const [serverUrl, setServerUrl] = useState(() => jellyfinClient.getConfig().serverUrl || '');
  const [isConnecting, setIsConnecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<string | null>(null);

  const { ref, focusKey } = useFocusable({
    focusKey: 'SERVER_CONNECT_MODAL',
    isFocusBoundary: true,
    // Only while shown: when closed it must not catch the remote (← on a page used to jump into it)
    focusable: isOpen
  });

  // Automatically focus the Connect button with the TV remote on open
  useEffect(() => {
    if (isOpen) {
      // Empty address → start on the field (OK opens the TV keyboard); otherwise on Connect.
      const timer = setTimeout(() => {
        setFocus(jellyfinClient.getConfig().serverUrl ? 'CONNECT_SERVER_SUBMIT_BTN' : 'CONNECT_SERVER_URL_INPUT');
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Already signed in to a server ("Change server")? Then Back / Cancel returns to the app. On the very first
  // start there is nothing to go back to, so the screen stays until a server is connected.
  const canCancel = !!jellyfinClient.getConfig().accessToken;
  useEffect(() => {
    if (!isOpen || !canCancel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.keyCode === 27 || e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, canCancel, onClose]);

  if (!isOpen) return null;

  const handleConnect = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!serverUrl.trim()) return;

    setIsConnecting(true);
    setErrorMessage(null);
    setSuccessInfo(null);

    try {
      const cleanUrl = normalizeServerUrl(serverUrl);
      setServerUrl(cleanUrl);
      if (isBlockedMixedContent(cleanUrl)) {
        throw new Error(
          `This page is secure (https), so the browser blocks the unsecured address ${cleanUrl}. Use your server's https address (e.g. https://jellyfin.yourdomain.com).`
        );
      }
      const info = await jellyfinClient.testServer(cleanUrl);
      setSuccessInfo(`Connected to "${info.serverName}" (v${info.version})`);

      // New server → forget the sign-in from the previous one (its token means nothing here)
      const previous = normalizeServerUrl(jellyfinClient.getConfig().serverUrl || '');
      if (previous !== cleanUrl) {
        jellyfinClient.setConfig({ serverUrl: cleanUrl, accessToken: '', userId: '', username: '' });
      } else {
        jellyfinClient.setConfig({ serverUrl: cleanUrl });
      }

      // Fetch server users
      await loadUsers();

      // Seamlessly transition to Profile Selection screen ("Who is watching?")
      setTimeout(() => {
        setIsConnecting(false);
        onConnected();
        setIsProfileSwitcherOpen(true);
      }, 700);
    } catch (err: any) {
      setIsConnecting(false);
      setErrorMessage(
        err.message || 'Cannot reach Jellyfin server. Please verify address and CORS/SSL settings.'
      );
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 9900,
          backgroundColor: 'rgba(5, 7, 12, 0.96)',
          backdropFilter: 'blur(36px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px'
        }}
      >
        {/* Ambient background glow */}
        <div
          style={{
            position: 'absolute',
            width: '600px',
            height: '600px',
            borderRadius: '50%',
            background: 'radial-gradient(circle, rgba(var(--accent-rgb), 0.15) 0%, rgba(168, 85, 247, 0.1) 50%, transparent 70%)',
            filter: 'blur(70px)',
            pointerEvents: 'none'
          }}
        />

        <div
          style={{
            width: '100%',
            maxWidth: '580px',
            backgroundColor: 'rgba(18, 22, 34, 0.88)',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            borderRadius: '28px',
            padding: '40px 44px',
            boxShadow: '0 25px 60px rgba(0, 0, 0, 0.85), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
            position: 'relative',
            zIndex: 2,
            textAlign: 'center'
          }}
        >
          {/* Yudia logo */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '0 auto 22px auto' }}>
            <YudiaLogo size={56} />
          </div>

          <h1
            style={{
              fontSize: '2rem',
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: '-0.5px',
              margin: '0 0 8px 0'
            }}
          >
            Connect your Jellyfin server
          </h1>

          <p
            style={{
              fontSize: '0.95rem',
              color: 'rgba(255, 255, 255, 0.65)',
              margin: '0 0 28px 0',
              lineHeight: 1.5
            }}
          >
            Enter your self-hosted Jellyfin address to discover user profiles and stream your media.
          </p>

          {/* Success Message */}
          {successInfo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                borderRadius: '14px',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                color: '#10b981',
                fontSize: '0.88rem',
                fontWeight: 600,
                marginBottom: '20px',
                textAlign: 'left'
              }}
            >
              <CheckCircle2 size={18} />
              <span>{successInfo}</span>
            </div>
          )}

          {/* Error Message */}
          {errorMessage && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '12px 16px',
                borderRadius: '14px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.4)',
                color: '#ef4444',
                fontSize: '0.85rem',
                marginBottom: '20px',
                textAlign: 'left'
              }}
            >
              <AlertCircle size={18} />
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleConnect}>
            <div style={{ marginBottom: '22px', textAlign: 'left' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  color: 'rgba(255, 255, 255, 0.6)',
                  marginBottom: '8px'
                }}
              >
                Server Address URL
              </label>
              <FocusableInput
                focusKeyId="CONNECT_SERVER_URL_INPUT"
                type="url"
                inputMode="url"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="jellyfin.example.com or 192.168.1.20:8096"
                disabled={isConnecting}
                style={{
                  width: '100%',
                  padding: '14px 18px',
                  borderRadius: '14px',
                  border: '1.5px solid rgba(255, 255, 255, 0.15)',
                  backgroundColor: 'rgba(255, 255, 255, 0.05)',
                  color: '#ffffff',
                  fontSize: '1rem',
                  boxSizing: 'border-box',
                  outline: 'none',
                  transition: 'border-color 0.2s ease'
                }}
                onFocus={(e) => (e.target.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.target.style.borderColor = 'rgba(255, 255, 255, 0.15)')}
              />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <ConnectSubmitButton
                focusKeyId="CONNECT_SERVER_SUBMIT_BTN"
                isConnecting={isConnecting}
                onClick={handleConnect}
              />
              {canCancel && (
                <FocusableButton focusKey="CONNECT_SERVER_CANCEL_BTN" onPress={onClose} style={{ justifyContent: 'center', width: '100%' }}>
                  Cancel
                </FocusableButton>
              )}

            </div>
          </form>
        </div>
      </div>
    </FocusContext.Provider>
  );
};

const ConnectSubmitButton: React.FC<{
  focusKeyId: string;
  isConnecting: boolean;
  onClick: () => void;
}> = ({ focusKeyId, isConnecting, onClick }) => {
  const { ref, focused } = useFocusable({
    focusKey: focusKeyId,
    onEnterPress: onClick
  });

  return (
    <button
      ref={ref}
      onClick={onClick}
      disabled={isConnecting}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        width: '100%',
        padding: '15px 24px',
        borderRadius: '14px',
        border: focused ? '2px solid #ffffff' : 'none',
        background: 'linear-gradient(135deg, var(--accent) 0%, var(--accent-2) 100%)',
        color: '#07090e',
        fontSize: '1.05rem',
        fontWeight: 800,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        cursor: 'pointer',
        boxShadow: focused
          ? '0 0 30px rgba(var(--accent-rgb), 0.8), 0 8px 24px rgba(0, 0, 0, 0.5)'
          : '0 4px 18px rgba(var(--accent-rgb), 0.3)',
        transform: focused ? 'scale(1.02)' : 'scale(1)',
        transition: 'all 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)'
      }}
    >
      <span>{isConnecting ? 'Testing Connection...' : 'Connect & Find Profiles'}</span>
      <ArrowRight size={18} />
    </button>
  );
};
