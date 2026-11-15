/**
 * The short metallic "ting" of the coin-flip easter egg (src/app/coinflip.tsx).
 * One player is kept while the screen is open and rewound on every tap, so a
 * rhythm of taps retriggers the sound. Best-effort, like the launch sound: a
 * busy audio session or a web autoplay block must never surface.
 *
 * assets/coin-ting.m4a is synthesized (a few damped sine partials), see the PR
 * that added it for the ffmpeg command.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { hasEpisodePlayer } from './controller';

const VOLUME = 0.8;
let player: AudioPlayer | undefined;

export function playCoinTing(): void {
  try {
    if (!player) {
      // A UI sound: obey the silent switch and mix with other apps' audio. Once
      // the episode player exists it owns the audio session mode: leave it alone.
      if (!hasEpisodePlayer()) {
        void setAudioModeAsync({
          playsInSilentMode: false,
          interruptionMode: 'mixWithOthers',
        }).catch(() => undefined);
      }
      player = createAudioPlayer(require('../../assets/coin-ting.m4a'));
      player.volume = VOLUME;
    }
    // Rewind first: a clip that has rung out does not restart on play() alone.
    void player.seekTo(0).catch(() => undefined);
    player.play();
  } catch {
    // Silence is an acceptable outcome.
  }
}

export function releaseCoinTing(): void {
  try {
    player?.remove();
  } catch {
    // already gone
  }
  player = undefined;
}
