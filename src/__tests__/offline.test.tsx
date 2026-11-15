/**
 * Offline cache: what was fetched once is served from disk afterwards, the
 * cache can be measured and cleared, and clearing it never touches the
 * episodes the user downloaded on purpose.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { Alert } from 'react-native';
import { StorageSettings } from '@/components/StorageSettings';
import { translate } from '@/i18n';
import {
  cacheBytes,
  cachedImageUri,
  cacheImage,
  clearCache,
  readCachedJson,
  warmImageCache,
  withCachedFallback,
  writeCachedJson,
} from '@/lib/cache';
import { formatBytes } from '@/lib/format';
import { downloadsBytes, localAudioUri, useDownloads } from '@/state/downloads';
import { useSettings } from '@/state/settings';

/** In-memory stand-in for the expo-file-system object API (the subset the app uses). */
jest.mock('expo-file-system', () => {
  // Kept on globalThis so a re-required module ("next launch") sees the same disk.
  const disk = globalThis as unknown as { __files?: Map<string, string>; __dirs?: Set<string> };
  const files = (disk.__files ??= new Map<string, string>());
  const dirs = (disk.__dirs ??= new Set<string>());
  const join = (parts: (string | { uri: string })[]) =>
    parts
      .map((p) => (typeof p === 'string' ? p : p.uri))
      .reduce((a, b) => `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`);

  class FakeFile {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get name() {
      return this.uri.split('/').pop()!;
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    create() {
      files.set(this.uri, '');
    }
    delete() {
      files.delete(this.uri);
    }
    textSync() {
      const text = files.get(this.uri);
      if (text === undefined) throw new Error('ENOENT');
      return text;
    }
    writeSync(content: string) {
      files.set(this.uri, content);
    }
    moveSync(to: FakeFile) {
      files.set(to.uri, this.textSync());
      files.delete(this.uri);
      this.uri = to.uri;
    }
    static downloadFileAsync = jest.fn(async (url: string, to: FakeFile) => {
      if (url.includes('unreachable')) throw new Error('offline');
      files.set(to.uri, `bytes of ${url}`);
      return to;
    });
    static createDownloadTask = jest.fn();
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
      // Like `intermediates: true`: every ancestor exists afterwards.
      const parts = this.uri.slice('file:///'.length).split('/').filter(Boolean);
      parts.forEach((_, i) => dirs.add(`file:///${parts.slice(0, i + 1).join('/')}/`));
    }
    delete() {
      for (const uri of [...files.keys()]) if (uri.startsWith(this.uri)) files.delete(uri);
      for (const uri of [...dirs]) if (uri.startsWith(this.uri)) dirs.delete(uri);
    }
    list() {
      return [...files.keys()]
        .filter((uri) => uri.startsWith(this.uri) && !uri.slice(this.uri.length).includes('/'))
        .map((uri) => new FakeFile(uri));
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
    DownloadTask: class {},
    Paths: {
      cache: new FakeDirectory('file:///cache'),
      document: new FakeDirectory('file:///documents'),
      availableDiskSpace: 1e9,
    },
  };
});
jest.mock('expo-image', () => ({
  Image: {
    clearDiskCache: jest.fn(() => Promise.resolve(true)),
    clearMemoryCache: jest.fn(() => Promise.resolve(true)),
  },
}));

const disk = globalThis as unknown as { __files: Map<string, string>; __dirs: Set<string> };
const download = File.downloadFileAsync as unknown as jest.Mock;
const THUMB = 'https://i.ytimg.com/vi/abc/hqdefault.jpg';
const OTHER = 'https://i.ytimg.com/vi/xyz/hqdefault.jpg';
const DOWNLOADED = 'file:///documents/audio/s01e01.mp3';

/** An episode the user downloaded for offline listening. */
function seedDownload(fileUri = DOWNLOADED) {
  disk.__dirs.add('file:///documents/audio/');
  disk.__files.set(DOWNLOADED, 'x'.repeat(5 * 1024 * 1024));
  useDownloads.setState({
    items: {
      s01e01: {
        episodeId: 's01e01',
        status: 'done',
        bytesWritten: 5 * 1024 * 1024,
        totalBytes: 5 * 1024 * 1024,
        fileUri,
        updatedAt: 1,
      },
    },
  });
}

beforeEach(async () => {
  await clearCache();
  disk.__files.clear();
  disk.__dirs.clear();
  useDownloads.setState({ items: {} });
  useSettings.setState({ locale: 'en' });
  jest.clearAllMocks();
});

describe('image cache', () => {
  it('downloads an image once and serves the local file from then on', async () => {
    expect(cachedImageUri(THUMB)).toBeUndefined();
    const [a, b] = await Promise.all([cacheImage(THUMB), cacheImage(THUMB)]);
    expect(a).toMatch(/^file:\/\/\/cache\/syk-cache\/images\/[0-9a-f]+\.jpg$/);
    expect(b).toBe(a);
    expect(cachedImageUri(THUMB)).toBe(a);
    expect(await cacheImage(THUMB)).toBe(a);
    expect(download).toHaveBeenCalledTimes(1);
    expect(disk.__files.get(a!)).toBe(`bytes of ${THUMB}`);
  });

  it('keeps different URLs apart', async () => {
    expect(await cacheImage(THUMB)).not.toBe(await cacheImage(OTHER));
  });

  it('finds the cached image again on the next launch, without the network', async () => {
    const uri = await cacheImage(THUMB);
    download.mockClear();
    jest.isolateModules(() => {
      const nextLaunch = require('@/lib/cache') as typeof import('@/lib/cache');
      expect(nextLaunch.cachedImageUri(THUMB)).toBe(uri);
    });
    expect(download).not.toHaveBeenCalled();
  });

  it('reports a failed download as a miss and leaves nothing half-written in the index', async () => {
    const url = 'https://unreachable.example/a.jpg';
    expect(await cacheImage(url)).toBeUndefined();
    expect(cachedImageUri(url)).toBeUndefined();
  });

  it('warms only what is missing and stops at the first failure', async () => {
    await cacheImage(THUMB);
    download.mockClear();
    await warmImageCache([THUMB, OTHER, 'https://unreachable.example/b.jpg', 'https://x/c.jpg']);
    expect(download.mock.calls.map((c) => c[0])).toEqual([
      OTHER,
      'https://unreachable.example/b.jpg',
    ]);
  });
});

describe('data cache', () => {
  it('round-trips JSON under a key', () => {
    expect(readCachedJson('comments-s01e01')).toBeUndefined();
    writeCachedJson('comments-s01e01', [{ id: '1' }]);
    expect(readCachedJson('comments-s01e01')).toEqual([{ id: '1' }]);
  });

  it('serves the last good response when the network call fails', async () => {
    expect(await withCachedFallback('questions', async () => ['fresh'])).toEqual(['fresh']);
    const offline = () => Promise.reject(new Error('offline'));
    expect(await withCachedFallback('questions', offline)).toEqual(['fresh']);
    await expect(withCachedFallback('never-loaded', offline)).rejects.toThrow('offline');
  });
});

describe('clearing', () => {
  it('measures the cache and empties it without touching downloads', async () => {
    seedDownload();
    await cacheImage(THUMB);
    writeCachedJson('questions', ['q']);
    expect(cacheBytes()).toBe(`bytes of ${THUMB}`.length + '["q"]'.length);

    await clearCache();
    expect(cacheBytes()).toBe(0);
    expect(cachedImageUri(THUMB)).toBeUndefined();
    expect(readCachedJson('questions')).toBeUndefined();
    expect(Image.clearDiskCache).toHaveBeenCalled();
    // The explicitly downloaded episode is still there.
    expect(disk.__files.has(DOWNLOADED)).toBe(true);
    expect(localAudioUri('s01e01')).toBe(DOWNLOADED);
    expect(downloadsBytes()).toBe(5 * 1024 * 1024);
  });
});

describe('downloaded audio', () => {
  it('resolves to where the file is now, not to a path persisted before an app update', () => {
    seedDownload('file:///old-container/documents/audio/s01e01.mp3');
    expect(localAudioUri('s01e01')).toBe(DOWNLOADED);
  });

  it('falls back to streaming when the file is gone', () => {
    seedDownload();
    disk.__files.delete(DOWNLOADED);
    expect(localAudioUri('s01e01')).toBeUndefined();
  });
});

describe('formatBytes', () => {
  it('uses KB below one megabyte', () => {
    expect(formatBytes(40 * 1024, 'en')).toBe('40 KB');
    expect(formatBytes(300, 'en')).toBe('1 KB');
    expect(formatBytes(1.5 * 1024 * 1024, 'en')).toBe('1.5 MB');
    expect(formatBytes(142 * 1024 * 1024, 'en')).toBe('142 MB');
    expect(formatBytes(142 * 1024 * 1024, 'fa')).toBe('۱۴۲ MB');
  });
});

describe('<StorageSettings/>', () => {
  type AlertButton = { text?: string; style?: string; onPress?: () => void };
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const lastButtons = () => alert.mock.calls[alert.mock.calls.length - 1]![2] as AlertButton[];

  it('shows cache + downloads, and "Clear cache" only clears the cache after a confirm', async () => {
    seedDownload();
    await cacheImage(THUMB);
    await render(<StorageSettings />);
    expect(screen.getByTestId('storage-total').props.children).toBe('5.0 MB');
    expect(screen.getByTestId('storage-breakdown').props.children).toContain('Cache 1 KB');
    expect(screen.getByTestId('storage-breakdown').props.children).toContain('Downloads 5.0 MB');

    await fireEvent.press(screen.getByTestId('clear-cache'));
    expect(alert).toHaveBeenCalledWith(
      translate('en', 'clearCache'),
      translate('en', 'clearCacheConfirm'),
      expect.any(Array),
    );
    // Nothing happens until the user confirms.
    expect(cachedImageUri(THUMB)).toBeDefined();

    const confirm = lastButtons().find((b) => b.style === 'destructive')!;
    await act(async () => confirm.onPress!());
    expect(await screen.findByText(translate('en', 'cacheCleared'))).toBeTruthy();
    expect(cachedImageUri(THUMB)).toBeUndefined();
    expect(disk.__files.has(DOWNLOADED)).toBe(true);
    expect(useDownloads.getState().items.s01e01?.status).toBe('done');
  });

  it('keeps deleting downloads a separate, explicitly labelled action', async () => {
    seedDownload();
    await render(<StorageSettings />);
    await fireEvent.press(screen.getByTestId('delete-downloads'));
    expect(alert).toHaveBeenCalledWith(
      translate('en', 'deleteAll'),
      translate('en', 'deleteAllConfirm'),
      expect.any(Array),
    );
    const confirm = lastButtons().find((b) => b.style === 'destructive')!;
    await act(async () => confirm.onPress!());
    expect(disk.__files.has(DOWNLOADED)).toBe(false);
    expect(useDownloads.getState().items).toEqual({});
  });

  it('uses the agreed Farsi wording for "Clear cache"', () => {
    expect(translate('fa', 'clearCache')).toBe('پاک کردن حافظه موقت');
  });

  it('offers no "delete downloads" when there are none', async () => {
    await render(<StorageSettings />);
    expect(screen.queryByTestId('delete-downloads')).toBeNull();
  });
});
