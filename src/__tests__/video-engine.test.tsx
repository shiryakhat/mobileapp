/**
 * The local video engine: with the episode's mp4 on disk, video mode plays it
 * through expo-video instead of the YouTube iframe, and the transport, the
 * position (transcript sync) and the saved progress follow it like they follow
 * the audio engine. Without the file, video mode streams as before.
 */
import { act, render } from '@testing-library/react-native';
import { LocalVideoSurface } from '@/components/LocalVideoSurface';
import { episodes } from '@/content';
import {
  attachVideo,
  audioSourceFor,
  detachVideo,
  loadEpisode,
  pause,
  play,
  reportVideo,
  seekTo,
  setMode,
  setRate,
  stop,
} from '@/player/controller';
import { usePlayback } from '@/player/store';
import { localVideoUri, useDownloads } from '@/state/downloads';
import { useProgress } from '@/state/progress';

const mockAudio = {
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
};
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockAudio),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/cache', () => ({ cachedImageUri: jest.fn(() => undefined) }));
jest.mock('@/player/artwork', () => ({
  localArtworkUri: jest.fn(() => 'file:///artwork.jpg'),
  resolveLocalArtwork: jest.fn(() => Promise.resolve(undefined)),
}));
jest.mock('@/state/downloads', () => ({
  localAudioUri: jest.fn(() => undefined),
  localVideoUri: jest.fn(() => undefined),
  useDownloads: { subscribe: jest.fn() },
}));

/** The expo-video player, as far as the surface uses it. */
const mockVideo = {
  listeners: {} as Record<string, (payload: never) => void>,
  addListener: jest.fn((event: string, fn: (payload: never) => void) => {
    mockVideo.listeners[event] = fn;
    return { remove: jest.fn() };
  }),
  play: jest.fn(),
  pause: jest.fn(),
  status: 'loading',
  playing: false,
  duration: 0,
  currentTime: 0,
  playbackRate: 1,
  timeUpdateEventInterval: 0,
};
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn((_source: string, setup?: (p: unknown) => void) => {
    setup?.(mockVideo);
    return mockVideo;
  }),
  VideoView: () => null,
}));

const MP4 = 'file:///documents/video/ep.mp4';
const episode = episodes.find((e) => e.audioUrl && e.archiveVideoUrl)!;
const mockLocalVideo = jest.mocked(localVideoUri);
// Registered once, when the controller module was loaded.
const onDownloadsChange = (useDownloads.subscribe as jest.Mock).mock.calls[0]![0] as () => void;
const emit = (event: string, payload: object = {}) =>
  act(async () => mockVideo.listeners[event]!(payload as never));
const handle = () => ({ play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), setRate: jest.fn() });

beforeEach(() => {
  stop();
  useProgress.setState({ byEpisode: {} });
  mockLocalVideo.mockReturnValue(undefined);
  Object.assign(mockVideo, {
    listeners: {},
    status: 'loading',
    playing: false,
    duration: 0,
    currentTime: 0,
    playbackRate: 1,
  });
  jest.clearAllMocks();
});

describe('engine choice', () => {
  it('streams video through YouTube when there is no local mp4', () => {
    loadEpisode(episode, { mode: 'video' });
    expect(usePlayback.getState()).toMatchObject({ mode: 'video', engine: 'youtube' });
  });

  it('plays the downloaded mp4 in video mode', () => {
    mockLocalVideo.mockReturnValue(MP4);
    loadEpisode(episode, { mode: 'video' });
    expect(usePlayback.getState()).toMatchObject({ mode: 'video', engine: 'video' });
    // The audio engine is not involved.
    expect(mockAudio.replace).not.toHaveBeenCalled();
  });

  it("plays the mp4's audio track natively in audio mode, so that works offline too", () => {
    mockLocalVideo.mockReturnValue(MP4);
    expect(audioSourceFor(episode)).toBe(MP4);
    loadEpisode(episode);
    expect(usePlayback.getState()).toMatchObject({ mode: 'audio', engine: 'native' });
    expect(mockAudio.replace).toHaveBeenCalledWith({ uri: MP4 });
  });

  it('goes back to streaming, at the same position, when the mp4 is deleted', () => {
    mockLocalVideo.mockReturnValue(MP4);
    loadEpisode(episode, { mode: 'video', startAt: 90 });
    mockLocalVideo.mockReturnValue(undefined);
    onDownloadsChange();
    expect(usePlayback.getState()).toMatchObject({
      mode: 'video',
      engine: 'youtube',
      positionSec: 90,
    });
  });

  it('leaves the other engines alone when downloads change', () => {
    loadEpisode(episode, { mode: 'video' });
    onDownloadsChange();
    expect(usePlayback.getState().engine).toBe('youtube');
  });
});

describe('transport against the local video', () => {
  beforeEach(() => {
    mockLocalVideo.mockReturnValue(MP4);
  });

  it('hands the surface its start position, play intent and rate', () => {
    loadEpisode(episode, { mode: 'video', startAt: 120, autoplay: true });
    expect(attachVideo(handle())).toMatchObject({ startAt: 120, autoplay: true });
  });

  it('sends play / pause / seek / rate to the player', () => {
    loadEpisode(episode, { mode: 'video' });
    const h = handle();
    attachVideo(h);

    play();
    expect(h.play).toHaveBeenCalled();
    expect(usePlayback.getState().playing).toBe(true);
    pause();
    expect(h.pause).toHaveBeenCalled();
    expect(usePlayback.getState().playing).toBe(false);
    seekTo(300);
    expect(h.seekTo).toHaveBeenCalledWith(300);
    expect(usePlayback.getState().positionSec).toBe(300);
    setRate(1.5);
    expect(h.setRate).toHaveBeenCalledWith(1.5);
    setRate(1);
    expect(mockAudio.play).not.toHaveBeenCalled();
  });

  it('follows what the player reports: position, its own controls, the end', () => {
    loadEpisode(episode, { mode: 'video' });
    attachVideo(handle());

    reportVideo({ playing: true, buffering: false });
    reportVideo({ positionSec: 42 });
    expect(usePlayback.getState()).toMatchObject({ playing: true, positionSec: 42 });
    // Paused from the native controls: saved right away.
    reportVideo({ playing: false });
    expect(usePlayback.getState().playing).toBe(false);
    expect(useProgress.getState().byEpisode[episode.id]?.positionSec).toBe(42);

    reportVideo({ playing: false, ended: true });
    expect(usePlayback.getState()).toMatchObject({ playing: false, buffering: false });
  });

  it('ignores reports once another engine is active', () => {
    loadEpisode(episode, { mode: 'video' });
    setMode('audio');
    reportVideo({ positionSec: 999, playing: true });
    expect(usePlayback.getState().positionSec).not.toBe(999);
  });

  it('resumes where the surface left off when it is mounted again', () => {
    loadEpisode(episode, { mode: 'video' });
    const h = handle();
    attachVideo(h);
    reportVideo({ playing: true });
    reportVideo({ positionSec: 77 });
    detachVideo(h);
    expect(usePlayback.getState().playing).toBe(false);
    expect(attachVideo(handle())).toMatchObject({ startAt: 77, autoplay: false });
  });

  it('keeps a seek made while no surface is mounted', () => {
    loadEpisode(episode, { mode: 'video' });
    const h = handle();
    attachVideo(h);
    detachVideo(h); // the episode screen was left
    seekTo(200);
    expect(attachVideo(handle()).startAt).toBe(200);
  });
});

describe('<LocalVideoSurface/>', () => {
  beforeEach(() => {
    mockLocalVideo.mockReturnValue(MP4);
  });

  it('waits for the file, then seeks to the resume position and plays', async () => {
    loadEpisode(episode, { mode: 'video', startAt: 120, autoplay: true });
    const view = await render(<LocalVideoSurface uri={MP4} width={320} />);
    expect(mockVideo.timeUpdateEventInterval).toBe(0.5);
    expect(mockVideo.play).not.toHaveBeenCalled();
    // A stray tick before the seek must not move the saved position to 0.
    await emit('timeUpdate', { currentTime: 0 });
    expect(usePlayback.getState().positionSec).toBe(120);

    mockVideo.status = 'readyToPlay';
    mockVideo.duration = 3000;
    await emit('statusChange', { status: 'readyToPlay' });
    expect(mockVideo.currentTime).toBe(120);
    expect(mockVideo.play).toHaveBeenCalledTimes(1);
    expect(usePlayback.getState().durationSec).toBe(3000);

    await emit('playingChange', { isPlaying: true });
    await emit('timeUpdate', { currentTime: 125 });
    expect(usePlayback.getState()).toMatchObject({ playing: true, positionSec: 125 });

    await view.unmount();
    expect(usePlayback.getState().playing).toBe(false);
  });

  it('stays paused when playback was not asked for, and obeys the transport', async () => {
    loadEpisode(episode, { mode: 'video' });
    mockVideo.status = 'readyToPlay';
    const view = await render(<LocalVideoSurface uri={MP4} width={320} />);
    expect(mockVideo.play).not.toHaveBeenCalled();

    await act(async () => play());
    expect(mockVideo.play).toHaveBeenCalledTimes(1);
    await act(async () => seekTo(60));
    expect(mockVideo.currentTime).toBe(60);
    await act(async () => setRate(2));
    expect(mockVideo.playbackRate).toBe(2);
    await act(async () => pause());
    expect(mockVideo.pause).toHaveBeenCalledTimes(1);
    await act(async () => setRate(1));
    await view.unmount();
  });

  it('shows a rebuffer as buffering, not as a pause, and the end as stopped', async () => {
    loadEpisode(episode, { mode: 'video', autoplay: true });
    mockVideo.status = 'readyToPlay';
    const view = await render(<LocalVideoSurface uri={MP4} width={320} />);
    await emit('playingChange', { isPlaying: true });

    mockVideo.status = 'loading';
    await emit('statusChange', { status: 'loading' });
    await emit('playingChange', { isPlaying: false });
    expect(usePlayback.getState()).toMatchObject({ playing: true, buffering: true });

    mockVideo.status = 'readyToPlay';
    mockVideo.playing = true;
    await emit('statusChange', { status: 'readyToPlay' });
    expect(usePlayback.getState()).toMatchObject({ playing: true, buffering: false });

    await emit('playToEnd');
    expect(usePlayback.getState().playing).toBe(false);
    await view.unmount();
  });

  it('reports a file that cannot be played', async () => {
    loadEpisode(episode, { mode: 'video', autoplay: true });
    const view = await render(<LocalVideoSurface uri={MP4} width={320} />);
    await emit('statusChange', { status: 'error', error: { message: 'corrupt' } });
    expect(usePlayback.getState()).toMatchObject({ playing: false, error: 'corrupt' });
    await view.unmount();
  });
});
