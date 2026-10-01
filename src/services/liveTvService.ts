/**
 * Live TV (IPTV) through Jellyfin's Live TV — the channels come from the M3U tuner and the guide from XMLTV,
 * both configured on the server. The app never talks to the IPTV source directly.
 */
import { jellyfinClient, imageQuery } from '../api/jellyfin';

export interface LiveProgram {
  id: string;
  title: string;
  start: Date;
  end: Date;
  overview?: string;
}

export interface LiveChannel {
  id: string;
  number: string;
  name: string;
  logoUrl?: string;
  now?: LiveProgram;
  next?: LiveProgram;
}

export interface LiveStreamHandle {
  url: string;
  liveStreamId?: string;
  playSessionId?: string;
}

const cfg = () => {
  const c = jellyfinClient.getConfig();
  return { base: (c.serverUrl || '').replace(/\/$/, ''), token: c.accessToken, userId: c.userId, deviceId: c.deviceId };
};

const headers = (json = false): Record<string, string> => ({
  Accept: 'application/json',
  Authorization: `MediaBrowser Token="${cfg().token}"`,
  ...(json ? { 'Content-Type': 'application/json' } : {})
});

async function getJson(path: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${cfg().base}${path}`, { headers: headers(), signal });
  if (!res.ok) throw new Error(`Live TV request failed (${res.status})`);
  return res.json();
}

const toProgram = (p: any): LiveProgram => ({
  id: p.Id,
  title: p.EpisodeTitle ? `${p.Name} — ${p.EpisodeTitle}` : p.Name,
  start: new Date(p.StartDate),
  end: new Date(p.EndDate),
  overview: p.Overview
});

export function isLiveTvAvailable(): boolean {
  const { base, token, userId } = cfg();
  return !!base && !!token && !!userId;
}

/** Channels sorted by number, each with the programme on now and the one after (when the guide has them). */
export async function getLiveChannels(signal?: AbortSignal): Promise<LiveChannel[]> {
  const { base, token, userId } = cfg();
  const data = await getJson(`/LiveTv/Channels?userId=${userId}&EnableImages=true&SortBy=SortName`, signal);
  const channels: LiveChannel[] = (data.Items || []).map((c: any) => ({
    id: c.Id,
    number: c.ChannelNumber || c.Number || '',
    name: c.Name,
    logoUrl: c.ImageTags?.Primary ? `${base}/Items/${c.Id}/Images/Primary?${imageQuery(240, c.ImageTags.Primary)}&ApiKey=${token}` : undefined
  }));

  // Guide for the next few hours — one request for every channel.
  try {
    const now = new Date();
    const until = new Date(now.getTime() + 6 * 3600_000);
    const guide = await getJson(
      `/LiveTv/Programs?userId=${userId}&MinEndDate=${now.toISOString()}&MaxStartDate=${until.toISOString()}&SortBy=StartDate&Fields=Overview&EnableImages=false`,
      signal
    );
    const byChannel = new Map<string, LiveProgram[]>();
    const seen = new Set<string>();
    for (const p of guide.Items || []) {
      const key = `${p.ChannelId}|${p.StartDate}|${(p.Name || '').toLowerCase()}`;
      if (seen.has(key)) continue; // XMLTV feeds often list the same slot twice
      seen.add(key);
      const list = byChannel.get(p.ChannelId) || [];
      list.push(toProgram(p));
      byChannel.set(p.ChannelId, list);
    }
    for (const ch of channels) {
      const list = (byChannel.get(ch.id) || []).sort((a, b) => a.start.getTime() - b.start.getTime());
      ch.now = list.find((p) => p.start <= now && p.end > now);
      ch.next = list.find((p) => p.start >= (ch.now?.end ?? now));
    }
  } catch {
    // No guide is fine — channels still play.
  }

  return channels.sort((a, b) => (parseFloat(a.number) || 9999) - (parseFloat(b.number) || 9999));
}

/**
 * Ask Jellyfin to open the channel and hand back a stream this device can play.
 * IPTV is usually MPEG-TS, which browsers can't play, so we ask for fragmented MP4 with H.264 video
 * (copied, not re-encoded, when the channel already is H.264 — cheap for the Pi) and AAC audio.
 */
export async function openLiveStream(channelId: string, signal?: AbortSignal): Promise<LiveStreamHandle> {
  const { base, token, userId, deviceId } = cfg();
  const body = {
    UserId: userId,
    AutoOpenLiveStream: true,
    MaxStreamingBitrate: 20_000_000,
    EnableDirectPlay: false,
    DeviceProfile: {
      MaxStreamingBitrate: 20_000_000,
      DirectPlayProfiles: [],
      TranscodingProfiles: [
        {
          Container: 'mp4',
          Type: 'Video',
          VideoCodec: 'h264',
          AudioCodec: 'aac',
          Context: 'Streaming',
          Protocol: 'http',
          MaxAudioChannels: '2',
          BreakOnNonKeyFrames: true
        }
      ],
      ContainerProfiles: [],
      CodecProfiles: [],
      SubtitleProfiles: []
    }
  };

  const res = await fetch(`${base}/Items/${channelId}/PlaybackInfo?userId=${userId}`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify(body),
    signal
  });
  if (!res.ok) throw new Error(`The server couldn't open this channel (${res.status})`);
  const info = await res.json();
  const source = info.MediaSources?.[0];
  if (info.ErrorCode || !source?.TranscodingUrl) {
    throw new Error(info.ErrorCode ? `The server couldn't open this channel (${info.ErrorCode})` : 'No playable stream for this channel');
  }

  let url = `${base}${source.TranscodingUrl}`;
  if (!/[?&](api_key|ApiKey)=/i.test(url)) url += `${url.includes('?') ? '&' : '?'}ApiKey=${token}`;
  if (deviceId && !/[?&]DeviceId=/i.test(url)) url += `&DeviceId=${encodeURIComponent(deviceId)}`;
  return { url, liveStreamId: source.LiveStreamId, playSessionId: info.PlaySessionId };
}

/** Release the tuner and stop the server-side conversion. Fire-and-forget. */
export function closeLiveStream(handle: LiveStreamHandle | null): void {
  if (!handle) return;
  const { base, deviceId } = cfg();
  if (handle.liveStreamId) {
    fetch(`${base}/LiveStreams/Close?liveStreamId=${encodeURIComponent(handle.liveStreamId)}`, {
      method: 'POST',
      headers: headers()
    }).catch(() => {});
  }
  if (handle.playSessionId) {
    fetch(`${base}/Videos/ActiveEncodings?deviceId=${encodeURIComponent(deviceId || '')}&playSessionId=${encodeURIComponent(handle.playSessionId)}`, {
      method: 'DELETE',
      headers: headers()
    }).catch(() => {});
  }
}
