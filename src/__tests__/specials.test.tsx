/**
 * Specials (season 0) are talks: the list shows where each was given and when
 * ("<conference> - <date>") instead of its "SP<n>" code, latest talk first.
 */
import { render, screen } from '@testing-library/react-native';
import { EpisodeCard } from '@/components/EpisodeCard';
import { episodes, seasons, type Episode } from '@/content';
import { episodeMeta, formatDate, joinMeta } from '@/lib/format';
import { useSettings } from '@/state/settings';

jest.mock('expo-image', () => ({ Image: 'Image' }));

const specials = seasons.find((s) => s.season === 0)!.data;
const special = (id: string) => episodes.find((e) => e.id === id)!;
/** The bidi isolates are layout plumbing, not text. */
const plain = (text: string) => text.replace(/[\u2068\u2069]/g, '');

beforeEach(() => useSettings.setState({ locale: 'en' }));

describe('specials order', () => {
  it('lists the specials by date, latest first', () => {
    const dates = specials.map((e) => e.publishedAt);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(specials).toHaveLength(episodes.filter((e) => e.season === 0).length);
  });

  it('is no longer the SP-number order', () => {
    // sp15 was added last but dates from 2020; sp01 (2020-11) is not the oldest.
    expect(specials[0]!.id).toBe('sp14');
    expect(specials.at(-1)!.id).toBe('sp02');
    const ids = specials.map((e) => e.id);
    expect(ids.indexOf('sp15')).toBeGreaterThan(ids.indexOf('sp01'));
  });

  it('breaks a tie on the date by the higher number', () => {
    const ids = specials.map((e) => e.id);
    expect(special('sp03').publishedAt).toBe(special('sp04').publishedAt);
    expect(ids.indexOf('sp04')).toBe(ids.indexOf('sp03') - 1);
  });

  it('leaves the regular seasons in episode order, newest first', () => {
    for (const s of seasons.filter((x) => x.season !== 0)) {
      const numbers = s.data.map((e) => e.episode);
      expect(numbers).toEqual([...numbers].sort((a, b) => b - a));
    }
  });
});

describe('specials label', () => {
  it('every special names its conference in both languages', () => {
    for (const e of specials) {
      expect(e.conferenceEn).toBeTruthy();
      expect(e.conferenceFa).toBeTruthy();
    }
    expect(episodes.filter((e) => e.season !== 0 && e.conferenceEn)).toEqual([]);
  });

  it('reads "<conference> - <date>" instead of the SP code', () => {
    const ep = special('sp03');
    expect(plain(episodeMeta(ep, 'en'))).toBe('Devcon 5 - 27 December 2019');
    expect(episodeMeta(ep, 'en')).not.toContain('SP03');
    expect(plain(episodeMeta(special('sp15'), 'en'))).toBe(
      'Stanford Blockchain Conference 2020 - 2 March 2020',
    );
  });

  it('uses the Persian name and the Jalali date in Farsi', () => {
    const ep = special('sp03');
    expect(plain(episodeMeta(ep, 'fa'))).toBe(
      `${ep.conferenceFa} - ${formatDate(ep.publishedAt, 'fa')}`,
    );
    expect(ep.conferenceFa).toBe('دِوکان ۵');
  });

  it('keeps each side in its own bidi isolate', () => {
    expect(episodeMeta(special('sp06'), 'fa')).toMatch(
      /^\u2068Liquidity 2020\u2069 - \u2068.+\u2069$/,
    );
  });

  it('falls back to the code for a special without a conference, and for regular episodes', () => {
    const bare: Episode = { ...special('sp03'), conferenceEn: undefined, conferenceFa: undefined };
    expect(episodeMeta(bare, 'en')).toBe(joinMeta('SP03', '27 December 2019'));
    const regular = episodes.find((e) => e.season > 0)!;
    expect(episodeMeta(regular, 'en')).toBe(
      joinMeta(regular.code, formatDate(regular.publishedAt, 'en')),
    );
    // One language only: it is used for both.
    expect(plain(episodeMeta({ ...bare, conferenceEn: 'Some Conf' }, 'fa'))).toContain(
      'Some Conf - ',
    );
  });

  it('shows on the episode card', async () => {
    const ep = special('sp14');
    await render(<EpisodeCard episode={ep} onPress={() => undefined} />);
    expect(screen.getByText(episodeMeta(ep, 'en'))).toBeTruthy();
    expect(plain(episodeMeta(ep, 'en'))).toBe('Devcon 8 - 6 November 2026');
    expect(screen.queryByText(/SP14/)).toBeNull();
  });
});
