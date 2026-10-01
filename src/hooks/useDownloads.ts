import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe, getVersion, getEntry, listDownloads, listRules, getRule, getOfflineImageUrl, DownloadEntry } from '../services/downloads';

/** Re-render whenever the downloads change (progress is throttled to ~4 updates per second). */
export const useDownloadsVersion = () => useSyncExternalStore(subscribe, getVersion);

export function useDownloadEntry(id: string | undefined): DownloadEntry | undefined {
  useDownloadsVersion();
  return id ? getEntry(id) : undefined;
}

export function useDownloadList(): DownloadEntry[] {
  useDownloadsVersion();
  return listDownloads();
}

export function useAutoRules() {
  useDownloadsVersion();
  return listRules();
}

export function useAutoRule(id: string | undefined) {
  useDownloadsVersion();
  return id ? getRule(id) : undefined;
}

/** Picture saved with a download (works offline). null until loaded / when there is none. */
export function useOfflineImage(id: string | undefined, kind: 'poster' | 'backdrop' | 'series', enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!id || !enabled) return;
    let alive = true;
    getOfflineImageUrl(id, kind).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [id, kind, enabled]);
  return url;
}

export function formatBytes(n: number): string {
  if (!n) return '0 MB';
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  return `${Math.max(1, Math.round(n / 1e6))} MB`;
}
