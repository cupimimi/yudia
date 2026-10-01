import React, { useEffect, useState } from 'react';
import { Download, CircleCheck, Loader2, AlertCircle, Trash2, RefreshCw, Clock } from 'lucide-react';
import { FocusableButton } from './FocusableButton';
import '../styles/downloads.css';
import { MediaItem } from '../mockData';
import { useDownloadEntry, useDownloadsVersion, useAutoRule } from '../hooks/useDownloads';
import {
  downloadsSupported,
  downloadItem,
  removeDownload,
  retryDownload,
  getEntry,
  setRule,
  readDownloadSettings,
  listDownloads
} from '../services/downloads';

const pct = (bytes: number, total: number) => (total > 0 ? Math.min(99, Math.floor((bytes / total) * 100)) : 0);

/** Press twice within 3 s to confirm (removing a download), so a stray OK press never deletes anything. */
function useConfirm(): [boolean, () => boolean] {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return [
    armed,
    () => {
      if (armed) {
        setArmed(false);
        return true;
      }
      setArmed(true);
      return false;
    }
  ];
}

/**
 * Download one movie / episode / song. States: Download → Waiting → Downloading 42 % → Downloaded
 * (press twice to remove). Hidden where downloads aren't available (TV, non-https page).
 */
export const DownloadButton: React.FC<{
  item: MediaItem;
  focusKey?: string;
  compact?: boolean; // round icon-only button (episode rows)
  style?: React.CSSProperties;
  onArrowPress?: (dir: string) => boolean;
}> = ({ item, focusKey, compact, style, onArrowPress }) => {
  const entry = useDownloadEntry(item.id);
  const [armed, confirm] = useConfirm();
  if (!downloadsSupported()) return null;

  let icon: React.ReactNode = <Download size={compact ? 18 : 20} />;
  let label = 'Download';
  let onPress: () => unknown = () => downloadItem(item);
  let tone: React.CSSProperties = {};

  if (entry?.status === 'queued') {
    icon = <Clock size={compact ? 18 : 20} />;
    label = 'Waiting…';
    onPress = () => confirm() && removeDownload(item.id);
    if (armed) label = 'Cancel?';
  } else if (entry?.status === 'downloading') {
    icon = <Loader2 size={compact ? 18 : 20} className="animate-spin" />;
    label = armed ? 'Cancel?' : `Downloading ${pct(entry.bytes, entry.totalBytes)} %`;
    onPress = () => confirm() && removeDownload(item.id);
  } else if (entry?.status === 'done') {
    icon = armed ? <Trash2 size={compact ? 18 : 20} /> : <CircleCheck size={compact ? 18 : 20} />;
    label = armed ? 'Remove download?' : 'Downloaded';
    onPress = () => confirm() && removeDownload(item.id);
    tone = { color: armed ? '#ff6b6b' : 'var(--accent)', borderColor: armed ? '#ff6b6b' : 'rgba(var(--accent-rgb), 0.5)' };
  } else if (entry?.status === 'error') {
    icon = <AlertCircle size={compact ? 18 : 20} />;
    label = 'Retry download';
    onPress = () => retryDownload(item.id);
    tone = { color: '#ffb020' };
  }

  return (
    <FocusableButton
      focusKey={focusKey}
      onPress={onPress}
      onArrowPress={onArrowPress}
      style={{
        ...(compact ? { position: 'relative', width: 40, height: 40, padding: 0, borderRadius: '50%', justifyContent: 'center', flexShrink: 0 } : {}),
        ...tone,
        ...style
      }}
    >
      <span title={compact ? label : undefined} aria-label={label} style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
        {icon}
        {!compact && <span>{label}</span>}
      </span>
      {entry?.status === 'downloading' && compact && (
        <span className="dl-ring" style={{ ['--p' as string]: `${pct(entry.bytes, entry.totalBytes)}%` } as React.CSSProperties} />
      )}
    </FocusableButton>
  );
};

/**
 * Download a whole set (season, album, playlist). With `ruleType` it also becomes an auto-download:
 *  • series: keep the next N unwatched episodes downloaded (watched ones removed)
 *  • album / playlist: every song, new songs included
 */
export const CollectionDownloadButton: React.FC<{
  id: string; // series / album / playlist id (the rule id)
  name: string;
  ruleType: 'series' | 'album' | 'playlist';
  items: MediaItem[]; // what "Download" fetches now (album / playlist songs; for series: nothing, the rule decides)
  focusKey?: string;
  className?: string;
  style?: React.CSSProperties;
}> = ({ id, name, ruleType, items, focusKey, className, style }) => {
  useDownloadsVersion();
  const rule = useAutoRule(id);
  const [armed, confirm] = useConfirm();
  if (!downloadsSupported()) return null;

  // Songs of this album / playlist, or (series) the episodes this rule downloaded
  const mine = items.length ? items.map((i) => getEntry(i.id)).filter(Boolean) : listDownloads().filter((e) => e.ruleId === id);
  const done = mine.filter((e) => e!.status === 'done').length;
  const busy = mine.some((e) => e!.status === 'downloading' || e!.status === 'queued');

  let label: string;
  let icon: React.ReactNode;
  if (!rule) {
    label = ruleType === 'series' ? 'Auto-download' : 'Download';
    icon = <Download size={18} />;
  } else if (armed) {
    label = 'Stop & remove?';
    icon = <Trash2 size={18} />;
  } else if (busy) {
    label = ruleType === 'series' ? 'Downloading…' : `Downloading ${done}/${items.length}`;
    icon = <Loader2 size={18} className="animate-spin" />;
  } else {
    label = ruleType === 'series' ? `Auto-download on` : 'Downloaded';
    icon = ruleType === 'series' ? <RefreshCw size={18} /> : <CircleCheck size={18} />;
  }

  const onPress = async () => {
    if (!rule) {
      setRule({ id, type: ruleType, name, keep: ruleType === 'series' ? readDownloadSettings().keepEpisodes : undefined });
      return;
    }
    if (!confirm()) return;
    setRule(null, id);
    // Remove what this rule downloaded
    await Promise.all(listDownloads().filter((e) => e.ruleId === id).map((e) => removeDownload(e.id)));
  };

  return (
    <FocusableButton
      focusKey={focusKey}
      onPress={onPress}
      className={className}
      style={{
        ...(rule && !armed ? { color: 'var(--accent)', borderColor: 'rgba(var(--accent-rgb), 0.5)' } : {}),
        ...(armed ? { color: '#ff6b6b', borderColor: '#ff6b6b' } : {}),
        ...style
      }}
    >
      {icon}
      <span>{label}</span>
    </FocusableButton>
  );
};
