/**
 * Easter egg: four quick taps on the version number open the coin flip, which
 * is the website's coin in a WebView; every tap tosses it and plays the sound.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import CoinFlip, { MURMUR_DELAY_MS, MURMUR_MS, coinSize } from '../app/coinflip';
import { COIN_PAGE } from '@/coinflip/coinPage.generated';
import { coinPageHtml, parseCoinEvent, tossScript, type CoinEvent } from '@/coinflip/page';
import { translate } from '@/i18n';
import { createMultiTap } from '@/lib/multiTap';
import { playCoinTing, releaseCoinTing } from '@/player/coinTing';
import { SettingsTab } from '@/screens/SettingsTab';
import { useSettings } from '@/state/settings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
}));
jest.mock('@/player/coinTing', () => ({ playCoinTing: jest.fn(), releaseCoinTing: jest.fn() }));

// The WebView is native: stand in for it, keeping what the screen passes down
// and what it injects into the page.
const mockInjected: string[] = [];
jest.mock('react-native-webview', () => {
  const { useImperativeHandle } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    WebView: ({ ref, ...props }: { ref?: React.Ref<unknown>; children?: ReactNode }) => {
      useImperativeHandle(ref, () => ({
        injectJavaScript: (script: string) => mockInjected.push(script),
        reload: () => undefined,
      }));
      return <View {...props} />;
    },
  };
});

// The project has no Node typings (it is an app): the builder is typed by hand.
const builder = jest.requireActual<{ moduleSource(): string; OUT: string }>(
  '../../scripts/build-coinflip.js',
);
const fs = jest.requireActual<{ readFileSync(file: string, encoding: 'utf8'): string }>('fs');

const webview = () => screen.getByTestId('coinflip-webview');
/** The page reports something, as the WebView would deliver it. */
const page = (event: CoinEvent) =>
  act(async () => {
    webview().props.onMessage({ nativeEvent: { data: JSON.stringify(event) } });
  });
const caption = () => screen.getByTestId('coinflip-caption').props.children as string;
const en = (key: Parameters<typeof translate>[1]) => translate('en', key);
const layout = { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 844 } } };

async function open() {
  await render(<CoinFlip />);
  await fireEvent(screen.getByTestId('coinflip-screen'), 'layout', layout);
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockInjected.length = 0;
  await useSettings.persist.rehydrate();
  useSettings.setState({ locale: 'en' });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('multi-tap', () => {
  it('fires on the fourth quick tap, then starts over', () => {
    const tap = createMultiTap();
    expect([0, 200, 400, 600].map((at) => tap(at))).toEqual([false, false, false, true]);
    expect([700, 800, 900].map((at) => tap(at))).toEqual([false, false, false]);
    expect(tap(1000)).toBe(true);
  });

  it('starts over after a pause between taps', () => {
    const tap = createMultiTap();
    expect([0, 200, 400].map((at) => tap(at))).toEqual([false, false, false]);
    expect(tap(1001)).toBe(false); // 601 ms after the third
    expect([1200, 1400].map((at) => tap(at))).toEqual([false, false]);
    expect(tap(1600)).toBe(true);
  });

  it('starts over when four taps take longer than the window', () => {
    const tap = createMultiTap();
    expect([0, 500, 1000, 1500].map((at) => tap(at))).toEqual([false, false, false, false]);
  });
});

describe('version easter egg', () => {
  it('opens the coin flip after four quick taps on the version, not before', async () => {
    const now = jest.spyOn(Date, 'now');
    await render(<SettingsTab />);
    const version = screen.getByTestId('version-tap');
    for (const at of [1000, 1200, 1400]) {
      now.mockReturnValue(at);
      await fireEvent.press(version);
    }
    expect(router.push).not.toHaveBeenCalled();
    now.mockReturnValue(1600);
    await fireEvent.press(version);
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/coinflip');
  });

  it('ignores slow taps', async () => {
    const now = jest.spyOn(Date, 'now');
    await render(<SettingsTab />);
    for (const at of [1000, 2000, 3000, 4000, 5000]) {
      now.mockReturnValue(at);
      await fireEvent.press(screen.getByTestId('version-tap'));
    }
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe('the coin page', () => {
  it('is up to date with the website coin, the template and the artwork', () => {
    // Out of date? Run: npm run coinflip:build
    expect(fs.readFileSync(builder.OUT, 'utf8') === builder.moduleSource()).toBe(true);
  });

  it('is self-contained: nothing is fetched, imported or linked', () => {
    expect(/https?:\/\/shiryakhat/.test(COIN_PAGE)).toBe(false);
    expect(/\b(src|href)="(?!data:)/.test(COIN_PAGE)).toBe(false);
    expect(/import\.meta|\bimport\s*[({*]|\bexport\s/.test(COIN_PAGE)).toBe(false);
    expect(COIN_PAGE.includes('loadImage(base + ')).toBe(false);
    expect(COIN_PAGE.match(/data:image\/webp;base64,/g)).toHaveLength(4);
    expect(COIN_PAGE.includes('background: #070C3B')).toBe(true);
    // The website's coin, as it is: its odds of the rim included.
    expect(COIN_PAGE.includes('const EDGE_CHANCE = 1 / 6;')).toBe(true);
    expect(COIN_PAGE.match(/<script>/g)).toHaveLength(1);
    expect(COIN_PAGE.match(/<\/script/g)).toHaveLength(1);
  });

  it('is told about reduce motion, once', () => {
    expect(COIN_PAGE.split('"__COIN_OPTS__"')).toHaveLength(2);
    expect(coinPageHtml({ still: true })).toContain('var OPTS = {"still":true};');
    expect(coinPageHtml({ still: false })).toContain('var OPTS = {"still":false};');
  });

  it('is tossed by a script that tolerates a page that is not up yet', () => {
    expect(tossScript()).toBe('window.__coin && window.__coin.toss(); true;');
    expect(tossScript(120.6)).toBe('window.__coin && window.__coin.toss(121); true;');
    expect(tossScript(NaN)).toBe(tossScript());
  });

  it('only understands its own messages', () => {
    expect(parseCoinEvent('{"type":"ready","live":true}')).toEqual({ type: 'ready', live: true });
    expect(parseCoinEvent('{"type":"land","face":"tails"}')).toEqual({
      type: 'land',
      face: 'tails',
    });
    expect(parseCoinEvent('{"type":"edge"}')).toEqual({ type: 'edge' });
    expect(parseCoinEvent('{"type":"idle","extra":1}')).toEqual({ type: 'idle' });
    for (const junk of ['', 'null', '[]', '{"type":"land","face":"rim"}', '{"type":"x"}', 7]) {
      expect(parseCoinEvent(junk)).toBeNull();
    }
  });

  it('sizes the coin like the page does, to put the caption under it', () => {
    expect(coinSize(390, 844)).toBeCloseTo(280.8);
    expect(coinSize(1024, 1366)).toBe(352);
    expect(coinSize(844, 390)).toBeCloseTo(163.8);
  });
});

describe('<CoinFlip/>', () => {
  it('shows the bundled page full-screen, animated unless motion is reduced', async () => {
    await open();
    const { source, originWhitelist } = webview().props;
    expect(source.html).toBe(coinPageHtml({ still: false }));
    expect(source.uri).toBeUndefined();
    expect(originWhitelist).toEqual(['*']);
    expect(caption()).toBe(en('coinHint'));
  });

  it('shows the still coin under reduce motion', async () => {
    const { AccessibilityInfo } = jest.requireActual<typeof import('react-native')>('react-native');
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    await open();
    expect(webview().props.source.html).toBe(coinPageHtml({ still: true }));
  });

  it('tosses and plays the sound on every tap, and names the face it lands on', async () => {
    await open();
    const coin = screen.getByTestId('coinflip-coin');

    await fireEvent.press(coin, { nativeEvent: { locationX: 300 } });
    expect(playCoinTing).toHaveBeenCalledTimes(1);
    expect(mockInjected).toEqual([tossScript(300)]);
    await page({ type: 'land', face: 'tails' });
    expect(caption()).toBe(en('coinTails'));

    // Batted again in mid-air: every tap rings and reaches the coin.
    await fireEvent.press(coin);
    await fireEvent.press(coin);
    expect(playCoinTing).toHaveBeenCalledTimes(3);
    expect(mockInjected).toHaveLength(3);
    await page({ type: 'land', face: 'heads' });
    expect(caption()).toBe(en('coinHeads'));

    // Back to turning idly: the result no longer applies.
    await page({ type: 'idle' });
    expect(caption()).toBe(en('coinHint'));
  });

  it("teeters on its rim under the website's caption, in the app's language", async () => {
    jest.useFakeTimers();
    useSettings.setState({ locale: 'fa' });
    await open();
    await page({ type: 'edge' });
    expect(screen.queryByTestId('coinflip-caption')).toBeNull();
    expect(screen.getByText('شیر یا خط؟')).toBeTruthy();
    expect(screen.getByText('تصمیم با شماست')).toBeTruthy();
    await act(() => jest.advanceTimersByTimeAsync(MURMUR_DELAY_MS + MURMUR_MS + 50));

    // It makes up its mind...
    await page({ type: 'land', face: 'heads' });
    expect(screen.queryByTestId('coinflip-undecided')).toBeNull();
    expect(caption()).toBe(translate('fa', 'coinHeads'));

    // ...or is tossed again off its rim.
    await page({ type: 'edge' });
    await fireEvent.press(screen.getByTestId('coinflip-coin'));
    expect(caption()).toBe(translate('fa', 'coinHint'));
  });

  it('says "heads or tails? …you decide" in English', async () => {
    await open();
    await page({ type: 'edge' });
    expect(screen.getByText('heads or tails?')).toBeTruthy();
    expect(screen.getByText('…you decide')).toBeTruthy();
  });

  it('closes from the header and lets go of the sound', async () => {
    await open();
    await fireEvent.press(screen.getByTestId('coinflip-close'));
    expect(router.back).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(releaseCoinTing).toHaveBeenCalledTimes(1);
  });
});
