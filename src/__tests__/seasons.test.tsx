/**
 * The season chips in the Episodes top bar filter the list: one season, the
 * specials (season 0), or everything.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { seasons } from '@/content';
import { translate } from '@/i18n';
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

beforeEach(() => useSettings.setState({ locale: 'en' }));

describe('season chips', () => {
  const selected = (testID: string) =>
    screen.getByTestId(testID).props.accessibilityState?.selected === true;
  const sectionTitles = () =>
    seasons
      .map((s) => (s.season === 0 ? 'Specials' : `Season ${s.season}`))
      // The chip carries the same label, so a rendered section adds a second match.
      .filter((label) => screen.queryAllByText(label).length > 1);
  const season = (n: number) => seasons.find((s) => s.season === n)!;

  it('starts on "All" with every season offered, specials included', async () => {
    await render(<EpisodesTab />);
    expect(selected('season-chip-all')).toBe(true);
    for (const s of seasons) expect(selected(`season-chip-${s.season}`)).toBe(false);
    expect(seasons.some((s) => s.season === 0)).toBe(true);
    expect(screen.getByTestId(`episode-card-${seasons[0]!.data[0]!.id}`)).toBeTruthy();
  });

  it('filters the list to the tapped season and marks it active', async () => {
    await render(<EpisodesTab />);
    const oldest = season(1);
    await fireEvent.press(screen.getByTestId('season-chip-1'));

    expect(selected('season-chip-1')).toBe(true);
    expect(selected('season-chip-all')).toBe(false);
    expect(sectionTitles()).toEqual(['Season 1']);
    expect(screen.getByTestId(`episode-card-${oldest.data[0]!.id}`)).toBeTruthy();
    expect(screen.queryByTestId(`episode-card-${seasons[0]!.data[0]!.id}`)).toBeNull();
    expect(
      screen.getByText(translate('en', 'episodesCount', { n: oldest.data.length })),
    ).toBeTruthy();
  });

  it('shows only the specials for season 0, and everything again on "All"', async () => {
    await render(<EpisodesTab />);
    await fireEvent.press(screen.getByTestId('season-chip-0'));
    expect(selected('season-chip-0')).toBe(true);
    expect(sectionTitles()).toEqual(['Specials']);
    // The list is virtualised: only the first screenful of specials is mounted.
    for (const e of season(0).data.slice(0, 5)) {
      expect(screen.getByTestId(`episode-card-${e.id}`)).toBeTruthy();
    }
    expect(
      screen.getByText(translate('en', 'episodesCount', { n: season(0).data.length })),
    ).toBeTruthy();
    expect(screen.queryByTestId(`episode-card-${seasons[0]!.data[0]!.id}`)).toBeNull();

    await fireEvent.press(screen.getByTestId('season-chip-all'));
    expect(selected('season-chip-all')).toBe(true);
    expect(selected('season-chip-0')).toBe(false);
    expect(screen.getByTestId(`episode-card-${seasons[0]!.data[0]!.id}`)).toBeTruthy();
  });

  it('labels the "All" chip in Farsi too', async () => {
    useSettings.setState({ locale: 'fa' });
    await render(<EpisodesTab />);
    expect(screen.getByText('همه')).toBeTruthy();
  });
});
