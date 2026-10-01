import React, { useEffect } from 'react';
import { useFocusable } from '@noriginmedia/norigin-spatial-navigation';
import { ageColor } from '../utils/contentAdvisory';

/** Same triangle as the in-player advisory. */
const Triangle: React.FC<{ color: string; size?: number }> = ({ color, size = 34 }) => (
  <svg viewBox="0 0 64 58" width={size} height={(size * 58) / 64} aria-hidden="true" style={{ flexShrink: 0, filter: `drop-shadow(0 0 6px ${color})` }}>
    <path d="M28.5 4.2c1.6-2.8 5.4-2.8 7 0l26 45.2c1.6 2.8-.4 6.1-3.5 6.1H6c-3.1 0-5.1-3.3-3.5-6.1z" fill={color} fillOpacity="0.18" stroke={color} strokeWidth="4" strokeLinejoin="round" />
    <rect x="29" y="18" width="6" height="21" rx="3" fill={color} />
    <circle cx="32" cy="46" r="3.6" fill={color} />
  </svg>
);

// European scale (FSK / Switzerland). US ratings are converted to their usual equivalent.
const AGE_LEVELS = [
  { age: 0, label: 'All ages', examples: 'FSK 0 · US: G, TV-G, TV-Y', meaning: 'Suitable for everyone.' },
  { age: 6, label: '6+', examples: 'FSK 6 · US: PG, TV-PG, TV-Y7', meaning: 'Some scenes may need a parent nearby.' },
  { age: 12, label: '12+', examples: 'FSK 12 · US: PG-13, TV-14', meaning: 'Not for young children.' },
  { age: 16, label: '16+', examples: 'FSK 16 · US: R, TV-MA', meaning: 'Mature audiences.' },
  { age: 18, label: '18+', examples: 'FSK 18 · US: NC-17 · R / TV-MA tagged explicit', meaning: 'Adults only.' }
];

/** Read-only card the remote can land on — so ↑↓ scrolls through the page. */
const InfoCard: React.FC<{ id: string; title: string; onLeft: () => void; children: React.ReactNode }> = ({ id, title, onLeft, children }) => {
  const { ref, focused } = useFocusable({
    focusKey: `RATINGS_INFO_${id}`,
    onArrowPress: (direction) => {
      if (direction === 'left') {
        onLeft();
        return false;
      }
      return true;
    }
  });
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);

  return (
    <div
      ref={ref}
      className={`focusable ${focused ? 'focused' : ''}`}
      style={{
        padding: '20px 24px',
        borderRadius: '20px',
        backgroundColor: focused ? 'rgba(255, 255, 255, 0.08)' : 'rgba(255, 255, 255, 0.04)',
        border: focused ? '2px solid rgba(255,255,255,0.85)' : '1px solid rgba(255, 255, 255, 0.08)',
        transform: 'none',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        transition: 'all 0.2s ease'
      }}
    >
      <h3 style={{ fontSize: '1.02rem', fontWeight: 700, color: '#ffffff', margin: 0 }}>{title}</h3>
      {children}
    </div>
  );
};

const muted: React.CSSProperties = { fontSize: '0.85rem', color: 'rgba(255,255,255,0.65)', lineHeight: 1.55, margin: 0 };
const code: React.CSSProperties = {
  fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
  fontSize: '0.82rem',
  padding: '2px 8px',
  borderRadius: '6px',
  background: 'rgba(0, 229, 255, 0.12)',
  color: '#7df3ff',
  whiteSpace: 'nowrap'
};

/**
 * Settings → Ratings & Warnings: explains the popup shown when a title starts
 * (colour code, photosensitive warning, where the data comes from, how to correct it).
 */
export const RatingsInfoPanel: React.FC<{ onLeft: () => void }> = ({ onLeft }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
    <InfoCard id="colors" title="Age colour code" onLeft={onLeft}>
      <p style={muted}>
        Ages follow the European scale (0 · 6 · 12 · 16 · 18, as FSK in Germany and Switzerland). Titles with a US rating are
        converted to the usual European equivalent, and the original rating is shown next to the age. The triangle and the
        line take the colour of the age.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {AGE_LEVELS.map((lvl) => {
          const color = ageColor(lvl.age);
          return (
            <div key={lvl.label} style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <Triangle color={color} />
              <div style={{ width: '4px', alignSelf: 'stretch', borderRadius: '2px', background: color, boxShadow: `0 0 8px ${color}` }} />
              <span style={{ width: '96px', fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>{lvl.label}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <span style={{ fontSize: '0.9rem', fontWeight: 600, color: '#fff' }}>{lvl.meaning}</span>
                <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.55)' }}>{lvl.examples}</span>
              </div>
            </div>
          );
        })}
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Triangle color={ageColor(undefined)} />
          <div style={{ width: '4px', alignSelf: 'stretch', borderRadius: '2px', background: ageColor(undefined) }} />
          <span style={{ width: '96px', fontSize: '1.15rem', fontWeight: 800, color: '#fff' }}>Unrated</span>
          <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.65)' }}>No rating in Jellyfin — only the topics are shown.</span>
        </div>
      </div>
    </InfoCard>

    <InfoCard id="photo" title="Photosensitive warning" onLeft={onLeft}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <Triangle color="#ffb020" />
        <div style={{ width: '4px', alignSelf: 'stretch', borderRadius: '2px', background: '#ffb020' }} />
        <p style={muted}>
          Shown right after the age when a title contains <strong style={{ color: '#fff' }}>flashing lights or patterns</strong>.
          It is deliberately calm — no blinking or pulsing — so the warning itself is safe for people sensitive to flashing.
        </p>
      </div>
    </InfoCard>

    <InfoCard id="sources" title="Where the information comes from" onLeft={onLeft}>
      <p style={muted}>
        <strong style={{ color: '#fff' }}>Age</strong> — the rating stored in Jellyfin (a custom rating set by the server admin wins).
        European ratings are used as they are; US ratings are converted (PG-13 → 12+, TV-MA → 16+). Because the US scale stops at 17,
        an R / TV-MA title tagged as explicit (erotic, hentai…) is shown as 18+.
      </p>
      <p style={muted}>
        <strong style={{ color: '#fff' }}>Topics & flashing lights</strong> — community warnings from DoesTheDogDie.com, added to
        the library automatically by the server. Only topics most voters agree on are used, most serious first.
        <br />
        <span style={{ color: 'rgba(255,255,255,0.8)', fontWeight: 600 }}>Powered by DoesTheDogDie.com</span>
      </p>
      <p style={muted}>
        When a title isn’t on DoesTheDogDie, Yudia makes a best guess from its genres, keywords and synopsis.
      </p>
      <p style={muted}>
        Everything is read fresh from the server when a title starts, so new media gets its warnings without any update to the app.
      </p>
    </InfoCard>

    <InfoCard id="tags" title="Add or correct a warning (server admin)" onLeft={onLeft}>
      <p style={muted}>In Jellyfin, edit the title’s metadata and add a tag:</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: '16px', rowGap: '10px', alignItems: 'center' }}>
        <span style={code}>advisory:violence</span>
        <span style={muted}>adds a topic (any wording, e.g. advisory:strong language)</span>
        <span style={code}>warning:flashing lights</span>
        <span style={muted}>turns on the photosensitive warning</span>
        <span style={code}>advisory:none</span>
        <span style={muted}>hides the automatic topics for that title</span>
      </div>
      <p style={muted}>
        To force an age, fill in <strong style={{ color: '#fff' }}>Custom rating</strong> in the same screen (e.g.{' '}
        <span style={code}>FSK-18</span> or <span style={code}>CH-16</span>) — it always wins over the official rating.
      </p>
    </InfoCard>
  </div>
);
