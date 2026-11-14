/**
 * RTL is a first-class requirement: Farsi is the default locale and the whole
 * UI mirrors without an app reload. These tests pin the rules down.
 */
import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Scrubber } from '@/components/Scrubber';
import { ShareCard } from '@/components/ShareCard';
import { TabBar } from '@/components/TabBar';
import { Icon, Screen, Text } from '@/components/ui';
import { episodes } from '@/content';
import { digits, translate } from '@/i18n';
import { formatTime, joinMeta } from '@/lib/format';
import { useSettings } from '@/state/settings';

const styleOf = (node: { props: { style?: unknown } }) =>
  StyleSheet.flatten(node.props.style as never) as Record<string, unknown>;

function setLocale(locale: 'fa' | 'en') {
  useSettings.setState({ locale });
}

describe('locale defaults', () => {
  it('starts in Farsi', () => {
    expect(useSettings.getInitialState().locale).toBe('fa');
  });
});

describe.each([
  ['fa', 'rtl'],
  ['en', 'ltr'],
] as const)('layout direction in %s', (locale, dir) => {
  beforeEach(() => setLocale(locale));

  it(`roots every screen with direction: ${dir}`, async () => {
    await render(
      <Screen testID="root">
        <Text testID="label">{translate(locale, 'appName')}</Text>
      </Screen>,
    );
    expect(styleOf(screen.getByTestId('root')).direction).toBe(dir);
  });

  it('aligns text to the logical start edge and sets the writing direction', async () => {
    await render(<Text testID="label">متن</Text>);
    const style = styleOf(screen.getByTestId('label'));
    // RN resolves `left` against the inherited direction, so `left` === start.
    expect(style.textAlign).toBe('left');
    expect(style.writingDirection).toBe(dir);
  });

  it('lets a line opt into the other language direction', async () => {
    await render(
      <Text testID="other" dir={dir === 'rtl' ? 'ltr' : 'rtl'} align="end">
        other
      </Text>,
    );
    const style = styleOf(screen.getByTestId('other'));
    expect(style.writingDirection).toBe(dir === 'rtl' ? 'ltr' : 'rtl');
    expect(style.textAlign).toBe('right');
  });

  it('localises tab labels', async () => {
    await render(<TabBar />);
    expect(screen.getByText(translate(locale, 'tabEpisodes'))).toBeTruthy();
    expect(screen.getByText(translate(locale, 'tabSettings'))).toBeTruthy();
  });
});

describe('RTL details', () => {
  beforeEach(() => setLocale('fa'));

  it('keeps the playback timeline left-to-right in Farsi', async () => {
    const view = await render(
      <Scrubber positionSec={30} durationSec={120} onSeek={() => undefined} />,
    );
    const root = view.toJSON() as { props: { style?: unknown } };
    expect(styleOf(root).direction).toBe('ltr');
  });

  it('mirrors directional icons only', async () => {
    const chevron = await render(<Icon name="chevron-left" />);
    expect(JSON.stringify(chevron.toJSON())).toContain('"scaleX":-1');
    await chevron.unmount();
    const play = await render(<Icon name="play" />);
    expect(JSON.stringify(play.toJSON())).not.toContain('scaleX');
  });

  it('renders the share card in the requested language direction', async () => {
    const episode = episodes[0]!;
    for (const [locale, dir] of [
      ['fa', 'rtl'],
      ['en', 'ltr'],
    ] as const) {
      const view = await render(
        <ShareCard episode={episode} quote="نقل قول" link="https://example.com" locale={locale} />,
      );
      expect(styleOf(view.toJSON() as { props: { style?: unknown } }).direction).toBe(dir);
      await view.unmount();
    }
  });

  it('uses Persian digits in Farsi and ASCII digits in English', () => {
    expect(digits('S07E07 12:30', 'fa')).toBe('S۰۷E۰۷ ۱۲:۳۰');
    expect(formatTime(3725, 'fa')).toBe('۱:۰۲:۰۵');
    expect(formatTime(3725, 'en')).toBe('1:02:05');
    expect(translate('fa', 'season', { n: 7 })).toBe('فصل ۷');
  });

  it('isolates mixed-direction fragments so bidi cannot reorder them', () => {
    expect(joinMeta('S07E07', '۱۹ مرداد', undefined)).toBe(
      '\u2068S07E07\u2069  ·  \u2068۱۹ مرداد\u2069',
    );
  });
});
