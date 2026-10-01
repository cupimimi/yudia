import { create } from 'zustand';
import { MediaItem } from '../mockData';
import {
  jellyfinTvService,
  JellyfinSeason,
  JellyfinEpisode
} from '../services/jellyfinTvService';

export interface SmartPlayTarget {
  episode: JellyfinEpisode;
  resumeTicks: number;
  reason: 'resume' | 'next' | 'first';
}

interface SeriesState {
  activeSeries: MediaItem | null;
  seasons: JellyfinSeason[];
  selectedSeasonId: string | null;
  episodes: JellyfinEpisode[];
  loadingSeasons: boolean;
  loadingEpisodes: boolean;
  isFavorite: boolean;

  // Actions
  loadSeries: (series: MediaItem) => Promise<void>;
  selectSeason: (seasonId: string) => Promise<void>;
  toggleEpisodePlayed: (episodeId: string) => Promise<void>;
  markSeasonPlayed: (seasonId: string, played: boolean) => Promise<void>;
  toggleSeriesFavorite: () => Promise<void>;
  getSmartPlayTarget: () => SmartPlayTarget | null;
  getNextEpisodeInSequence: (currentEpisodeId: string) => Promise<JellyfinEpisode | null>;
  reset: () => void;
}

export const useSeriesStore = create<SeriesState>((set, get) => ({
  activeSeries: null,
  seasons: [],
  selectedSeasonId: null,
  episodes: [],
  loadingSeasons: false,
  loadingEpisodes: false,
  isFavorite: false,

  loadSeries: async (series: MediaItem) => {
    set({
      activeSeries: series,
      loadingSeasons: true,
      seasons: [],
      episodes: [],
      selectedSeasonId: null
    });

    try {
      const seasons = await jellyfinTvService.getSeasons(series.id);
      // Select the first non-special regular season (Season 1) by default, or the first available
      const defaultSeason = seasons.find((s) => !s.IsSpecial) || seasons[0];
      const initialSeasonId = defaultSeason ? defaultSeason.Id : null;

      set({
        seasons,
        selectedSeasonId: initialSeasonId,
        loadingSeasons: false
      });

      if (initialSeasonId) {
        await get().selectSeason(initialSeasonId);
      }
    } catch (err) {
      console.warn('useSeriesStore: Failed to load series seasons', err);
      set({ loadingSeasons: false });
    }
  },

  selectSeason: async (seasonId: string) => {
    const { activeSeries } = get();
    if (!activeSeries) return;

    set({ selectedSeasonId: seasonId, loadingEpisodes: true });

    try {
      const episodes = await jellyfinTvService.getEpisodes(activeSeries.id, seasonId);
      set({ episodes, loadingEpisodes: false });
    } catch (err) {
      console.warn('useSeriesStore: Failed to load episodes for season', seasonId, err);
      set({ loadingEpisodes: false });
    }
  },

  toggleEpisodePlayed: async (episodeId: string) => {
    const { episodes } = get();
    const target = episodes.find((e) => e.Id === episodeId);
    if (!target) return;

    const newPlayed = !target.UserData?.Played;

    // Optimistically update UI
    set({
      episodes: episodes.map((ep) =>
        ep.Id === episodeId
          ? {
              ...ep,
              UserData: {
                PlaybackPositionTicks: 0,
                PlayedPercentage: newPlayed ? 100 : 0,
                Played: newPlayed,
                IsFavorite: ep.UserData?.IsFavorite ?? false,
                PlayCount: newPlayed ? (ep.UserData?.PlayCount || 0) + 1 : 0
              }
            }
          : ep
      )
    });

    await jellyfinTvService.markPlayedStatus(episodeId, newPlayed);
  },

  markSeasonPlayed: async (seasonId: string, played: boolean) => {
    const { episodes } = get();
    set({
      episodes: episodes.map((ep) => ({
        ...ep,
        UserData: {
          PlaybackPositionTicks: 0,
          PlayedPercentage: played ? 100 : 0,
          Played: played,
          IsFavorite: ep.UserData?.IsFavorite ?? false,
          PlayCount: played ? 1 : 0
        }
      }))
    });

    // Mark each episode on server
    for (const ep of episodes) {
      await jellyfinTvService.markPlayedStatus(ep.Id, played);
    }
  },

  toggleSeriesFavorite: async () => {
    const { activeSeries, isFavorite } = get();
    if (!activeSeries) return;

    const newFav = !isFavorite;
    set({ isFavorite: newFav });
    await jellyfinTvService.markFavoriteStatus(activeSeries.id, newFav);
  },

  /**
   * Smart Play Calculation:
   * 1. If user has an in-progress episode, resume at PlaybackPositionTicks.
   * 2. If latest watched episode was finished, launch the next unplayed episode in sequence.
   * 3. If all episodes watched or none started, launch Season 1, Episode 1.
   */
  getSmartPlayTarget: (): SmartPlayTarget | null => {
    const { episodes, seasons } = get();
    if (episodes.length === 0) return null;

    // 1. In-progress episode check
    const inProgress = episodes.find(
      (e) => (e.UserData?.PlaybackPositionTicks || 0) > 0 && !e.UserData?.Played
    );
    if (inProgress) {
      return {
        episode: inProgress,
        resumeTicks: inProgress.UserData?.PlaybackPositionTicks || 0,
        reason: 'resume'
      };
    }

    // 2. Next unplayed episode in sequence
    const nextUnplayed = episodes.find((e) => !e.UserData?.Played && e.ParentIndexNumber > 0);
    if (nextUnplayed) {
      return {
        episode: nextUnplayed,
        resumeTicks: 0,
        reason: 'next'
      };
    }

    // 3. Fallback: First regular episode (Season 1 Episode 1)
    const firstEp = episodes.find((e) => e.ParentIndexNumber === 1 && e.IndexNumber === 1) || episodes[0];
    return {
      episode: firstEp,
      resumeTicks: 0,
      reason: 'first'
    };
  },

  /**
   * Continuous Playback: Finds the next chronological episode.
   * If current is season finale, queries and transitions seamlessly to Season N+1, Episode 1!
   */
  getNextEpisodeInSequence: async (currentEpisodeId: string): Promise<JellyfinEpisode | null> => {
    const { episodes, seasons, activeSeries } = get();
    const currentIndex = episodes.findIndex((e) => e.Id === currentEpisodeId);

    // If there is another episode in the current season
    if (currentIndex !== -1 && currentIndex + 1 < episodes.length) {
      return episodes[currentIndex + 1];
    }

    // Current episode is Season Finale: find next season (ignoring Specials / Season 0)
    if (!activeSeries) return null;
    const currentEp = episodes[currentIndex];
    const currentSeasonNum = currentEp?.ParentIndexNumber ?? 1;

    const nextSeason = seasons.find(
      (s) => !s.IsSpecial && s.IndexNumber === currentSeasonNum + 1
    );

    if (nextSeason) {
      try {
        const nextSeasonEpisodes = await jellyfinTvService.getEpisodes(activeSeries.id, nextSeason.Id);
        if (nextSeasonEpisodes.length > 0) {
          return nextSeasonEpisodes[0];
        }
      } catch (err) {
        console.warn('Failed to load next season for continuous play:', err);
      }
    }

    return null;
  },

  reset: () => {
    set({
      activeSeries: null,
      seasons: [],
      selectedSeasonId: null,
      episodes: [],
      loadingSeasons: false,
      loadingEpisodes: false,
      isFavorite: false
    });
  }
}));
