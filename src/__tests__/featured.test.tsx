/**
 * The featured card at the top of the Episodes screen: the newest episode for
 * its first 14 days, otherwise a random episode re-drawn on mount and refresh.
 */
import { act, render, screen } from '@testing-library/react-native';
import { episodes, type Episode } from '@/content';
import { FEATURED_PIN_DAYS, newestEpisode, pickFeatured } from '@/content/featured';
import { EpisodesTab } from '@/screens/EpisodesTab';
import { useSettings } from '@/state/settings';

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('expo-image', () => ({ Image: 'Image' }));
jest.mock('expo-file-system', () => ({
  File: class {},
  Directory: class {},
  DownloadTask: class {},
  Paths: {},
}));

const DAY = 24 * 60 * 60 * 1000;
const ep = (id: string, publishedAt: string) => ({ id, publishedAt }) as Episode;
const list = [ep('a', '2025-01-10'), ep('c', '2026-03-01'), ep('b', '2025-06-20')];
const published = Date.parse('2026-03-01');

describe('pickFeatured', () => {
  it('finds the newest episode by publish date, wherever it sits in the list', () => {
    expect(newestEpisode(list)?.id).toBe('c');
    expect(newestEpisode([])).toBeUndefined();
    expect(pickFeatured([])).toBeUndefined();
  });

  it('pins the newest episode for its first 14 days, whatever the draw', () => {
    for (const days of [0, 1, 13, FEATURED_PIN_DAYS]) {
      for (const r of [0, 0.5, 0.99]) {
        expect(pickFeatured(list, published + days * DAY, () => r)?.id).toBe('c');
      }
    }
  });

  it('draws a random episode from the whole list once the 14 days are over', () => {
    const later = published + FEATURED_PIN_DAYS * DAY + 1;
    expect(pickFeatured(list, later, () => 0)?.id).toBe('a');
    expect(pickFeatured(list, later, () => 0.4)?.id).toBe('c');
    expect(pickFeatured(list, later, () => 0.99)?.id).toBe('b');
    // A draw of exactly 1 must not run off the end.
    expect(pickFeatured(list, later, () => 1)?.id).toBe('b');
  });

  it('draws again on every call', () => {
    const later = published + 30 * DAY;
    const draws = [0.9, 0.1];
    const random = () => draws.shift()!;
    expect(pickFeatured(list, later, random)?.id).toBe('b');
    expect(pickFeatured(list, later, random)?.id).toBe('a');
  });
});

describe('featured card on the Episodes screen', () => {
  const newest = newestEpisode(episodes)!;
  const title = (e: Episode) => `${e.titleEn}, ${e.code}`;
  const featuredLabel = () => screen.getByTestId('featured-card').props.accessibilityLabel;
  let random: jest.SpyInstance;
  let now: jest.SpyInstance;

  beforeEach(() => {
    useSettings.setState({ locale: 'en' });
    random = jest.spyOn(Math, 'random');
    now = jest.spyOn(Date, 'now');
  });
  afterEach(() => jest.restoreAllMocks());

  it('shows the newest episode while it is under two weeks old', async () => {
    now.mockReturnValue(Date.parse(newest.publishedAt) + 3 * DAY);
    random.mockReturnValue(0);
    await render(<EpisodesTab />);
    expect(featuredLabel()).toBe(title(newest));
  });

  it('shows a random episode after that, re-drawn on refresh but not on re-render', async () => {
    now.mockReturnValue(Date.parse(newest.publishedAt) + 15 * DAY);
    const first = episodes[0]!;
    const last = episodes[episodes.length - 1]!;
    random.mockReturnValue(0);
    const view = await render(<EpisodesTab />);
    expect(featuredLabel()).toBe(title(first));

    random.mockReturnValue(0.999);
    await view.rerender(<EpisodesTab />);
    expect(featuredLabel()).toBe(title(first));

    await act(async () => screen.getByTestId('episodes-list').props.onRefresh());
    expect(featuredLabel()).toBe(title(last));
  });

  it('draws again on a fresh mount', async () => {
    now.mockReturnValue(Date.parse(newest.publishedAt) + 15 * DAY);
    random.mockReturnValue(0);
    const view = await render(<EpisodesTab />);
    expect(featuredLabel()).toBe(title(episodes[0]!));
    await view.unmount();
    random.mockReturnValue(0.999);
    await render(<EpisodesTab />);
    expect(featuredLabel()).toBe(title(episodes[episodes.length - 1]!));
  });
});
