/**
 * Sharing: the QR code is the universal link, the text carries that and the
 * web page, and a share started at a moment of the episode points every link at it.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Share } from 'react-native';
import ShareScreen from '../app/share';
import EpisodeRoute from '../app/episode/[id]';
import { episodes } from '@/content';
import { usePlayback } from '@/player/store';
import { useSettings } from '@/state/settings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: jest.fn(),
}));
// The QR code is drawn natively: what matters here is what it encodes.
jest.mock('react-native-qrcode-svg', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    __esModule: true,
    default: (props: { value: string }) => <View testID="qr" {...props} />,
  };
});
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('@/components/YoutubeSurface', () => ({ YoutubeSurface: () => null }));
jest.mock('@/player/controller', () => ({
  loadEpisode: jest.fn(),
  hasEpisodePlayer: jest.fn(() => false),
}));

const episode = episodes.find((e) => e.webUrl)!;
const params = (value: Record<string, string>) =>
  (useLocalSearchParams as jest.Mock).mockReturnValue(value);
const qr = () => screen.getByTestId('qr').props.value as string;
const sharedText = async () => {
  const share = jest
    .spyOn(Share, 'share')
    .mockResolvedValue({ action: 'sharedAction', activityType: undefined });
  await fireEvent.press(screen.getByText('Share as text'));
  return (share.mock.calls[0]![0] as { message: string }).message.split('\n');
};

beforeEach(async () => {
  jest.clearAllMocks();
  usePlayback.setState({ episodeId: undefined, positionSec: 0, playing: false });
  await useSettings.persist.rehydrate();
  useSettings.setState({ locale: 'en' });
});

afterEach(() => jest.restoreAllMocks());

describe('share screen', () => {
  it('encodes the universal link in the QR code and shares both links', async () => {
    params({ id: episode.id });
    await render(<ShareScreen />);
    const app = `https://shiryakhat.app/episode/${episode.id}`;
    expect(qr()).toBe(app);
    expect(screen.getByText(/· shiryakhat\.app$/)).toBeTruthy();
    expect((await sharedText()).slice(-4)).toEqual([
      'Open in the app:',
      app,
      'Listen on the web:',
      episode.webUrl,
    ]);
  });

  it('points every link at the shared moment', async () => {
    params({ id: episode.id, t: '754.6', quote: 'A thought' });
    await render(<ShareScreen />);
    const app = `https://shiryakhat.app/episode/${episode.id}?t=754`;
    expect(qr()).toBe(app);
    const text = await sharedText();
    expect(text[0]).toBe('«A thought»');
    expect(text[1]).toMatch(/· 12:34$/);
    expect(text.slice(-4)).toEqual([
      'Open in the app:',
      app,
      'Listen on the web:',
      `${episode.webUrl}?t=754`,
    ]);
  });

  it('ignores a position that is not one', async () => {
    params({ id: episode.id, t: 'soon' });
    await render(<ShareScreen />);
    expect(qr()).toBe(`https://shiryakhat.app/episode/${episode.id}`);
  });
});

describe('share from the player', () => {
  it('shares at the current position of the episode that is playing', async () => {
    usePlayback.setState({ episodeId: episode.id, positionSec: 754.6 });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    await fireEvent.press(screen.getByTestId('share-button'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/share',
      params: { id: episode.id, t: '754' },
    });
  });

  it('shares the episode alone when it is not the one in the player', async () => {
    usePlayback.setState({ episodeId: 'another', positionSec: 754.6, playing: true });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    await fireEvent.press(screen.getByTestId('share-button'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/share', params: { id: episode.id } });
  });
});
