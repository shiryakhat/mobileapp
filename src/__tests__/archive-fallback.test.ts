/**
 * archive.org is the fallback media host:
 *
 *  - source precedence is downloaded file > RSS enclosure > archive.org;
 *  - an episode without an RSS enclosure plays natively from archive.org;
 *  - when the RSS enclosure errors out, the player retries once from
 *    archive.org, at the same position.
 */
import type { AudioStatus } from 'expo-audio';
import { Platform } from 'react-native';
import { episodes, type Episode } from '@/content';
import {
  archiveVideoSourceFor,
  audioSourceFor,
  loadEpisode,
  play,
  stop,
} from '@/player/controller';
import { usePlayback } from '@/player/store';
import { localAudioUri } from '@/state/downloads';

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

const mockLocal = jest.mocked(localAudioUri);
const LOCAL = 'file:///audio/episode.mp3';
const RSS = 'https://rss.example/episode.mp3';
const ARCHIVE = 'https://archive.org/download/shiryakhat-abc/episode.mp3';

// Controlled sources on real episodes (the controller looks episodes up by id).
// Each failover test needs its own episode: the fallback is sticky per session.
const withRss = episodes.filter((e) => e.audioUrl);
function fixture(i: number, patch: Partial<Episode>): Episode {
  return Object.assign(withRss[i]!, { audioUrl: RSS, archiveAudioUrl: ARCHIVE }, patch);
}

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
function emit(s: AudioStatus): void {
  const listener = mockPlayer.addListener.mock.calls[0]![1] as (s: AudioStatus) => void;
  listener(s);
}
const sources = () => mockPlayer.replace.mock.calls.map(([source]) => source.uri as string);

beforeAll(() => {
  jest.replaceProperty(Platform, 'OS', 'android');
});

beforeEach(() => {
  stop();
  mockLocal.mockReturnValue(undefined);
  mockPlayer.replace.mockClear();
  mockPlayer.play.mockClear();
  mockPlayer.seekTo.mockClear();
});

describe('audioSourceFor', () => {
  const ep = fixture(0, {});

  it('prefers the downloaded file', () => {
    mockLocal.mockReturnValue(LOCAL);
    expect(audioSourceFor(ep)).toBe(LOCAL);
  });

  it('streams the RSS enclosure when nothing is downloaded', () => {
    expect(audioSourceFor(ep)).toBe(RSS);
  });

  it('falls back to archive.org when there is no RSS enclosure', () => {
    expect(audioSourceFor({ ...ep, audioUrl: undefined })).toBe(ARCHIVE);
  });

  it('has no source without any of them', () => {
    expect(audioSourceFor({ ...ep, audioUrl: undefined, archiveAudioUrl: undefined })).toBe(
      undefined,
    );
  });

  it('exposes the archive.org video for the video path', () => {
    const video = 'https://archive.org/download/shiryakhat-abc/episode.mp4';
    expect(archiveVideoSourceFor({ ...ep, archiveVideoUrl: video })).toBe(video);
    expect(archiveVideoSourceFor({ ...ep, archiveVideoUrl: undefined })).toBe(undefined);
  });
});

describe('an episode without an RSS enclosure', () => {
  it('plays natively from archive.org instead of through YouTube', () => {
    const ep = fixture(1, { audioUrl: undefined });
    loadEpisode(ep, { autoplay: true });
    expect(usePlayback.getState().engine).toBe('native');
    expect(sources()).toEqual([ARCHIVE]);
  });
});

describe('the RSS enclosure fails to load', () => {
  it('retries once from archive.org, at the same position', () => {
    const ep = fixture(2, {});
    loadEpisode(ep, { startAt: 600, autoplay: true });
    expect(sources()).toEqual([RSS]);

    emit(status({ isLoaded: false, error: 'Source error' }));
    expect(sources()).toEqual([RSS, ARCHIVE]);
    expect(mockPlayer.play).toHaveBeenCalledTimes(2); // still wants to play
    expect(usePlayback.getState()).toMatchObject({ error: undefined, positionSec: 600 });
    expect(audioSourceFor(ep)).toBe(ARCHIVE); // sticky for the session

    emit(status({ playing: false }));
    expect(mockPlayer.seekTo).toHaveBeenCalledWith(600);

    // archive.org fails as well: no loop — the error is shown, play() tries again.
    emit(status({ isLoaded: false, error: 'Source error' }));
    expect(sources()).toEqual([RSS, ARCHIVE]);
    expect(usePlayback.getState().error).toBe('Source error');
    play();
    expect(sources()).toEqual([RSS, ARCHIVE, ARCHIVE]);
  });

  it('still prefers a file downloaded later', () => {
    const ep = fixture(2, {});
    mockLocal.mockReturnValue(LOCAL);
    expect(audioSourceFor(ep)).toBe(LOCAL);
  });

  it('shows the error when there is no archive.org copy', () => {
    const ep = fixture(3, { archiveAudioUrl: undefined });
    loadEpisode(ep, { autoplay: true });
    emit(status({ isLoaded: false, error: 'Source error' }));
    expect(sources()).toEqual([RSS]);
    expect(usePlayback.getState().error).toBe('Source error');
  });

  it('does not swap a failing downloaded file for a stream', () => {
    const ep = fixture(4, {});
    mockLocal.mockReturnValue(LOCAL);
    loadEpisode(ep, { autoplay: true });
    emit(status({ isLoaded: false, error: 'Source error' }));
    expect(sources()).toEqual([LOCAL]);
    expect(usePlayback.getState().error).toBe('Source error');
  });
});
