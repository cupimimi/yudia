import React, { useEffect, useState } from 'react';
import { Menu, X, Home, Film, Tv, Radio, Music, Settings, Search, Users, Download } from 'lucide-react';
import { downloadsSupported } from '../services/downloads';
import { CastButton } from './CastButton';
import { ConnectButton } from './ConnectSheet';
import { useAppState, TabType } from '../state/AppStateContext';
import { YudiaLogo } from './YudiaLogo';
import { AvatarImg } from './AvatarImg';

const ITEMS: { id: TabType; label: string; icon: React.ReactNode }[] = [
  { id: 'home', label: 'Home', icon: <Home size={22} /> },
  { id: 'movies', label: 'Movies', icon: <Film size={22} /> },
  { id: 'tv', label: 'TV Shows', icon: <Tv size={22} /> },
  { id: 'live', label: 'Live TV', icon: <Radio size={22} /> },
  { id: 'music', label: 'Music', icon: <Music size={22} /> },
  ...(downloadsSupported() ? [{ id: 'downloads' as TabType, label: 'Downloads', icon: <Download size={22} /> }] : []),
  { id: 'settings', label: 'Settings', icon: <Settings size={22} /> }
];

/**
 * Phone navigation (replaces the TV sidebar on narrow screens): a top bar with ☰, the Yudia logo, search and the
 * profile picture, and a menu that slides in from the left. Closes on tap outside, ✕, choosing a page, or Back/Esc.
 */
export const MobileTopBar: React.FC = () => {
  const { activeTab, setActiveTab, setIsSearchOpen, setIsProfileSwitcherOpen, currentUser } = useAppState();
  const [open, setOpen] = useState(false);

  // Back gesture / Esc closes the menu first
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.keyCode === 27) {
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = '';
    };
  }, [open]);

  const go = (tab: TabType) => {
    setActiveTab(tab);
    setOpen(false);
    document.querySelector('main')?.scrollTo({ top: 0 });
  };

  const iconBtn: React.CSSProperties = {
    width: 44,
    height: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    border: 'none',
    background: 'transparent',
    color: '#fff',
    cursor: 'pointer',
    flexShrink: 0
  };

  return (
    <>
      <header className="mobile-topbar">
        <button style={iconBtn} aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <Menu size={26} />
        </button>
        <button
          onClick={() => go('home')}
          aria-label="Yudia — home"
          style={{ ...iconBtn, width: 'auto', padding: '0 4px', marginRight: 'auto' }}
        >
          <YudiaLogo size={26} />
        </button>
        <CastButton plain style={iconBtn} />
        <ConnectButton plain style={iconBtn} />
        <button style={iconBtn} aria-label="Search" onClick={() => setIsSearchOpen(true)}>
          <Search size={22} />
        </button>
        <button
          style={{ ...iconBtn, borderRadius: '50%', overflow: 'hidden', width: 36, height: 36, background: 'rgba(255,255,255,0.08)' }}
          aria-label="Switch profile"
          onClick={() => setIsProfileSwitcherOpen(true)}
        >
          {currentUser?.avatarUrl ? (
            <AvatarImg src={currentUser.avatarUrl} alt={currentUser.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Users size={18} />
          )}
        </button>
      </header>

      {/* Slide-in menu */}
      <div className={`mobile-drawer-backdrop ${open ? 'is-open' : ''}`} onClick={() => setOpen(false)} />
      <nav className={`mobile-drawer ${open ? 'is-open' : ''}`} aria-label="Main menu" aria-hidden={!open}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 12px 14px 20px' }}>
          <YudiaLogo size={30} />
          <button style={iconBtn} aria-label="Close menu" onClick={() => setOpen(false)}>
            <X size={26} />
          </button>
        </div>

        {currentUser && (
          <button className="mobile-drawer__profile" onClick={() => { setOpen(false); setIsProfileSwitcherOpen(true); }}>
            <span style={{ width: 44, height: 44, borderRadius: '50%', overflow: 'hidden', background: 'rgba(255,255,255,0.08)', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {currentUser.avatarUrl ? (
                <AvatarImg src={currentUser.avatarUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <Users size={20} />
              )}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
              <span style={{ fontWeight: 800, fontSize: '1rem', color: '#fff' }}>{currentUser.name}</span>
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)' }}>Switch profile</span>
            </span>
          </button>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 12px' }}>
          {ITEMS.map((item) => (
            <button
              key={item.id}
              className={`mobile-drawer__item ${activeTab === item.id ? 'is-active' : ''}`}
              onClick={() => go(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
          <button className="mobile-drawer__item" onClick={() => { setOpen(false); setIsSearchOpen(true); }}>
            <Search size={22} />
            <span>Search</span>
          </button>
        </div>
      </nav>
    </>
  );
};
