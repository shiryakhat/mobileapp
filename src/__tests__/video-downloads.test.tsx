/**
 * Offline video: an episode downloads as audio (mp3) or video (the archive.org
 * mp4) — the kind is persisted with the item, and the download button only asks
 * "Audio or Video?" when the episode really has both. Since v1.3.2 the other
 * kind can be fetched next to the first, and the downloaded button opens a menu
 * to get it or to delete what is on disk.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { DownloadButton } from '@/components/DownloadButton';
import { episodes, type Episode } from '@/content';
import { translate } from '@/i18n';
import {
  deleteDownload,
  downloadedKinds,
  downloadKind,
  downloadKindsFor,
  downloadsBytes,
  localAudioUri,
  localVideoUri,
  manageActionsFor,
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

  it('keeps a finished download when the other kind is fetched next to it', async () => {
    startDownload(withVideo, 'audio');
    lastTask().finish(1000);
    await settled();

    startDownload(withVideo, 'video');
    // The mp3 stays, and stays playable, while the mp4 comes down.
    expect(files.has(MP3)).toBe(true);
    expect(item(withVideo)).toMatchObject({
      kind: 'video',
      status: 'downloading',
      also: { kind: 'audio', totalBytes: 1000 },
    });
    expect(localAudioUri(withVideo.id)).toBe(MP3);
    lastTask().finish(5000);
    await settled();
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'done' });
    expect(downloadedKinds(item(withVideo))).toEqual(['audio', 'video']);
    expect([...files.keys()].sort()).toEqual([MP3, MP4]);
    expect(localAudioUri(withVideo.id)).toBe(MP3);
    expect(localVideoUri(withVideo.id)).toBe(MP4);
    expect(storageStats().usedBytes).toBe(6000);
  });

  it('clears an unfinished download of the other kind instead of keeping it', () => {
    // A failed audio download left a partial mp3 behind.
    files.set(MP3, 'partial');
    useDownloads.getState().patch(withVideo.id, { kind: 'audio', status: 'error' });

    startDownload(withVideo, 'video');
    expect(files.has(MP3)).toBe(false);
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'downloading' });
    expect(item(withVideo)!.also).toBeUndefined();
  });

  it('deletes one kind and keeps the other', async () => {
    startDownload(withVideo, 'audio');
    lastTask().finish(1000);
    await settled();
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    await settled();

    // The kept one (audio) goes: the item is untouched otherwise.
    deleteDownload(withVideo.id, 'audio');
    expect([...files.keys()]).toEqual([MP4]);
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'done', totalBytes: 5000 });
    expect(item(withVideo)!.also).toBeUndefined();

    // Asking for a kind that is not there is a no-op.
    deleteDownload(withVideo.id, 'audio');
    expect(item(withVideo)).toMatchObject({ kind: 'video', status: 'done' });

    // The last one goes: nothing is left.
    deleteDownload(withVideo.id, 'video');
    expect(files.size).toBe(0);
    expect(item(withVideo)).toBeUndefined();
  });

  it('promotes the kept kind when the one fetched last is deleted', async () => {
    startDownload(withVideo, 'audio');
    lastTask().finish(1000);
    await settled();
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    await settled();

    deleteDownload(withVideo.id, 'video');
    expect([...files.keys()]).toEqual([MP3]);
    expect(item(withVideo)).toMatchObject({ kind: 'audio', status: 'done', totalBytes: 1000 });
    expect(item(withVideo)!.also).toBeUndefined();
    expect(localAudioUri(withVideo.id)).toBe(MP3);
    expect(localVideoUri(withVideo.id)).toBeUndefined();
    expect(storageStats().usedBytes).toBe(1000);
  });

  it('survives a file system that throws while deleting one kind', async () => {
    startDownload(withVideo, 'audio');
    lastTask().finish(1000);
    await settled();
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    await settled();

    const del = jest.spyOn(File.prototype, 'delete').mockImplementation(() => {
      throw new Error('EBUSY');
    });
    expect(() => deleteDownload(withVideo.id, 'audio')).not.toThrow();
    expect(() => deleteDownload(withVideo.id, 'video')).not.toThrow();
    expect(() => deleteDownload(withVideo.id)).not.toThrow();
    del.mockRestore();
    expect(item(withVideo)).toBeUndefined();
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

  it('says which kind is on disk', async () => {
    startDownload(withVideo, 'video');
    lastTask().finish(5000);
    await settled();

    await render(<DownloadButton episode={withVideo} />);
    expect(screen.queryByTestId('downloaded-audio')).toBeNull();
    const done = screen.getByTestId('downloaded-video');
    expect(done.props.accessibilityLabel).toBe(translate('en', 'downloadedVideo'));
  });

  it('has every new string in both locales', () => {
    for (const key of [
      'downloadEpisode',
      'downloadChoose',
      'downloadAudioHint',
      'downloadVideoHint',
      'downloadedAudio',
      'downloadedVideo',
      'downloadedBoth',
      'getAudio',
      'getVideo',
      'deleteAudio',
      'deleteVideo',
      'deleteBoth',
      'deleteDownload',
    ] as const) {
      expect(translate('fa', key)).not.toBe(translate('en', key));
      expect(translate('fa', key)).not.toBe(key);
    }
  });
});

describe('menu of a downloaded episode: the choices', () => {
  const done = (kind: 'audio' | 'video') => ({ kind, status: 'done' as const });

  it('offers nothing while nothing is on disk', () => {
    expect(manageActionsFor(withVideo, undefined)).toEqual([]);
    expect(manageActionsFor(withVideo, { kind: 'audio', status: 'downloading' })).toEqual([]);
  });

  it('audio on disk, video available: get the video, or delete the audio', () => {
    expect(manageActionsFor(withVideo, done('audio'))).toEqual(['download-video', 'delete-audio']);
  });

  it('video on disk, audio available: get the audio, or delete the video', () => {
    expect(manageActionsFor(withVideo, done('video'))).toEqual(['download-audio', 'delete-video']);
  });

  it('both on disk: delete either, or both', () => {
    const both = { ...done('video'), also: { kind: 'audio' as const, totalBytes: 1 } };
    expect(manageActionsFor(withVideo, both)).toEqual([
      'delete-audio',
      'delete-video',
      'delete-all',
    ]);
  });

  it('an audio-only episode: just "Delete download"', () => {
    expect(manageActionsFor(audioOnly, done('audio'))).toEqual(['delete']);
    // An item from before kinds existed is audio.
    expect(manageActionsFor(audioOnly, { status: 'done' })).toEqual(['delete']);
  });

  it('offers both kinds for an archive-backed special (mp3 + mp4, no enclosure)', () => {
    const special = episodes.find((e) => e.season === 0 && !e.audioUrl && e.archiveVideoUrl)!;
    expect(special.archiveAudioUrl).toBeTruthy();
    expect(manageActionsFor(special, done('audio'))).toEqual(['download-video', 'delete-audio']);
  });
});

describe('<DownloadButton/> menu of a downloaded episode', () => {
  const download = async (ep: Episode, kind: 'audio' | 'video', bytes: number) => {
    startDownload(ep, kind);
    lastTask().finish(bytes);
    await settled();
  };
  const ids = () =>
    ['download-audio', 'download-video', 'delete-audio', 'delete-video', 'delete-all', 'delete']
      .map((a) => `manage-${a}`)
      .filter((id) => screen.queryByTestId(id));

  it('audio downloaded: "Download Video" fetches the mp4 and keeps the mp3', async () => {
    await download(withVideo, 'audio', 1000);
    await render(<DownloadButton episode={withVideo} />);
    expect(ids()).toEqual([]);

    await fireEvent.press(screen.getByTestId('downloaded-audio'));
    expect(ids()).toEqual(['manage-download-video', 'manage-delete-audio']);
    expect(screen.getByText('Download Video')).toBeTruthy();
    expect(screen.getByText('Delete Audio')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('manage-download-video'));
    expect(lastTask().url).toBe(withVideo.archiveVideoUrl);
    expect(lastTask().to.uri).toBe(MP4);
    expect(files.has(MP3)).toBe(true);
    expect(screen.getByTestId('download-progress')).toBeTruthy();

    lastTask().finish(5000);
    await settled();
    expect(screen.getByTestId('downloaded-both')).toBeTruthy();
  });

  it('video downloaded: "Download Audio" fetches the mp3; "Delete Video" removes the mp4', async () => {
    await download(withVideo, 'video', 5000);
    await render(<DownloadButton episode={withVideo} />);
    await fireEvent.press(screen.getByTestId('downloaded-video'));
    expect(ids()).toEqual(['manage-download-audio', 'manage-delete-video']);
    expect(screen.getByText('Download Audio')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('manage-delete-video'));
    expect(files.size).toBe(0);
    expect(item(withVideo)).toBeUndefined();
    expect(screen.getByTestId('download-button')).toBeTruthy();
  });

  it('both downloaded: deletes one and keeps the other, or deletes all', async () => {
    await download(withVideo, 'audio', 1000);
    await download(withVideo, 'video', 5000);
    await render(<DownloadButton episode={withVideo} />);
    await fireEvent.press(screen.getByTestId('downloaded-both'));
    expect(ids()).toEqual(['manage-delete-audio', 'manage-delete-video', 'manage-delete-all']);

    await fireEvent.press(screen.getByTestId('manage-delete-video'));
    expect([...files.keys()]).toEqual([MP3]);
    expect(item(withVideo)).toMatchObject({ kind: 'audio', status: 'done' });

    // Back to one kind: the menu offers the video again.
    await fireEvent.press(screen.getByTestId('downloaded-audio'));
    expect(ids()).toEqual(['manage-download-video', 'manage-delete-audio']);
    await fireEvent.press(screen.getByTestId('manage-download-video'));
    lastTask().finish(5000);
    await settled();

    await fireEvent.press(screen.getByTestId('downloaded-both'));
    await fireEvent.press(screen.getByTestId('manage-delete-all'));
    expect(files.size).toBe(0);
    expect(item(withVideo)).toBeUndefined();
    expect(screen.getByTestId('download-button')).toBeTruthy();
  });

  it('audio-only episode: just "Delete download"', async () => {
    await download(audioOnly, 'audio', 1000);
    await render(<DownloadButton episode={audioOnly} />);
    await fireEvent.press(screen.getByTestId('downloaded-audio'));
    expect(ids()).toEqual(['manage-delete']);
    expect(screen.getByText('Delete download')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('manage-delete'));
    expect(files.size).toBe(0);
    expect(item(audioOnly)).toBeUndefined();
  });

  it('does not crash when the file system throws on delete', async () => {
    await download(withVideo, 'audio', 1000);
    await render(<DownloadButton episode={withVideo} />);
    const del = jest.spyOn(File.prototype, 'delete').mockImplementation(() => {
      throw new Error('EBUSY');
    });
    await fireEvent.press(screen.getByTestId('downloaded-audio'));
    await fireEvent.press(screen.getByTestId('manage-delete-audio'));
    del.mockRestore();
    expect(screen.getByTestId('download-button')).toBeTruthy();
  });
});
