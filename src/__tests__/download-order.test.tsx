/**
 * The Library's downloads list must keep its order while files download.
 *
 * Up to v1.3.3 the list was sorted by `updatedAt`, which every progress tick
 * bumps — so with two downloads running, whichever reported progress last
 * jumped to the top and the rows kept swapping places. The order now comes from
 * `addedAt`, fixed when the episode enters the list (v1.3.4).
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { episodes, type Episode } from '@/content';
import { LibraryTab } from '@/screens/LibraryTab';
import {
  deleteDownload,
  pauseDownload,
  resumeDownload,
  sortDownloads,
  startDownload,
  useDownloads,
  type DownloadItem,
} from '@/state/downloads';
import { useSettings } from '@/state/settings';

type Progress = (p: { bytesWritten: unknown; totalBytes: unknown }) => void;
type FakeTask = { url: string; onProgress: Progress; finish: () => void };

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-file-system', () => {
  class FakeFile {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}${name}`;
    }
    get exists() {
      return false;
    }
    get size() {
      return 64 * 1024 * 1024;
    }
    delete() {}
    static createDownloadTask = jest.fn(
      (url: string, to: FakeFile, options: { onProgress: Progress }) => {
        let finish: () => void = () => undefined;
        const run = new Promise<FakeFile>((resolve) => {
          finish = () => resolve(to);
        });
        return {
          url,
          onProgress: options.onProgress,
          finish,
          downloadAsync: jest.fn(() => run),
          resumeAsync: jest.fn(() => new Promise(() => undefined)),
          pauseAsync: jest.fn(() => Promise.resolve()),
          savable: jest.fn(() => ({ url })),
          cancel: jest.fn(),
        };
      },
    );
  }
  class FakeDirectory {
    uri: string;
    constructor(parent: string | { uri: string }, name?: string) {
      this.uri = typeof parent === 'string' ? parent : `${parent.uri}${name}/`;
    }
    get exists() {
      return true;
    }
    get size() {
      return 0;
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
  };
});

const createTask = File.createDownloadTask as unknown as jest.Mock;
const MB = 1024 * 1024;
const [first, second, third] = episodes.filter((e) => e.audioUrl) as [Episode, Episode, Episode];

/** The task that downloads `ep` (the latest one, if it was started more than once). */
const taskOf = (ep: Episode) =>
  createTask.mock.results.map((r) => r.value as FakeTask).findLast((t) => t.url === ep.audioUrl)!;
const order = () => sortDownloads(useDownloads.getState().items).map((i) => i.episodeId);

// A clock we move by hand: every store write is stamped with it, and the
// progress handler throttles on it.
let now = 1_800_000_000_000;
const advance = (ms: number) => {
  now += ms;
};
const tick = (ep: Episode, megabytes: number) => {
  advance(1000);
  taskOf(ep).onProgress({ bytesWritten: BigInt(megabytes * MB), totalBytes: BigInt(64 * MB) });
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  for (const id of Object.keys(useDownloads.getState().items)) deleteDownload(id);
  useSettings.setState({ locale: 'en' });
  createTask.mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('downloads list order', () => {
  it('does not change while two downloads report progress', () => {
    startDownload(first, 'audio');
    advance(1000);
    startDownload(second, 'audio');
    const initial = order();
    expect(initial).toEqual([second.id, first.id]); // most recently added first

    // Progress arrives interleaved, each tick making its item the "last updated".
    for (let mb = 4; mb <= 60; mb += 4) {
      tick(first, mb);
      expect(order()).toEqual(initial);
      tick(second, mb / 2);
      expect(order()).toEqual(initial);
    }

    const { items } = useDownloads.getState();
    expect(items[first.id]).toMatchObject({ status: 'downloading', bytesWritten: 60 * MB });
    expect(items[second.id]).toMatchObject({ status: 'downloading', bytesWritten: 30 * MB });
    // The ticks really did move `updatedAt` — the old sort key — past the other item's.
    expect(items[second.id]!.updatedAt).toBeGreaterThan(items[first.id]!.updatedAt);
    tick(first, 62);
    expect(useDownloads.getState().items[first.id]!.updatedAt).toBeGreaterThan(
      useDownloads.getState().items[second.id]!.updatedAt,
    );
    expect(order()).toEqual(initial);
  });

  it('keeps `addedAt` through progress, pause, resume and completion', async () => {
    startDownload(first, 'audio');
    advance(1000);
    startDownload(second, 'audio');
    const initial = order();
    const added = useDownloads.getState().items[first.id]!.addedAt;
    expect(added).toBe(now - 1000);

    tick(first, 8);
    await pauseDownload(first.id);
    expect(order()).toEqual(initial);
    advance(1000);
    resumeDownload(first);
    tick(first, 16);
    expect(order()).toEqual(initial);

    // The older download finishing does not move it above the newer one.
    startDownload(third, 'audio');
    advance(1000);
    taskOf(third).finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(useDownloads.getState().items[third.id]).toMatchObject({ status: 'done' });
    tick(second, 8);
    expect(order()).toEqual([third.id, second.id, first.id]);
    expect(useDownloads.getState().items[first.id]!.addedAt).toBe(added);
  });

  it('orders items from before v1.3.4 (no `addedAt`) by their last change, stably', () => {
    const legacy = (episodeId: string, updatedAt: number): DownloadItem => ({
      episodeId,
      status: 'done',
      bytesWritten: MB,
      totalBytes: MB,
      updatedAt,
    });
    useDownloads.setState({
      items: { [first.id]: legacy(first.id, 100), [second.id]: legacy(second.id, 200) },
    });
    expect(order()).toEqual([second.id, first.id]);

    // Touching the older one stamps its `addedAt` from the old value: no jump.
    useDownloads.getState().patch(first.id, { also: undefined });
    expect(useDownloads.getState().items[first.id]!.addedAt).toBe(100);
    expect(order()).toEqual([second.id, first.id]);
  });

  it('breaks ties by id, so items added in the same millisecond do not flip', () => {
    startDownload(second, 'audio');
    startDownload(first, 'audio');
    const initial = order();
    expect(initial).toEqual([first.id, second.id].sort((a, b) => a.localeCompare(b)));
    tick(first, 4);
    tick(second, 4);
    expect(order()).toEqual(initial);
  });
});

describe('Library → Downloads', () => {
  // Each row's meta line starts with the episode code (wrapped in bidi isolates).
  const codes = new RegExp(`(${first.code}|${second.code}).*Downloading`);
  const rows = () =>
    screen.getAllByText(codes).map((node) => codes.exec(String(node.props.children))![1]);

  it('renders the rows in the same order after progress ticks', async () => {
    startDownload(first, 'audio');
    advance(1000);
    startDownload(second, 'audio');
    await render(<LibraryTab />);
    await fireEvent.press(screen.getByText('Downloads'));
    const initial = rows();
    expect(initial).toEqual([second.code, first.code]);

    for (let mb = 4; mb <= 20; mb += 4) {
      await act(async () => tick(first, mb));
      expect(rows()).toEqual(initial);
      await act(async () => tick(second, mb));
      expect(rows()).toEqual(initial);
    }
    // The rows did re-render with the new byte counts.
    expect(screen.getAllByText(/20 MB/).length).toBe(2);
  });
});
