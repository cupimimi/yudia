import React, { useEffect, useState } from 'react';
import { ContentAdvisory, ageColor, ageValueFromRating } from '../utils/contentAdvisory';
import { getAdvisoryCached } from '../services/preloadService';

const RATING_MS = 6500;
const PHOTO_MS = 7000;
const GAP_MS = 500;
/** Exit animation: the bar sweeps back to the right, wiping the text away, then the triangle fades. */
const LEAVE_MS = 1000;

const creditStyle: React.CSSProperties = {
  marginTop: '4px',
  fontSize: '0.85rem',
  fontWeight: 600,
  color: 'rgba(255,255,255,0.7)'
};

interface Props {
  itemId: string;
  /** True once the video is actually playing (after the launch animation, not during Up Next). */
  active: boolean;
  /** Push down below the top bar while the player controls are visible. */
  controlsVisible: boolean;
}

/**
 * Streaming-service style advisory, top-left, shown once per title when playback starts:
 *   1. age + topics ("13+ · PG-13 / violence, language")
 *   2. photosensitive warning, when the title has one
 * Purely informational: not focusable, never takes the remote's focus, no pointer events.
 */
export const ContentAdvisoryOverlay: React.FC<Props> = ({ itemId, active, controlsVisible }) => {
  const [advisory, setAdvisory] = useState<ContentAdvisory | null>(null);
  const [phase, setPhase] = useState<'hidden' | 'rating' | 'photo'>('hidden');
  const [leaving, setLeaving] = useState(false);

  const enabled = (() => {
    try {
      return JSON.parse(localStorage.getItem('jellyfin_streaming_settings') || '{}').showContentAdvisory !== false;
    } catch {
      return true;
    }
  })();

  // Load fresh from the server for every title — new media is covered automatically.
  useEffect(() => {
    const ctrl = new AbortController();
    setAdvisory(null);
    setPhase('hidden');
    setLeaving(false);
    getAdvisoryCached(itemId).catch(() => null).then((a) => {
      if (!ctrl.signal.aborted) setAdvisory(a);
    });
    return () => ctrl.abort();
  }, [itemId]);

  // Start once per title, the first time playback is active with data available…
  const [startedFor, setStartedFor] = useState<string | null>(null);
  useEffect(() => {
    if (enabled && active && advisory && startedFor !== itemId) setStartedFor(itemId);
  }, [enabled, active, advisory, itemId, startedFor]);

  // …then run the sequence to the end regardless of pause/seek (only a new title cancels it).
  useEffect(() => {
    if (startedFor !== itemId || !advisory) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const hasRating = !!advisory.rating || advisory.topics.length > 0;
    const at = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const hide = (end: number) => {
      at(end - LEAVE_MS, () => setLeaving(true));
      at(end, () => {
        setPhase('hidden');
        setLeaving(false);
      });
    };
    let t = 0;
    if (hasRating) {
      setPhase('rating');
      t += RATING_MS;
    }
    if (advisory.photosensitive) {
      const gap = hasRating ? GAP_MS : 0;
      if (hasRating) hide(t);
      at(t + gap, () => setPhase('photo'));
      t += gap + PHOTO_MS;
    }
    hide(t);
    return () => timers.forEach(clearTimeout);
  }, [startedFor, itemId, advisory]);

  if (!advisory || phase === 'hidden') return null;
  return <AdvisoryCard advisory={advisory} phase={phase} leaving={leaving} controlsVisible={controlsVisible} />;
};

/** The visual card (also used by design previews). */
export const AdvisoryCard: React.FC<{
  advisory: ContentAdvisory;
  phase: 'rating' | 'photo';
  controlsVisible: boolean;
  leaving?: boolean;
}> = ({ advisory, phase, controlsVisible, leaving = false }) => {
  const isPhoto = phase === 'photo';
  // Age colour code (green → yellow → orange → red → crimson); amber for the photosensitive warning.
  const color = isPhoto ? '#ffb020' : ageColor(advisory.ageValue ?? ageValueFromRating(advisory.rating));

  return (
    <div
      key={phase} // replay the entrance animation for the second card
      role="status"
      aria-live="polite"
      className={`advisory ${isPhoto ? 'advisory--calm' : ''} ${leaving ? 'is-leaving' : ''}`}
      style={{
        position: 'absolute',
        top: controlsVisible ? '150px' : '56px',
        left: '64px',
        zIndex: 9010,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'stretch',
        gap: '16px',
        maxWidth: '680px',
        transition: 'top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)',
        textShadow: '0 2px 12px rgba(0,0,0,0.85)',
        ['--adv' as string]: color
      } as React.CSSProperties}
    >
      <style>{ADVISORY_CSS}</style>

      {/* Warning triangle */}
      <svg className="advisory__tri" viewBox="0 0 64 58" width="54" height="49" aria-hidden="true">
        <path
          d="M28.5 4.2c1.6-2.8 5.4-2.8 7 0l26 45.2c1.6 2.8-.4 6.1-3.5 6.1H6c-3.1 0-5.1-3.3-3.5-6.1z"
          fill={color}
          fillOpacity="0.18"
          stroke={color}
          strokeWidth="4"
          strokeLinejoin="round"
        />
        <g className="advisory__bang" fill={color}>
          <rect x="29" y="18" width="6" height="21" rx="3" />
          <circle cx="32" cy="46" r="3.6" />
        </g>
      </svg>

      {/* Wipe: the colour-coded bar starts at the right and slides left, revealing the text behind it */}
      <div className="advisory__reveal">
      <div className="advisory__track" aria-hidden="true">
        <div className="advisory__bar" style={{ background: color }} />
      </div>
      <div className="advisory__text" style={{ display: 'flex', flexDirection: 'column', gap: '6px', padding: '4px 0' }}>
        {!isPhoto ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
              {advisory.ageLabel && (
                <span style={{ fontSize: '2rem', fontWeight: 800, color: '#ffffff', letterSpacing: '-0.01em' }}>
                  {advisory.ageLabel}
                </span>
              )}
              {/* Rating badge unless it only repeats the age ("18" next to "18+") */}
              {advisory.rating && !(advisory.ageLabel && /^\d+\+?$/.test(advisory.rating.trim())) && (
                <span
                  style={{
                    fontSize: advisory.ageLabel ? '1rem' : '2rem',
                    fontWeight: advisory.ageLabel ? 700 : 800,
                    color: advisory.ageLabel ? 'rgba(255,255,255,0.8)' : '#ffffff',
                    border: advisory.ageLabel ? `1px solid ${color}` : 'none',
                    borderRadius: '4px',
                    padding: advisory.ageLabel ? '1px 8px' : 0
                  }}
                >
                  {advisory.rating}
                </span>
              )}
            </div>
            {advisory.topics.length > 0 && (
              <span style={{ fontSize: '1.15rem', fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>
                {advisory.topics.join(', ')}
              </span>
            )}
            {/* Required by the DoesTheDogDie API terms whenever their data is on screen (exact wording). */}
            {advisory.attribution.topics && <span style={creditStyle}>Powered by DoesTheDogDie.com</span>}
          </>
        ) : (
          <>
            <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#ffffff' }}>Photosensitive warning</span>
            <span style={{ fontSize: '1.05rem', fontWeight: 500, color: 'rgba(255,255,255,0.88)', lineHeight: 1.4 }}>
              This title contains flashing lights or patterns that may affect photosensitive viewers.
            </span>
            {advisory.attribution.photosensitive && <span style={creditStyle}>Powered by DoesTheDogDie.com</span>}
          </>
        )}
      </div>
      </div>
    </div>
  );
};

/**
 * Entrance: triangle drops in with a bounce → the bar appears at the right edge → it slides right-to-left,
 * and the text is revealed behind it (clip follows the bar). Exit (.is-leaving) is the same wipe in reverse:
 * the bar slides back to the right erasing the text, shrinks, then the triangle fades out.
 * Then a slow glow pulse on the triangle (well under 3 flashes/s) and two blinks of the "!".
 * The photosensitive card (.advisory--calm) gets no pulse and no blink — a flashing warning for people
 * sensitive to flashing would defeat its purpose. Everything is off with prefers-reduced-motion.
 */
const ADVISORY_CSS = `
.advisory__tri { flex-shrink: 0; align-self: center; transform-origin: 50% 70%;
  animation: advTriIn .6s cubic-bezier(.34,1.56,.64,1) both, advTriGlow 2.2s ease-in-out .7s infinite; }
.advisory__bang { animation: advBang .5s steps(1) .65s 2 both; }
.advisory__reveal { position: relative; padding-left: 21px;
  animation: advWipeIn .75s cubic-bezier(.65,0,.35,1) .55s both; }
.advisory__track { position: absolute; top: 0; bottom: 0; left: 0; width: 100%;
  animation: advTrackIn .75s cubic-bezier(.65,0,.35,1) .55s both; }
.advisory__bar { width: 5px; height: 100%; border-radius: 3px; transform-origin: center;
  box-shadow: 0 0 14px var(--adv); animation: advBarGrow .3s cubic-bezier(.16,1,.3,1) .3s both; }
.advisory--calm .advisory__tri { animation: advTriFade .5s ease-out both; filter: drop-shadow(0 0 8px var(--adv)); }
.advisory--calm .advisory__bang { animation: none; }

.advisory.is-leaving .advisory__reveal { animation: advWipeOut .7s cubic-bezier(.65,0,.35,1) both; }
.advisory.is-leaving .advisory__track { animation: advTrackOut .7s cubic-bezier(.65,0,.35,1) both; }
.advisory.is-leaving .advisory__bar { animation: advBarShrink .25s ease-in .65s both; }
.advisory.is-leaving .advisory__tri,
.advisory--calm.is-leaving .advisory__tri { animation: advTriOut .3s ease-in .65s both; }

@keyframes advTriIn { 0% { opacity: 0; transform: translateY(-18px) scale(.3) rotate(-18deg); }
  70% { opacity: 1; transform: translateY(2px) scale(1.14) rotate(5deg); }
  100% { opacity: 1; transform: none; } }
@keyframes advTriGlow { 0%,100% { filter: drop-shadow(0 0 4px var(--adv)); transform: scale(1); }
  50% { filter: drop-shadow(0 0 16px var(--adv)); transform: scale(1.06); } }
@keyframes advBang { 0% { opacity: 1; } 50% { opacity: .15; } }
@keyframes advBarGrow { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
@keyframes advBarShrink { from { transform: scaleY(1); opacity: 1; } to { transform: scaleY(0); opacity: 0; } }
@keyframes advTrackIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
@keyframes advTrackOut { from { transform: translateX(0); } to { transform: translateX(100%); } }
@keyframes advWipeIn { from { clip-path: inset(-20px -30px -20px 100%); }
  to { clip-path: inset(-20px -30px -20px -12px); } }
@keyframes advWipeOut { from { clip-path: inset(-20px -30px -20px -12px); }
  to { clip-path: inset(-20px -30px -20px 100%); } }
@keyframes advTriFade { from { opacity: 0; transform: scale(.85); } to { opacity: 1; transform: none; } }
@keyframes advTriOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(.6); } }
@media (prefers-reduced-motion: reduce) {
  .advisory__tri, .advisory__bang, .advisory__bar, .advisory__track, .advisory__reveal { animation: none !important; }
  .advisory.is-leaving { opacity: 0; transition: opacity .3s; }
}
`;

