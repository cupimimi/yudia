import React, { useId } from 'react';

/** A sad jellyfish holding a little screen that says "No media". Used for empty pages and the reconnect pop-up. */
export const SadJellyfish: React.FC<{ size?: number }> = ({ size = 200 }) => {
  const id = useId().replace(/:/g, '');
  return (
    <svg className="sad-jelly" viewBox="0 0 240 220" width={size} height={(size * 220) / 240} role="img" aria-label="Sad jellyfish holding a screen that says no media">
      <defs>
        <linearGradient id={`bell-${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7df3ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
        <radialGradient id={`glow-${id}`} cx="0.5" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#00e5ff" stopOpacity="0.28" />
          <stop offset="1" stopColor="#00e5ff" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="96" cy="92" rx="92" ry="82" fill={`url(#glow-${id})`} />

      <g className="sad-jelly__body">
        {/* tentacles */}
        <g fill="none" stroke={`url(#bell-${id})`} strokeWidth="5" strokeLinecap="round" opacity="0.85">
          <path className="sad-jelly__tentacle" d="M58 112 q-8 18 2 34 t-4 36" />
          <path className="sad-jelly__tentacle" d="M78 116 q8 16 -2 32 t4 34" />
          <path className="sad-jelly__tentacle" d="M98 116 q-8 18 2 32 t-2 30" />
          <path className="sad-jelly__tentacle" d="M118 112 q10 12 4 26" />
        </g>
        {/* the arm holding the screen */}
        <path d="M128 104 q22 4 34 22" fill="none" stroke={`url(#bell-${id})`} strokeWidth="5" strokeLinecap="round" />

        {/* bell */}
        <path d="M34 108 C34 58 62 32 96 32 C130 32 158 58 158 108 C150 114 140 106 130 112 C120 118 110 108 96 114 C82 120 72 108 62 114 C52 118 42 110 34 108 Z" fill={`url(#bell-${id})`} />
        <path d="M58 62 C66 48 80 42 94 42" fill="none" stroke="#fff" strokeOpacity="0.55" strokeWidth="5" strokeLinecap="round" />

        {/* sad face */}
        <g stroke="#0d1324" strokeWidth="4" strokeLinecap="round" fill="none">
          <path d="M70 78 q7 -6 14 0" />
          <path d="M108 78 q7 -6 14 0" />
          <path d="M84 98 q12 -9 24 0" />
        </g>
        <path className="sad-jelly__tear" d="M122 84 q4 7 0 11 q-4 -4 0 -11 z" fill="#7df3ff" />
        <ellipse cx="66" cy="90" rx="6" ry="3.5" fill="#ff7ab6" opacity="0.45" />
        <ellipse cx="126" cy="90" rx="6" ry="3.5" fill="#ff7ab6" opacity="0.45" />
      </g>

      {/* the little screen */}
      <g className="sad-jelly__screen">
        <rect x="150" y="120" width="80" height="56" rx="8" fill="#0d1324" stroke="#7df3ff" strokeOpacity="0.6" strokeWidth="3" />
        <g stroke="#ffffff" strokeOpacity="0.12" strokeWidth="2">
          <line x1="158" y1="132" x2="222" y2="132" />
          <line x1="158" y1="142" x2="210" y2="142" />
          <line x1="158" y1="164" x2="218" y2="164" />
        </g>
        <text x="190" y="156" textAnchor="middle" fontFamily="Inter, sans-serif" fontSize="12" fontWeight="800" fill="#ffffff">NO MEDIA</text>
        <path d="M176 176 l-6 12 M204 176 l6 12" stroke="#7df3ff" strokeOpacity="0.6" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
};

/** Centered empty state: the jellyfish, a title ("No media found") and an optional hint / action. */
export const EmptyState: React.FC<{ title?: string; message?: React.ReactNode; children?: React.ReactNode }> = ({
  title = 'No media found',
  message,
  children
}) => (
  <div className="empty-state" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 14, padding: '48px 16px' }}>
    <SadJellyfish />
    <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 800, color: '#fff' }}>{title}</h2>
    {message && <p style={{ margin: 0, maxWidth: 460, fontSize: '1rem', lineHeight: 1.5, color: 'rgba(255,255,255,0.65)' }}>{message}</p>}
    {children}
  </div>
);
