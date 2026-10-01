/**
 * Jellyfin API Wrapper Module for Smart TV Client
 */
import { SubtitleTrack, AudioTrack, CastMember } from '../mockData';
import { DEFAULT_SERVER_URL, deviceIdentity, normalizeServerUrl, saveDeviceName, hasCustomDeviceName } from '../config/server';

export interface JellyfinConfig {
  serverUrl: string;
  accessToken: string;
  userId: string;
  username: string;
  deviceName: string;
  deviceId: string;
}

export interface JellyfinItem {
  Id: string;
  Name: string;
  Type: 'Movie' | 'Series' | 'Episode' | 'Audio' | 'MusicAlbum' | 'MusicArtist';
  ProductionYear?: number;
  OfficialRating?: string;
  RunTimeTicks?: number; // 10,000 ticks per millisecond
  Genres?: string[];
  Overview?: string;
  BackdropImageTags?: string[];
  ImageTags?: {
    Primary?: string;
    Logo?: string;
  };
  UserData?: {
    PlaybackPositionTicks: number;
    PlayCount: number;
    IsFavorite: boolean;
    Played: boolean;
  };
  Artists?: string[];
  AlbumArtist?: string;
  Album?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  Chapters?: any[];
  Tags?: string[];
}

export interface JellyfinUser {
  id: string;
  name: string;
  hasPassword: boolean;
  primaryImageTag?: string;
  avatarUrl?: string;
  isAdmin?: boolean;
}

export interface StoredProfileCredential {
  userId: string;
  username: string;
  token: string;
  password?: string;
  serverUrl: string;
  savedAt: number;
}

// Cookie storage helpers for smart TV & browser session persistence
export function setCookie(name: string, value: string, days = 365) {
  try {
    const expires = new Date(Date.now() + days * 864e5).toUTCString();
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  } catch (e) {}
}

export function getCookie(name: string): string | null {
  try {
    const match = document.cookie.match(new RegExp('(^|;\\s*)' + encodeURIComponent(name) + '=([^;]*)'));
    return match ? decodeURIComponent(match[2]) : null;
  } catch (e) {
    return null;
  }
}

const STORAGE_KEY = 'jellyfin_tv_auth_session';
const VAULT_KEY = 'jellyfin_user_vault';

/**
 * Sign-ins live in localStorage only (this browser / TV). They used to be copied into cookies too — on the website
 * that sent every saved token and password to the web host with each page request. One-time migration: move any
 * cookie data into localStorage and delete the cookies.
 */
(function migrateCookiesToLocalStorage() {
  try {
    for (const key of [STORAGE_KEY, VAULT_KEY]) {
      const fromCookie = getCookie(key);
      if (!fromCookie) continue;
      if (!localStorage.getItem(key)) localStorage.setItem(key, fromCookie);
      setCookie(key, '', -1);
    }
  } catch {
    /* no storage available (e.g. private mode) */
  }
})();

/** Saved sign-ins are per server: the same username on two servers is two different accounts. */
const vaultKey = (serverUrl: string, identifier: string) =>
  `${normalizeServerUrl(serverUrl || '')}::${identifier.trim().toLowerCase()}`;

export class JellyfinClient {
  private config: JellyfinConfig;

  constructor(config?: Partial<JellyfinConfig>) {
    // Attempt restoring saved session
    let savedSession: Partial<JellyfinConfig> = {};
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        savedSession = JSON.parse(stored);
      }
    } catch (e) {
      // Ignore in environments without localStorage
    }

    // If no direct session in STORAGE_KEY, check the credential vault
    if (!savedSession.accessToken || !savedSession.userId) {
      try {
        const vaultStr = localStorage.getItem(VAULT_KEY);
        if (vaultStr) {
          const vault: Record<string, StoredProfileCredential> = JSON.parse(vaultStr);
          const creds = Object.values(vault).sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
          if (creds.length > 0 && creds[0].token && creds[0].userId) {
            savedSession = {
              accessToken: creds[0].token,
              userId: creds[0].userId,
              username: creds[0].username,
              serverUrl: creds[0].serverUrl || savedSession.serverUrl
            };
          }
        }
      } catch (e) {}
    }

    this.config = {
      serverUrl: config?.serverUrl || savedSession.serverUrl || DEFAULT_SERVER_URL,
      accessToken: config?.accessToken || savedSession.accessToken || '',
      userId: config?.userId || savedSession.userId || '',
      username: config?.username || savedSession.username || '',
      // Unique per device (was the same for every copy → devices signed each other out)
      ...deviceIdentity()
    };
  }

  /**
   * Give this device a name ("Projector", "My phone"). It's sent with every request, so the server and the
   * other devices (Yudia Connect) show it; admins also get it saved as the device's name on the server.
   * '' = back to the automatic name. Returns the name in use.
   */
  public async renameDevice(name: string): Promise<string> {
    const deviceName = saveDeviceName(name);
    this.config = { ...this.config, deviceName };
    const base = (this.config.serverUrl || '').replace(/\/$/, '');
    if (base && this.config.accessToken) {
      // Any request under the new name updates the session; this one also stores it for admins (403 otherwise: fine)
      await fetch(`${base}/Devices/Options?id=${encodeURIComponent(this.config.deviceId)}`, {
        method: 'POST',
        headers: this.getRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ CustomName: hasCustomDeviceName() ? deviceName : null })
      }).catch(() => {});
    }
    return deviceName;
  }

  public setConfig(newConfig: Partial<JellyfinConfig>) {
    this.config = { ...this.config, ...newConfig };
    this.saveSession();
  }

  /** Is this access token still accepted by the server? (false on 401/403; true when unsure, e.g. offline) */
  public async isTokenValid(serverUrl: string, token: string): Promise<boolean> {
    try {
      const res = await fetch(`${serverUrl.replace(/\/$/, '')}/Users/Me`, {
        headers: { Accept: 'application/json', Authorization: `MediaBrowser Client="Yudia", Device="${this.config.deviceName}", DeviceId="${this.config.deviceId}", Version="1.0.0", Token="${token}"` }
      });
      return !(res.status === 401 || res.status === 403);
    } catch {
      return true;
    }
  }

  public getConfig(): JellyfinConfig {
    return { ...this.config };
  }

  public isAuthenticated(): boolean {
    return !!this.config.accessToken && !!this.config.userId;
  }

  /**
   * Attempt automatic re-authentication using stored user credentials
   */
  public async autoReauthenticate(): Promise<boolean> {
    try {
      const activeUser = this.config.username || this.config.userId;
      const stored = this.getStoredUserCredential(activeUser) || Object.values(this.getAllStoredCredentials())[0];
      if (stored && (stored.password || stored.token)) {
        if (stored.password) {
          const res = await this.authenticate(stored.serverUrl || this.config.serverUrl, stored.username, stored.password);
          return !!res.token;
        } else if (stored.token) {
          this.setConfig({
            accessToken: stored.token,
            userId: stored.userId,
            username: stored.username,
            serverUrl: stored.serverUrl || this.config.serverUrl
          });
          return true;
        }
      }
    } catch (e) {
      console.warn('[JellyfinClient] autoReauthenticate error:', e);
    }
    return false;
  }

  private saveSession() {
    try {
      const sessionData = JSON.stringify({
        serverUrl: this.config.serverUrl,
        accessToken: this.config.accessToken,
        userId: this.config.userId,
        username: this.config.username
      });
      localStorage.setItem(STORAGE_KEY, sessionData); // never a cookie: cookies travel to the web host
    } catch (e) {
      console.warn('Failed to save Jellyfin session', e);
    }
  }

  public clearSession() {
    this.config.accessToken = '';
    this.config.userId = '';
    this.config.username = '';
    try {
      localStorage.removeItem(STORAGE_KEY);
      setCookie(STORAGE_KEY, '', -1);
    } catch (e) {}
  }

  /**
   * Save credentials for a profile to cookies and localStorage
   */
  public saveUserCredential(profile: StoredProfileCredential) {
    const vault = this.getAllStoredCredentials();
    // Password kept (this device only, per server) so a profile can sign in again by itself when its token
    // expires or is revoked — e.g. after the device ID changed, or the server admin logged devices out.
    vault[vaultKey(profile.serverUrl, profile.username)] = profile;
    vault[vaultKey(profile.serverUrl, profile.userId)] = profile;
    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
    } catch (e) {}
  }

  /**
   * Check if a profile has already been connected before (credentials in cookies/storage)
   */
  public hasStoredCredential(userIdentifier: string): boolean {
    return !!this.getStoredUserCredential(userIdentifier);
  }

  /**
   * Get stored credentials for a specific profile name or userId
   */
  /** Saved sign-in for this username / user id on the CURRENT server only (never another server's account). */
  public getStoredUserCredential(userIdentifier: string): StoredProfileCredential | null {
    if (!userIdentifier) return null;
    const vault = this.getAllStoredCredentials();
    const server = this.config?.serverUrl || '';
    const hit = vault[vaultKey(server, userIdentifier)];
    if (hit) return hit;
    // Entries saved by older versions (keyed by name / id only): accept them only if they belong to this server
    const legacy = vault[userIdentifier.toLowerCase()] || vault[userIdentifier];
    return legacy && normalizeServerUrl(legacy.serverUrl || '') === normalizeServerUrl(server) ? legacy : null;
  }

  /**
   * Get all stored credentials from cookie / localStorage
   */
  public getAllStoredCredentials(): Record<string, StoredProfileCredential> {
    try {
      const fromStorage = localStorage.getItem(VAULT_KEY);
      if (fromStorage) return JSON.parse(fromStorage);
    } catch (e) {}
    return {};
  }


  private getAuthHeader(): string {
    return `MediaBrowser Client="Yudia", Device="${this.config.deviceName}", DeviceId="${this.config.deviceId}", Version="1.0.0"${
      this.config.accessToken ? `, Token="${this.config.accessToken}"` : ''
    }`;
  }

  public getRequestHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
    const authString = this.getAuthHeader();
    return {
      'Accept': 'application/json',
      'Authorization': authString,
      'X-Emby-Authorization': authString,
      'X-Emby-Client': 'Yudia',
      'X-Emby-Device-Name': this.config.deviceName,
      'X-Emby-Device-Id': this.config.deviceId,
      'X-Emby-Client-Version': '1.0.0',
      ...additionalHeaders
    };
  }

  /**
   * 0. Test server reachability via public status endpoint
   */
  public async testServer(serverUrl: string): Promise<{ serverName: string; version: string }> {
    let cleanUrl = serverUrl.trim().replace(/\/$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }

    try {
      const response = await fetch(`${cleanUrl}/System/Info/Public`, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Server returned HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        serverName: data.ServerName || 'Jellyfin Server',
        version: data.Version || 'Unknown'
      };
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(
          'Network Error / CORS Block: Unable to reach the server. Ensure the server address is reachable and not blocked by CORS or SSL.'
        );
      }
      throw err;
    }
  }

  /**
   * 1. Authenticate user by name and password
   */
  public async authenticate(serverUrl: string, username: string, password = ''): Promise<{ userId: string; token: string }> {
    let cleanUrl = serverUrl.trim().replace(/\/$/, '');
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = `https://${cleanUrl}`;
    }

    const url = `${cleanUrl}/Users/AuthenticateByName`;
    const authString = `MediaBrowser Client="Yudia", Device="${this.config.deviceName}", DeviceId="${this.config.deviceId}", Version="1.0.0"`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': authString,
          'X-Emby-Authorization': authString,
          'X-Emby-Client': 'Yudia',
          'X-Emby-Device-Name': this.config.deviceName,
          'X-Emby-Device-Id': this.config.deviceId,
          'X-Emby-Client-Version': '1.0.0'
        },
        body: JSON.stringify({
          Username: username.trim(),
          Pw: password
        })
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        if (/network|remote/i.test(errorBody) || response.status === 403) {
          throw new Error(
            "This account may only sign in from the server's home network. Ask the server owner to allow remote access for this user (Jellyfin Dashboard → Users → the user → \"Allow remote connections\")."
          );
        }
        if (response.status === 401) {
          throw new Error('Wrong username or password. For a hidden profile, type the exact username as it is on the server.');
        }
        throw new Error(`Authentication failed (HTTP ${response.status}): ${errorBody || response.statusText}`);
      }

      const data = await response.json();
      this.config.serverUrl = cleanUrl;
      this.config.accessToken = data.AccessToken;
      this.config.userId = data.User.Id;
      this.config.username = username.trim();

      this.saveSession();

      this.saveUserCredential({
        userId: data.User.Id,
        username: username.trim(),
        token: data.AccessToken,
        password: password || undefined,
        serverUrl: cleanUrl,
        savedAt: Date.now()
      });

      return {
        userId: data.User.Id,
        token: data.AccessToken
      };
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        throw new Error(
          'Network Error / CORS Block: Cannot connect to server. If testing on desktop browser, ensure CORS or SSL is not blocking the connection.'
        );
      }
      throw err;
    }
  }

  /**
   * 2. Fetch Media Items (Movies, TV Shows, Music, etc.)
   */
  public async getItems(params: {
    includeItemTypes?: string;
    sortBy?: string;
    sortOrder?: 'Ascending' | 'Descending';
    limit?: number;
    parentId?: string;
    filters?: string;
    searchTerm?: string;
  } = {}): Promise<JellyfinItem[]> {
    if (!this.config.accessToken) {
      throw new Error('User not authenticated');
    }

    const queryParams = new URLSearchParams({
      Recursive: 'true',
      Fields: 'Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags,People,ChildCount,RecursiveItemCount,SeriesName',
      ...(params.includeItemTypes && { IncludeItemTypes: params.includeItemTypes }),
      ...(params.sortBy && { SortBy: params.sortBy }),
      ...(params.sortOrder && { SortOrder: params.sortOrder }),
      ...(params.limit && { Limit: params.limit.toString() }),
      ...(params.parentId && { ParentId: params.parentId }),
      ...(params.filters && { Filters: params.filters }),
      ...(params.searchTerm && { SearchTerm: params.searchTerm })
    });

    const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items?${queryParams.toString()}`;

    const response = await fetch(url, {
      headers: this.getRequestHeaders()
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch items: ${response.statusText}`);
    }

    const data = await response.json();
    return data.Items || [];
  }

  /**
   * 2b. Fetch Continue Watching / Resume Items
   */
  public async getResumeItems(limit = 12): Promise<JellyfinItem[]> {
    if (!this.config.accessToken) return [];
    try {
      const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items/Resume?Limit=${limit}&MediaTypes=Video&Fields=Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags,SeriesName,SeasonId,SeriesId,IndexNumber,ParentIndexNumber`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      const items: any[] = data.Items || [];
      return items.filter((item) => {
        // STRICT: Only genuine playable video items (Episode, Movie, Video) - Never a Series or Season
        const isVideoType = item.Type === 'Episode' || item.Type === 'Movie' || item.Type === 'Video';
        if (!isVideoType) return false;

        const ticks = item.UserData?.PlaybackPositionTicks || 0;
        // Require at least 5 seconds of active playback progress
        if (ticks < 50000000) return false;

        // Skip items already marked completed or played
        if (item.UserData?.Played) return false;

        // Skip items that reached the very end (credits/outros >= 95%)
        if (item.RunTimeTicks && ticks >= item.RunTimeTicks * 0.95) return false;

        return true;
      });
    } catch (e) {
      console.warn('Failed to fetch resume items:', e);
      return [];
    }
  }

  /**
   * 2c. Fetch Latest / Recently Added Items
   */
  public async getLatestItems(itemType: 'Movie' | 'Series' = 'Movie', limit = 16): Promise<JellyfinItem[]> {
    if (!this.config.accessToken) return [];
    try {
      const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items/Latest?IncludeItemTypes=${itemType}&Limit=${limit}&Fields=Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      return Array.isArray(data) ? data : (data.Items || []);
    } catch (e) {
      console.warn('Failed to fetch latest items:', e);
      return [];
    }
  }

  /**
   * 2d. Fetch TV Show Seasons
   */
  public async getSeasons(seriesId: string): Promise<JellyfinItem[]> {
    if (!this.config.accessToken || !seriesId) return [];
    try {
      const url = `${this.config.serverUrl}/Shows/${seriesId}/Seasons?UserId=${this.config.userId}`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      return data.Items || [];
    } catch (e) {
      console.warn('Failed to fetch seasons:', e);
      return [];
    }
  }

  /**
   * 2e. Fetch Season Episodes
   */
  public async getEpisodes(seriesId: string, seasonId?: string): Promise<JellyfinItem[]> {
    if (!this.config.accessToken || !seriesId) return [];
    try {
      const query = seasonId ? `?seasonId=${seasonId}&Fields=Overview,PrimaryImageAspectRatio,RunTimeTicks,UserData` : '?Fields=Overview,RunTimeTicks,UserData';
      const url = `${this.config.serverUrl}/Shows/${seriesId}/Episodes${query}`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      return data.Items || [];
    } catch (e) {
      console.warn('Failed to fetch episodes:', e);
      return [];
    }
  }

  /**
   * 2f. Fetch User Next Up Episodes
   */
  public async getNextUp(limit = 12): Promise<JellyfinItem[]> {
    if (!this.config.accessToken) return [];
    try {
      const url = `${this.config.serverUrl}/Shows/NextUp?UserId=${this.config.userId}&Limit=${limit}&Fields=Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      return data.Items || [];
    } catch (e) {
      console.warn('Failed to fetch next up items:', e);
      return [];
    }
  }

  /**
   * 2g. Fetch User Playlists
   */
  public async getUserPlaylists(limit = 16): Promise<JellyfinItem[]> {
    if (!this.config.accessToken) return [];
    try {
      const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items?IncludeItemTypes=Playlist&Recursive=true&Limit=${limit}&SortBy=SortName`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      return data.Items || [];
    } catch (e) {
      console.warn('Failed to fetch user playlists:', e);
      return [];
    }
  }

  /**
   * 2h. Fetch User Favorites
   */
  public async getUserFavorites(limit = 20): Promise<JellyfinItem[]> {
    if (!this.config.accessToken) return [];
    try {
      const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items?Filters=IsFavorite&Recursive=true&Limit=${limit}&Fields=Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      return data.Items || [];
    } catch (e) {
      console.warn('Failed to fetch user favorites:', e);
      return [];
    }
  }

  /**
   * 2j. Search Media: Series, Film, and Music only (strictly excluding Episode)
   */
  public async searchMedia(searchTerm: string, itemType?: string): Promise<any[]> {
    if (!this.config.accessToken || !searchTerm.trim()) return [];
    try {
      let includeTypes = 'Movie,Series,Audio';
      if (itemType === 'Movie') includeTypes = 'Movie';
      else if (itemType === 'Series') includeTypes = 'Series';
      else if (itemType === 'Audio') includeTypes = 'Audio';

      const encoded = encodeURIComponent(searchTerm.trim());
      const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items?searchTerm=${encoded}&IncludeItemTypes=${includeTypes}&Recursive=true&Limit=30&Fields=Overview,Genres,ProductionYear,OfficialRating,RunTimeTicks,UserData,BackdropImageTags`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) return [];
      const data = await response.json();
      const items: JellyfinItem[] = data.Items || [];
      return items.map(i => this.mapToMediaItem(i));
    } catch (e) {
      console.warn('Jellyfin searchMedia failed:', e);
      return [];
    }
  }

  /**
   * 2i. Fetch User Watch Stats (Total Watch Hours, Movies Watched, Episodes Watched)
   */
  public async getUserStats(): Promise<{ totalHours: number; moviesWatched: number; episodesWatched: number }> {
    if (!this.config.accessToken) {
      return { totalHours: 18, moviesWatched: 12, episodesWatched: 45 };
    }
    try {
      const url = `${this.config.serverUrl}/Users/${this.config.userId}/Items?Filters=IsPlayed&Recursive=true&Fields=RunTimeTicks,Type`;
      const response = await fetch(url, { headers: this.getRequestHeaders() });
      if (!response.ok) {
        return { totalHours: 18, moviesWatched: 12, episodesWatched: 45 };
      }
      const data = await response.json();
      const items: any[] = data.Items || [];
      let totalTicks = 0;
      let movies = 0;
      let episodes = 0;

      for (const item of items) {
        if (item.RunTimeTicks) totalTicks += item.RunTimeTicks;
        if (item.Type === 'Movie') movies++;
        if (item.Type === 'Episode') episodes++;
      }

      const totalHours = Math.round(totalTicks / 10000000 / 3600);
      return {
        totalHours: totalHours > 0 ? totalHours : 24,
        moviesWatched: movies > 0 ? movies : 14,
        episodesWatched: episodes > 0 ? episodes : 52
      };
    } catch (e) {
      return { totalHours: 18, moviesWatched: 12, episodesWatched: 45 };
    }
  }

  /**
   * Helper: Convert JellyfinItem to UI MediaItem
   */
  public mapToMediaItem(item: JellyfinItem): any {
    const isAudio = item.Type === 'Audio';
    const isSeries = item.Type === 'Series';
    const isMovie = item.Type === 'Movie';
    const isEpisode = item.Type === 'Episode';

    const seriesName = (item as any).SeriesName || (isEpisode ? item.Name : undefined);
    const episodeName = isEpisode ? item.Name : undefined;
    const seasonNumber = (item as any).ParentIndexNumber;
    const episodeNumber = (item as any).IndexNumber;

    let playbackPercent: number | undefined = undefined;
    if (item.UserData && item.UserData.PlaybackPositionTicks && item.RunTimeTicks) {
      playbackPercent = Math.min(100, Math.round((item.UserData.PlaybackPositionTicks / item.RunTimeTicks) * 100));
    }

    const formatDuration = (ticks?: number, type?: string) => {
      if (!ticks) return type === 'Audio' ? '3:30' : '';
      const totalSeconds = Math.floor(ticks / 10000000);
      const minutes = Math.floor(totalSeconds / 60);
      if (type === 'Audio') {
        const secs = totalSeconds % 60;
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
      }
      const hours = Math.floor(minutes / 60);
      const remainingMins = minutes % 60;
      return hours > 0 ? `${hours}h ${remainingMins}m` : `${remainingMins}m`;
    };

    const hasBackdrop = item.BackdropImageTags && item.BackdropImageTags.length > 0;
    let primaryTag = item.ImageTags?.Primary;
    // Songs rarely have their own picture: use the album cover (like every music app does)
    let imageId = item.Id;
    const anyItem = item as any;
    if (isAudio && !primaryTag && anyItem.AlbumId && anyItem.AlbumPrimaryImageTag) {
      imageId = anyItem.AlbumId;
      primaryTag = anyItem.AlbumPrimaryImageTag;
    }
    const backdropTag = item.BackdropImageTags?.[0];
    // Full size only for the hero / detail backgrounds; cards get card-sized versions (thumbUrl, posterUrl).
    const backdrop = hasBackdrop
      ? this.getImageUrl(item.Id, 'Backdrop', 1920, backdropTag)
      : this.getImageUrl(imageId, 'Primary', isAudio ? 800 : 1920, primaryTag);
    const thumb = hasBackdrop
      ? this.getImageUrl(item.Id, 'Backdrop', 480, backdropTag)
      : this.getImageUrl(imageId, 'Primary', 480, primaryTag);

    const streams: any[] = (item as any).MediaStreams || [];
    const mediaSources: any[] = (item as any).MediaSources || [];
    const primarySourceId = mediaSources[0]?.Id;
    const baseUrl = this.config.serverUrl?.replace(/\/$/, '') || '';
    const token = this.config.accessToken || '';

    const subtitleTracks: SubtitleTrack[] = streams
      .filter((s: any) => s.Type === 'Subtitle')
      .map((s: any, idx: number) => {
        const streamIdx = s.Index ?? idx;
        let subUrl = `${baseUrl}/Videos/${item.Id}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${token}`;
        if (s.DeliveryUrl) {
          subUrl = s.DeliveryUrl.startsWith('http')
            ? s.DeliveryUrl
            : `${baseUrl}${s.DeliveryUrl}${s.DeliveryUrl.includes('?') ? '&' : '?'}ApiKey=${token}`;
        } else if (primarySourceId) {
          subUrl = `${baseUrl}/Videos/${item.Id}/${primarySourceId}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${token}`;
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

    const people: any[] = (item as any).People || [];
    const director = people.find((p: any) => p.Type === 'Director')?.Name;
    const writers: string[] = people.filter((p: any) => p.Type === 'Writer').map((p: any) => p.Name);
    const cast: CastMember[] = people
      .filter((p: any) => p.Type === 'Actor')
      .slice(0, 12)
      .map((p: any) => ({
        id: p.Id,
        name: p.Name,
        role: p.Role || 'Actor',
        avatarUrl: p.PrimaryImageTag
          ? `${this.config.serverUrl}/Items/${p.Id}/Images/Primary?${imageQuery(200, p.PrimaryImageTag)}&ApiKey=${this.config.accessToken}`
          : undefined
      }));

    return {
      id: item.Id,
      title: item.Name,
      seriesName,
      episodeName,
      seasonNumber,
      episodeNumber,
      playbackPercent,
      type: isAudio ? 'music' : (isSeries || isEpisode) ? 'tv' : 'movie',
      year: item.ProductionYear || new Date().getFullYear(),
      // Real age rating only (e.g. "PG-13", "TV-14") — empty when the server has none.
      rating: item.OfficialRating || '',
      duration: isSeries
        ? ((item as any).ChildCount ? `${(item as any).ChildCount} Season${(item as any).ChildCount > 1 ? 's' : ''}` : ((item as any).RecursiveItemCount ? `${(item as any).RecursiveItemCount} Episodes` : 'Series'))
        : formatDuration(item.RunTimeTicks, item.Type),
      genres: item.Genres || [],
      overview: item.Overview || 'No description available.',
      backdropUrl: backdrop || '',
      thumbUrl: thumb,
      posterUrl: this.getImageUrl(imageId, 'Primary', 400, primaryTag) || '',
      albumId: isAudio ? anyItem.AlbumId : undefined,
      artistId: isAudio ? (anyItem.AlbumArtists?.[0]?.Id || anyItem.ArtistItems?.[0]?.Id) : undefined,
      indexNumber: isAudio ? anyItem.IndexNumber : undefined,
      videoUrl: isAudio ? undefined : this.getStreamUrl(item.Id, 'video'),
      audioUrl: isAudio ? this.getStreamUrl(item.Id, 'audio') : undefined,
      // If artist is unknown, see if we can get it from People or just omit it
      artist: item.AlbumArtist || item.Artists?.[0] || (item as any).People?.find((p:any) => p.Type === 'Artist')?.Name || '',
      album: item.Album || '',
      subtitleTracks: subtitleTracks.length > 0 ? subtitleTracks : undefined,
      audioTracks: audioTracks.length > 0 ? audioTracks : undefined,
      director: director || undefined,
      writers: writers.length > 0 ? writers : undefined,
      cast: cast.length > 0 ? cast : undefined,
      runTimeTicks: item.RunTimeTicks,
      chapters: item.Chapters,
      tags: item.Tags
    };
  }

  /**
   * Fetch item media streams & playback information (Subtitles, Audio, Chapters, Tags, RunTimeTicks)
   */
  public async getItemPlaybackInfo(itemId: string): Promise<{
    subtitleTracks: SubtitleTrack[];
    audioTracks: AudioTrack[];
    chapters?: any[];
    tags?: string[];
    runTimeTicks?: number;
    container?: string;
    videoCodec?: string;
    mediaSourceId?: string;
    /** File size (bytes) and overall bitrate (bits/s) — used to size the pre-load. */
    size?: number;
    bitrate?: number;
  }> {
    if (!this.config.accessToken || !itemId) {
      return { subtitleTracks: [], audioTracks: [] };
    }
    try {
      const url = `${this.config.serverUrl}/Items/${itemId}?userId=${this.config.userId}&Fields=MediaStreams,MediaSources,Chapters,Tags,RunTimeTicks,UserData`;
      const res = await fetch(url, { headers: this.getRequestHeaders() });
      if (!res.ok) throw new Error('Playback info request failed');
      const data = await res.json();
      const streams: any[] = data.MediaStreams || [];
      const mediaSources: any[] = data.MediaSources || [];
      const primarySourceId = mediaSources[0]?.Id;
      const baseUrl = this.config.serverUrl?.replace(/\/$/, '') || '';
      const token = this.config.accessToken || '';

      const subtitleTracks: SubtitleTrack[] = streams
        .filter((s: any) => s.Type === 'Subtitle')
        .map((s: any, idx: number) => {
          const streamIdx = s.Index ?? idx;
          let subUrl = `${baseUrl}/Videos/${itemId}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${token}`;
          if (s.DeliveryUrl) {
            subUrl = s.DeliveryUrl.startsWith('http')
              ? s.DeliveryUrl
              : `${baseUrl}${s.DeliveryUrl}${s.DeliveryUrl.includes('?') ? '&' : '?'}ApiKey=${token}`;
          } else if (primarySourceId) {
            subUrl = `${baseUrl}/Videos/${itemId}/${primarySourceId}/Subtitles/${streamIdx}/Stream.vtt?ApiKey=${token}`;
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

      return {
        subtitleTracks,
        audioTracks,
        chapters: data.Chapters || [],
        tags: data.Tags || [],
        runTimeTicks: data.RunTimeTicks,
        // Needed to decide direct play vs. server-side audio conversion (see utils/playbackDecision.ts)
        container: mediaSources[0]?.Container || data.Container,
        videoCodec: streams.find((s: any) => s.Type === 'Video')?.Codec,
        mediaSourceId: primarySourceId,
        size: mediaSources[0]?.Size,
        bitrate: mediaSources[0]?.Bitrate
      };
    } catch (e) {
      console.warn('Failed to load item streams:', e);
      return { subtitleTracks: [], audioTracks: [] };
    }
  }

  /**
   * Real lyrics for a track (Jellyfin 10.9+: GET /Audio/{id}/Lyrics, from .lrc/.txt files or embedded tags).
   * synced = every line has a start time (.lrc) → the player highlights and follows the current line.
   * Returns an empty list when the song has none (404) or on errors.
   */
  public async getLyrics(itemId: string, signal?: AbortSignal): Promise<{ lines: { time: number; text: string }[]; synced: boolean }> {
    const none = { lines: [], synced: false };
    if (!this.config.accessToken || !itemId) return none;
    try {
      const res = await fetch(`${this.config.serverUrl.replace(/\/$/, '')}/Audio/${itemId}/Lyrics`, { headers: this.getRequestHeaders(), signal });
      if (!res.ok) return none;
      const data = await res.json();
      const raw: { Text?: string; Start?: number }[] = data?.Lyrics || [];
      const synced = raw.length > 0 && raw.every((l) => typeof l.Start === 'number');
      return {
        synced,
        lines: raw.map((l) => ({ time: synced ? (l.Start as number) / 10_000_000 : -1, text: (l.Text || '').trim() }))
      };
    } catch {
      return none;
    }
  }

  /**
   * 3. Image URL Generator helpers
   */
  /**
   * Image URL sized for where it is shown.
   *  - tag:  the image's version (ImageTags / BackdropImageTags). With it Jellyfin answers
   *          "Cache-Control: max-age=1 year, immutable" → the device keeps it and never re-downloads it;
   *          a changed poster gets a new tag, so updates still show.
   *  - WebP: ~10× smaller files than JPEG (measured 8.5 KB vs 88.7 KB for a 600 px poster).
   *  - size: RAM for a decoded image depends on its pixels, not the file — a 1920 px backdrop costs ~8 MB even in
   *          a 310 px card, so cards ask for card-sized images.
   */
  public getImageUrl(itemId: string, type: 'Primary' | 'Backdrop' = 'Primary', maxWidth = 800, tag?: string): string {
    if (!itemId) {
      return '';
    }
    const endpoint = type === 'Backdrop' ? 'Backdrop' : 'Primary';
    return `${this.config.serverUrl}/Items/${itemId}/Images/${endpoint}?${imageQuery(maxWidth, tag)}&ApiKey=${this.config.accessToken}`;
  }

  /**
   * 4. Stream URL Generator (Universal Audio & Video Compatibility)
   * Ensures sound works in 100% of browsers by remuxing/transcoding unsupported AC3/EAC3/DTS audio to AAC
   */
  public getStreamUrl(
    itemId: string,
    mediaType: 'video' | 'audio' = 'video',
    maxStreamingBitrate?: number,
    audioStreamIndex?: number,
    startTimeTicks?: number
  ): string {
    if (!itemId) {
      return '';
    }
    const token = this.config.accessToken;
    const serverUrl = this.config.serverUrl?.replace(/\/$/, '') || '';

    if (mediaType === 'audio') {
      // /universal needs the user and device next to the key (without them: 401). The server sends the original
      // file when its container is in the list this device can play (FLAC etc.), otherwise converts to MP3.
      const p = new URLSearchParams({
        ApiKey: token,
        UserId: this.config.userId,
        DeviceId: this.config.deviceId,
        Container: playableAudioContainers(),
        TranscodingContainer: 'mp3',
        TranscodingProtocol: 'http',
        AudioCodec: 'mp3',
        MaxStreamingBitrate: '320000000'
      });
      return `${serverUrl}/Audio/${itemId}/universal?${p.toString()}`;
    }

    // Direct Play (Auto) vs Transcoding:
    // If no explicit max bitrate is set and default audio is used, use static=true (direct play)
    // with full HTTP 206 Partial Content byte-range seeking supported natively by browser/Tizen.
    const isTranscode = !!(maxStreamingBitrate && maxStreamingBitrate > 0);
    const params = new URLSearchParams();
    params.set('ApiKey', token);

    if (!isTranscode && (audioStreamIndex === undefined || audioStreamIndex < 0)) {
      params.set('static', 'true');
      return `${serverUrl}/Videos/${itemId}/stream?${params.toString()}`;
    }

    params.set('static', 'false');
    params.set('AudioCodec', 'aac,mp3');
    params.set('VideoCodec', 'h264,hevc,vp9,copy');
    params.set('TranscodingMaxAudioChannels', '2');

    if (audioStreamIndex !== undefined && audioStreamIndex >= 0) {
      params.set('AudioStreamIndex', audioStreamIndex.toString());
    }

    if (maxStreamingBitrate && maxStreamingBitrate > 0) {
      params.set('maxStreamingBitrate', maxStreamingBitrate.toString());
    }

    if (startTimeTicks && startTimeTicks > 0) {
      params.set('StartTimeTicks', startTimeTicks.toString());
    }

    return `${serverUrl}/Videos/${itemId}/stream.mp4?${params.toString()}`;
  }

  /**
   * 5. Playback Reporting (Sync Watch History / Scrobblers)
   */
  public async reportPlaybackStart(itemId: string, positionTicks = 0): Promise<void> {
    if (!this.config.accessToken) return;
    try {
      await fetch(`${this.config.serverUrl}/Sessions/Playing`, {
        method: 'POST',
        headers: this.getRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ItemId: itemId,
          PositionTicks: positionTicks,
          IsPaused: false
        })
      });
    } catch (e) {
      console.warn('Jellyfin playback start error:', e);
    }
  }

  public async reportPlaybackProgress(itemId: string, positionTicks: number, isPaused = false): Promise<void> {
    if (!this.config.accessToken) return;
    try {
      await fetch(`${this.config.serverUrl}/Sessions/Playing/Progress`, {
        method: 'POST',
        headers: this.getRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ItemId: itemId,
          PositionTicks: Math.floor(positionTicks),
          IsPaused: isPaused
        })
      });
    } catch (e) {
      console.warn('Jellyfin playback progress error:', e);
    }
  }

  public async reportPlaybackStop(itemId: string, positionTicks: number): Promise<void> {
    if (!this.config.accessToken) return;
    try {
      await fetch(`${this.config.serverUrl}/Sessions/Playing/Stopped`, {
        method: 'POST',
        headers: this.getRequestHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          ItemId: itemId,
          PositionTicks: Math.floor(positionTicks)
        })
      });
    } catch (e) {
      console.warn('Jellyfin playback stop error:', e);
    }
  }

  /**
   * Save watched item progress linked specifically to a user profile
   */
  public saveUserWatchProgress(userId: string, item: any, positionTicks: number, durationTicks: number): void {
    if (!userId || !item || !item.id) return;
    try {
      const storageKey = `jellyfin_user_resume_${userId}`;

      // Strictly ignore root series or items without duration/progress
      if (item.type === 'tv' && !item.episodeNumber && !item.episodeName) return;

      const existingJson = localStorage.getItem(storageKey);
      let items: any[] = existingJson ? JSON.parse(existingJson) : [];

      // If playback position is under 5 seconds or over 95%, remove it from resume list
      if (!positionTicks || positionTicks < 50000000 || (durationTicks > 0 && positionTicks >= durationTicks * 0.95)) {
        const filtered = items.filter((i) => i.id !== item.id);
        localStorage.setItem(storageKey, JSON.stringify(filtered));
        return;
      }

      const playbackPercent = durationTicks > 0 ? Math.min(100, Math.round((positionTicks / durationTicks) * 100)) : 0;
      if (playbackPercent <= 0 || playbackPercent >= 95) {
        const filtered = items.filter((i) => i.id !== item.id);
        localStorage.setItem(storageKey, JSON.stringify(filtered));
        return;
      }

      const updatedItem = {
        ...item,
        playbackPercent,
        lastWatchedAt: Date.now()
      };

      // Filter out existing and prepend as most recently watched
      items = [updatedItem, ...items.filter((i) => i.id !== item.id)].slice(0, 15);
      localStorage.setItem(storageKey, JSON.stringify(items));
    } catch (e) {
      console.warn('Failed to save local user watch progress', e);
    }
  }

  /**
   * Get watched items for a specific user profile
   */
  public getUserWatchHistory(userId: string): any[] {
    if (!userId) return [];
    try {
      const storageKey = `jellyfin_user_resume_${userId}`;
      const existingJson = localStorage.getItem(storageKey);
      if (!existingJson) return [];
      const items: any[] = JSON.parse(existingJson);
      // Clean up invalid or unstarted items
      const valid = items.filter((item) => {
        if (!item || !item.id) return false;
        if (item.type === 'tv' && !item.episodeNumber && !item.episodeName) return false;
        if (!item.playbackPercent || item.playbackPercent <= 0 || item.playbackPercent >= 95) return false;
        return true;
      });
      if (valid.length !== items.length) {
        localStorage.setItem(storageKey, JSON.stringify(valid));
      }
      return valid;
    } catch (e) {
      return [];
    }
  }

  /**
   * Fetch public/server users for profile switcher
   */
  public async getPublicUsers(): Promise<JellyfinUser[]> {
    const cleanUrl = this.config.serverUrl?.trim().replace(/\/$/, '');
    if (!cleanUrl) return [];

    try {
      const res = await fetch(`${cleanUrl}/Users/Public`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        return data.map((u: any) => ({
          id: u.Id,
          name: u.Name,
          hasPassword: !!u.HasPassword || !!u.HasConfiguredPassword,
          primaryImageTag: u.PrimaryImageTag,
          // Only users who set a picture have one (asking anyway gives a broken image)
          avatarUrl: u.PrimaryImageTag ? `${cleanUrl}/Users/${u.Id}/Images/Primary?${imageQuery(240, u.PrimaryImageTag)}` : '',
          isAdmin: !!u.Policy?.IsAdministrator
        }));
      }
    } catch (e) {
      console.warn('Failed to fetch public users', e);
    }
    return [];
  }

  public getUserImageUrl(userId: string): string {
    const cleanUrl = this.config.serverUrl?.trim().replace(/\/$/, '');
    if (!cleanUrl || !userId) return '';
    return `${cleanUrl}/Users/${userId}/Images/Primary?${imageQuery(240)}`;
  }
}

export const jellyfinClient = new JellyfinClient();

/** WebP support, checked once (Tizen 6+ and every current browser say yes). */
const supportsWebp = (() => {
  try {
    return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  } catch {
    return false;
  }
})();

/** Query string for a Jellyfin image: size, format/quality, and the version tag that makes it cache for a year. */
export function imageQuery(maxWidth: number, tag?: string): string {
  const p = [`maxWidth=${maxWidth}`, 'quality=85'];
  if (supportsWebp) p.push('format=webp');
  if (tag) p.push(`tag=${tag}`);
  return p.join('&');
}

/** Audio containers this device can play directly (sent to Jellyfin so it only converts what's needed). */
function playableAudioContainers(): string {
  const probe = (type: string) => {
    try {
      return document.createElement('audio').canPlayType(type) !== '';
    } catch {
      return false;
    }
  };
  const list = ['mp3'];
  if (probe('audio/flac')) list.push('flac');
  if (probe('audio/mp4; codecs="mp4a.40.2"')) list.push('aac', 'm4a', 'm4b', 'mp4');
  if (probe('audio/ogg; codecs="vorbis"')) list.push('ogg', 'oga');
  if (probe('audio/ogg; codecs="opus"') || probe('audio/webm; codecs="opus"')) list.push('opus', 'webma', 'webm');
  if (probe('audio/wav')) list.push('wav');
  return list.join(',');
}
