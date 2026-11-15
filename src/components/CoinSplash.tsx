/**
 * Launch screen: the Shir ya Khat coin is tossed while the app boots, lands on
 * a random face and fades into the app.
 *
 * The website's coin is a Three.js scene (site/assets/coin.js); this is its
 * lightweight native cousin — the same two faces on a flat disc. The whole toss
 * hangs off ONE native-driven value, so it stays smooth while the JS thread is
 * busy mounting the app underneath.
 */
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, View } from 'react-native';
import { playCoinSound } from '@/player/coinSound';
import { useSettings } from '@/state/settings';
import { brand } from '@/theme';

const HEADS = require('../../assets/coin-face-heads.webp');
const TAILS = require('../../assets/coin-face-tails.webp');

const COIN_SIZE = 176;
const LIFT_PX = 64;
/** The toss itself. */
export const FLIP_MS = 1300;
/** One more turn in the air, repeated while the app is still loading. */
export const EXTRA_SPIN_MS = 350;
/** Ceiling for flip + waiting: past this the coin fades out, loaded or not. */
export const MAX_HOLD_MS = 2000;
export const FADE_MS = 200;
/** Start anyway if the coin art has not reported in by then. */
const ART_TIMEOUT_MS = 300;
/** The sound waits for the persisted "splash sound" setting, but not for long. */
const SOUND_GRACE_MS = 400;
/** Still coin, shown instead of the toss when the OS asks for reduced motion. */
const STILL_MS = 700;

/** Half-turns the toss can cover: the longest landing plus the extra spins. */
const MAX_HALF_TURNS = 16;
const SAMPLES = 24;
const EPSILON = 0.001;

const sample = (fn: (p: number) => number) =>
  Array.from({ length: SAMPLES + 1 }, (_, i) => fn(i / SAMPLES));
const PROGRESS = sample((p) => p);
/** Height of the toss: up and back down. */
const ARC = sample((p) => 4 * p * (1 - p));
/** Spin: fast off the thumb, slowing into the landing. */
const easeOut = (p: number) => 1 - (1 - p) * (1 - p);

/**
 * Opacity of one face as a step function of the half-turns travelled. Heads
 * faces the viewer on even half-turns, and the faces swap whenever the coin is
 * edge-on (0.5, 1.5, 2.5, …).
 */
export function faceVisibility(face: 'heads' | 'tails', maxHalfTurns = MAX_HALF_TURNS) {
  const inputRange = [0];
  const outputRange = [face === 'heads' ? 1 : 0];
  for (let k = 0; k < maxHalfTurns; k++) {
    const headsBefore = k % 2 === 0;
    inputRange.push(k + 0.5, k + 0.5 + EPSILON);
    outputRange.push(
      (face === 'heads') === headsBefore ? 1 : 0,
      (face === 'heads') === headsBefore ? 0 : 1,
    );
  }
  inputRange.push(maxHalfTurns);
  outputRange.push(outputRange[outputRange.length - 1]!);
  return { inputRange, outputRange };
}

interface Props {
  /** The app underneath is loaded and can be revealed. */
  ready: boolean;
  /** The coin has faded out; unmount it. */
  onDone: () => void;
}

export function CoinSplash({ ready, onDone }: Props) {
  /** Odd half-turns land on tails. */
  const [landing] = useState(() => (Math.random() < 0.5 ? 6 : 7));
  const [toss] = useState(() => new Animated.Value(0)); // 0 → 1 over FLIP_MS
  const [extra] = useState(() => new Animated.Value(0)); // half-turns added while waiting
  const [fade] = useState(() => new Animated.Value(1));
  const [artShown, setArtShown] = useState(false);

  const readyRef = useRef(ready);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    readyRef.current = ready;
    onDoneRef.current = onDone;
  }, [ready, onDone]);

  useEffect(() => {
    const timer = setTimeout(() => setArtShown(true), ART_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!artShown) return;
    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const startedAt = Date.now();
    // The coin is on screen: hand over from the native splash.
    void SplashScreen.hideAsync().catch(() => undefined);

    const playSound = () => {
      if (!cancelled && useSettings.getState().splashSound) void playCoinSound();
    };
    let stopWaitingForSettings: (() => void) | undefined;
    if (useSettings.persist.hasHydrated()) playSound();
    else {
      stopWaitingForSettings = useSettings.persist.onFinishHydration(() => {
        if (Date.now() - startedAt < SOUND_GRACE_MS) playSound();
      });
    }

    // Steps are sequenced with timers rather than animation callbacks: the
    // animations themselves run on the UI thread and need no JS in between.
    const after = (ms: number, step: () => void) => {
      timers.push(
        setTimeout(() => {
          if (!cancelled) step();
        }, ms),
      );
    };
    const leave = () => {
      Animated.timing(fade, { toValue: 0, duration: FADE_MS, useNativeDriver: true }).start();
      after(FADE_MS, () => onDoneRef.current());
    };
    /** After the toss: leave if the app is ready or time is up, else stay in the air. */
    const settle = (spin: boolean, extraTurns = 0) => {
      if (readyRef.current || Date.now() - startedAt + EXTRA_SPIN_MS > MAX_HOLD_MS) {
        leave();
        return;
      }
      if (spin) {
        Animated.timing(extra, {
          toValue: extraTurns + 2,
          duration: EXTRA_SPIN_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }).start();
      }
      after(EXTRA_SPIN_MS, () => settle(spin, extraTurns + 2));
    };

    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) {
          after(STILL_MS, () => settle(false));
          return;
        }
        Animated.timing(toss, {
          toValue: 1,
          duration: FLIP_MS,
          easing: Easing.linear,
          useNativeDriver: true,
        }).start();
        after(FLIP_MS, () => settle(true));
      });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      stopWaitingForSettings?.();
      toss.stopAnimation();
      extra.stopAnimation();
      fade.stopAnimation();
    };
  }, [artShown, toss, extra, fade]);

  const halfTurns = Animated.add(
    toss.interpolate({
      inputRange: PROGRESS,
      outputRange: sample((p) => landing * easeOut(p)),
    }),
    extra,
  );
  const rotateY = halfTurns.interpolate({
    inputRange: [0, MAX_HALF_TURNS],
    outputRange: ['0deg', `${MAX_HALF_TURNS * 180}deg`],
  });
  const translateY = toss.interpolate({
    inputRange: PROGRESS,
    outputRange: ARC.map((a) => -LIFT_PX * a),
  });
  const scale = toss.interpolate({
    inputRange: PROGRESS,
    outputRange: ARC.map((a) => 1 + 0.2 * a),
  });

  return (
    <Animated.View
      testID="coin-splash"
      // Decorative, and it swallows touches until the app is revealed.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: fade }]}
    >
      <View style={styles.stage}>
        <Animated.View
          style={[
            styles.coin,
            { transform: [{ perspective: 900 }, { translateY }, { scale }, { rotateY }] },
          ]}
        >
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              { opacity: halfTurns.interpolate(faceVisibility('heads')) },
            ]}
          >
            <Image
              source={HEADS}
              style={styles.face}
              contentFit="contain"
              priority="high"
              onDisplay={() => setArtShown(true)}
            />
          </Animated.View>
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              // Mirrored, so tails reads the right way round once the coin has turned over.
              {
                opacity: halfTurns.interpolate(faceVisibility('tails')),
                transform: [{ scaleX: -1 }],
              },
            ]}
          >
            <Image source={TAILS} style={styles.face} contentFit="contain" priority="high" />
          </Animated.View>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    zIndex: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: brand.navy,
  },
  // Coins are not mirrored in RTL.
  stage: { direction: 'ltr', alignItems: 'center' },
  coin: { width: COIN_SIZE, height: COIN_SIZE },
  face: { flex: 1 },
});
