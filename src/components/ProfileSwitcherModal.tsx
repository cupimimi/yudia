import React, { useState, useEffect } from 'react';
import { AvatarImg } from './AvatarImg';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { focusInside } from '../navigation/pageFocus';

const MODAL = 'PROFILE_SWITCHER_MODAL';
import { User, Check, Lock, Shield, UserPlus, X, KeyRound, AlertCircle, Loader2, Sparkles, Server } from 'lucide-react';
import { useAppState } from '../state/AppStateContext';
import { JellyfinUser, jellyfinClient } from '../api/jellyfin';
import { StartRect } from './ProfileTransitionOverlay';
import { FocusableButton } from './FocusableButton';
import { FocusableInput } from './FocusableInput';

interface ProfileSwitcherModalProps {
  onClose: () => void;
}

export const ProfileSwitcherModal: React.FC<ProfileSwitcherModalProps> = ({ onClose }) => {
  const { allUsers, currentUser, triggerProfileSwitch, isLoadingData, setIsServerConnectOpen } = useAppState();

  const [selectedUser, setSelectedUser] = useState<JellyfinUser | null>(null);
  const [password, setPassword] = useState('');
  const [clickedRect, setClickedRect] = useState<StartRect | null>(null);
  const [showPasswordPrompt, setShowPasswordPrompt] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Manual login modal state
  const [isManualLogin, setIsManualLogin] = useState(false);
  const [customUsername, setCustomUsername] = useState('');

  // Auto-fill manual password if username is known
  useEffect(() => {
    if (customUsername) {
      const cred = jellyfinClient.getStoredUserCredential(customUsername);
      if (cred && cred.password) {
        setPassword(cred.password);
      }
    }
  }, [customUsername]);

  const { ref, focusKey } = useFocusable({
    focusKey: 'PROFILE_SWITCHER_MODAL',
    isFocusBoundary: true
  });

  // Focus the first profile card (or active profile card) on modal open
  useEffect(() => {
    const activeIdx = allUsers.findIndex(
      (u) => currentUser?.id === u.id || currentUser?.name.toLowerCase() === u.name.toLowerCase()
    );
    focusInside(MODAL, [activeIdx >= 0 ? `PROFILE_CARD_${activeIdx}` : 'PROFILE_CARD_0', 'PROFILE_CARD_0']);
  }, [allUsers, currentUser]);

  // Handle D-pad Return / Escape keys
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.keyCode === 10009 || e.key === 'Escape') {
        e.preventDefault();
        // Runs first (capture) and stops every other Back handler: Back in the sign-in form must only close
        // the form — the app's global Back used to close the whole profile screen at the same time.
        e.stopImmediatePropagation();
        if (showPasswordPrompt) {
          setShowPasswordPrompt(false);
          focusInside(MODAL, ['PROFILE_CARD_0']);
          return;
        }
        if (isManualLogin) {
          setIsManualLogin(false);
          focusInside(MODAL, [`PROFILE_CARD_${allUsers.length}`, 'PROFILE_CARD_0']);
          return;
        }
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [showPasswordPrompt, isManualLogin, onClose, allUsers.length]);

  const handleSelectProfile = async (user: JellyfinUser, rect?: StartRect | null) => {
    setSelectedUser(user);
    if (rect) setClickedRect(rect);
    setAuthError(null);

    const hasStoredCred = jellyfinClient.hasStoredCredential(user.id) || jellyfinClient.hasStoredCredential(user.name);

    // If user has already been connected before (credentials in cookies/storage) or has no password
    if (hasStoredCred || !user.hasPassword) {
      try {
        await triggerProfileSwitch(user, undefined, rect || clickedRect);
      } catch (e: any) {
        setAuthError(e.message || 'Failed to reconnect with stored credentials.');
      }
    } else {
      // First time connecting on a password-protected profile
      setPassword('');
      setShowPasswordPrompt(true);
      focusInside(MODAL, ['PWD_SUBMIT_BTN', 'PROFILE_PWD_INPUT']);
    }
  };

  const handlePasswordSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedUser) return;
    setIsSubmitting(true);
    setAuthError(null);
    try {
      setShowPasswordPrompt(false);
      await triggerProfileSwitch(selectedUser, password, clickedRect);
    } catch (err: any) {
      setShowPasswordPrompt(true);
      setAuthError(err.message || 'Invalid password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleManualSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!customUsername.trim()) return;
    setIsSubmitting(true);
    setAuthError(null);
    try {
      const tempUser: JellyfinUser = {
        id: customUsername.trim(),
        name: customUsername.trim(),
        hasPassword: !!password,
        avatarUrl: ''
      };
      setIsManualLogin(false);
      await triggerProfileSwitch(tempUser, password);
    } catch (err: any) {
      setIsManualLogin(true);
      setAuthError(err.message || 'Failed to authenticate.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div
        ref={ref}
        data-focus-key="PROFILE_SWITCHER_MODAL"
        style={{
          position: 'fixed',
          top: 0, right: 0, bottom: 0, left: 0,
          zIndex: 960,
          backgroundColor: 'rgba(5, 7, 12, 0.94)',
          backdropFilter: 'blur(30px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px',
          boxSizing: 'border-box'
        }}
      >
        {/* Floating Close Button Top-Right */}
        <div style={{ position: 'absolute', top: '32px', right: '48px' }}>
          <ModalCloseButton onSelect={onClose} />
        </div>

        {/* Password Prompt Sub-Modal */}
        {showPasswordPrompt && selectedUser ? (
          <div
            style={{
              width: '460px',
              backgroundColor: 'rgba(20, 24, 34, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '28px',
              padding: '36px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(var(--accent-rgb), 0.2)'
            }}
          >
            {/* User Avatar in prompt */}
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                overflow: 'hidden',
                border: '3px solid var(--accent)',
                marginBottom: '16px',
                backgroundColor: '#12151c',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {selectedUser.avatarUrl ? (
                <AvatarImg
                  src={selectedUser.avatarUrl}
                  alt={selectedUser.name}
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
              ) : (
                <User size={40} color="#ffffff" />
              )}
            </div>

            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 6px 0', color: '#ffffff' }}>
              Welcome back, {selectedUser.name}
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.6)', margin: '0 0 24px 0' }}>
              Enter password for this Jellyfin profile
            </p>

            {authError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'rgba(255, 51, 75, 0.15)',
                  border: '1px solid rgba(255, 51, 75, 0.4)',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  color: '#ff4d63',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ position: 'relative', width: '100%' }}>
                <KeyRound
                  size={20}
                  color="rgba(255,255,255,0.4)"
                  style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)', zIndex: 1 }}
                />
                <FocusableInput
                  focusKeyId="PROFILE_PWD_INPUT"
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Profile password"
                  autoFocus
                  style={{ paddingLeft: '48px' }}
                />
              </div>

              <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
                <ActionButton
                  focusKey="PWD_CANCEL_BTN"
                  label="Cancel"
                  variant="secondary"
                  onSelect={() => setShowPasswordPrompt(false)}
                />
                <ActionButton
                  focusKey="PWD_SUBMIT_BTN"
                  label={isSubmitting ? 'Signing In...' : 'Sign In'}
                  variant="primary"
                  onSelect={handlePasswordSubmit}
                  disabled={isSubmitting}
                />
              </div>
            </form>
          </div>
        ) : isManualLogin ? (
          /* Manual Login with custom credentials */
          <div
            style={{
              width: '460px',
              backgroundColor: 'rgba(20, 24, 34, 0.95)',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '28px',
              padding: '36px',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              boxShadow: '0 24px 60px rgba(0, 0, 0, 0.8), 0 0 30px rgba(var(--accent-rgb), 0.2)'
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '16px'
              }}
            >
              <UserPlus size={32} color="var(--accent)" />
            </div>
            <h3 style={{ fontSize: '1.5rem', fontWeight: 800, margin: '0 0 6px 0', color: '#ffffff' }}>
              Sign In to Jellyfin
            </h3>
            <p style={{ fontSize: '0.9rem', color: 'rgba(255, 255, 255, 0.6)', margin: '0 0 24px 0' }}>
              Any account on this server — including profiles hidden from the list. Type the exact username.
            </p>

            {authError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  backgroundColor: 'rgba(255, 51, 75, 0.15)',
                  border: '1px solid rgba(255, 51, 75, 0.4)',
                  padding: '10px 14px',
                  borderRadius: '12px',
                  color: '#ff4d63',
                  fontSize: '0.85rem',
                  marginBottom: '16px',
                  width: '100%',
                  boxSizing: 'border-box'
                }}
              >
                <AlertCircle size={18} style={{ flexShrink: 0 }} />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleManualSubmit} style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <FocusableInput
                focusKeyId="MANUAL_USERNAME_INPUT"
                type="text"
                name="username"
                autoComplete="username"
                autoCapitalize="off"
                spellCheck={false}
                value={customUsername}
                onChange={(e) => setCustomUsername(e.target.value)}
                placeholder="Username"
                autoFocus
              />

              <FocusableInput
                focusKeyId="MANUAL_PWD_INPUT"
                type="password"
                name="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password (leave blank if none)"
              />

              <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                <ActionButton
                  focusKey="MANUAL_CANCEL_BTN"
                  label="Back"
                  variant="secondary"
                  onSelect={() => setIsManualLogin(false)}
                />
                <ActionButton
                  focusKey="MANUAL_SUBMIT_BTN"
                  label={isSubmitting ? 'Signing In...' : 'Connect'}
                  variant="primary"
                  onSelect={handleManualSubmit}
                  disabled={isSubmitting || !customUsername.trim()}
                />
              </div>
            </form>
          </div>
        ) : (
          /* Profile Picker Grid */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <h2
              style={{
                fontSize: '2.4rem',
                fontWeight: 800,
                letterSpacing: '-0.5px',
                marginBottom: '10px',
                textAlign: 'center'
              }}
            >
              Who's Watching?
            </h2>
            <p
              style={{
                fontSize: '1.05rem',
                color: 'rgba(255, 255, 255, 0.65)',
                marginBottom: '48px',
                textAlign: 'center'
              }}
            >
              Select your Jellyfin profile to access your personal continue watching and watch history
            </p>

            {/* Profile Cards Horizontal Row */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '32px',
                flexWrap: 'wrap',
                maxWidth: '900px'
              }}
            >
              {allUsers.map((user, idx) => {
                const isActive = currentUser?.id === user.id || currentUser?.name.toLowerCase() === user.name.toLowerCase();
                const isSaved = jellyfinClient.hasStoredCredential(user.id) || jellyfinClient.hasStoredCredential(user.name);
                return (
                  <ProfileCard
                    key={user.id}
                    focusKeyId={`PROFILE_CARD_${idx}`}
                    user={user}
                    isActive={isActive}
                    isSaved={isSaved}
                    delayIndex={idx}
                    onSelect={(rect) => handleSelectProfile(user, rect)}
                  />
                );
              })}

              {/* Add / Other Profile Card */}
              <AddProfileCard
                focusKeyId={`PROFILE_CARD_${allUsers.length}`}
                delayIndex={allUsers.length}
                onSelect={() => {
                  setPassword('');
                  setCustomUsername('');
                  setAuthError(null);
                  setIsManualLogin(true);
                  // Start on the username field (the Connect button is disabled until a name is typed)
                  focusInside(MODAL, ['MANUAL_USERNAME_INPUT']);
                }}
              />
            </div>

            {/* Switch Server & Loading Indicators */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginTop: '28px' }}>
              <FocusableButton
                focusKey="PROFILE_CHANGE_SERVER_BTN"
                onPress={() => {
                  onClose();
                  setIsServerConnectOpen(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 18px',
                  borderRadius: '20px',
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
                  borderColor: 'rgba(255, 255, 255, 0.2)',
                  fontSize: '0.85rem'
                }}
              >
                <Server size={15} color="var(--accent)" />
                <span>Change Server</span>
              </FocusableButton>

              {isLoadingData && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent)', fontSize: '0.85rem' }}>
                  <Loader2 size={16} className="animate-spin" />
                  <span>Loading profiles...</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </FocusContext.Provider>
  );
};

interface ProfileCardProps {
  user: JellyfinUser;
  isActive: boolean;
  isSaved?: boolean;
  delayIndex?: number;
  focusKeyId: string;
  onSelect: (startRect: StartRect | null) => void;
}

const ProfileCard: React.FC<ProfileCardProps> = ({
  user,
  isActive,
  isSaved,
  delayIndex = 0,
  focusKeyId,
  onSelect
}) => {
  const getRect = () => {
    const el = ref.current;
    const avatarEl = el?.querySelector('.profile-avatar-circle') || el;
    if (avatarEl) {
      const r = avatarEl.getBoundingClientRect();
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
    return null;
  };

  const { ref, focused } = useFocusable({
    focusKey: focusKeyId,
    onEnterPress: () => onSelect(getRect())
  });

  return (
    <div
      ref={ref}
      data-focus-key={focusKeyId}
      tabIndex={0}
      onClick={() => onSelect(getRect())}
      className={`focusable profile-card-enter ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
        cursor: 'pointer',
        animationDelay: `${delayIndex * 0.08}s`,
        transform: focused ? 'scale(1.12)' : 'scale(1)',
        transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        outline: 'none',
        boxShadow: 'none',
        border: 'none',
        backgroundColor: 'transparent'
      }}
    >
      {/* Avatar Circle Container */}
      <div
        className="profile-avatar-circle"
        style={{
          width: '130px',
          height: '130px',
          borderRadius: '50%',
          position: 'relative',
          padding: '4px',
          backgroundColor: '#12151c',
          border: focused
            ? '4px solid #ffffff'
            : isActive
            ? '3px solid var(--accent)'
            : isSaved
            ? '2px solid rgba(var(--accent-rgb), 0.6)'
            : '2px solid rgba(255, 255, 255, 0.2)',
          boxShadow: focused
            ? '0 16px 36px rgba(0, 0, 0, 0.9), 0 0 28px rgba(255, 255, 255, 0.6)'
            : isActive
            ? '0 8px 24px rgba(var(--accent-rgb), 0.35)'
            : isSaved
            ? '0 6px 20px rgba(var(--accent-rgb), 0.2)'
            : '0 4px 16px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.25s ease'
        }}
      >
        {user.avatarUrl ? (
          <AvatarImg
            src={user.avatarUrl}
            alt={user.name}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: '50%'
            }}
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #0071e3 0%, #7928ca 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '2.4rem',
              fontWeight: 800,
              color: '#ffffff'
            }}
          >
            {user.name.charAt(0).toUpperCase()}
          </div>
        )}

        {/* Active Profile Checkmark badge */}
        {isActive && (
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              right: '4px',
              backgroundColor: 'var(--accent)',
              borderRadius: '50%',
              width: '28px',
              height: '28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-contrast)',
              boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
              border: '2px solid #000000'
            }}
          >
            <Check size={16} strokeWidth={3} />
          </div>
        )}

        {/* Saved in cookies badge (Instant 1-Click Connect) */}
        {isSaved && !isActive && (
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              right: '4px',
              backgroundColor: 'var(--accent)',
              borderRadius: '50%',
              width: '26px',
              height: '26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--accent-contrast)',
              boxShadow: '0 2px 10px rgba(var(--accent-rgb), 0.65)',
              border: '2px solid #000000'
            }}
            title="Instant Connect (Credentials in Cookies)"
          >
            <Sparkles size={13} strokeWidth={2.8} />
          </div>
        )}

        {/* Lock indicator if user has password and not saved yet */}
        {user.hasPassword && !isSaved && !isActive && (
          <div
            style={{
              position: 'absolute',
              bottom: '4px',
              right: '4px',
              backgroundColor: 'rgba(0, 0, 0, 0.75)',
              borderRadius: '50%',
              width: '26px',
              height: '26px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              border: '1px solid rgba(255, 255, 255, 0.3)'
            }}
          >
            <Lock size={13} />
          </div>
        )}
      </div>

      {/* User Name & Badges */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
        <span
          style={{
            fontSize: '1.15rem',
            fontWeight: 700,
            color: focused ? '#ffffff' : isActive ? 'var(--accent)' : 'rgba(255, 255, 255, 0.85)',
            letterSpacing: '-0.2px'
          }}
        >
          {user.name}
        </span>
        {user.isAdmin && (
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              color: '#f59e0b',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              padding: '2px 8px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px'
            }}
          >
            <Shield size={11} /> Admin
          </span>
        )}
      </div>
    </div>
  );
};

const AddProfileCard: React.FC<{ focusKeyId: string; delayIndex?: number; onSelect: () => void }> = ({
  focusKeyId,
  delayIndex = 0,
  onSelect
}) => {
  const { ref, focused } = useFocusable({
    focusKey: focusKeyId,
    onEnterPress: onSelect
  });

  return (
    <div
      ref={ref}
      data-focus-key={focusKeyId}
      tabIndex={0}
      onClick={onSelect}
      className={`focusable profile-card-enter ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
        cursor: 'pointer',
        animationDelay: `${delayIndex * 0.08}s`,
        transform: focused ? 'scale(1.12)' : 'scale(1)',
        transition: 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)',
        outline: 'none',
        boxShadow: 'none',
        border: 'none',
        backgroundColor: 'transparent'
      }}
    >
      <div
        style={{
          width: '130px',
          height: '130px',
          borderRadius: '50%',
          backgroundColor: focused ? 'rgba(255, 255, 255, 0.15)' : 'rgba(255, 255, 255, 0.05)',
          border: focused ? '4px solid #ffffff' : '2px dashed rgba(255, 255, 255, 0.3)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: focused ? '0 16px 36px rgba(0, 0, 0, 0.9), 0 0 25px rgba(255, 255, 255, 0.5)' : 'none',
          transition: 'all 0.25s ease'
        }}
      >
        <UserPlus size={44} color={focused ? '#ffffff' : 'rgba(255, 255, 255, 0.6)'} />
      </div>

      <span
        style={{
          fontSize: '1.05rem',
          fontWeight: 600,
          color: focused ? '#ffffff' : 'rgba(255, 255, 255, 0.7)'
        }}
      >
        Other User
      </span>
      <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.45)', marginTop: '2px' }}>
        hidden profiles
      </span>
    </div>
  );
};

interface ActionButtonProps {
  focusKey: string;
  label: string;
  variant: 'primary' | 'secondary';
  onSelect: () => void;
  disabled?: boolean;
}

const ActionButton: React.FC<ActionButtonProps> = ({ focusKey, label, variant, onSelect, disabled }) => {
  const { ref, focused } = useFocusable({
    focusKey,
    onEnterPress: onSelect
  });

  const isPrimary = variant === 'primary';

  return (
    <button
      ref={ref}
      onClick={onSelect}
      disabled={disabled}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        flex: 1,
        padding: '12px 20px',
        borderRadius: '14px',
        border: focused
          ? '2px solid #ffffff'
          : isPrimary
          ? '1px solid rgba(var(--accent-rgb), 0.5)'
          : '1px solid rgba(255, 255, 255, 0.2)',
        backgroundColor: focused
          ? '#ffffff'
          : isPrimary
          ? 'linear-gradient(135deg, var(--accent) 0%, #0071e3 100%)'
          : 'rgba(255, 255, 255, 0.08)',
        color: focused ? '#000000' : '#ffffff',
        fontSize: '0.95rem',
        fontWeight: 700,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        boxShadow: focused ? '0 0 16px rgba(255, 255, 255, 0.5)' : 'none',
        transform: focused ? 'scale(1.04)' : 'scale(1)',
        transition: 'all 0.2s ease'
      }}
    >
      {label}
    </button>
  );
};

const ModalCloseButton: React.FC<{ onSelect: () => void }> = ({ onSelect }) => {
  const { ref, focused } = useFocusable({
    focusKey: 'MODAL_CLOSE_ICON_BTN',
    onEnterPress: onSelect
  });

  return (
    <button
      ref={ref}
      onClick={onSelect}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        border: focused ? '2px solid #ffffff' : '1px solid rgba(255, 255, 255, 0.2)',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.3)' : 'rgba(255, 255, 255, 0.08)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        boxShadow: focused ? '0 0 14px rgba(255, 255, 255, 0.4)' : 'none',
        transform: focused ? 'scale(1.1)' : 'scale(1)',
        transition: 'all 0.2s ease'
      }}
    >
      <X size={20} />
    </button>
  );
};
