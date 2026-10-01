/**
 * Link between the players and remote commands (Yudia Connect): the active player registers what it can do
 * (pause, seek, next…), and commands arriving from another device are routed to it.
 * The video player wins while it's open; otherwise the music player.
 */
export interface PlayerControls {
  kind: 'video' | 'audio';
  pause: () => void;
  unpause: () => void;
  togglePause: () => void;
  seek: (seconds: number) => void;
  next?: () => void;
  previous?: () => void;
  stop: () => void;
  setVolume?: (percent: number) => void;
  toggleMute?: (mute?: boolean) => void;
}

const players: Partial<Record<'video' | 'audio', PlayerControls>> = {};

export function registerPlayer(c: PlayerControls): () => void {
  players[c.kind] = c;
  return () => {
    if (players[c.kind] === c) delete players[c.kind];
  };
}

export const activePlayer = (): PlayerControls | undefined => players.video || players.audio;

/** Start position for the next song the music player loads (a "Play" command with a start time). */
let pendingAudioStart: { id: string; seconds: number } | null = null;
export const setPendingAudioStart = (id: string, seconds: number) => {
  pendingAudioStart = seconds > 0 ? { id, seconds } : null;
};
export function takePendingAudioStart(id: string): number {
  if (pendingAudioStart && pendingAudioStart.id === id) {
    const s = pendingAudioStart.seconds;
    pendingAudioStart = null;
    return s;
  }
  return 0;
}
