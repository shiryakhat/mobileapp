/**
 * The coin-toss sound of the coin-flip easter egg (src/app/coinflip.tsx): the
 * same clip, at the same level, as the website's coin plays on every tap
 * (site/assets/site.js). A few players are kept while the screen is open and
 * used in turn, so a rhythm of taps overlaps instead of cutting itself off.
 * Best-effort, like the launch sound: a busy audio session or a web autoplay
 * block must never surface.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { hasEpisodePlayer } from './controller';

const VOLUME = 0.45;
/** The clip is ~3 s: this many tosses can ring at once before the oldest is reused. */
const VOICES = 4;
let players: AudioPlayer[] = [];
let next = 0;

export function playCoinTing(): void {
  try {
    if (players.length === 0) {
      // A UI sound: obey the silent switch and mix with other apps' audio. Once
      // the episode player exists it owns the audio session mode: leave it alone.
      if (!hasEpisodePlayer()) {
        void setAudioModeAsync({
          playsInSilentMode: false,
          interruptionMode: 'mixWithOthers',
        }).catch(() => undefined);
      }
    }
    let player = players[next];
    if (!player) {
      player = createAudioPlayer(require('../../assets/coin-flip.mp3'));
      player.volume = VOLUME;
      players[next] = player;
    }
    next = (next + 1) % VOICES;
    // Rewind first: a clip that has rung out does not restart on play() alone.
    void player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    // Silence is an acceptable outcome.
  }
}

export function releaseCoinTing(): void {
  for (const player of players) {
    try {
      player.remove();
    } catch {
      // already gone
    }
  }
  players = [];
  next = 0;
}
