/**
 * Easter egg: four quick taps on the version number in Settings open this
 * full-page coin. Every tap tosses it (and rings); a tap while it is in the air
 * bats it again. Like the website's coin (site/assets/coin.js) it lands on a
 * random face, and about one toss in six on its rim, where it teeters for a
 * moment before making up its mind.
 */
import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { faceVisibility } from '@/components/CoinSplash';
import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { playCoinTing, releaseCoinTing } from '@/player/coinTing';
import { space } from '@/theme';

const HEADS = require('../../assets/coin-face-heads.webp');
const TAILS = require('../../assets/coin-face-tails.webp');

const NAVY = '#070C3B';
const INK = '#F3EFE6';
const SILVER = '#B9BEC9';

const COIN_SIZE = 240;
const LIFT_PX = 120;
export const FLIP_MS = 1100;
/** How long the coin teeters on its rim, and how long it takes to fall off it. */
export const EDGE_WAIT_MS = 1600;
export const TIP_MS = 450;
export const EDGE_CHANCE = 1 / 6;
/** Every toss turns the coin over at least this many times. */
const MIN_HALF_TURNS = 5;
/** The spin is kept below this by rewinding whole turns before each toss. */
const MAX_HALF_TURNS = 16;
/** The rim shows while the coin is this close (in half-turns) to edge-on. */
const RIM_WINDOW = 0.045;
const EPSILON = 0.001;

export type Outcome = 'heads' | 'tails' | 'edge';
type Face = Exclude<Outcome, 'edge'>;

export function pickOutcome(random: () => number = Math.random): Outcome {
  if (random() < EDGE_CHANCE) return 'edge';
  return random() < 0.5 ? 'heads' : 'tails';
}

/**
 * Where a toss starting at `from` half-turns comes down: heads faces the viewer
 * on even half-turns, tails on odd ones, and the coin is edge-on halfway between.
 */
export function landingFor(from: number, outcome: Outcome): number {
  const min = Math.ceil(from + MIN_HALF_TURNS);
  if (outcome === 'edge') return min + 0.5;
  const odd = min % 2 === 1;
  return odd === (outcome === 'tails') ? min : min + 1;
}

/** Opacity of the rim: a step up around every edge-on position (0.5, 1.5, …). */
function rimVisibility() {
  const inputRange = [0];
  const outputRange = [0];
  for (let k = 0; k < MAX_HALF_TURNS; k++) {
    const at = k + 0.5;
    inputRange.push(
      at - RIM_WINDOW,
      at - RIM_WINDOW + EPSILON,
      at + RIM_WINDOW,
      at + RIM_WINDOW + EPSILON,
    );
    outputRange.push(0, 1, 1, 0);
  }
  inputRange.push(MAX_HALF_TURNS);
  outputRange.push(0);
  return { inputRange, outputRange };
}

const easeOut = (p: number) => 1 - (1 - p) * (1 - p);
const easeIn = (p: number) => p * p;

/** One move of the coin, kept so its position can be worked out at any moment. */
interface Spin {
  from: number;
  to: number;
  startedAt: number;
  duration: number;
  ease: (p: number) => number;
}

/** Half-turns the coin has reached `now`, part-way through (or after) a spin. */
export function spinPosition(spin: Spin, now: number): number {
  const p =
    spin.duration > 0 ? Math.min(1, Math.max(0, (now - spin.startedAt) / spin.duration)) : 1;
  return spin.from + (spin.to - spin.from) * spin.ease(p);
}

const HEADS_VISIBILITY = faceVisibility('heads', MAX_HALF_TURNS);
const TAILS_VISIBILITY = faceVisibility('tails', MAX_HALF_TURNS);
const RIM_VISIBILITY = rimVisibility();

export default function CoinFlip() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const [halfTurns] = useState(() => new Animated.Value(0));
  const [height] = useState(() => new Animated.Value(0)); // 0 on the table, 1 at the top of the toss
  const [teeter] = useState(() => new Animated.Value(0)); // -1…1 while balancing on the rim
  const [result, setResult] = useState<Outcome | null>(null);
  const reduceMotion = useRef(false);
  /** Each tap starts a new toss; a finished animation of an older one is ignored. */
  const tossId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const spin = useRef<Spin>({ from: 0, to: 0, startedAt: 0, duration: 0, ease: easeOut });

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        if (mounted) reduceMotion.current = on;
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
      tossId.current += 1;
      clearTimeout(timer.current);
      halfTurns.stopAnimation();
      height.stopAnimation();
      teeter.stopAnimation();
      releaseCoinTing();
    };
  }, [halfTurns, height, teeter]);

  const toss = useCallback(() => {
    const id = ++tossId.current;
    const current = () => id === tossId.current;
    clearTimeout(timer.current);
    playCoinTing();
    setResult(null);
    teeter.stopAnimation();
    teeter.setValue(0);

    const outcome = pickOutcome();

    /** Off the rim, onto whichever face is nearer the way it leans. */
    const tip = (from: number) => {
      const face: Face = Math.random() < 0.5 ? 'heads' : 'tails';
      const down = Math.floor(from);
      const to = (down % 2 === 1) === (face === 'tails') ? down : down + 1;
      teeter.stopAnimation();
      spin.current = { from, to, startedAt: Date.now(), duration: TIP_MS, ease: easeIn };
      Animated.parallel([
        Animated.timing(teeter, { toValue: 0, duration: TIP_MS / 2, useNativeDriver: true }),
        Animated.timing(halfTurns, {
          toValue: to,
          duration: TIP_MS,
          easing: easeIn,
          useNativeDriver: true,
        }),
      ]).start();
      timer.current = setTimeout(() => {
        if (current()) setResult(face);
      }, TIP_MS);
    };

    const land = (at: number) => {
      if (!current()) return;
      setResult(outcome);
      if (outcome !== 'edge') return;
      Animated.loop(
        Animated.sequence([
          Animated.timing(teeter, { toValue: 1, duration: 260, useNativeDriver: true }),
          Animated.timing(teeter, { toValue: -1, duration: 520, useNativeDriver: true }),
          Animated.timing(teeter, { toValue: 0, duration: 260, useNativeDriver: true }),
        ]),
      ).start();
      timer.current = setTimeout(() => {
        if (current()) tip(at);
      }, EDGE_WAIT_MS);
    };

    // Pick up the coin wherever it is (mid-air included). Its position is worked
    // out here rather than read back from the native driver, which answers late.
    // Whole turns are dropped, which looks the same and keeps the spin within range.
    const now = Date.now();
    const from = ((spinPosition(spin.current, now) % 2) + 2) % 2;
    const to = landingFor(from, outcome);
    halfTurns.stopAnimation();
    if (reduceMotion.current) {
      spin.current = { from: to, to, startedAt: now, duration: 0, ease: easeOut };
      halfTurns.setValue(to);
      land(to);
      return;
    }
    spin.current = { from, to, startedAt: now, duration: FLIP_MS, ease: easeOut };
    halfTurns.setValue(from);
    height.stopAnimation();
    Animated.sequence([
      Animated.timing(height, {
        toValue: 1,
        duration: FLIP_MS / 2,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
      Animated.timing(height, {
        toValue: 0,
        duration: FLIP_MS / 2,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
    Animated.timing(halfTurns, {
      toValue: to,
      duration: FLIP_MS,
      easing: easeOut,
      useNativeDriver: true,
    }).start();
    // Sequenced with a timer, like the launch coin: the animation itself runs on the UI thread.
    timer.current = setTimeout(() => land(to), FLIP_MS);
  }, [halfTurns, height, teeter]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const rotateX = halfTurns.interpolate({
    inputRange: [0, MAX_HALF_TURNS],
    outputRange: ['0deg', `${MAX_HALF_TURNS * 180}deg`],
  });
  const translateY = height.interpolate({ inputRange: [0, 1], outputRange: [0, -LIFT_PX] });
  const scale = height.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const rotateZ = teeter.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] });

  const caption =
    result === 'heads'
      ? t('coinHeads')
      : result === 'tails'
        ? t('coinTails')
        : result === 'edge'
          ? t('coinEdge')
          : t('coinHint');

  return (
    <View
      testID="coinflip-screen"
      style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom + space.xl }]}
    >
      <StatusBar style="light" />
      <View style={styles.header}>
        <Pressable
          testID="coinflip-close"
          accessibilityRole="button"
          accessibilityLabel={t('close')}
          hitSlop={12}
          onPress={close}
          style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}
        >
          <Feather name="chevron-down" size={26} color={INK} />
        </Pressable>
      </View>

      <Pressable
        testID="coinflip-coin"
        accessibilityRole="button"
        accessibilityLabel={t('coinHint')}
        onPress={toss}
        style={styles.stage}
      >
        <Animated.View
          style={[styles.coin, { transform: [{ translateY }, { scale }, { rotateZ }] }]}
        >
          <Animated.View
            style={[StyleSheet.absoluteFill, { transform: [{ perspective: 900 }, { rotateX }] }]}
          >
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                { opacity: halfTurns.interpolate(HEADS_VISIBILITY) },
              ]}
            >
              <Image source={HEADS} style={styles.face} contentFit="contain" priority="high" />
            </Animated.View>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                // Upside down, so tails reads the right way up once the coin has turned over.
                {
                  opacity: halfTurns.interpolate(TAILS_VISIBILITY),
                  transform: [{ scaleY: -1 }],
                },
              ]}
            >
              <Image source={TAILS} style={styles.face} contentFit="contain" priority="high" />
            </Animated.View>
          </Animated.View>
          {/* The flat faces vanish edge-on; this is the coin's rim, seen from the side. */}
          <Animated.View
            pointerEvents="none"
            style={[styles.rim, { opacity: halfTurns.interpolate(RIM_VISIBILITY) }]}
          />
        </Animated.View>
      </Pressable>

      <Text
        testID="coinflip-caption"
        variant="heading"
        align="center"
        accessibilityLiveRegion="polite"
        style={styles.caption}
      >
        {caption}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NAVY },
  header: { flexDirection: 'row', paddingHorizontal: space.sm },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  // Coins are not mirrored in RTL.
  stage: { flex: 1, direction: 'ltr', alignItems: 'center', justifyContent: 'center' },
  coin: { width: COIN_SIZE, height: COIN_SIZE, alignItems: 'center', justifyContent: 'center' },
  face: { flex: 1 },
  rim: {
    width: COIN_SIZE * 0.96,
    height: 14,
    borderRadius: 7,
    backgroundColor: SILVER,
    borderTopWidth: 2,
    borderTopColor: '#E6E9F0',
    borderBottomWidth: 3,
    borderBottomColor: '#7E8492',
  },
  caption: { color: INK, minHeight: 32, paddingHorizontal: space.lg },
});
