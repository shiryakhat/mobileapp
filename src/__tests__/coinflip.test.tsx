/**
 * Easter egg: four quick taps on the version number open the coin flip; every
 * tap on the coin tosses it and rings.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import CoinFlip, {
  EDGE_CHANCE,
  EDGE_WAIT_MS,
  FLIP_MS,
  TIP_MS,
  landingFor,
  pickOutcome,
  spinPosition,
} from '../app/coinflip';
import { translate } from '@/i18n';
import { createMultiTap } from '@/lib/multiTap';
import { playCoinTing, releaseCoinTing } from '@/player/coinTing';
import { SettingsTab } from '@/screens/SettingsTab';
import { useSettings } from '@/state/settings';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => true) },
}));
// The launch coin (whose face maths this screen reuses) pulls in the native audio module.
jest.mock('@/player/coinSound', () => ({ playCoinSound: jest.fn() }));
jest.mock('@/player/coinTing', () => ({ playCoinTing: jest.fn(), releaseCoinTing: jest.fn() }));

const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
const caption = () => screen.getByTestId('coinflip-caption').props.children as string;
const en = (key: Parameters<typeof translate>[1]) => translate('en', key);

beforeEach(async () => {
  jest.clearAllMocks();
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

describe('coin outcomes', () => {
  it('lands on the rim about one toss in six, otherwise on a fair face', () => {
    const rolls =
      (...values: number[]) =>
      () =>
        values.shift()!;
    expect(pickOutcome(rolls(EDGE_CHANCE - 0.01))).toBe('edge');
    expect(pickOutcome(rolls(EDGE_CHANCE, 0.49))).toBe('heads');
    expect(pickOutcome(rolls(0.9, 0.5))).toBe('tails');
  });

  it('comes down heads on even half-turns, tails on odd ones, edge-on in between', () => {
    for (const from of [0, 0.3, 1, 1.5, 1.99]) {
      const heads = landingFor(from, 'heads');
      const tails = landingFor(from, 'tails');
      const edge = landingFor(from, 'edge');
      expect(heads % 2).toBe(0);
      expect(tails % 2).toBe(1);
      expect(edge % 1).toBe(0.5);
      for (const to of [heads, tails, edge]) {
        expect(to - from).toBeGreaterThanOrEqual(5);
        expect(to).toBeLessThan(16);
      }
    }
  });
});

describe('spin position', () => {
  const spin = { from: 1, to: 7, startedAt: 1000, duration: 1000, ease: (p: number) => p };

  it('follows the toss, and stays put before and after it', () => {
    expect(spinPosition(spin, 900)).toBe(1);
    expect(spinPosition(spin, 1500)).toBe(4);
    expect(spinPosition(spin, 5000)).toBe(7);
    expect(spinPosition({ ...spin, duration: 0 }, 1000)).toBe(7);
  });
});

describe('<CoinFlip/>', () => {
  beforeEach(() => jest.useFakeTimers());

  it('tosses and rings on every tap, and announces the face it lands on', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.9); // not the rim; tails
    await render(<CoinFlip />);
    expect(caption()).toBe(en('coinHint'));

    await fireEvent.press(screen.getByTestId('coinflip-coin'));
    expect(playCoinTing).toHaveBeenCalledTimes(1);
    await advance(FLIP_MS + 50);
    expect(caption()).toBe(en('coinTails'));

    // Batted again in mid-air: another ring, and only the last toss counts.
    await fireEvent.press(screen.getByTestId('coinflip-coin'));
    await advance(FLIP_MS / 2);
    jest.spyOn(Math, 'random').mockReturnValue(0.3); // heads
    await fireEvent.press(screen.getByTestId('coinflip-coin'));
    expect(playCoinTing).toHaveBeenCalledTimes(3);
    await advance(FLIP_MS / 2 + 50);
    expect(caption()).toBe(en('coinHint'));
    await advance(FLIP_MS / 2);
    expect(caption()).toBe(en('coinHeads'));
  });

  it('teeters on its rim, then falls onto a face', async () => {
    jest.spyOn(Math, 'random').mockReturnValue(0.01); // the rim, then heads
    await render(<CoinFlip />);
    await fireEvent.press(screen.getByTestId('coinflip-coin'));
    await advance(FLIP_MS + 50);
    expect(caption()).toBe(en('coinEdge'));
    await advance(EDGE_WAIT_MS + TIP_MS + 50);
    expect(caption()).toBe(en('coinHeads'));
  });

  it('closes from the header and lets go of the sound', async () => {
    await render(<CoinFlip />);
    await fireEvent.press(screen.getByTestId('coinflip-close'));
    expect(router.back).toHaveBeenCalledTimes(1);
    await screen.unmount();
    expect(releaseCoinTing).toHaveBeenCalledTimes(1);
  });
});
