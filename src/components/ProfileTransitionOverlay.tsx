import React, { useState, useEffect } from 'react';
import { AvatarImg } from './AvatarImg';
import { User, Sparkles } from 'lucide-react';
import { JellyfinUser } from '../api/jellyfin';

export type TransitionPhase = 'idle' | 'center' | 'spin' | 'exit';

export interface StartRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface ProfileTransitionOverlayProps {
  user: JellyfinUser | null;
  phase: TransitionPhase;
  startRect?: StartRect | null;
}

export const ProfileTransitionOverlay: React.FC<ProfileTransitionOverlayProps> = ({
  user,
  phase,
  startRect
}) => {
  const [isCentered, setIsCentered] = useState(!startRect);

  useEffect(() => {
    if (startRect) {
      setIsCentered(false);
      const timer = setTimeout(() => {
        setIsCentered(true);
      }, 40);
      return () => clearTimeout(timer);
    } else {
      setIsCentered(true);
    }
  }, [startRect]);

  if (phase === 'idle' || !user) return null;

  const isSpin = phase === 'spin';
  const isExit = phase === 'exit';

  // Compute position: from original clicked card position to exact screen center
  const initialScale = startRect ? Math.max(0.45, startRect.width / 180) : 0.8;
  const currentLeft = !isCentered && startRect ? `${startRect.left + startRect.width / 2}px` : '50vw';
  const currentTop = !isCentered && startRect ? `${startRect.top + startRect.height / 2}px` : '50vh';

  const currentTransform = isExit
    ? 'translate(-50%, -145vh) scale(0.95)'
    : !isCentered && startRect
    ? `translate(-50%, -50%) scale(${initialScale})`
    : isSpin
    ? 'translate(-50%, -50%) scale(1.2)'
    : 'translate(-50%, -50%) scale(1.1)';

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex: 10000,
        backgroundColor: '#07090e',
        pointerEvents: 'all',
        animation: isExit ? 'curtainReveal 0.85s cubic-bezier(0.4, 0, 0.2, 1) forwards' : 'none',
        transition: 'background-color 0.4s ease'
      }}
    >
      {/* Dynamic Ambient Background Glow */}
      <div
        style={{
          position: 'absolute',
          left: '50vw',
          top: '50vh',
          transform: 'translate(-50%, -50%)',
          width: '560px',
          height: '560px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(var(--accent-rgb), 0.3) 0%, rgba(121, 40, 202, 0.22) 50%, transparent 70%)',
          filter: 'blur(55px)',
          pointerEvents: 'none',
          opacity: isExit ? 0 : 1,
          transition: 'opacity 0.7s ease'
        }}
      />

      {/* Main Avatar Motion Container: leaves its own place, glides to center, spins, floats up */}
      <div
        style={{
          position: 'fixed',
          left: currentLeft,
          top: currentTop,
          transform: currentTransform,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '24px',
          zIndex: 2,
          transition: isExit
            ? 'transform 0.85s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.7s ease'
            : 'all 0.55s cubic-bezier(0.16, 1, 0.3, 1)',
          willChange: 'transform, left, top'
        }}
      >
        {/* Outer Orbital Glowing / Spinning Ring */}
        <div
          style={{
            position: 'relative',
            width: '180px',
            height: '180px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
          }}
        >
          {/* Animated Neon Spinner Ring */}
          <div
            style={{
              position: 'absolute',
              top: '-10px', right: '-10px', bottom: '-10px', left: '-10px',
              borderRadius: '50%',
              background: 'conic-gradient(from 0deg, var(--accent), #0071e3, #7928ca, #ec4899, var(--accent))',
              animation: 'profileSpinLoading 1.1s linear infinite',
              opacity: isSpin ? 1 : 0.35,
              filter: 'blur(4px)',
              transition: 'opacity 0.3s ease'
            }}
          />

          {/* Frosted Avatar Container */}
          <div
            style={{
              width: '180px',
              height: '180px',
              borderRadius: '50%',
              overflow: 'hidden',
              backgroundColor: '#12151c',
              border: '4px solid #ffffff',
              boxShadow: '0 0 50px rgba(var(--accent-rgb), 0.7), inset 0 0 20px rgba(0,0,0,0.5)',
              position: 'relative',
              zIndex: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              animation: isSpin ? 'profileAuraPulse 1.8s ease-in-out infinite' : 'none'
            }}
          >
            {user.avatarUrl ? (
              <AvatarImg
                src={user.avatarUrl}
                alt={user.name}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover'
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
                  background: 'linear-gradient(135deg, #0071e3 0%, #7928ca 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '3.6rem',
                  fontWeight: 800,
                  color: '#ffffff'
                }}
              >
                {user.name.charAt(0).toUpperCase()}
              </div>
            )}
          </div>
        </div>

        {/* Profile Name & Loading Indicator */}
        <div
          style={{
            textAlign: 'center',
            opacity: isExit ? 0 : isCentered ? 1 : 0,
            transform: isCentered ? 'translateY(0)' : 'translateY(16px)',
            transition: 'all 0.4s ease'
          }}
        >
          <h2
            style={{
              fontSize: '1.9rem',
              fontWeight: 800,
              color: '#ffffff',
              margin: '0 0 6px 0',
              letterSpacing: '-0.3px',
              textShadow: '0 4px 20px rgba(0,0,0,0.8)'
            }}
          >
            {user.name}
          </h2>

          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '6px 16px',
              borderRadius: '20px',
              backgroundColor: 'rgba(var(--accent-rgb), 0.15)',
              border: '1px solid rgba(var(--accent-rgb), 0.4)',
              color: 'var(--accent)',
              fontSize: '0.85rem',
              fontWeight: 700,
              letterSpacing: '0.5px',
              textTransform: 'uppercase'
            }}
          >
            <Sparkles size={14} />
            <span>{isSpin ? 'Authenticating & Loading Cinema...' : 'Connecting...'}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
