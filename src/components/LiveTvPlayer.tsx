import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Radio, RotateCw, AlertTriangle } from 'lucide-react';
import { LiveChannel, LiveStreamHandle, closeLiveStream, openLiveStream } from '../services/liveTvService';

const BANNER_MS = 5000;
const ZAP_SETTLE_MS = 700;     // wait for the remote to stop before tuning (fast zapping = one tune)
const DIGIT_SETTLE_MS = 1500;  // typed channel number
const TUNE_TIMEOUT_MS = 60_000;

interface Props {
  channels: LiveChannel[];
  startIndex: number;
  onClose: () => void;
}

type Status = 'tuning' | 'playing' | 'error';

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/**
 * Full-screen live TV. Owns the remote while open: all keys are handled here (capture phase) and
 * stopped, so the app's own shortcuts and spatial navigation stay quiet underneath.
 *
 *   ↑ / ↓ / CH+ / CH−  change channel      0–9  type a channel number
 *   OK / Info          show the banner      Back close
 */
export const LiveTvPlayer: React.FC<Props> = ({ channels, startIndex, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handleRef = useRef<LiveStreamHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [index, setIndex] = useState(startIndex);          // channel on screen / being tuned
  const [pendingIndex, setPendingIndex] = useState<number | null>(null); // while zapping
  const [src, setSrc] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>('tuning');
  const [error, setError] = useState('');
  const [bannerVisible, setBannerVisible] = useState(true);
  const [digits, setDigits] = useState('');
  const [, forceTick] = useState(0);

  const bannerTimer = useRef<ReturnType<typeof setTimeout>>();
  const zapTimer = useRef<ReturnType<typeof setTimeout>>();
  const digitTimer = useRef<ReturnType<typeof setTimeout>>();

  const showBanner = useCallback(() => {
    setBannerVisible(true);
    clearTimeout(bannerTimer.current);
    bannerTimer.current = setTimeout(() => setBannerVisible(false), BANNER_MS);
  }, []);

  // ---- tuning ----
  const tune = useCallback(async (i: number) => {
    const channel = channels[i];
    if (!channel) return;
    abortRef.current?.abort();
    closeLiveStream(handleRef.current);
    handleRef.current = null;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timeout = setTimeout(() => ctrl.abort(), TUNE_TIMEOUT_MS);

    setIndex(i);
    setPendingIndex(null);
    setSrc(null);
    setStatus('tuning');
    setError('');
    showBanner();

    try {
      const handle = await openLiveStream(channel.id, ctrl.signal);
      if (ctrl.signal.aborted) return closeLiveStream(handle);
      handleRef.current = handle;
      setSrc(handle.url);
    } catch (err: any) {
      if (abortRef.current !== ctrl) return; // superseded by another channel
      setStatus('error');
      setError(
        err?.name === 'AbortError'
          ? 'The channel took too long to start. The IPTV source may be offline.'
          : err?.message || 'This channel is not available right now.'
      );
    } finally {
      clearTimeout(timeout);
    }
  }, [channels, showBanner]);

  useEffect(() => {
    tune(startIndex);
    return () => {
      abortRef.current?.abort();
      closeLiveStream(handleRef.current);
      clearTimeout(bannerTimer.current);
      clearTimeout(zapTimer.current);
      clearTimeout(digitTimer.current);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the "now" progress bar moving.
  useEffect(() => {
    const id = setInterval(() => forceTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  // Refs hold the in-progress zap / typed number so rapid key presses build on each other.
  const pendingRef = useRef<number | null>(null);
  const digitsRef = useRef('');

  const zap = useCallback((delta: number) => {
    const from = pendingRef.current ?? index;
    const next = (from + delta + channels.length) % channels.length;
    pendingRef.current = next;
    setPendingIndex(next);
    clearTimeout(zapTimer.current);
    zapTimer.current = setTimeout(() => {
      pendingRef.current = null;
      tune(next);
    }, ZAP_SETTLE_MS);
    showBanner();
  }, [channels.length, index, tune, showBanner]);

  const typeDigit = useCallback((d: string) => {
    const typed = (digitsRef.current + d).slice(-3);
    digitsRef.current = typed;
    setDigits(typed);
    clearTimeout(digitTimer.current);
    digitTimer.current = setTimeout(() => {
      digitsRef.current = '';
      setDigits('');
      const target = channels.findIndex((c) => parseInt(c.number, 10) === parseInt(typed, 10));
      if (target !== -1) tune(target);
    }, DIGIT_SETTLE_MS);
  }, [channels, tune]);

  // ---- remote ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.keyCode;
      const handled = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      if (k === 10009 || k === 27 || k === 8) { handled(); onClose(); return; }                 // Back / Esc
      if (k === 38 || k === 427 || e.key === 'ChannelUp') { handled(); zap(1); return; }       // ↑ / CH+
      if (k === 40 || k === 428 || e.key === 'ChannelDown') { handled(); zap(-1); return; }    // ↓ / CH−
      if (k === 13 || k === 457 || e.key === 'Info') {                                         // OK / Info
        handled();
        if (status === 'error') tune(index);
        else if (bannerVisible) setBannerVisible(false);
        else showBanner();
        return;
      }
      if (k >= 48 && k <= 57) { handled(); typeDigit(String(k - 48)); return; }              // 0–9
      handled(); // everything else: swallow so nothing underneath reacts
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [zap, typeDigit, onClose, status, bannerVisible, showBanner, tune, index]);

  const shown = channels[pendingIndex ?? index];
  const now = shown?.now;
  const progress = now ? Math.min(100, Math.max(0, ((Date.now() - now.start.getTime()) / (now.end.getTime() - now.start.getTime())) * 100)) : 0;

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, left: 0, background: '#000', zIndex: 9500, overflow: 'hidden' }}>
      {src && (
        <video
          ref={videoRef}
          key={src}
          src={src}
          autoPlay
          playsInline
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onPlaying={() => setStatus('playing')}
          onError={() => {
            setStatus('error');
            setError('The stream stopped or could not be decoded on this device.');
          }}
        />
      )}

      {/* Tuning / error state */}
      {status !== 'playing' && (
        <div style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '18px', color: '#fff' }}>
          {status === 'tuning' ? (
            <>
              <Radio size={48} color="var(--accent)" style={{ animation: 'livePulse 1.4s ease-in-out infinite' }} />
              <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>Tuning {shown?.name}…</span>
            </>
          ) : (
            <>
              <AlertTriangle size={48} color="#ffb020" />
              <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>{shown?.name} isn't available</span>
              <span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.7)', maxWidth: '640px', textAlign: 'center' }}>{error}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.95rem', color: 'var(--accent)', fontWeight: 700 }}>
                <RotateCw size={18} /> OK to retry · ↑↓ other channel · Back to the list
              </span>
            </>
          )}
        </div>
      )}

      {/* Typed channel number */}
      {digits && (
        <div style={{ position: 'absolute', top: '48px', right: '64px', fontSize: '3.2rem', fontWeight: 800, color: '#fff', textShadow: '0 2px 16px rgba(0,0,0,0.9)', fontVariantNumeric: 'tabular-nums' }}>
          {digits}
        </div>
      )}

      {/* Channel banner */}
      {shown && (bannerVisible || pendingIndex !== null) && (
        <div
          style={{
            position: 'absolute',
            left: '48px',
            right: '48px',
            bottom: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
            padding: '22px 30px',
            borderRadius: '22px',
            background: 'rgba(12, 15, 23, 0.86)',
            backdropFilter: 'blur(30px)',
            WebkitBackdropFilter: 'blur(30px)',
            border: '1px solid rgba(255,255,255,0.14)',
            color: '#fff',
            animation: 'liveBannerIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)'
          }}
        >
          <div style={{ width: '120px', height: '72px', flexShrink: 0, borderRadius: '12px', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {shown.logoUrl ? (
              <img decoding="async" src={shown.logoUrl} alt="" style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
            ) : (
              <Radio size={30} color="rgba(255,255,255,0.6)" />
            )}
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
              <span style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{shown.number}</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{shown.name}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 800, padding: '2px 8px', borderRadius: '6px', background: '#e50914', letterSpacing: '0.08em' }}>LIVE</span>
            </div>
            {now ? (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '16px', fontSize: '1.05rem' }}>
                  <span style={{ fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{now.title}</span>
                  <span style={{ color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{fmtTime(now.start)} – {fmtTime(now.end)}</span>
                </div>
                <div style={{ height: '5px', borderRadius: '3px', background: 'rgba(255,255,255,0.18)', overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)' }} />
                </div>
                {shown.next && (
                  <span style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.65)' }}>
                    Next · {fmtTime(shown.next.start)} {shown.next.title}
                  </span>
                )}
              </>
            ) : (
              <span style={{ fontSize: '1rem', color: 'rgba(255,255,255,0.6)' }}>No guide information for this channel</span>
            )}
          </div>

          <div style={{ flexShrink: 0, textAlign: 'right', fontSize: '0.85rem', color: 'rgba(255,255,255,0.55)', lineHeight: 1.6 }}>
            ↑↓ channels<br />0–9 number<br />Back list
          </div>
        </div>
      )}

      <style>{`
        @keyframes livePulse { 0%,100% { opacity: .45; transform: scale(.94); } 50% { opacity: 1; transform: scale(1); } }
        @keyframes liveBannerIn { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
      `}</style>
    </div>
  );
};
