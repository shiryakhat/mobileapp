/**
 * Timestamped bookmarks ("marks"): a moment of an episode, with an optional note.
 * The player keeps ONE bookmark button; it opens a sheet that marks the current
 * position, bookmarks the whole episode, and lists the episode's marks.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import EpisodeRoute from '../app/episode/[id]';
import { TranscriptView } from '@/components/TranscriptView';
import { episodes, type Cue, type Transcript } from '@/content';
import { loadEpisode } from '@/player/controller';
import { usePlayback } from '@/player/store';
import { LibraryTab } from '@/screens/LibraryTab';
import { episodeMarks, liveBookmarks, useBookmarks } from '@/state/bookmarks';
import { useSettings } from '@/state/settings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: jest.fn(),
}));
jest.mock('expo-crypto', () => {
  let n = 0;
  return { randomUUID: () => `uuid-${++n}` };
});
jest.mock('@/components/YoutubeSurface', () => ({ YoutubeSurface: () => null }));
jest.mock('@/player/controller', () => ({
  loadEpisode: jest.fn(),
  hasEpisodePlayer: jest.fn(() => false),
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

const episode = episodes[0]!;
const other = episodes[1]!;
const store = () => useBookmarks.getState();
const marks = () => episodeMarks(store().items, episode.id);
const params = (value: Record<string, string>) =>
  (useLocalSearchParams as jest.Mock).mockReturnValue(value);
const press = (testID: string) => fireEvent.press(screen.getByTestId(testID));

beforeEach(async () => {
  jest.clearAllMocks();
  useBookmarks.setState({ items: [] });
  usePlayback.setState({ episodeId: episode.id, positionSec: 0, playing: false });
  await useSettings.persist.rehydrate();
  useSettings.setState({ locale: 'en' });
});

describe('marks store', () => {
  it('adds a mark at a position, with a trimmed optional note', () => {
    const mark = store().add(episode.id, 754.6, '  a thought ');
    expect(mark).toMatchObject({ episodeId: episode.id, timeSec: 754, note: 'a thought' });
    expect(mark.createdAt).toEqual(expect.any(Number));
    expect(store().add(episode.id, 30).note).toBeUndefined();
  });

  it('lists an episode’s marks sorted by position, leaving out other episodes', () => {
    store().add(episode.id, 900);
    store().add(episode.id, 12);
    store().add(other.id, 5);
    store().add(episode.id, 300);
    store().add(episode.id, null); // whole-episode bookmark: not a mark
    expect(marks().map((m) => m.timeSec)).toEqual([12, 300, 900]);
  });

  it('keeps one mark per second; marking it again replaces the note', () => {
    const first = store().add(episode.id, 60, 'old');
    const again = store().add(episode.id, 60.9, 'new');
    expect(again.id).toBe(first.id);
    expect(marks()).toHaveLength(1);
    expect(marks()[0]!.note).toBe('new');
    // …and without a note the existing one stays.
    store().add(episode.id, 60);
    expect(marks()[0]!.note).toBe('new');
  });

  it('deletes a mark (soft delete, so the removal can sync)', () => {
    const a = store().add(episode.id, 10);
    store().add(episode.id, 20);
    store().remove(a.id);
    expect(marks().map((m) => m.timeSec)).toEqual([20]);
    expect(store().items.find((b) => b.id === a.id)?.deletedAt).toEqual(expect.any(Number));
  });

  it('still bookmarks the whole episode, independently of its marks', () => {
    store().add(episode.id, 42);
    store().toggleEpisode(episode.id);
    const whole = () => liveBookmarks(store().items).filter((b) => b.timeSec === null);
    expect(whole()).toHaveLength(1);
    store().toggleEpisode(episode.id);
    expect(whole()).toHaveLength(0);
    expect(marks()).toHaveLength(1);
  });

  it('reads bookmarks saved by earlier versions unchanged', () => {
    const legacy = { id: 'old', episodeId: episode.id, createdAt: 1, updatedAt: 1 };
    useBookmarks.setState({
      items: [
        { ...legacy, timeSec: null },
        { ...legacy, id: 'old-moment', timeSec: 90, note: 'quote' },
      ],
    });
    expect(marks().map((m) => m.id)).toEqual(['old-moment']);
    store().toggleEpisode(episode.id); // the existing whole-episode bookmark is found
    expect(liveBookmarks(store().items).map((b) => b.id)).toEqual(['old-moment']);
  });
});

describe('the player’s single bookmark button', () => {
  it('is the only bookmark button in the toolbar', async () => {
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    expect(screen.getAllByTestId('bookmark-button')).toHaveLength(1);
    expect(screen.queryByTestId('bookmark-add-moment')).toBeNull();
  });

  it('marks the current playback position, with the note typed in the sheet', async () => {
    usePlayback.setState({ episodeId: episode.id, positionSec: 754.6 });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    await press('bookmark-button');
    // The position is frozen when the sheet opens, however long the note takes.
    await act(() => usePlayback.setState({ positionSec: 800 }));
    expect(screen.getByText(/12:34/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('bookmark-note'), 'come back to this');
    await press('bookmark-add-moment');

    expect(marks()).toMatchObject([{ timeSec: 754, note: 'come back to this' }]);
    expect(screen.queryByTestId('bookmark-add-moment')).toBeNull(); // sheet closed
  });

  it('marks without a note in two taps', async () => {
    usePlayback.setState({ episodeId: episode.id, positionSec: 61 });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    await press('bookmark-button');
    await press('bookmark-add-moment');
    expect(marks()).toMatchObject([{ timeSec: 61, note: undefined }]);
  });

  it('still toggles the whole-episode bookmark', async () => {
    usePlayback.setState({ episodeId: episode.id, positionSec: 61 });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    const whole = () => liveBookmarks(store().items).filter((b) => b.timeSec === null);

    await press('bookmark-button');
    expect(screen.getByText('Bookmark episode')).toBeTruthy();
    await press('bookmark-toggle-episode');
    expect(whole()).toMatchObject([{ episodeId: episode.id }]);

    await press('bookmark-button');
    expect(screen.getByText('Remove episode bookmark')).toBeTruthy();
    await press('bookmark-toggle-episode');
    expect(whole()).toHaveLength(0);
  });

  it('offers only the episode bookmark when nothing has been played', async () => {
    usePlayback.setState({ episodeId: 'another', positionSec: 500, playing: true });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    await press('bookmark-button');
    expect(screen.queryByTestId('bookmark-add-moment')).toBeNull();
    expect(screen.getByTestId('bookmark-toggle-episode')).toBeTruthy();
  });

  it('is lit when the episode or any moment of it is bookmarked', async () => {
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    const selected = () =>
      (screen.getByTestId('bookmark-button').props.accessibilityState as { selected: boolean })
        .selected;
    expect(selected()).toBe(false);
    await act(() => void store().add(episode.id, 30));
    expect(selected()).toBe(true);
  });
});

describe('an episode’s marks in the player', () => {
  it('lists them in the chapters pane in playback order, with time and note', async () => {
    store().add(episode.id, 3725, 'later');
    store().add(episode.id, 125, 'earlier');
    params({ id: episode.id, pane: 'chapters' });
    await render(<EpisodeRoute />);

    expect(screen.getByText('Your bookmarks')).toBeTruthy();
    expect(screen.getByText('2:05')).toBeTruthy();
    expect(screen.getByText('1:02:05')).toBeTruthy();
    const rows = screen.getAllByTestId(/^mark-(?!delete)/);
    expect(rows.map((r) => r.props.testID)).toEqual(marks().map((m) => `mark-${m.id}`));
    expect(screen.getByText('earlier')).toBeTruthy();
  });

  it('seeks the player to the mark when it is tapped', async () => {
    const mark = store().add(episode.id, 125, 'here');
    params({ id: episode.id, pane: 'chapters' });
    await render(<EpisodeRoute />);
    (loadEpisode as jest.Mock).mockClear();
    await press(`mark-${mark.id}`);
    expect(loadEpisode).toHaveBeenCalledWith(episode, { startAt: 125, autoplay: true });
  });

  it('seeks from the list in the bookmark sheet too, and closes it', async () => {
    const mark = store().add(episode.id, 125, 'here');
    usePlayback.setState({ episodeId: episode.id, positionSec: 900 });
    params({ id: episode.id });
    await render(<EpisodeRoute />);
    await press('bookmark-button');
    (loadEpisode as jest.Mock).mockClear();
    await press(`mark-${mark.id}`);
    expect(loadEpisode).toHaveBeenCalledWith(episode, { startAt: 125, autoplay: true });
    expect(screen.queryByTestId('bookmark-toggle-episode')).toBeNull();
  });

  it('deletes a mark from the list without seeking', async () => {
    const mark = store().add(episode.id, 125, 'here');
    params({ id: episode.id, pane: 'chapters' });
    await render(<EpisodeRoute />);
    (loadEpisode as jest.Mock).mockClear();
    await press(`mark-delete-${mark.id}`);
    expect(marks()).toHaveLength(0);
    expect(screen.queryByTestId('episode-marks')).toBeNull();
    expect(loadEpisode).not.toHaveBeenCalled();
  });
});

describe('marking from the transcript', () => {
  // Cue N starts at N * 10.5 s, so odd cues start mid-second.
  const cues: Cue[] = Array.from({ length: 6 }, (_, i) => [
    i * 10_500,
    i * 10_500 + 9_000,
    `line ${i}`,
    `خط ${i}`,
  ]);
  const transcript = { cues } as Transcript;

  async function mount() {
    await render(<TranscriptView episode={episode} transcript={transcript} onSeek={jest.fn()} />);
    await act(() => {
      fireEvent(screen.getByTestId('transcript-viewport'), 'layout', {
        nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 1000 } },
      });
    });
  }
  const longPress = (index: number) => fireEvent(screen.getByTestId(`cue-${index}`), 'longPress');

  it('long-press bookmarks the line’s timestamp, the line itself as the note', async () => {
    await mount();
    await longPress(3); // 31.5 s
    await press('cue-bookmark');
    expect(marks()).toMatchObject([{ timeSec: 31, note: 'line 3' }]);
    // The marked line — and only it — carries the marker.
    expect(screen.getByTestId('cue-mark-3')).toBeTruthy();
    expect(screen.queryByTestId('cue-mark-2')).toBeNull();
  });

  it('takes the user’s own note instead when one is typed', async () => {
    await mount();
    await longPress(2);
    await fireEvent.changeText(screen.getByTestId('cue-note'), 'my note');
    await press('cue-bookmark');
    expect(marks()).toMatchObject([{ timeSec: 21, note: 'my note' }]);
  });

  it('offers to remove the bookmark on a line that already has one', async () => {
    await mount();
    await longPress(3);
    await press('cue-bookmark');
    await longPress(3);
    expect(screen.queryByTestId('cue-bookmark')).toBeNull();
    await press('cue-remove-bookmark');
    expect(marks()).toHaveLength(0);
    expect(screen.queryByTestId('cue-mark-3')).toBeNull();
  });
});

describe('library bookmarks tab', () => {
  it('shows marks and whole-episode bookmarks, and opens a mark at its position', async () => {
    const mark = store().add(episode.id, 125, 'a note');
    store().toggleEpisode(other.id);
    await render(<LibraryTab />);
    expect(screen.getByText(/2:05/)).toBeTruthy();
    expect(screen.getByText('a note')).toBeTruthy();
    expect(screen.getByText(/Whole episode/)).toBeTruthy();
    await press(`bookmark-${mark.id}`);
    const { router } = jest.requireMock<typeof import('expo-router')>('expo-router');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/episode/[id]',
      params: { id: episode.id, t: '125' },
    });
  });
});
