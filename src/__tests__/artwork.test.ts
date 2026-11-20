import { Asset } from 'expo-asset';
import { getEpisode } from '@/content';
import { loadEpisode, stop } from '@/player/controller';

const mockPlayer = {
  addListener: jest.fn(),
  replace: jest.fn(),
  setPlaybackRate: jest.fn(),
  play: jest.fn(),
  pause: jest.fn(),
  setActiveForLockScreen: jest.fn(),
  updateLockScreenMetadata: jest.fn(),
  clearLockScreenControls: jest.fn(),
};
jest.mock('expo-audio', () => ({
  createAudioPlayer: jest.fn(() => mockPlayer),
  setAudioModeAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/lib/cache', () => ({ cachedImageUri: jest.fn(() => undefined) }));
jest.mock('@/state/downloads', () => ({
  localAudioUri: jest.fn(() => undefined),
  localVideoUri: jest.fn(() => undefined),
  useDownloads: { subscribe: jest.fn() },
}));
jest.mock('expo-asset', () => {
  class FakeAsset {
    name: string;
    type: string;
    hash: string | null;
    uri: string;
    localUri: string | null = null;
    downloaded = false;
    constructor(d: { name: string; type: string; hash?: string | null; uri: string }) {
      this.name = d.name;
      this.type = d.type;
      this.hash = d.hash ?? null;
      this.uri = d.uri;
    }
    downloadAsync = jest.fn(async () => {
      this.localUri = `file:///cache/ExponentAsset-${this.hash}.${this.type}`;
      this.downloaded = true;
      return this;
    });
    static fromModule = jest.fn();
  }
  return { Asset: FakeAsset };
});

const fromModule = Asset.fromModule as unknown as jest.Mock;
const artworkOf = (call: unknown[] | undefined, at: number) =>
  (call?.[at] as { artworkUrl?: string } | undefined)?.artworkUrl;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Play an episode that has a public audio URL and (optionally) bundled artwork. */
function playEpisode(id: string) {
  const episode = getEpisode(id)!;
  expect(episode.audioUrl).toBeTruthy();
  loadEpisode(episode, { autoplay: true });
  return episode;
}

beforeEach(() => {
  stop();
  jest.clearAllMocks();
});

describe('lock-screen artwork', () => {
  it('switches to the bundled thumbnail once it is on disk, then uses it straight away', async () => {
    // A development build: the asset is served by Metro until it is downloaded.
    fromModule.mockImplementation(
      () => new Asset({ name: 'S07E07', type: 'jpg', hash: 'h1', uri: 'http://metro/S07E07.jpg' }),
    );
    const episode = playEpisode('s07e07');
    expect(artworkOf(mockPlayer.setActiveForLockScreen.mock.calls[0], 1)).toBe(
      episode.youtubeThumb,
    );
    await flush();
    expect(artworkOf(mockPlayer.updateLockScreenMetadata.mock.calls[0], 0)).toBe(
      'file:///cache/ExponentAsset-h1.jpg',
    );

    stop();
    jest.clearAllMocks();
    playEpisode('s07e07');
    expect(artworkOf(mockPlayer.setActiveForLockScreen.mock.calls[0], 1)).toBe(
      'file:///cache/ExponentAsset-h1.jpg',
    );
    await flush();
    expect(mockPlayer.updateLockScreenMetadata).not.toHaveBeenCalled();
  });

  it('copies an Android resource to a file instead of handing over its resource name', async () => {
    // An Android release build: the "local URI" of a bundled image is a drawable name.
    fromModule.mockImplementation(() =>
      Object.assign(
        new Asset({ name: 'S07E06', type: 'jpg', hash: 'h2', uri: 'assets_episodethumbs_s07e06' }),
        { localUri: 'assets_episodethumbs_s07e06', downloaded: true },
      ),
    );
    playEpisode('s07e06');
    await flush();
    expect(artworkOf(mockPlayer.updateLockScreenMetadata.mock.calls[0], 0)).toBe(
      'file:///cache/ExponentAsset-h2.jpg',
    );
  });

  it('keeps the YouTube thumbnail when the bundled one cannot be read', async () => {
    fromModule.mockImplementation(() => {
      throw new Error('missing from the asset registry');
    });
    const episode = playEpisode('s07e05');
    await flush();
    expect(artworkOf(mockPlayer.setActiveForLockScreen.mock.calls[0], 1)).toBe(
      episode.youtubeThumb,
    );
    expect(mockPlayer.updateLockScreenMetadata).not.toHaveBeenCalled();
  });

  it('does not touch the lock screen of an episode that is no longer playing', async () => {
    fromModule.mockImplementation(
      () => new Asset({ name: 'S07E04', type: 'jpg', hash: 'h4', uri: 'http://metro/S07E04.jpg' }),
    );
    playEpisode('s07e04');
    stop();
    await flush();
    expect(mockPlayer.updateLockScreenMetadata).not.toHaveBeenCalled();
  });
});
