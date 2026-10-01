/**
 * Jellyfin TV Service
 * Complete functional service for Jellyfin TV Series hierarchy,
 * Next Up, seasons, episodes, playback reporting, and watched status.
 */

import { jellyfinClient, JellyfinItem, imageQuery } from '../api/jellyfin';
import { queueProgress } from './downloads';
import { SubtitleTrack, AudioTrack } from '../mockData';

export interface EpisodeChapter {
  StartPositionTicks: number;
  Name: string;
  ImagePath?: string;
  MarkerType?: 'IntroStart' | 'IntroEnd' | 'CreditsStart' | 'Chapter';
}

export interface EpisodeMediaSource {
  Id: string;
  Name: string;
  Path?: string;
  Container?: string;
  Size?: number;
  Bitrate?: number;
  VideoType?: string;
}

export interface JellyfinSeason {
  Id: string;
  Name: string;
  SeriesId: string;
  SeriesName: string;
  IndexNumber: number; // 0 for Specials, 1 for Season 1, etc.
  IsSpecial: boolean;
  Overview?: string;
  UserData?: {
    UnplayedItemCount?: number;
    PlayedPercentage?: number;
    Played: boolean;
    IsFavorite?: boolean;
  };
}

export interface JellyfinEpisode {
  Id: string;
  Name: string;
  SeriesId: string;
  SeriesName: string;
  SeasonId: string;
  SeasonName: string;
  IndexNumber: number; // Episode Number
  ParentIndexNumber: number; // Season Number
  Overview?: string;
  RunTimeTicks?: number;
  AirsBeforeSeasonNumber?: number;
  AirsAfterSeasonNumber?: number;
  AirsBeforeEpisodeNumber?: number;
  ProductionYear?: number;
  PremiereDate?: string;
  CommunityRating?: number;
  PrimaryImageAspectRatio?: number;
  HasBackdrop?: boolean;
  BackdropUrl?: string;
  ImageUrl?: string;
  MediaSources?: EpisodeMediaSource[];
  MediaStreams?: any[];
  SubtitleTracks?: SubtitleTrack[];
  AudioTracks?: AudioTrack[];
  Chapters?: EpisodeChapter[];
  IntroMarker?: {
    startTicks: number;
    endTicks: number;
  };
  CreditsMarker?: {
    startTicks: number;
  };
  UserData?: {
    PlaybackPositionTicks: number;
    PlayedPercentage: number;
    Played: boolean;
    IsFavorite: boolean;
    PlayCount: number;
  };
}

export class JellyfinTvService {
  private get baseUrl(): string {
    return jellyfinClient.getConfig().serverUrl?.trim().replace(/\/$/, '') || '';
  }

  private get userId(): string {
    return jellyfinClient.getConfig().userId;
  }

  private get token(): string {
    return jellyfinClient.getConfig().accessToken;
  }

  private getHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
    // Same client/device identity as the rest of the app (jellyfinClient)
    return jellyfinClient.getRequestHeaders({ Accept: 'application/json', ...extraHeaders });
  }

  /**
   * 1. Query /Shows/NextUp: Retrieve exact next unwatched or in-progress episode
   */
  public async getNextUp(limit = 16): Promise<JellyfinEpisode[]> {
    if (!this.token || !this.userId) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/Shows/NextUp?userId=${this.userId}&limit=${limit}&Fields=Overview,PrimaryImageAspectRatio,MediaStreams,UserData,Chapters,MediaSources`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`NextUp query failed: ${res.statusText}`);
      const data = await res.json();
      const items: any[] = data.Items || [];
      return items.map((item) => this.mapRawEpisode(item));
    } catch (err) {
      console.warn('Failed to fetch live NextUp, falling back to mock:', err);
      return [];
    }
  }

  /**
   * 2. Query /Shows/{seriesId}/Seasons: Retrieve all seasons (including Specials / Season 0)
   */
  public async getSeasons(seriesId: string): Promise<JellyfinSeason[]> {
    if (!this.token || !seriesId) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/Shows/${seriesId}/Seasons?userId=${this.userId}&Fields=Overview,UserData`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`Seasons query failed: ${res.statusText}`);
      const data = await res.json();
      const items: any[] = data.Items || [];

      const seasons: JellyfinSeason[] = items.map((s) => ({
        Id: s.Id,
        Name: s.Name || (s.IndexNumber === 0 ? 'Specials' : `Season ${s.IndexNumber}`),
        SeriesId: seriesId,
        SeriesName: s.SeriesName || '',
        IndexNumber: s.IndexNumber ?? 1,
        IsSpecial: s.IndexNumber === 0,
        Overview: s.Overview,
        UserData: s.UserData
      }));

      // Sort: Regular seasons ascending (1, 2, 3), with Specials / Season 0 cleanly placed
      seasons.sort((a, b) => {
        if (a.IndexNumber === 0) return 1; // Put specials at end or handled explicitly
        if (b.IndexNumber === 0) return -1;
        return a.IndexNumber - b.IndexNumber;
      });

      return seasons;
    } catch (err) {
      console.warn('Failed to fetch seasons for series:', seriesId, err);
      return [];
    }
  }

  /**
   * 3. Query /Shows/{seriesId}/Episodes: Fetch complete episode metadata, streams, chapters
   */
  public async getEpisodes(seriesId: string, seasonId: string): Promise<JellyfinEpisode[]> {
    if (!this.token || !seriesId) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/Shows/${seriesId}/Episodes?seasonId=${seasonId}&userId=${this.userId}&Fields=Overview,PrimaryImageAspectRatio,MediaStreams,UserData,Chapters,MediaSources,People,RunTimeTicks`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) throw new Error(`Episodes query failed: ${res.statusText}`);
      const data = await res.json();
      const items: any[] = data.Items || [];
      return items.map((item) => this.mapRawEpisode(item));
    } catch (err) {
      console.warn('Failed to fetch episodes for season:', seasonId, err);
      return [];
    }
  }

  /**
   * Next episode after `episodeId`, crossing season boundaries (S1 finale → S2E1).
   * Uses /Shows/{seriesId}/Episodes?startItemId=… which returns the episode itself followed by the next one.
   * Resolves the series id from the server when it is not known. Returns null at the series finale or on error.
   */
  public async getNextEpisode(episodeId: string, seriesId?: string): Promise<JellyfinEpisode | null> {
    if (!this.token || !episodeId) return null;
    const isJellyfinId = (id?: string) => !!id && /^[a-f0-9]{32}$/i.test(id);

    try {
      let sid = isJellyfinId(seriesId) ? seriesId : undefined;
      if (!sid) {
        const res = await fetch(`${this.baseUrl}/Items?Ids=${episodeId}&userId=${this.userId}&Fields=SeriesId`, {
          headers: this.getHeaders()
        });
        if (!res.ok) return null;
        sid = (await res.json()).Items?.[0]?.SeriesId;
        if (!sid) return null;
      }

      const url = `${this.baseUrl}/Shows/${sid}/Episodes?startItemId=${episodeId}&limit=2&userId=${this.userId}&Fields=Overview,PrimaryImageAspectRatio,MediaStreams,UserData,Chapters,MediaSources,RunTimeTicks`;
      const res = await fetch(url, { headers: this.getHeaders() });
      if (!res.ok) return null;
      const items: any[] = (await res.json()).Items || [];
      const idx = items.findIndex((i) => i.Id === episodeId);
      const next = idx === -1 ? null : items[idx + 1];
      return next ? this.mapRawEpisode(next) : null;
    } catch (err) {
      console.warn('getNextEpisode failed:', err);
      return null;
    }
  }

  /**
   * 4. Toggle Played / Unplayed State for an episode
   */
  public async markPlayedStatus(episodeId: string, played: boolean): Promise<boolean> {
    if (!this.token || !this.userId) {
      return true;
    }

    try {
      const endpoint = `${this.baseUrl}/Users/${this.userId}/PlayedItems/${episodeId}`;
      const res = await fetch(endpoint, {
        method: played ? 'POST' : 'DELETE',
        headers: this.getHeaders()
      });
      return res.ok;
    } catch (e) {
      console.warn('Failed to update episode played status:', e);
      return false;
    }
  }

  /**
   * 5. Toggle Favorite on a Show or Episode
   */
  public async markFavoriteStatus(itemId: string, isFavorite: boolean): Promise<boolean> {
    if (!this.token || !this.userId) {
      return true;
    }

    try {
      const endpoint = `${this.baseUrl}/Users/${this.userId}/FavoriteItems/${itemId}`;
      const res = await fetch(endpoint, {
        method: isFavorite ? 'POST' : 'DELETE',
        headers: this.getHeaders()
      });
      return res.ok;
    } catch (e) {
      console.warn('Failed to update favorite status:', e);
      return false;
    }
  }

  /**
   * 6. Playback Session Lifecycle: Report Playing Start
   */
  public async reportPlaybackStart(
    itemId: string,
    positionTicks = 0,
    audioIndex?: number,
    subtitleIndex?: number,
    /** Extra fields (Yudia Connect: VolumeLevel, IsMuted, IsPaused, NowPlayingQueue…). */
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${this.baseUrl}/Sessions/Playing`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ItemId: itemId,
          PositionTicks: positionTicks,
          AudioStreamIndex: audioIndex,
          SubtitleStreamIndex: subtitleIndex,
          CanSeek: true,
          PlayMethod: 'DirectPlay',
          ...extra
        })
      });
    } catch (e) {
      console.warn('Failed to report playback start:', e);
    }
  }

  /**
   * 7. Playback Session Lifecycle: Report Progress Every 10s
   */
  public async reportPlaybackProgress(
    itemId: string,
    positionTicks: number,
    isPaused: boolean,
    audioIndex?: number,
    subtitleIndex?: number,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    if (!this.token) return;
    try {
      await fetch(`${this.baseUrl}/Sessions/Playing/Progress`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ItemId: itemId,
          PositionTicks: positionTicks,
          IsPaused: isPaused,
          AudioStreamIndex: audioIndex,
          SubtitleStreamIndex: subtitleIndex,
          EventName: 'timeupdate',
          CanSeek: true,
          ...extra
        })
      });
    } catch (e) {
      // Non-critical background telemetry
    }
  }

  /**
   * 8. Playback Session Lifecycle: Report Playback Stopped
   */
  public async reportPlaybackStop(itemId: string, positionTicks: number): Promise<void> {
    if (!this.token) return;
    const at = Date.now();
    try {
      await fetch(`${this.baseUrl}/Sessions/Playing/Stopped`, {
        method: 'POST',
        headers: this.getHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ItemId: itemId,
          PositionTicks: positionTicks
        })
      });
    } catch (e) {
      // Offline (e.g. watching a download): keep the position and send it when the server is reachable again
      queueProgress(itemId, positionTicks, at);
    }
  }

  /**
   * Map raw Jellyfin JSON into normalized JellyfinEpisode with markers & streams
   */
  public mapRawEpisode(item: any): JellyfinEpisode {
    const streams: any[] = item.MediaStreams || [];
    const chapters: any[] = item.Chapters || [];

    // Parse audio and subtitle streams
    const mediaSources: any[] = item.MediaSources || [];
    const primarySourceId = mediaSources[0]?.Id;

    const subtitleTracks: SubtitleTrack[] = streams
      .filter((s: any) => s.Type === 'Subtitle')
      .map((s: any, idx: number) => {
        const streamIdx = s.Index ?? idx;
        let subUrl = `${this.baseUrl}/Videos/${item.Id}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${this.token}`;
        if (s.DeliveryUrl) {
          subUrl = s.DeliveryUrl.startsWith('http')
            ? s.DeliveryUrl
            : `${this.baseUrl}${s.DeliveryUrl}${s.DeliveryUrl.includes('?') ? '&' : '?'}ApiKey=${this.token}`;
        } else if (primarySourceId) {
          subUrl = `${this.baseUrl}/Videos/${item.Id}/${primarySourceId}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${this.token}`;
        }

        return {
          id: `sub-${streamIdx}`,
          index: streamIdx,
          language: s.Language || 'und',
          displayTitle: s.DisplayTitle || `${s.Language?.toUpperCase() || 'Subtitle'} (${s.Codec || 'Text'})`,
          url: subUrl,
          isDefault: !!s.IsDefault,
          isForced: !!s.IsForced
        };
      });

    const audioTracks: AudioTrack[] = streams
      .filter((s: any) => s.Type === 'Audio')
      .map((s: any, idx: number) => ({
        id: `aud-${s.Index ?? idx}`,
        index: s.Index ?? idx,
        language: s.Language || 'und',
        displayTitle: s.DisplayTitle || `${s.Language?.toUpperCase() || 'Audio'} (${s.Codec || 'AAC'})`,
        codec: s.Codec,
        isDefault: !!s.IsDefault
      }));

    // Find intro and credits markers
    let introMarker: { startTicks: number; endTicks: number } | undefined = undefined;
    let creditsMarker: { startTicks: number } | undefined = undefined;

    const totalEpisodeTicks = item.RunTimeTicks 
      || item.MediaSources?.[0]?.RunTimeTicks
      || (chapters.length > 0 ? chapters[chapters.length - 1].StartPositionTicks + 180 * 10000000 : 0);

    // Check Jellyfin intro-skipper plugin timestamps or chapter names
    for (let i = 0; i < chapters.length; i++) {
      const c = chapters[i];
      const name = (c.Name || '').toLowerCase().trim();
      const posTicks = c.StartPositionTicks || 0;

      // 1. Intro marker: opening theme, intro title, must be in the first half of the episode
      const isIntroName = (
        name.includes('intro') ||
        name.includes('opening') ||
        name.includes('theme') ||
        name === 'op' ||
        c.MarkerType === 'IntroStart'
      ) && (totalEpisodeTicks === 0 || posTicks < totalEpisodeTicks * 0.5);

      if (isIntroName && !introMarker) {
        const nextChapter = chapters[i + 1];
        introMarker = {
          startTicks: posTicks,
          endTicks: nextChapter ? nextChapter.StartPositionTicks : posTicks + 90 * 10000000
        };
      }

      // 2. End Credits marker: closing theme, end credits, ending.
      // MUST NOT be "opening credits" and MUST be in the latter half / ending of the video (> 60% into episode or > 180s)
      const isEndCreditName = (
        name.includes('ending') ||
        name.includes('end credits') ||
        name.includes('closing credits') ||
        name.includes('outtro') ||
        name === 'ed' ||
        c.MarkerType === 'CreditsStart' ||
        (name.includes('credits') && !name.includes('opening') && !name.includes('title'))
      );

      const isLateEnoughForCredits = totalEpisodeTicks > 0
        ? posTicks >= totalEpisodeTicks * 0.65
        : posTicks >= 180 * 10000000;

      if (isEndCreditName && isLateEnoughForCredits && posTicks > 0) {
        creditsMarker = {
          startTicks: posTicks
        };
      }
    }

    // Check item tags for intro and credit
    const itemTags: string[] = (item.Tags || []).map((t: any) => String(t).toLowerCase());
    if (itemTags.includes('intro') && !introMarker) {
      introMarker = {
        startTicks: 15 * 10000000,
        endTicks: 90 * 10000000
      };
    }
    if ((itemTags.includes('credit') || itemTags.includes('credits')) && !creditsMarker && totalEpisodeTicks > 0) {
      creditsMarker = {
        startTicks: Math.max(totalEpisodeTicks * 0.5, totalEpisodeTicks - 90 * 10000000)
      };
    }

    return {
      Id: item.Id,
      Name: item.Name || `Episode ${item.IndexNumber || 1}`,
      SeriesId: item.SeriesId || '',
      SeriesName: item.SeriesName || '',
      SeasonId: item.SeasonId || '',
      SeasonName: item.SeasonName || `Season ${item.ParentIndexNumber || 1}`,
      IndexNumber: item.IndexNumber ?? 1,
      ParentIndexNumber: item.ParentIndexNumber ?? 1,
      Overview: item.Overview || 'No description available.',
      RunTimeTicks: item.RunTimeTicks || (totalEpisodeTicks > 0 ? totalEpisodeTicks : undefined),
      AirsBeforeSeasonNumber: item.AirsBeforeSeasonNumber,
      AirsAfterSeasonNumber: item.AirsAfterSeasonNumber,
      AirsBeforeEpisodeNumber: item.AirsBeforeEpisodeNumber,
      ProductionYear: item.ProductionYear,
      PremiereDate: item.PremiereDate,
      CommunityRating: item.CommunityRating,
      PrimaryImageAspectRatio: item.PrimaryImageAspectRatio || 1.77,
      HasBackdrop: !!(item.BackdropImageTags && item.BackdropImageTags.length > 0),
      BackdropUrl: item.BackdropImageTags?.length
        ? `${this.baseUrl}/Items/${item.Id}/Images/Backdrop?${imageQuery(1920, item.BackdropImageTags[0])}&ApiKey=${this.token}`
        : undefined,
      ImageUrl: `${this.baseUrl}/Items/${item.Id}/Images/Primary?${imageQuery(480, item.ImageTags?.Primary)}&ApiKey=${this.token}`,
      MediaSources: item.MediaSources,
      MediaStreams: item.MediaStreams,
      SubtitleTracks: subtitleTracks,
      AudioTracks: audioTracks,
      Chapters: chapters,
      IntroMarker: introMarker,
      CreditsMarker: creditsMarker,
      UserData: item.UserData
        ? {
            PlaybackPositionTicks: item.UserData.PlaybackPositionTicks || 0,
            PlayedPercentage: item.UserData.PlayedPercentage || 0,
            Played: !!item.UserData.Played,
            IsFavorite: !!item.UserData.IsFavorite,
            PlayCount: item.UserData.PlayCount || 0
          }
        : undefined
    };
  }

}

export const jellyfinTvService = new JellyfinTvService();
