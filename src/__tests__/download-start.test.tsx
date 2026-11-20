/**
 * Starting a download must never crash the app (v1.3.0 / build 36 did).
 *
 * Root cause, reproduced on a simulator: expo-file-system's native progress
 * event carries `bytesWritten` / `totalBytes` as Int64, which arrives in JS as
 * a BigInt. Stored as-is it broke `JSON.stringify` (the persist middleware:
 * "Do not know how to serialize a BigInt") and `Math.max` in the progress ring
 * ("Cannot convert BigInt to number") — a render error, fatal in a release
 * build. So the fake task below reports progress the way the device does.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { DownloadButton, downloadFraction } from '@/components/DownloadButton';
import { episodes, type Episode } from '@/content';
import {
  deleteDownload,
  pauseDownload,
  resumeDownload,
  startDownload,
  toBytes,
  useDownloads,
} from '@/state/downloads';
import { useSettings } from '@/state/settings';

type Progress = (p: { bytesWritten: unknown; totalBytes: unknown }) => void;

jest.mock('expo-file-system', () => {
  const state = { failDirs: false };
  class FakeFile {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    get exists() {
      return false;
    }
    get size() {
      return 0;
    }
    delete() {
      throw new Error('path does not exist');
    }
    static createDownloadTask = jest.fn(
      (url: string, to: FakeFile, options: { onProgress: Progress }) => ({
        url,
        to,
        onProgress: options.onProgress,
        downloadAsync: jest.fn(() => new Promise(() => undefined)),
        resumeAsync: jest.fn(() => new Promise(() => undefined)),
        pauseAsync: jest.fn(() => Promise.reject(new Error('Cannot call pause() in state "idle"'))),
        savable: jest.fn(),
        cancel: jest.fn(() => {
          throw new Error('already released');
        }),
      }),
    );
  }
  class FakeDirectory {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      if (state.failDirs) throw new Error('tried to create a directory with a file path');
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}${name}/`;
    }
    get exists() {
      return true;
    }
    create() {}
  }
  return {
    File: FakeFile,
    Directory: FakeDirectory,
    DownloadTask: { fromSavable: jest.fn() },
    Paths: {
      get document() {
        return new FakeDirectory('file:///documents/');
      },
      availableDiskSpace: 1e9,
    },
    __state: state,
  };
});

const fs = jest.requireMock('expo-file-system') as { __state: { failDirs: boolean } };
const createTask = File.createDownloadTask as unknown as jest.Mock;
const lastTask = () => createTask.mock.results.at(-1)!.value as { onProgress: Progress };
const item = (ep: Episode) => useDownloads.getState().items[ep.id];
const persisted = async () => {
  const raw = await AsyncStorage.getItem('syk.downloads');
  return JSON.parse(raw!) as { state: { items: Record<string, unknown> } };
};

const episode = episodes.find((e) => e.audioUrl && e.archiveVideoUrl)!;
const special = episodes.find((e) => !e.audioUrl && e.archiveAudioUrl);
const MB = 1024 * 1024;

beforeEach(() => {
  fs.__state.failDirs = false;
  for (const id of Object.keys(useDownloads.getState().items)) deleteDownload(id);
  useSettings.setState({ locale: 'en' });
  jest.clearAllMocks();
  createTask.mockClear();
});

describe('byte counts from native', () => {
  it('turns whatever native sends into a plain non-negative number', () => {
    expect(toBytes(BigInt(135127039))).toBe(135127039);
    expect(toBytes(42)).toBe(42);
    expect(toBytes(BigInt(-1))).toBe(0); // "size unknown"
    expect(toBytes(-1)).toBe(0);
    expect(toBytes(NaN)).toBe(0);
    expect(toBytes(undefined)).toBe(0);
    expect(toBytes('12')).toBe(0);
  });

  it('computes the ring fraction from BigInt counts without throwing', () => {
    const fraction = downloadFraction({
      bytesWritten: BigInt(25) as unknown as number,
      totalBytes: BigInt(100) as unknown as number,
    });
    expect(fraction).toBe(0.25);
  });
});

describe('starting a download', () => {
  it('stores BigInt progress as numbers, so the state persists and renders', async () => {
    await render(<DownloadButton episode={episode} />);
    await fireEvent.press(screen.getByTestId('download-button'));
    await fireEvent.press(screen.getByTestId('download-audio'));
    expect(item(episode)).toMatchObject({ kind: 'audio', status: 'downloading' });

    // What the device delivers: Int64 → BigInt.
    await act(async () =>
      lastTask().onProgress({ bytesWritten: BigInt(16 * MB), totalBytes: BigInt(128 * MB) }),
    );

    expect(item(episode)).toMatchObject({ bytesWritten: 16 * MB, totalBytes: 128 * MB });
    expect(typeof item(episode)!.bytesWritten).toBe('number');
    // The persist middleware wrote it (it threw on a BigInt before).
    expect((await persisted()).state.items[episode.id]).toMatchObject({
      status: 'downloading',
      bytesWritten: 16 * MB,
      totalBytes: 128 * MB,
    });
    // And the ring drew it (Math.max threw on a BigInt before).
    expect(screen.getByTestId('download-progress').props.accessibilityValue.now).toBe(13);
  });

  it.each(['audio', 'video'] as const)(
    'survives a %s pick whose progress has no known size',
    async (kind) => {
      await render(<DownloadButton episode={episode} />);
      await fireEvent.press(screen.getByTestId('download-button'));
      await fireEvent.press(screen.getByTestId(`download-${kind}`));
      await act(async () =>
        lastTask().onProgress({ bytesWritten: BigInt(5 * MB), totalBytes: BigInt(-1) }),
      );
      expect(item(episode)).toMatchObject({ kind, bytesWritten: 5 * MB, totalBytes: 0 });
      expect(screen.getByTestId('download-progress').props.accessibilityValue.now).toBe(0);
    },
  );

  it('downloads a talk special (archive.org mp3) the same way', async () => {
    if (!special) return;
    startDownload(special, 'audio');
    await act(async () =>
      lastTask().onProgress({ bytesWritten: BigInt(MB), totalBytes: BigInt(4 * MB) }),
    );
    expect(item(special)).toMatchObject({ status: 'downloading', bytesWritten: MB });
  });

  it('ignores a progress event that arrives after the download was deleted', async () => {
    startDownload(episode, 'audio');
    const task = lastTask();
    deleteDownload(episode.id); // cancel() throws in this fake: must not matter
    task.onProgress({ bytesWritten: BigInt(MB), totalBytes: BigInt(4 * MB) });
    expect(item(episode)).toBeUndefined();
  });

  it('shows the error state instead of throwing when the file system fails', async () => {
    fs.__state.failDirs = true;
    await render(<DownloadButton episode={episode} />);
    await fireEvent.press(screen.getByTestId('download-button'));
    await fireEvent.press(screen.getByTestId('download-video'));

    expect(createTask).not.toHaveBeenCalled();
    expect(item(episode)).toMatchObject({ kind: 'video', status: 'error' });
    expect(item(episode)!.error).toMatch(/directory/);
    expect(screen.queryByTestId('download-progress')).toBeNull();

    // Retry works once the cause is gone.
    fs.__state.failDirs = false;
    await act(async () => startDownload(episode));
    expect(createTask).toHaveBeenCalledTimes(1);
    expect(item(episode)).toMatchObject({ kind: 'video', status: 'downloading' });
  });

  it('shows the error state when the native task cannot be created', () => {
    createTask.mockImplementationOnce(() => {
      throw new Error('native module unavailable');
    });
    expect(() => startDownload(episode, 'audio')).not.toThrow();
    expect(item(episode)).toMatchObject({ status: 'error', error: 'native module unavailable' });
  });

  it('does not reject when pausing fails, and resuming starts over', async () => {
    startDownload(episode, 'audio');
    await expect(pauseDownload(episode.id)).resolves.toBeUndefined();
    expect(item(episode)).toMatchObject({ status: 'paused' });

    expect(() => resumeDownload(episode)).not.toThrow();
    expect(createTask).toHaveBeenCalledTimes(2);
    expect(item(episode)).toMatchObject({ status: 'downloading' });
  });
});
