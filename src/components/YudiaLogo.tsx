import React, { useId } from 'react';

/** Yudia mark: a play button with a Y cut into it. Source files: design/yudia-mark.svg, design/yudia-app-icon.svg */
export const YudiaMark: React.FC<{ size?: number }> = ({ size = 48 }) => {
  const gid = `yudia-g-${useId().replace(/:/g, '')}`; // unique per instance so several logos can coexist
  return (
    <svg viewBox="100 80 340 350" width={size} height={size} role="img" aria-label="Yudia">
      <defs>
        <linearGradient id={gid} gradientUnits="userSpaceOnUse" x1="140" y1="110" x2="420" y2="400">
          <stop offset="0" stopColor="#00e5ff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M170 104 C150 92 128 104 128 128 V384 C128 408 150 420 170 408 L396 278 C416 266 416 246 396 234 Z" fill={`url(#${gid})`} />
      <g stroke="#0d1324" strokeWidth={40} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M190 190 L232 250 L274 190" />
        <path d="M232 250 V332" />
      </g>
    </svg>
  );
};

/** Mark + "Yudia" wordmark. */
export const YudiaLogo: React.FC<{ size?: number }> = ({ size = 44 }) => (
  <div style={{ display: 'inline-flex', alignItems: 'center', gap: size * 0.28 }}>
    <YudiaMark size={size} />
    <span style={{ fontSize: size * 0.8, fontWeight: 800, letterSpacing: '-0.03em', color: '#ffffff', lineHeight: 1 }}>Yudia</span>
  </div>
);
