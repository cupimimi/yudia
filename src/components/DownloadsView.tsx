import React, { useEffect, useMemo, useState } from 'react';
import { useFocusable, FocusContext } from '@noriginmedia/norigin-spatial-navigation';
import { Play, Trash2, RefreshCw, AlertCircle, Loader2, Clock, Film, Tv, Music2, WifiOff, Download, ListMusic, Disc3 } from 'lucide-react';
import { FocusableButton } from './FocusableButton';
import { EmptyState } from './SadJellyfish';
import { useAppState } from '../state/AppStateContext';
import { MediaItem } from '../mockData';
import { useDownloadList, useAutoRules, useOfflineImage, formatBytes, useDownloadsVersion } from '../hooks/useDownloads';
import {
  DownloadEntry,
  removeDownload,
  retryDownload,
  setRule,
  storageEstimate,
  readDownloadSettings,
  downloadsSupported
} from '../services/downloads';
import '../styles/downloads.css';

const pct = (e: DownloadEntry) => (e.totalBytes > 0 ? Math.min(99, Math.floor((e.bytes / e.totalBytes) * 100)) : 0);

/**
 * Downloads page (website on phones / laptops): what's downloading, then everything on this device — movies,
 * series (grouped by show, in episode order), music — plus the auto-downloads and the space used.
 * Works with no connection: pictures, subtitles, markers and lyrics were saved with each download.
 */
export const DownloadsView: React.FC = () => {
  const { playVideo, playAudio, setActiveTab } = useAppState();
  const list = useDownloadList();
  const rules = useAutoRules();
  const version = useDownloadsVersion();
  const [online, setOnline] = useState(navigator.onLine !== false);
  const [space, setSpace] = useState<{ used: number; quota: number; downloads: number } | null>(null);
  const { ref, focusKey } = useFocusable({ focusKey: 'DOWNLOADS_VIEW', trackChildren: true });

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  useEffect(() => {
    storageEstimate().then(setSpace);
  }, [version]);

  const active = list.filter((e) => e.status !== 'done');
  const done = list.filter((e) => e.status === 'done');
  const movies = done.filter((e) => e.kind === 'movie');
  const episodes = done.filter((e) => e.kind === 'episode');
  const songs = done.filter((e) => e.kind === 'song');

  const shows = useMemo(() => {
    const map = new Map<string, DownloadEntry[]>();
    episodes.forEach((e) => {
      const key = e.item.seriesId || e.item.seriesName || 'other';
      map.set(key, [...(map.get(key) || []), e]);
    });
    return [...map.values()].map((eps) =>
      eps.sort((a, b) => (a.item.seasonNumber || 0) - (b.item.seasonNumber || 0) || (a.item.episodeNumber || 0) - (b.item.episodeNumber || 0))
    );
  }, [episodes.map((e) => e.id).join()]);

  const playEntry = (e: DownloadEntry, queue?: DownloadEntry[]) => {
    const item: MediaItem = { ...e.item, playbackPercent: e.watched ? 0 : e.item.playbackPercent };
    if (e.kind === 'song') {
      const q = (queue || [e]).map((x) => x.item);
      playAudio(e.item, q);
    } else {
      playVideo(item);
    }
  };

  if (!downloadsSupported()) {
    return (
      <EmptyState
        title="Downloads aren't available here"
        message="Downloads work in the website version (phone or laptop, opened over https). On the TV everything streams from your server."
      />
    );
  }

  return (
    <FocusContext.Provider value={focusKey}>
      <div ref={ref} className="dl-page">
        <header className="dl-head">
          <div>
            <h1 className="page-title dl-title">Downloads</h1>
            <p className="dl-sub">
              {!online && (
                <span className="dl-offline">
                  <WifiOff size={15} /> Offline — your downloads still play
                </span>
              )}
              {space && (
                <span>
                  {formatBytes(space.downloads)} of downloads
                  {space.quota ? ` · ${formatBytes(Math.max(0, space.quota - space.used))} free for Yudia` : ''}
                </span>
              )}
            </p>
          </div>
          <FocusableButton focusKey="DL_SETTINGS_BTN" onPress={() => setActiveTab('settings')} style={{ padding: '10px 18px' }}>
            <Download size={18} /> <span>Download settings</span>
          </FocusableButton>
        </header>

        {list.length === 0 && rules.length === 0 && (
          <EmptyState
            title="Nothing downloaded yet"
            message="Press Download on a movie, an episode, a season, an album or a playlist to keep it on this device and watch or listen without a connection. On a series, Auto-download keeps the next episodes ready for you."
          />
        )}

        {active.length > 0 && (
          <section className="dl-section">
            <h2 className="dl-h2">
              <Loader2 size={20} className="animate-spin" /> Downloading ({active.length})
            </h2>
            <div className="dl-list">
              {active.map((e) => (
                <ProgressRow key={e.id} entry={e} />
              ))}
            </div>
          </section>
        )}

        {shows.length > 0 && (
          <section className="dl-section">
            <h2 className="dl-h2">
              <Tv size={20} /> TV Shows
            </h2>
            {shows.map((eps) => (
              <ShowGroup key={eps[0].item.seriesId || eps[0].id} episodes={eps} onPlay={playEntry} />
            ))}
          </section>
        )}

        {movies.length > 0 && (
          <section className="dl-section">
            <h2 className="dl-h2">
              <Film size={20} /> Movies
            </h2>
            <div className="dl-grid">
              {movies.map((e) => (
                <PosterCard key={e.id} entry={e} onPlay={() => playEntry(e)} />
              ))}
            </div>
          </section>
        )}

        {songs.length > 0 && (
          <section className="dl-section">
            <h2 className="dl-h2">
              <Music2 size={20} /> Music ({songs.length} songs)
            </h2>
            <div className="dl-actions">
              <FocusableButton focusKey="DL_PLAY_ALL_MUSIC" onPress={() => playEntry(songs[0], songs)}>
                <Play size={18} /> <span>Play all</span>
              </FocusableButton>
              <FocusableButton
                focusKey="DL_SHUFFLE_MUSIC"
                onPress={() => {
                  const q = [...songs].sort(() => Math.random() - 0.5);
                  playEntry(q[0], q);
                }}
              >
                <RefreshCw size={18} /> <span>Shuffle</span>
              </FocusableButton>
            </div>
            <div className="dl-list">
              {songs.map((e) => (
                <SongRow key={e.id} entry={e} onPlay={() => playEntry(e, songs)} />
              ))}
            </div>
          </section>
        )}

        {rules.length > 0 && (
          <section className="dl-section">
            <h2 className="dl-h2">
              <RefreshCw size={20} /> Auto-downloads
            </h2>
            <p className="dl-note">
              Kept up to date automatically{readDownloadSettings().wifiOnly ? ' (on Wi-Fi)' : ''}: new songs in these playlists and albums, and the next
              unwatched episodes of these shows.
            </p>
            <div className="dl-list">
              {rules.map((r) => (
                <div key={r.id} className="dl-row">
                  <span className="dl-row__icon">{r.type === 'series' ? <Tv size={20} /> : r.type === 'album' ? <Disc3 size={20} /> : <ListMusic size={20} />}</span>
                  <span className="dl-row__main">
                    <span className="dl-row__title">{r.name}</span>
                    <span className="dl-row__sub">
                      {r.type === 'series' ? `Next ${r.keep || readDownloadSettings().keepEpisodes} episodes` : r.type === 'album' ? 'Album — all songs' : 'Playlist — all songs, new ones too'}
                    </span>
                  </span>
                  <FocusableButton
                    focusKey={`DL_RULE_OFF_${r.id}`}
                    onPress={async () => {
                      setRule(null, r.id);
                    }}
                    style={{ padding: '8px 16px' }}
                  >
                    <span>Turn off</span>
                  </FocusableButton>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </FocusContext.Provider>
  );
};

const Thumb: React.FC<{ entry: DownloadEntry; kind?: 'poster' | 'series'; className?: string }> = ({ entry, kind = 'poster', className }) => {
  const url = useOfflineImage(entry.id, kind, kind === 'poster' ? entry.hasPoster !== false : !!entry.hasSeriesPoster);
  const Icon = entry.kind === 'song' ? Music2 : entry.kind === 'episode' ? Tv : Film;
  return <span className={`dl-thumb ${className || ''}`}>{url ? <img src={url} alt="" /> : <Icon size={24} />}</span>;
};

const ProgressRow: React.FC<{ entry: DownloadEntry }> = ({ entry }) => {
  const label =
    entry.status === 'queued'
      ? entry.error || 'Waiting…'
      : entry.status === 'error'
      ? entry.error || 'Failed'
      : `${pct(entry)} % · ${formatBytes(entry.bytes)}${entry.totalBytes ? ` of ~${formatBytes(entry.totalBytes)}` : ''}`;
  return (
    <div className="dl-row">
      <Thumb entry={entry} />
      <span className="dl-row__main">
        <span className="dl-row__title">{titleOf(entry)}</span>
        <span className={`dl-row__sub ${entry.status === 'error' ? 'is-error' : ''}`}>
          {entry.status === 'queued' ? <Clock size={13} /> : entry.status === 'error' ? <AlertCircle size={13} /> : null} {label}
        </span>
        {entry.status === 'downloading' && (
          <span className="dl-bar">
            <span style={{ width: `${pct(entry)}%` }} />
          </span>
        )}
      </span>
      {entry.status === 'error' && (
        <FocusableButton focusKey={`DL_RETRY_${entry.id}`} onPress={() => retryDownload(entry.id)} style={{ padding: '8px 14px' }}>
          <RefreshCw size={16} /> <span>Retry</span>
        </FocusableButton>
      )}
      <RemoveButton id={entry.id} label="Cancel" />
    </div>
  );
};

const titleOf = (e: DownloadEntry) =>
  e.kind === 'episode'
    ? `${e.item.seriesName || ''} · S${e.item.seasonNumber || 1}:E${e.item.episodeNumber || 1} ${e.item.episodeName || ''}`
    : e.kind === 'song'
    ? `${e.item.title} — ${e.item.artist || ''}`
    : e.item.title;

/** Press twice to remove (a stray OK press never deletes). */
const RemoveButton: React.FC<{ id: string; label?: string }> = ({ id, label = 'Remove' }) => {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <FocusableButton
      focusKey={`DL_REMOVE_${id}`}
      onPress={() => (armed ? removeDownload(id) : setArmed(true))}
      style={{ padding: '8px 14px', ...(armed ? { color: '#ff6b6b', borderColor: '#ff6b6b' } : {}) }}
    >
      <Trash2 size={16} /> <span>{armed ? 'Sure?' : label}</span>
    </FocusableButton>
  );
};

const PosterCard: React.FC<{ entry: DownloadEntry; onPlay: () => void }> = ({ entry, onPlay }) => {
  const { ref, focused } = useFocusable({ focusKey: `DL_ITEM_${entry.id}`, onEnterPress: onPlay });
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);
  return (
    <div className="dl-card">
      <div ref={ref} className={`dl-card__poster focusable ${focused ? 'focused' : ''}`} onClick={onPlay} role="button" aria-label={`Play ${entry.item.title}`}>
        <Thumb entry={entry} className="dl-thumb--poster" />
        <span className="dl-card__play">
          <Play size={22} fill="currentColor" />
        </span>
      </div>
      <span className="dl-card__title">{entry.item.title}</span>
      <span className="dl-card__sub">
        {entry.item.year} · {formatBytes(entry.bytes)} · {entry.quality === 'original' ? 'Original' : entry.quality}
      </span>
      <RemoveButton id={entry.id} />
    </div>
  );
};

const ShowGroup: React.FC<{ episodes: DownloadEntry[]; onPlay: (e: DownloadEntry) => void }> = ({ episodes, onPlay }) => {
  const first = episodes[0];
  const size = episodes.reduce((s, e) => s + e.bytes, 0);
  return (
    <div className="dl-show">
      <div className="dl-show__head">
        <Thumb entry={first} kind={first.hasSeriesPoster ? 'series' : 'poster'} className="dl-thumb--show" />
        <div>
          <div className="dl-show__title">{first.item.seriesName || 'Series'}</div>
          <div className="dl-row__sub">
            {episodes.length} episode{episodes.length > 1 ? 's' : ''} · {formatBytes(size)}
          </div>
        </div>
      </div>
      <div className="dl-list">
        {episodes.map((e) => (
          <EpisodeRow key={e.id} entry={e} onPlay={() => onPlay(e)} />
        ))}
      </div>
    </div>
  );
};

const EpisodeRow: React.FC<{ entry: DownloadEntry; onPlay: () => void }> = ({ entry, onPlay }) => {
  const { ref, focused } = useFocusable({ focusKey: `DL_ITEM_${entry.id}`, onEnterPress: onPlay });
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);
  return (
    <div className="dl-row">
      <div ref={ref} className={`dl-row__play focusable ${focused ? 'focused' : ''}`} onClick={onPlay} role="button">
        <Thumb entry={entry} className="dl-thumb--wide" />
        <span className="dl-row__main">
          <span className="dl-row__title">
            S{entry.item.seasonNumber || 1}:E{entry.item.episodeNumber || 1} · {entry.item.episodeName || entry.item.title}
          </span>
          <span className="dl-row__sub">
            {entry.watched ? 'Watched · ' : ''}
            {entry.item.duration} · {formatBytes(entry.bytes)}
            {entry.ruleId ? ' · auto' : ''}
          </span>
        </span>
      </div>
      <RemoveButton id={entry.id} />
    </div>
  );
};

const SongRow: React.FC<{ entry: DownloadEntry; onPlay: () => void }> = ({ entry, onPlay }) => {
  const { activeAudio, isAudioPlaying } = useAppState();
  const { ref, focused } = useFocusable({ focusKey: `DL_ITEM_${entry.id}`, onEnterPress: onPlay });
  useEffect(() => {
    if (focused) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [focused]);
  const current = activeAudio?.id === entry.id;
  return (
    <div className="dl-row">
      <div ref={ref} className={`dl-row__play focusable ${focused ? 'focused' : ''} ${current ? 'is-current' : ''}`} onClick={onPlay} role="button">
        <Thumb entry={entry} />
        <span className="dl-row__main">
          <span className="dl-row__title">{entry.item.title}</span>
          <span className="dl-row__sub">
            {current && isAudioPlaying ? 'Playing · ' : ''}
            {entry.item.artist}
            {entry.item.album ? ` · ${entry.item.album}` : ''}
          </span>
        </span>
      </div>
      <RemoveButton id={entry.id} />
    </div>
  );
};
