/**
 * `Episode.hasVideo` — the one flag behind every video affordance (v1.3.5).
 *
 * The numbered episodes before S03E07 are audio-only: their upload is the
 * audio over a still image, so the app must not offer it as video. The flag is
 * derived in the content pipeline (pipeline/src/lib/video.ts) and shipped in
 * content/episodes.json; the app reads it and never compares episode numbers.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import EpisodeRoute from '../app/episode/[id]';
import { hasVideoFor } from '../../pipeline/src/lib/video';
import { DownloadButton } from '@/components/DownloadButton';
import { PlayerControls } from '@/components/PlayerControls';
import { episodes, getEpisode, type Episode } from '@/content';
import { translate } from '@/i18n';
import {
  archiveVideoSourceFor,
  audioSourceFor,
  loadEpisode,
  modeFor,
  setMode,
  stop,
  toggle,
} from '@/player/controller';
import { usePlayback } from '@/player/store';
import {
  deleteDownload,
  downloadKindsFor,
  downloadSourceFor,
  manageActionsFor,
  startDownload,
  useDownloads,
} from '@/state/downloads';
import { useSettings } from '@/state/settings';

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
};
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-video', () => ({ useVideoPlayer: jest.fn(), VideoView: () => null }));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('@/lib/cache', () => ({
  cachedImageUri: jest.fn(() => undefined),
  useCachedImage: (uri: string) => uri,
}));
jest.mock('@/player/artwork', () => ({
  localArtworkUri: jest.fn(() => 'file:///artwork.jpg'),
  resolveLocalArtwork: jest.fn(() => Promise.resolve(undefined)),
}));
/** Both video surfaces, as markers: the tests only ask whether one is shown. */
jest.mock('@/components/YoutubeSurface', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    YoutubeSurface: ({ hidden }: { hidden?: boolean }) => (
      <View testID={hidden ? 'youtube-audio' : 'youtube-video'} />
    ),
  };
});
jest.mock('@/components/LocalVideoSurface', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { LocalVideoSurface: () => <View testID="local-video" /> };
});
jest.mock('@shopify/flash-list', () => {
  const { ScrollView, View } = jest.requireActual<typeof import('react-native')>('react-native');
  function FlashList(props: {
    data: unknown[];
    renderItem: (info: { item: unknown; index: number }) => ReactNode;
  }) {
    return (
      <ScrollView>
        {props.data.map((item, index) => (
          <View key={index}>{props.renderItem({ item, index })}</View>
        ))}
      </ScrollView>
    );
  }
  return { FlashList };
});
/** A disk with nothing on it, and downloads that never finish. */
jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    exists = false;
    size = 0;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    delete() {}
    static createDownloadTask = jest.fn((url: string) => ({
      url,
      downloadAsync: jest.fn(() => new Promise(() => undefined)),
      cancel: jest.fn(),
    }));
  }
  class FakeDirectory {
    uri: string;
    exists = true;
    size = 0;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
    }
    create() {}
  }
  return {
    File: FakeFile,
    Directory: FakeDirectory,
    DownloadTask: { fromSavable: jest.fn(() => undefined) },
    Paths: { document: new FakeDirectory('file:///documents'), availableDiskSpace: 1e9 },
  };
});

const createTask = File.createDownloadTask as unknown as jest.Mock;
const taskUrls = () => createTask.mock.results.map((r) => (r.value as { url: string }).url);
const episode = (id: string) => getEpisode(id)!;
const params = (value: Record<string, string>) =>
  (useLocalSearchParams as jest.Mock).mockReturnValue(value);

const s01e01 = episode('s01e01');
const s03e06 = episode('s03e06');
const s03e07 = episode('s03e07');
const special = episodes.find((e) => e.season === 0)!;
const MP4 = 'https://archive.org/download/item/video.mp4';
/** An audio-only episode whose archive.org item nevertheless holds an mp4 (the still image). */
const stillImage: Episode = { ...s03e06, archiveVideoUrl: MP4 };

beforeEach(async () => {
  await act(async () => stop());
  for (const id of Object.keys(useDownloads.getState().items)) deleteDownload(id);
  await useSettings.persist.rehydrate();
  useSettings.setState({ locale: 'en' });
  jest.clearAllMocks();
});

describe('hasVideo in the shipped content', () => {
  it('is false for the numbered episodes before S03E07', () => {
    expect(s01e01.hasVideo).toBe(false);
    expect(s03e06.hasVideo).toBe(false);
    expect(episode('s02e03').hasVideo).toBe(false);
  });

  it('is true from S03E07 on', () => {
    expect(s03e07.hasVideo).toBe(true);
    expect(episode('s04e01').hasVideo).toBe(true);
    expect(episode('s07e07').hasVideo).toBe(true);
  });

  it('is true for the specials (SP talks), whatever their number', () => {
    const specials = episodes.filter((e) => e.season === 0);
    expect(specials.length).toBeGreaterThan(0);
    expect(specials.map((e) => e.code).every((code) => code.startsWith('SP'))).toBe(true);
    expect(specials.every((e) => e.hasVideo)).toBe(true);
    expect(episode('sp01').hasVideo).toBe(true);
  });

  it('is an explicit boolean on every episode, in step with the pipeline rule', () => {
    for (const e of episodes) {
      expect(typeof e.hasVideo).toBe('boolean');
      expect([e.id, e.hasVideo]).toEqual([e.id, hasVideoFor(e)]);
    }
    // Exactly S01, S02 and S03E01–E06 are audio-only.
    expect(
      episodes
        .filter((e) => !e.hasVideo)
        .map((e) => e.id)
        .sort(),
    ).toEqual(
      episodes
        .filter((e) => e.season > 0 && (e.season < 3 || (e.season === 3 && e.episode < 7)))
        .map((e) => e.id)
        .sort(),
    );
  });

  it('leaves every audio-only episode with audio to play', () => {
    for (const e of episodes.filter((x) => !x.hasVideo)) expect(audioSourceFor(e)).toBeTruthy();
  });
});

describe('the pipeline rule (hasVideoFor)', () => {
  it('draws the line at S03E07 for numbered episodes', () => {
    expect(hasVideoFor({ season: 1, episode: 1 })).toBe(false);
    expect(hasVideoFor({ season: 2, episode: 12 })).toBe(false);
    expect(hasVideoFor({ season: 3, episode: 6 })).toBe(false);
    expect(hasVideoFor({ season: 3, episode: 7 })).toBe(true);
    expect(hasVideoFor({ season: 3, episode: 8 })).toBe(true);
    expect(hasVideoFor({ season: 4, episode: 1 })).toBe(true);
  });

  it('keeps video for every special', () => {
    expect(hasVideoFor({ season: 0, episode: 1 })).toBe(true);
    expect(hasVideoFor({ season: 0, episode: 15 })).toBe(true);
  });
});

describe('downloads of an audio-only episode', () => {
  it('offers audio only — even when archive.org holds an mp4 for it', () => {
    expect(downloadKindsFor(s03e06)).toEqual(['audio']);
    expect(downloadKindsFor(stillImage)).toEqual(['audio']);
    expect(downloadSourceFor(stillImage, 'video')).toBeUndefined();
    expect(archiveVideoSourceFor(stillImage)).toBeUndefined();
    expect(manageActionsFor(stillImage, { kind: 'audio', status: 'done' })).toEqual(['delete']);
  });

  it('still offers both for S03E07 and for a special', () => {
    expect(downloadKindsFor(s03e07)).toEqual(['audio', 'video']);
    expect(downloadKindsFor(special)).toEqual(['audio', 'video']);
  });

  it('starts the audio download straight away: no "Audio or Video?" prompt', async () => {
    await render(<DownloadButton episode={stillImage} />);
    expect(screen.getByLabelText(translate('en', 'download'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('download-button'));
    expect(screen.queryByText(translate('en', 'downloadChoose'))).toBeNull();
    expect(screen.queryByTestId('download-video')).toBeNull();
    expect(taskUrls()).toEqual([stillImage.audioUrl]);
    expect(useDownloads.getState().items[stillImage.id]).toMatchObject({ kind: 'audio' });
  });

  it('refuses a video download, and retries an old one as audio', () => {
    startDownload(stillImage, 'video');
    expect(createTask).not.toHaveBeenCalled();

    // Begun as video before the episode became audio-only, and failed since.
    useDownloads.getState().patch(stillImage.id, { kind: 'video', status: 'error' });
    startDownload(stillImage);
    expect(taskUrls()).toEqual([stillImage.audioUrl]);
    expect(useDownloads.getState().items[stillImage.id]).toMatchObject({
      kind: 'audio',
      status: 'downloading',
    });
  });

  it('still asks for an episode with video', async () => {
    await render(<DownloadButton episode={s03e07} />);
    await fireEvent.press(screen.getByTestId('download-button'));
    expect(screen.getByTestId('download-video')).toBeTruthy();
    expect(createTask).not.toHaveBeenCalled();
  });
});

describe('the player for an audio-only episode', () => {
  it('has no Audio / Video switch, and keeps the rest of the transport', async () => {
    loadEpisode(s03e06);
    await render(<PlayerControls episode={s03e06} />);
    expect(screen.queryByTestId('mode-switch')).toBeNull();
    expect(screen.queryByText(translate('en', 'video'))).toBeNull();
    expect(screen.getByTestId('play-toggle')).toBeTruthy();
  });

  it('shows the switch for S03E07 and for a special', async () => {
    loadEpisode(s03e07);
    const view = await render(<PlayerControls episode={s03e07} />);
    expect(screen.getByTestId('mode-switch')).toBeTruthy();
    expect(screen.getByText(translate('en', 'video'))).toBeTruthy();
    await view.unmount();

    loadEpisode(special);
    await render(<PlayerControls episode={special} />);
    expect(screen.getByTestId('mode-switch')).toBeTruthy();
  });

  it('never enters video mode: it stays on the audio engine', () => {
    expect(modeFor(stillImage, 'video')).toBe('audio');
    expect(modeFor(s03e07, 'video')).toBe('video');

    loadEpisode(s03e06, { mode: 'video' });
    expect(usePlayback.getState()).toMatchObject({ mode: 'audio', engine: 'native' });
    setMode('video');
    expect(usePlayback.getState()).toMatchObject({ mode: 'audio', engine: 'native' });
    expect(mockPlayer.replace).toHaveBeenCalledTimes(1);
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: s03e06.audioUrl });
  });

  it('does not carry video mode over from the episode played before', () => {
    loadEpisode(s03e07, { mode: 'video' });
    expect(usePlayback.getState()).toMatchObject({ mode: 'video', engine: 'youtube' });
    loadEpisode(s03e06, { mode: usePlayback.getState().mode });
    expect(usePlayback.getState()).toMatchObject({
      episodeId: s03e06.id,
      mode: 'audio',
      engine: 'native',
    });
  });

  it('plays and pauses its audio as before', () => {
    loadEpisode(s01e01, { autoplay: true });
    expect(mockPlayer.replace).toHaveBeenCalledWith({ uri: s01e01.audioUrl });
    expect(mockPlayer.play).toHaveBeenCalledTimes(1);
    expect(usePlayback.getState().engine).toBe('native');

    usePlayback.setState({ playing: true });
    toggle();
    expect(mockPlayer.pause).toHaveBeenCalledTimes(1);
    expect(usePlayback.getState().playing).toBe(false);
    toggle();
    expect(mockPlayer.play).toHaveBeenCalledTimes(2);
  });
});

describe('the episode screen', () => {
  it('audio-only episode: no switch, no video surface, an audio-only download', async () => {
    params({ id: s03e06.id });
    await render(<EpisodeRoute />);
    expect(usePlayback.getState()).toMatchObject({ episodeId: s03e06.id, mode: 'audio' });
    expect(screen.getByTestId('play-toggle')).toBeTruthy();
    expect(screen.queryByTestId('mode-switch')).toBeNull();

    // Whatever asks for video, none is shown.
    await act(async () => setMode('video'));
    await act(async () => loadEpisode(s03e06, { mode: 'video', autoplay: true }));
    expect(screen.queryByTestId('youtube-video')).toBeNull();
    expect(screen.queryByTestId('local-video')).toBeNull();
    expect(screen.queryByTestId('youtube-audio')).toBeNull();
    expect(screen.getByTestId('episode-title')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('download-button'));
    expect(screen.queryByTestId('download-video')).toBeNull();
    expect(taskUrls()).toEqual([s03e06.audioUrl]);
  });

  it('S03E07: the switch is there and Video shows the YouTube surface', async () => {
    params({ id: s03e07.id });
    await render(<EpisodeRoute />);
    expect(screen.getByTestId('mode-switch')).toBeTruthy();
    expect(screen.queryByTestId('youtube-video')).toBeNull();

    await fireEvent.press(screen.getByText(translate('en', 'video')));
    expect(usePlayback.getState()).toMatchObject({ mode: 'video', engine: 'youtube' });
    expect(screen.getByTestId('youtube-video')).toBeTruthy();
  });

  it('a special: video stays as it was', async () => {
    params({ id: special.id });
    await render(<EpisodeRoute />);
    expect(screen.getByTestId('mode-switch')).toBeTruthy();
    await fireEvent.press(screen.getByText(translate('en', 'video')));
    expect(usePlayback.getState().mode).toBe('video');
    expect(screen.getByTestId('youtube-video')).toBeTruthy();
  });
});
