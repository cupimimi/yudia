// Shared media types. (This file used to also hold demo content — removed: the app only shows real server data.)
export interface SubtitleTrack {
  id: string;
  index: number;
  language: string;
  displayTitle: string;
  url?: string;
  isDefault?: boolean;
  isForced?: boolean;
}

export interface AudioTrack {
  id: string;
  index: number;
  language: string;
  displayTitle: string;
  codec?: string;
  isDefault?: boolean;
}

export interface CastMember {
  id?: string;
  name: string;
  role: string;
  avatarUrl?: string;
}

export interface MediaItem {
  id: string;
  title: string;
  seriesName?: string;
  seriesId?: string;
  episodeName?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  playbackPercent?: number; // 0 to 100
  type: 'movie' | 'tv' | 'music';
  year: number;
  rating: string;
  duration: string;
  genres: string[];
  overview: string;
  backdropUrl: string;
  /** Card-sized (480 px) version of the backdrop — rows use this, the hero/detail pages use backdropUrl. */
  thumbUrl?: string;
  posterUrl: string;
  videoUrl?: string;
  audioUrl?: string;
  artist?: string;
  album?: string;
  /** Music: ids for the album / artist pages, and the track number on its album. */
  albumId?: string;
  artistId?: string;
  indexNumber?: number;
  /** Song inside a playlist: its entry id there (to remove it from the playlist). */
  playlistItemId?: string;
  tagline?: string;
  subtitleTracks?: SubtitleTrack[];
  audioTracks?: AudioTrack[];
  director?: string;
  writers?: string[];
  cast?: CastMember[];
  studios?: string[];
  runTimeTicks?: number;
  chapters?: any[];
  tags?: string[];
}
