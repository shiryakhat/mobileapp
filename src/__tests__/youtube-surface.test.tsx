/**
 * The YouTube library only messages the iframe when its `play` prop changes.
 * When the iframe did not follow a command, the controller asks the surface to
 * send it again: the prop is flipped for one commit and then follows the store.
 */
import { act, render } from '@testing-library/react-native';
import { YoutubeSurface } from '@/components/YoutubeSurface';
import { attachYoutube } from '@/player/controller';
import { usePlayback } from '@/player/store';

const mockPlayProps: boolean[] = [];
jest.mock('react-native-youtube-iframe', () => ({
  __esModule: true,
  default: (props: { play: boolean }) => {
    mockPlayProps.push(props.play);
    return null;
  },
}));
jest.mock('@/player/controller', () => ({
  attachYoutube: jest.fn(),
  detachYoutube: jest.fn(),
  reportYoutube: jest.fn(),
}));

type Handle = Parameters<typeof attachYoutube>[0];

it('sends a command again by flipping the play prop for one commit', async () => {
  jest.useFakeTimers();
  usePlayback.setState({ playing: false });
  const view = await render(<YoutubeSurface videoId="abc" width={320} />);
  const handle = (attachYoutube as jest.Mock).mock.calls[0]![0] as Handle;
  expect(mockPlayProps.at(-1)).toBe(false);

  mockPlayProps.length = 0;
  await act(async () => handle.resend(false));
  expect(mockPlayProps.at(-1)).toBe(true); // → playVideo
  await act(async () => jest.runOnlyPendingTimers());
  expect(mockPlayProps.at(-1)).toBe(false); // back to the store's value → pauseVideo

  await view.unmount();
  jest.useRealTimers();
});
