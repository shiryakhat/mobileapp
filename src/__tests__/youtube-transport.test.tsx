/**
 * Video mode streams through the YouTube iframe (no downloaded mp4). The app's
 * transport — the big play / pause button — must drive that iframe exactly as
 * it drives the native audio engine.
 *
 * Two links in that chain are covered here:
 *
 *  1. transport → <YoutubeSurface/>: a tap on play / pause changes the `play`
 *     prop of the iframe component. The library is mocked the way it really
 *     behaves: it messages the player only once it is ready, and then only
 *     when `play` CHANGES.
 *  2. library → player page: the library sends `{"eventName":"playVideo"}` as
 *     a WebView postMessage, which the hosted player page does not understand
 *     (v1.3.5: the reason play / pause did nothing in video mode). The bridge
 *     script the surface injects is run against a stand-in page, with the
 *     message dispatched the way each platform's WebView does it.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import EpisodeRoute from '../app/episode/[id]';
import { episodes } from '@/content';
import { loadEpisode, setMode, stop } from '@/player/controller';
import { usePlayback } from '@/player/store';
import { YOUTUBE_BRIDGE_SCRIPT } from '@/player/youtubeBridge';
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

/** The mocked iframe: what it was told, and a way to make it speak. */
const mockIframe = {
  mounted: 0,
  /** Commands that reached the player, in order. */
  commands: [] as ('playVideo' | 'pauseVideo')[],
  ready: undefined as (() => void) | undefined,
  changeState: undefined as ((state: string) => void) | undefined,
  /** What the surface hands to the underlying WebView. */
  webViewProps: undefined as Record<string, unknown> | undefined,
};
jest.mock('react-native-youtube-iframe', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  function YoutubePlayer(
    props: {
      play: boolean;
      onReady: () => void;
      onChangeState: (state: string) => void;
      webViewProps?: Record<string, unknown>;
    },
    ref: React.Ref<unknown>,
  ) {
    const [ready, setReady] = React.useState(false);
    React.useImperativeHandle(ref, () => ({
      seekTo: jest.fn(),
      getCurrentTime: () => Promise.resolve(0),
      getDuration: () => Promise.resolve(0),
    }));
    React.useEffect(() => {
      mockIframe.mounted++;
      return () => {
        mockIframe.mounted--;
      };
    }, []);
    mockIframe.ready = () => {
      props.onReady();
      setReady(true);
    };
    mockIframe.changeState = props.onChangeState;
    mockIframe.webViewProps = props.webViewProps;
    // As in the library: nothing before the player is ready, then one message
    // per change of `play`.
    React.useEffect(() => {
      if (ready) mockIframe.commands.push(props.play ? 'playVideo' : 'pauseVideo');
    }, [props.play, ready]);
    return null;
  }
  return { __esModule: true, default: React.forwardRef(YoutubePlayer) };
});

const episode = episodes.find((e) => e.season === 7 && e.audioUrl)!;
const params = (value: Record<string, string>) =>
  (useLocalSearchParams as jest.Mock).mockReturnValue(value);
const playing = () => usePlayback.getState().playing;
const toggle = () => act(async () => fireEvent.press(screen.getByTestId('play-toggle')));
const iframeReady = () => act(async () => mockIframe.ready!());
const iframeState = (state: string) => act(async () => mockIframe.changeState!(state));

beforeEach(async () => {
  jest.useFakeTimers();
  await act(async () => stop());
  mockIframe.commands.length = 0;
  jest.clearAllMocks();
  await useSettings.persist.rehydrate();
  useSettings.setState({ locale: 'en' });
  params({ id: episode.id });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('video mode on the YouTube iframe', () => {
  it('switching a playing episode to Video starts the iframe, and the button pauses / resumes it', async () => {
    loadEpisode(episode, { autoplay: true });
    usePlayback.setState({ playing: true, positionSec: 120 });
    await render(<EpisodeRoute />);
    expect(usePlayback.getState()).toMatchObject({ engine: 'native', mode: 'audio' });

    await act(async () => setMode('video'));
    expect(usePlayback.getState()).toMatchObject({ engine: 'youtube', mode: 'video' });
    expect(mockIframe.mounted).toBe(1);

    await iframeReady();
    expect(mockIframe.commands).toEqual(['playVideo']);
    await iframeState('buffering');
    await iframeState('playing');
    await act(async () => jest.advanceTimersByTime(1100));
    expect(playing()).toBe(true);

    await toggle();
    expect(playing()).toBe(false);
    expect(mockIframe.commands).toEqual(['playVideo', 'pauseVideo']);
    await iframeState('paused');
    await act(async () => jest.advanceTimersByTime(1100));

    await toggle();
    expect(playing()).toBe(true);
    expect(mockIframe.commands).toEqual(['playVideo', 'pauseVideo', 'playVideo']);
  });

  it('starts a paused episode in Video mode from the play button', async () => {
    await render(<EpisodeRoute />);
    await act(async () => setMode('video'));
    await iframeReady();
    expect(mockIframe.commands).toEqual(['pauseVideo']);

    await toggle();
    expect(playing()).toBe(true);
    expect(mockIframe.commands).toEqual(['pauseVideo', 'playVideo']);
  });

  it('hands the lock-screen controls back while the iframe plays, and takes them again for audio', async () => {
    loadEpisode(episode, { autoplay: true });
    usePlayback.setState({ playing: true });
    await render(<EpisodeRoute />);
    expect(mockPlayer.setActiveForLockScreen).toHaveBeenCalledTimes(1);
    expect(mockPlayer.clearLockScreenControls).not.toHaveBeenCalled();

    // They command the native player directly: left on, "play" on the lock
    // screen would start the audio underneath the video.
    await act(async () => setMode('video'));
    expect(mockPlayer.pause).toHaveBeenCalled();
    expect(mockPlayer.clearLockScreenControls).toHaveBeenCalledTimes(1);

    await act(async () => setMode('audio'));
    expect(usePlayback.getState().engine).toBe('native');
    expect(mockPlayer.setActiveForLockScreen).toHaveBeenCalledTimes(2);
  });
});

describe('the bridge injected into the player page', () => {
  type Listener = (event: { data: unknown }) => void;

  /** A stand-in for the hosted player page: the global `player`, and the two event targets. */
  function page() {
    const listeners = { window: [] as Listener[], document: [] as Listener[] };
    const player = { playVideo: jest.fn(), pauseVideo: jest.fn(), setPlaybackRate: jest.fn() };
    const target = (list: Listener[]) => ({
      addEventListener: (type: string, fn: Listener) => {
        if (type === 'message') list.push(fn);
      },
    });
    const window: Record<string, unknown> = { ...target(listeners.window), player };
    const document = target(listeners.document);
    return {
      player,
      window,
      listeners,
      /** What the WebView does with `injectedJavaScript`. */
      inject: (script: unknown) =>
        new Function('window', 'document', String(script))(window, document) as unknown,
    };
  }
  /** Exactly what react-native-youtube-iframe posts for a command. */
  const message = (eventName: string, meta: object = {}) => ({
    data: JSON.stringify({ eventName, meta }),
  });

  it('is what the surface injects, before the page loads and after', async () => {
    await render(<EpisodeRoute />);
    await act(async () => setMode('video'));
    expect(mockIframe.webViewProps).toMatchObject({
      injectedJavaScriptBeforeContentLoaded: YOUTUBE_BRIDGE_SCRIPT,
      injectedJavaScript: YOUTUBE_BRIDGE_SCRIPT,
      // Without these the iframe cannot be started from the transport at all.
      allowsInlineMediaPlayback: true,
      mediaPlaybackRequiresUserAction: false,
    });
  });

  it('plays and pauses on iOS, where the message is dispatched on window', () => {
    const { player, listeners, inject } = page();
    inject(YOUTUBE_BRIDGE_SCRIPT);
    for (const listener of listeners.window) listener(message('playVideo'));
    expect(player.playVideo).toHaveBeenCalledTimes(1);
    for (const listener of listeners.window) listener(message('pauseVideo'));
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
  });

  it('plays and pauses on Android, where the message is dispatched on document', () => {
    const { player, listeners, inject } = page();
    inject(YOUTUBE_BRIDGE_SCRIPT);
    for (const listener of listeners.document) listener(message('pauseVideo'));
    expect(player.pauseVideo).toHaveBeenCalledTimes(1);
    for (const listener of listeners.document) listener(message('playVideo'));
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  it('acts once on a message that reaches both targets, and installs itself once', () => {
    const { player, listeners, inject } = page();
    // Injected twice: at document start and once the page has loaded.
    inject(YOUTUBE_BRIDGE_SCRIPT);
    inject(YOUTUBE_BRIDGE_SCRIPT);
    expect(listeners.window).toHaveLength(1);
    expect(listeners.document).toHaveLength(1);

    const bubbling = message('playVideo');
    listeners.document[0]!(bubbling);
    listeners.window[0]!(bubbling);
    expect(player.playVideo).toHaveBeenCalledTimes(1);
  });

  it('applies the playback speed, and ignores what it does not know', () => {
    const { player, window, listeners, inject } = page();
    inject(YOUTUBE_BRIDGE_SCRIPT);
    const send = listeners.window[0]!;
    send(message('setPlaybackRate', { playbackRate: 1.5 }));
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);

    // The page's own (bare string) protocol, other senders, a page without a player yet.
    send({ data: 'playVideo' });
    send({ data: { event: 'command' } });
    send(message('muteVideo'));
    window.player = undefined;
    send(message('playVideo'));
    expect(player.playVideo).not.toHaveBeenCalled();
    expect(player.pauseVideo).not.toHaveBeenCalled();
  });
});
