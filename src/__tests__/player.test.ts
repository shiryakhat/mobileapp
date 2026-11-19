/**
 * The native (expo-audio) engine and the store must not drift apart:
 *
 *  - Android reports a stale `status.playing` while the player is buffering
 *    (e.g. after a chapter / transcript tap seeks a stream). Those statuses
 *    must not undo the user's pause or play, or the transport button ends up
 *    doing the opposite of what it shows.
 *  - A player that lost its source (playback error, stopped by the system)
 *    ignores play(); the episode has to be loaded again, where it was.
 *  - Returning to the app re-reads the engine.
 */
import type { AudioStatus } from 'expo-audio';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { episodes } from '@/content';
import { loadEpisode, pause, play, seekTo, stop, toggle } from '@/player/controller';
import { usePlayback } from '@/player/store';

const mockPlayer = {
  addListener: jest.fn(),
  replace: jest.fn(),
  setPlaybackRate: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(() => Promise.resolve()),
  setActiveForLockScreen: jest.fn(),
  updateLockScreenMetadata: jest.fn(),
  clearLockScreenControls: jest.fn(),
  isLoaded: true,
  currentStatus: undefined as AudioStatus | undefined,
};
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/cache', () => ({ cachedImageUri: jest.fn(() => undefined) }));
jest.mock('@/state/downloads', () => ({ localAudioUri: jest.fn(() => undefined) }));
jest.mock('@/player/artwork', () => ({
  localArtworkUri: jest.fn(() => 'file:///artwork.jpg'),
  resolveLocalArtwork: jest.fn(() => Promise.resolve(undefined)),
}));

// These tests are about the primary source alone; the archive.org fallback is
// covered by archive-fallback.test.ts.
for (const e of episodes) delete e.archiveAudioUrl;
const episode = episodes.find((e) => e.audioUrl)!;
const appStateSpy = jest.spyOn(AppState, 'addEventListener');

function status(patch: Partial<AudioStatus>): AudioStatus {
  return {
    id: 'p',
    currentTime: 0,
    playbackState: 'ready',
    timeControlStatus: 'paused',
    reasonForWaitingToPlay: '',
    mute: false,
    duration: 3600,
    playing: false,
    loop: false,
    didJustFinish: false,
    isBuffering: false,
    isLoaded: true,
    playbackRate: 1,
    shouldCorrectPitch: true,
    isLive: false,
    currentOffsetFromLive: null,
    error: null,
    ...patch,
  } as AudioStatus;
}
const buffering = (patch: Partial<AudioStatus>) =>
  status({ playbackState: 'buffering', isBuffering: true, isLoaded: false, ...patch });

/** Deliver a native status event to the controller's listener. */
function emit(s: AudioStatus): void {
  const listener = mockPlayer.addListener.mock.calls[0]![1] as (s: AudioStatus) => void;
  listener(s);
}
const playing = () => usePlayback.getState().playing;

beforeAll(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
});

beforeEach(() => {
  stop();
  loadEpisode(episode);
  emit(status({}));
  mockPlayer.isLoaded = true;
  mockPlayer.play.mockClear();
  mockPlayer.pause.mockClear();
  mockPlayer.replace.mockClear();
  mockPlayer.seekTo.mockClear();
});

describe('key-point tap, then pause (Android stale status while buffering)', () => {
  it('keeps the pause when a late buffering status still says "playing"', () => {
    play();
    emit(status({ playing: true, currentTime: 10 }));

    // Chapter / transcript tap while playing: seek + play, the stream rebuffers.
    loadEpisode(episode, { startAt: 600, autoplay: true });
    emit(buffering({ playing: true, currentTime: 600 }));
    expect(playing()).toBe(true);

    toggle(); // the user pauses during the rebuffer
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    // Android repeats the pre-seek value: it must not flip the store back.
    emit(buffering({ playing: true, currentTime: 600 }));
    expect(playing()).toBe(false);

    // The next tap therefore resumes (it would have paused a second time).
    toggle();
    expect(mockPlayer.play).toHaveBeenCalledTimes(3);
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  });

  it('keeps the play when a late buffering status still says "paused"', () => {
    // Tap from a paused player: the engine will start as soon as it has data.
    loadEpisode(episode, { startAt: 600, autoplay: true });
    emit(buffering({ playing: false, currentTime: 600 }));
    expect(playing()).toBe(true);

    // So the button shows "pause", and tapping it really pauses.
    toggle();
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    emit(buffering({ playing: false, currentTime: 600 }));
    emit(status({ playing: false, currentTime: 600 }));
    expect(playing()).toBe(false);
  });

  it('follows the engine once it has settled (interruption, lock-screen controls)', () => {
    play();
    emit(status({ playing: true }));
    emit(status({ playing: false })); // paused by another app taking audio focus
    expect(playing()).toBe(false);
    emit(status({ playing: true })); // resumed from the lock screen
    expect(playing()).toBe(true);
    toggle();
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
  });

  it('does not reinterpret statuses on iOS', () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    try {
      play();
      emit(buffering({ playing: false }));
      expect(playing()).toBe(false);
    } finally {
      jest.replaceProperty(Platform, 'OS', 'android');
    }
  });
});

describe('a player that lost its source', () => {
  it('loads the episode again, at the same position, on play()', () => {
    play();
    emit(status({ playing: true, currentTime: 321 }));
    emit(status({ playing: false, currentTime: 321, error: 'Source error' }));
    emit(status({ playbackState: 'idle', isLoaded: false, currentTime: 321 }));
    expect(usePlayback.getState()).toMatchObject({ playing: false, error: 'Source error' });
    mockPlayer.isLoaded = false;

    play();
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: episode.audioUrl });
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
    expect(usePlayback.getState()).toMatchObject({ playing: true, error: undefined });

    // The reloaded source resumes where playback died.
    emit(buffering({ playing: false }));
    emit(status({ playing: false }));
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(321);

    // Healthy again: play() no longer reloads.
    emit(status({ playing: true, currentTime: 321 }));
    pause();
    play();
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);
  });

  it('reloads at the tapped position when a key point is tapped', () => {
    emit(status({ playbackState: 'idle', isLoaded: false, currentTime: 50 }));
    mockPlayer.isLoaded = false;
    loadEpisode(episode, { startAt: 900, autoplay: true });
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);
    emit(status({ playing: false }));
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(900);
  });

  it('does not reload for the idle status emitted while a source is replaced', () => {
    emit(status({ playbackState: 'idle', isLoaded: false }));
    emit(buffering({}));
    emit(status({}));
    play();
    expect(mockPlayer.replace).not.toHaveBeenCalled();
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
  });
});

describe('returning to the app', () => {
  const foreground = () => {
    const handler = appStateSpy.mock.calls[0]![1] as (s: AppStateStatus) => void;
    handler('active');
  };

  it('re-reads the engine state', () => {
    play();
    emit(status({ playing: true, currentTime: 100 }));
    // Paused while in the background, and the status event never arrived.
    mockPlayer.currentStatus = status({ playing: false, currentTime: 140 });
    foreground();
    expect(usePlayback.getState()).toMatchObject({ playing: false, positionSec: 140 });
    toggle();
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });

  it('ignores an engine that cannot be read', () => {
    play();
    mockPlayer.currentStatus = undefined;
    expect(foreground).not.toThrow();
    expect(playing()).toBe(true);
  });

  it('leaves the seek helpers untouched', () => {
    seekTo(42);
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(42);
  });
});
