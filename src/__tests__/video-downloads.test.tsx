/**
 * Offline video: an episode downloads as ONE kind — audio (mp3) or video (the
 * archive.org mp4) — the kind is persisted with the item, and the download
 * button only asks "Audio or Video?" when the episode really has both.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { Alert } from 'react-native';
import { DownloadButton } from '@/components/DownloadButton';
import { episodes, type Episode } from '@/content';
import { translate } from '@/i18n';
import {
  deleteDownload,
  downloadKind,
  downloadKindsFor,
  downloadsBytes,
  localAudioUri,
  localVideoUri,
  pauseDownload,
  resumeDownload,
  startDownload,
  storageStats,
  useDownloads,
} from '@/state/downloads';
import { useSettings } from '@/state/settings';

/** In-memory disk + download tasks that finish when the test says so. */
jest.mock('expo-file-system', () => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const join = (parts: (string | { uri: string })[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : p.uri))
      .reduce((a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`);

  class FakeFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    delete() {
      files.delete(this.uri);
    }
    static createDownloadTask = jest.fn((url: string, to: FakeFile) => {
      let settle: (file: FakeFile | null) => void = () => undefined;
      const task = {
        url,
        to,
        downloadAsync: jest.fn(() => new Promise<FakeFile | null>((r) => (settle = r))),
        resumeAsync: jest.fn(() => new Promise<FakeFile | null>((r) => (settle = r))),
        pauseAsync: jest.fn(async () => settle(null)),
        savable: jest.fn(() => ({ url, fileUri: to.uri, resumeData: 'r' })),
        cancel: jest.fn(() => settle(null)),
        /** Test hook: the server delivered `bytes`. */
        finish: (bytes: number) => {
          files.set(to.uri, 'x'.repeat(bytes));
          settle(to);
        },
      };
      return task;
    });
  }

  class FakeDirectory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = `${join(parts).replace(/\/+$/, '')}/`;
    }
    get exists() {
      return dirs.has(this.uri);
    }
    create() {
      dirs.add(this.uri);
    }
    get size() {
      let total = 0;
      for (const [uri, text] of files) if (uri.startsWith(this.uri)) total += text.length;
      return total;
    }
  }

  return {
    File: FakeFile,
    Directory: FakeDirectory,
    DownloadTask: { fromSavable: jest.fn(() => undefined) },
    Paths: { document: new FakeDirectory('file:///documents'), availableDiskSpace: 1e9 },
    __files: files,
  };
});

type FakeTask = {
  url: string;
  to: { uri: string };
  resumeAsync: jest.Mock;
  finish: (bytes: number) => void;
};
const createTask = File.createDownloadTask as unknown as jest.Mock;
const lastTask = () => createTask.mock.results.at(-1)!.value as FakeTask;
const files = (jest.requireMock('expo-file-system') as { __files: Map<string, string> }).__files;
const item = (ep: Episode) => useDownloads.getState().items[ep.id];
/** Let the task's promise chain run. */
const settled = () => act(async () => undefined);

const withVideo = episodes.find((e) => e.audioUrl && e.archiveVideoUrl)!;
const audioOnly: Episode = { ...withVideo, id: 'audio-only', archiveVideoUrl: undefined };
const MP3 = `file:///documents/audio/${withVideo.id}.mp3`;
const MP4 = `file:///documents/video/${withVideo.id}.mp4`;

beforeEach(() => {
  for (const id of Object.keys(useDownloads.getState().items)) deleteDownload(id);
  files.clear();
  useSettings.setState({ locale: 'en' });
  jest.clearAllMocks();
});

describe('download kinds', () => {
  it('offers video only for an episode with an archive.org mp4', () => {
    expect(downloadKindsFor(withVideo)).toEqual(['audio', 'video']);
    expect(downloadKindsFor(audioOnly)).toEqual(['audio']);
    expect(
      downloadKindsFor({ ...audioOnly, audioUrl: undefined, archiveAudioUrl: undefined }),
    ).toEqual([]);
  });

  it('treats an item persisted before kinds existed as audio', () => {
    expect(downloadKind({})).toBe('audio');
    expect(downloadKind(undefined)).toBe('audio');
    expect(downloadKind({ kind: 'video' })).toBe('video');
  });

  it('downloads audio from the enclosure to <id>.mp3 — the default, as before', async () => {
    startDownload(withVideo);
    expect(lastTask().url).toBe(withVideo.audioUrl);
    expect(lastTask().to.uri).toBe(MP3);
    expect(item(withVideo)).toMatchObject({ kind: 'audio', status: 'downloading' });

    lastTask().finish(1000);
    await settled();
    expect(item(withVideo)).toMatchObject({ kind: 'audio', status: 'done', totalBytes: 1000 });
    expect(localAudioUri(withVideo.id)).toBe(MP3);
    expect(localVideoUri(withVideo.id)).toBeUndefined();
  });

  it('downloads video from archive.org to <id>.mp4 and records the kind', async () => {
    startDownload(withVideo, 'video');
    expect(lastTask().url).toBe(withVideo.archiveVideoUrl);
    expect(lastTask().to.uri).toBe(MP4);
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'downloading' });

    lastTask().finish(5000);
    await settled();
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'done', totalBytes: 5000 });
    expect(localVideoUri(withVideo.id)).toBe(MP4);
    expect(localAudioUri(withVideo.id)).toBeUndefined();
  });

  it('does not start a video download for an episode without an mp4', () => {
    startDownload(audioOnly, 'video');
    expect(createTask).not.toHaveBeenCalled();
    expect(item(audioOnly)).toBeUndefined();
  });

  it('forgets a downloaded video whose file is gone, and fetches it again as video', async () => {
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    await settled();
    files.delete(MP4);
    expect(localVideoUri(withVideo.id)).toBeUndefined();

    startDownload(withVideo); // no kind: the one it was downloaded as
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(lastTask().to.uri).toBe(MP4);
  });

  it('keeps one kind per episode: switching replaces the other file', async () => {
    startDownload(withVideo, 'audio');
    lastTask().finish(1000);
    await settled();

    startDownload(withVideo, 'video');
    expect(files.has(MP3)).toBe(false);
    lastTask().finish(5000);
    await settled();
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'done' });
    expect([...files.keys()]).toEqual([MP4]);
  });

  it('pauses and resumes a video download as video', async () => {
    startDownload(withVideo, 'video');
    const task = lastTask();
    await act(() => pauseDownload(withVideo.id));
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'paused' });
    expect(item(withVideo)!.pauseState).toBeDefined();

    resumeDownload(withVideo);
    expect(task.resumeAsync).toHaveBeenCalled();
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'downloading' });
    task.finish(5000);
    await settled();
    expect(localVideoUri(withVideo.id)).toBe(MP4);
  });

  it('retries a failed video download as video', () => {
    useDownloads.getState().patch(withVideo.id, { kind: 'video', status: 'error' });
    startDownload(withVideo);
    expect(lastTask().url).toBe(withVideo.archiveVideoUrl);
  });

  it('counts both kinds in the storage figures and deletes either file', async () => {
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    startDownload(audioOnly);
    lastTask().finish(1000);
    await settled();
    expect(downloadsBytes()).toBe(6000);
    expect(storageStats().usedBytes).toBe(6000);

    deleteDownload(withVideo.id);
    expect(files.has(MP4)).toBe(false);
    expect(item(withVideo)).toBeUndefined();
    expect(downloadsBytes()).toBe(1000);
    deleteDownload(audioOnly.id);
    expect(downloadsBytes()).toBe(0);
  });
});

describe('<DownloadButton/> chooser', () => {
  it('asks "Audio or Video?" when the episode has an mp4, and starts what was picked', async () => {
    await render(<DownloadButton episode={withVideo} />);
    expect(screen.queryByTestId('download-video')).toBeNull();

    await fireEvent.press(screen.getByTestId('download-button'));
    // Nothing starts until a kind is picked.
    expect(createTask).not.toHaveBeenCalled();
    expect(screen.getByText(translate('en', 'downloadChoose'))).toBeTruthy();
    expect(screen.getByTestId('download-audio')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('download-video'));
    expect(lastTask().url).toBe(withVideo.archiveVideoUrl);
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'downloading' });
    expect(screen.queryByTestId('download-video')).toBeNull();
    expect(screen.getByTestId('download-progress')).toBeTruthy();
  });

  it('starts the audio download when "Audio" is picked', async () => {
    await render(<DownloadButton episode={withVideo} />);
    await fireEvent.press(screen.getByTestId('download-button'));
    await fireEvent.press(screen.getByTestId('download-audio'));
    expect(lastTask().url).toBe(withVideo.audioUrl);
    expect(item(withVideo)).toMatchObject({ kind: 'audio' });
  });

  it('downloads audio straight away, without a prompt, when there is no video', async () => {
    await render(<DownloadButton episode={audioOnly} />);
    expect(screen.getByLabelText(translate('en', 'download'))).toBeTruthy();
    await fireEvent.press(screen.getByTestId('download-button'));
    expect(screen.queryByTestId('download-audio')).toBeNull();
    expect(lastTask().url).toBe(audioOnly.audioUrl);
    expect(item(audioOnly)).toMatchObject({ kind: 'audio', status: 'downloading' });
  });

  it('says which kind is on disk, and deletes it after a confirm', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    await settled();

    await render(<DownloadButton episode={withVideo} />);
    expect(screen.queryByTestId('downloaded-audio')).toBeNull();
    const done = screen.getByTestId('downloaded-video');
    expect(done.props.accessibilityLabel).toBe(translate('en', 'downloadedVideo'));

    await fireEvent.press(done);
    type AlertButton = { style?: string; onPress?: () => void };
    const buttons = alert.mock.calls.at(-1)![2] as AlertButton[];
    await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
    expect(files.has(MP4)).toBe(false);
    expect(screen.getByTestId('download-button')).toBeTruthy();
  });

  it('has every new string in both locales', () => {
    for (const key of [
      'downloadEpisode',
      'downloadChoose',
      'downloadAudioHint',
      'downloadVideoHint',
      'downloadedAudio',
      'downloadedVideo',
    ] as const) {
      expect(translate('fa', key)).not.toBe(translate('en', key));
      expect(translate('fa', key)).not.toBe(key);
    }
  });
});
