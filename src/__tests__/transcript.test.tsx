/**
 * The transcript follows playback. A far seek (scrubber, chapter, deep link with
 * ?t=) must land on the matching cue in ONE direct jump — never an animated
 * roll or a window-by-window catch-up through the cues in between.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode, Ref } from 'react';
import { TranscriptView } from '@/components/TranscriptView';
import { episodes, type Cue, type Transcript } from '@/content';
import { usePlayback } from '@/player/store';

interface ScrollCall {
  index: number;
  animated?: boolean;
  viewPosition?: number;
}
const mockScrollToIndex = jest.fn<Promise<void>, [ScrollCall]>(() => Promise.resolve());
const mockListProps = jest.fn<
  void,
  [{ initialScrollIndex?: number; initialScrollIndexParams?: { viewOffset?: number } }]
>();

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

interface MockListProps {
  ref?: Ref<unknown>;
  data: unknown[];
  renderItem: (info: { item: unknown; index: number }) => ReactNode;
  keyExtractor: (item: unknown, index: number) => string;
  onLoad?: () => void;
  onScrollBeginDrag?: () => void;
  testID?: string;
  initialScrollIndex?: number;
}

/** FlashList stand-in: renders every row, reports "loaded", records imperative scrolls. */
jest.mock('@shopify/flash-list', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const { ScrollView, View } = jest.requireActual<typeof import('react-native')>('react-native');
  function FlashList(props: MockListProps) {
    mockListProps(props);
    React.useImperativeHandle(props.ref, () => ({ scrollToIndex: mockScrollToIndex }));
    const { onLoad } = props;
    React.useEffect(() => onLoad?.(), [onLoad]);
    return (
      <ScrollView testID={props.testID} onScrollBeginDrag={props.onScrollBeginDrag}>
        {props.data.map((item, index) => (
          <View key={props.keyExtractor(item, index)}>{props.renderItem({ item, index })}</View>
        ))}
      </ScrollView>
    );
  }
  return { FlashList };
});

const episode = episodes[0]!;
// 600 cues, 10 s apart — cue N starts at N * 10 s.
const cues: Cue[] = Array.from({ length: 600 }, (_, i) => [
  i * 10_000,
  i * 10_000 + 9_000,
  `line ${i}`,
  `خط ${i}`,
]);
const transcript = { cues } as Transcript;

const playAt = (positionSec: number) =>
  act(() => usePlayback.setState({ episodeId: episode.id, positionSec }));

/** Mount the transcript and report its viewport size, as the first native layout pass does. */
async function mount(props: { onSeek?: (sec: number) => void; initialCueIndex?: number } = {}) {
  await render(
    <TranscriptView
      episode={episode}
      transcript={transcript}
      onSeek={props.onSeek ?? jest.fn()}
      initialCueIndex={props.initialCueIndex}
    />,
  );
  await act(() => {
    fireEvent(screen.getByTestId('transcript-viewport'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 1000 } },
    });
  });
}

const lastScroll = () => mockScrollToIndex.mock.calls.at(-1)![0];

beforeEach(() => {
  mockScrollToIndex.mockClear();
  mockListProps.mockClear();
  usePlayback.setState({ episodeId: episode.id, positionSec: 0 });
});

describe('transcript follows playback', () => {
  it('jumps directly to a far seek target, in one non-animated scroll', async () => {
    await mount();
    mockScrollToIndex.mockClear();

    await playAt(4800); // 1h20m → cue 480

    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    expect(lastScroll()).toMatchObject({ index: 480, animated: false });
    // The active line sits comfortably below the top edge.
    expect(lastScroll().viewPosition).toBeGreaterThanOrEqual(0.25);
    expect(lastScroll().viewPosition).toBeLessThanOrEqual(0.4);
  });

  it('jumps directly on a far backward seek too', async () => {
    await playAt(4800);
    await mount();
    mockScrollToIndex.mockClear();

    await playAt(100);

    expect(mockScrollToIndex).toHaveBeenCalledTimes(1);
    expect(lastScroll()).toMatchObject({ index: 10, animated: false });
  });

  it('opens already at the playing cue when mounted mid-episode (deep link ?t=)', async () => {
    await playAt(4800);
    await mount();

    // The list is created already positioned on the cue, ~0.3 of the viewport down:
    // no scroll from the top at all.
    const first = mockListProps.mock.calls[0]![0];
    expect(first.initialScrollIndex).toBe(480);
    expect(first.initialScrollIndexParams?.viewOffset).toBeCloseTo(-300);
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('animates only short hops as playback advances line by line', async () => {
    await mount();
    mockScrollToIndex.mockClear();

    await playAt(10);

    expect(lastScroll()).toMatchObject({ index: 1, animated: true });
  });

  it('reveals the requested cue (search hit) without following playback', async () => {
    await mount({ initialCueIndex: 300 });
    expect(mockListProps.mock.calls[0]![0].initialScrollIndex).toBe(300);

    await playAt(4800);
    expect(mockScrollToIndex).not.toHaveBeenCalled();
  });

  it('stops following once the user drags, until they tap a line', async () => {
    const onSeek = jest.fn();
    await mount({ onSeek });
    await act(() => {
      fireEvent(screen.getByTestId('transcript-list'), 'scrollBeginDrag');
    });
    mockScrollToIndex.mockClear();

    await playAt(4800);
    expect(mockScrollToIndex).not.toHaveBeenCalled();

    await act(() => {
      fireEvent.press(screen.getByTestId('cue-200'));
    });
    expect(onSeek).toHaveBeenCalledWith(2000);
    // Following again: straight to where playback is, not a roll from the old spot.
    expect(lastScroll()).toMatchObject({ index: 480, animated: false });
  });

  it('highlights only the active cue', async () => {
    await playAt(4800);
    await mount();
    const bg = (id: string) =>
      (screen.getByTestId(id).props.style as { backgroundColor: string }).backgroundColor;
    expect(bg('cue-480')).not.toBe('transparent');
    expect(bg('cue-479')).toBe('transparent');
  });
});
