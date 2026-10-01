import React, { useEffect, useState } from 'react';
import { useFocusable, FocusContext, setFocus } from '@noriginmedia/norigin-spatial-navigation';
import { Radio, RefreshCw } from 'lucide-react';
import { LiveChannel, getLiveChannels, isLiveTvAvailable } from '../services/liveTvService';
import { LiveTvPlayer } from './LiveTvPlayer';
import { FocusableButton } from './FocusableButton';
import { EmptyState } from './SadJellyfish';

const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const ChannelRow: React.FC<{ channel: LiveChannel; index: number; onSelect: () => void }> = ({ channel, index, onSelect }) => {
  const { ref, focused } = useFocusable({
    focusKey: `LIVE_CH_${index}`,
    onEnterPress: onSelect,
    onFocus: (layout) => (layout.node as HTMLElement)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  });
  const now = channel.now;
  const progress = now
    ? Math.min(100, Math.max(0, ((Date.now() - now.start.getTime()) / (now.end.getTime() - now.start.getTime())) * 100))
    : 0;

  return (
    <div
      ref={ref}
      onClick={onSelect}
      className={`live-row focusable ${focused ? 'focused' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '22px',
        padding: '16px 22px',
        borderRadius: '18px',
        cursor: 'pointer',
        background: focused ? 'rgba(var(--accent-rgb), 0.14)' : 'rgba(255,255,255,0.04)',
        border: focused ? '1px solid rgba(var(--accent-rgb), 0.7)' : '1px solid rgba(255,255,255,0.08)',
        transform: focused ? 'scale(1.01)' : 'none',
        transition: 'all 0.2s ease'
      }}
    >
      <span style={{ width: '44px', textAlign: 'right', fontSize: '1.35rem', fontWeight: 800, color: focused ? 'var(--accent)' : 'rgba(255,255,255,0.55)', fontVariantNumeric: 'tabular-nums' }}>
        {channel.number}
      </span>
      <div style={{ width: '110px', height: '62px', flexShrink: 0, borderRadius: '10px', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {channel.logoUrl ? (
          <img decoding="async" src={channel.logoUrl} alt="" style={{ maxWidth: '90%', maxHeight: '90%', objectFit: 'contain' }} />
        ) : (
          <Radio size={26} color="rgba(255,255,255,0.5)" />
        )}
      </div>
      <div style={{ width: '260px', flexShrink: 0, fontSize: '1.15rem', fontWeight: 800, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {channel.name}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {now ? (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{now.title}</span>
              <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.6)', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                {fmtTime(now.start)} – {fmtTime(now.end)}
              </span>
            </div>
            <div style={{ height: '4px', borderRadius: '2px', background: 'rgba(255,255,255,0.14)', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)' }} />
            </div>
            {channel.next && (
              <span style={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.5)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Next · {fmtTime(channel.next.start)} {channel.next.title}
              </span>
            )}
          </>
        ) : (
          <span style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.45)' }}>No guide information</span>
        )}
      </div>
    </div>
  );
};

/**
 * Live TV tab: every channel from Jellyfin Live TV (your IPTV M3U) with what's on now / next.
 * OK opens the full-screen player; channels can then be changed with ↑↓ / CH± / number keys.
 */
export const LiveTvView: React.FC = () => {
  const { ref, focusKey } = useFocusable({ focusKey: 'LIVE_TV_VIEW', trackChildren: true });
  const [channels, setChannels] = useState<LiveChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Load channels + guide, refresh "now / next" every minute.
  useEffect(() => {
    if (!isLiveTvAvailable()) {
      setLoading(false);
      setError('Sign in to your Jellyfin server to watch live TV.');
      return;
    }
    let ctrl = new AbortController();
    const load = async (first: boolean) => {
      try {
        const list = await getLiveChannels(ctrl.signal);
        setChannels(list);
        setError(list.length ? '' : 'No live TV channels are set up on your Jellyfin server.');
        if (first && list.length) setTimeout(() => setFocus('LIVE_CH_0'), 80);
      } catch (e: any) {
        if (e?.name !== 'AbortError') setError('Could not load channels from Jellyfin.');
      } finally {
        setLoading(false);
      }
    };
    load(true);
    const id = setInterval(() => {
      ctrl = new AbortController();
      load(false);
    }, 60_000);
    return () => {
      ctrl.abort();
      clearInterval(id);
    };
  }, [reloadKey]);

  const closePlayer = () => {
    const last = playingIndex;
    setPlayingIndex(null);
    setTimeout(() => setFocus(`LIVE_CH_${last ?? 0}`), 80);
  };

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="live-tv" style={{ padding: '40px 0 80px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <Radio size={30} color="var(--accent)" />
          <h1 style={{ margin: 0, fontSize: '2rem', fontWeight: 800, color: '#fff' }}>Live TV</h1>
          {!loading && channels.length > 0 && (
            <span style={{ fontSize: '0.95rem', color: 'rgba(255,255,255,0.5)' }}>{channels.length} channels</span>
          )}
        </div>

        {loading && <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '1.05rem' }}>Loading channels…</span>}

        {!loading && error && (
          <EmptyState title="No live TV found" message={error}>
            {isLiveTvAvailable() && (
              <FocusableButton focusKey="LIVE_RETRY_BTN" onPress={() => { setLoading(true); setReloadKey((k) => k + 1); }}>
                <RefreshCw size={18} /> <span>Try again</span>
              </FocusableButton>
            )}
          </EmptyState>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {channels.map((ch, i) => (
            <ChannelRow key={ch.id} channel={ch} index={i} onSelect={() => setPlayingIndex(i)} />
          ))}
        </div>
      </div>

      {playingIndex !== null && channels.length > 0 && (
        <LiveTvPlayer channels={channels} startIndex={playingIndex} onClose={closePlayer} />
      )}
    </FocusContext.Provider>
  );
};
