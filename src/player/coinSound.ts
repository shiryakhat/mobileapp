/**
 * The coin-toss sound of the launch screen. Strictly best-effort: a missing
 * codec, a busy audio session or a web autoplay block must never surface.
 */
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { hasEpisodePlayer } from './controller';

const VOLUME = 0.7;
/** The clip is ~3 s; its player is released a little after it has rung out. */
const RELEASE_AFTER_MS = 5000;

export async function playCoinSound(): Promise<void> {
  // An episode opened by a deep link already owns the audio session: leave it alone.
  if (hasEpisodePlayer()) return;
  try {
    // A UI sound: obey the silent switch and never interrupt other apps' audio.
    // The episode player sets its own mode when it is first used.
    await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' });
    if (hasEpisodePlayer()) return;
    const player = createAudioPlayer(require('../../assets/coin-flip.mp3'));
    player.volume = VOLUME;
    player.play();
    setTimeout(() => {
      try {
        player.remove();
      } catch {
        // already gone
      }
    }, RELEASE_AFTER_MS);
  } catch {
    // Silence is an acceptable outcome.
  }
}
