/**
 * Launch screen: the coin hands over from the native splash, makes its sound
 * (when enabled), waits for the app — but never for long — and gets out of the way.
 */
import { act, render, screen } from '@testing-library/react-native';
import * as SplashScreen from 'expo-splash-screen';
import { CoinSplash, FADE_MS, FLIP_MS, MAX_HOLD_MS, faceVisibility } from '@/components/CoinSplash';
import { playCoinSound } from '@/player/coinSound';
import { useSettings } from '@/state/settings';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(() => Promise.resolve(true)),
  hideAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/player/coinSound', () => ({ playCoinSound: jest.fn(() => Promise.resolve()) }));

/** The coin starts once its art is on screen, or after this fallback (no image loads in jest). */
const ART_TIMEOUT_MS = 300;
const advance = (ms: number) => act(() => jest.advanceTimersByTimeAsync(ms));
/** Mount the splash and let the coin appear (its own act, so the toss starts on time). */
async function show(ready: boolean, onDone: () => void = jest.fn()) {
  await render(<CoinSplash ready={ready} onDone={onDone} />);
  await advance(ART_TIMEOUT_MS);
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  await useSettings.persist.rehydrate();
  useSettings.setState({ splashSound: true });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('coin faces', () => {
  const at = (face: 'heads' | 'tails', halfTurns: number) => {
    const { inputRange, outputRange } = faceVisibility(face, 8);
    let i = 0;
    while (i < inputRange.length - 1 && inputRange[i + 1]! <= halfTurns) i++;
    return outputRange[i];
  };

  it('shows heads on even half-turns and tails on odd ones', () => {
    for (const n of [0, 2, 4, 6, 8]) {
      expect(at('heads', n)).toBe(1);
      expect(at('tails', n)).toBe(0);
    }
    for (const n of [1, 3, 5, 7]) {
      expect(at('heads', n)).toBe(0);
      expect(at('tails', n)).toBe(1);
    }
  });

  it('never shows both faces, and keeps a valid interpolation range', () => {
    const heads = faceVisibility('heads', 8);
    const tails = faceVisibility('tails', 8);
    expect(heads.inputRange).toEqual(tails.inputRange);
    heads.outputRange.forEach((v, i) => expect(v + tails.outputRange[i]!).toBe(1));
    heads.inputRange.forEach((v, i) => {
      if (i > 0) expect(v).toBeGreaterThan(heads.inputRange[i - 1]!);
    });
  });
});

describe('<CoinSplash/>', () => {
  it('hides the native splash once the coin is up, flips, then reveals a ready app', async () => {
    const onDone = jest.fn();
    await render(<CoinSplash ready onDone={onDone} />);
    expect(screen.getByTestId('coin-splash', { includeHiddenElements: true })).toBeTruthy();
    expect(SplashScreen.hideAsync).not.toHaveBeenCalled();

    await advance(ART_TIMEOUT_MS);
    expect(SplashScreen.hideAsync).toHaveBeenCalledTimes(1);

    await advance(FLIP_MS - 100);
    expect(onDone).not.toHaveBeenCalled();
    await advance(100 + FADE_MS + 100);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('keeps the coin in the air while the app loads, but gives up after the cap', async () => {
    const onDone = jest.fn();
    await show(false, onDone);
    await advance(FLIP_MS + FADE_MS + 100);
    expect(onDone).not.toHaveBeenCalled();
    // Everything is over by the cap plus the fade (and a few frames of slack).
    await advance(MAX_HOLD_MS - FLIP_MS + 200);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('leaves as soon as a slow app becomes ready', async () => {
    const onDone = jest.fn();
    await show(false, onDone);
    await advance(FLIP_MS + 50);
    await screen.rerender(<CoinSplash ready onDone={onDone} />);
    await advance(MAX_HOLD_MS - FLIP_MS);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('plays the coin sound once by default', async () => {
    await show(true);
    await advance(FLIP_MS);
    expect(playCoinSound).toHaveBeenCalledTimes(1);
  });

  it('stays silent when the splash sound is switched off', async () => {
    useSettings.setState({ splashSound: false });
    await show(true);
    await advance(FLIP_MS);
    expect(playCoinSound).not.toHaveBeenCalled();
  });
});

describe('splash sound setting', () => {
  it('is on by default', () => {
    expect(useSettings.getInitialState().splashSound).toBe(true);
  });
});
