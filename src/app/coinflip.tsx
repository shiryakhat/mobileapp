/**
 * Easter egg: four quick taps on the version number in Settings open this
 * full-page coin. It is the website's coin (site/assets/coin.js): the same 3D
 * piece on the same navy, shown in a WebView from a page bundled with the app
 * (src/coinflip/). Every tap tosses it, with a coin-toss sound; a tap while it
 * is in the air bats it again. About one toss in six lands on its rim, where it
 * teeters under the website's caption: «شیر یا خط؟ تصمیم با شماست».
 */
import Feather from '@expo/vector-icons/Feather';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CoinStage } from '@/coinflip/CoinStage';
import type { CoinEvent, CoinFace, CoinStageHandle } from '@/coinflip/page';
import { Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { playCoinTing, releaseCoinTing } from '@/player/coinTing';
import { space } from '@/theme';

// The coin keeps its own colours in both themes, like the website's.
const NAVY = '#070C3B';
const INK = '#F3EFE6';
const MUTED = '#A19D94';
const BRASS = '#E4B54A';

/** The rim caption arrives like the website's: each line rises in, the second a beat later. */
export const MURMUR_MS = 900;
export const MURMUR_DELAY_MS = 700;
const MURMUR_RISE = 5;

/** What the caption under the coin says: the hint, the face it landed on, or the rim. */
type Caption = 'hint' | CoinFace | 'edge';

/** Side of the coin's box on the page: `min(72vw, 22rem, 42vh)` in the template. */
export function coinSize(width: number, height: number): number {
  return Math.min(0.72 * width, 352, 0.42 * height);
}

export default function CoinFlip() {
  const { t, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const stage = useRef<CoinStageHandle>(null);
  const [caption, setCaption] = useState<Caption>('hint');
  /** Reduce motion: unknown until the system has answered, then the page is built for it. */
  const [still, setStill] = useState<boolean | null>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [ask] = useState(() => new Animated.Value(0));
  const [decide] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => mounted && setStill(on))
      .catch(() => mounted && setStill(false));
    return () => {
      mounted = false;
      releaseCoinTing();
    };
  }, []);

  useEffect(() => {
    if (caption !== 'edge') return;
    ask.setValue(0);
    decide.setValue(0);
    const rise = (value: Animated.Value, delay: number) =>
      Animated.timing(value, {
        toValue: 1,
        duration: MURMUR_MS,
        delay,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      });
    const murmur = Animated.parallel([rise(ask, 0), rise(decide, MURMUR_DELAY_MS)]);
    murmur.start();
    return () => murmur.stop();
  }, [caption, ask, decide]);

  const onEvent = useCallback((event: CoinEvent) => {
    if (event.type === 'land') setCaption(event.face);
    else if (event.type === 'edge') setCaption('edge');
    else if (event.type === 'idle') setCaption('hint');
  }, []);

  const toss = (e?: GestureResponderEvent) => {
    playCoinTing();
    // Tossed again off its rim: the question no longer stands.
    setCaption((now) => (now === 'edge' ? 'hint' : now));
    stage.current?.toss(e?.nativeEvent?.locationX);
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  };

  // Just under the coin, as on the website: the page centres the coin in the screen.
  const size = coinSize(box.width, box.height);
  const captionTop = box.height / 2 + size * 0.6;
  const murmur = (value: Animated.Value) => ({
    opacity: value,
    transform: [
      { translateY: value.interpolate({ inputRange: [0, 1], outputRange: [MURMUR_RISE, 0] }) },
    ],
  });

  return (
    <View testID="coinflip-screen" style={styles.screen} onLayout={onLayout}>
      <StatusBar style="light" />
      {still === null ? null : <CoinStage ref={stage} still={still} onEvent={onEvent} />}

      {/* The whole page is the button: the coin itself takes no touches. */}
      <Pressable
        testID="coinflip-coin"
        accessibilityRole="button"
        accessibilityLabel={t('coinHint')}
        onPress={toss}
        style={StyleSheet.absoluteFill}
      />

      {box.height > 0 ? (
        <View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[styles.caption, { top: captionTop }]}
        >
          {caption === 'edge' ? (
            <View
              testID="coinflip-undecided"
              style={[styles.undecided, { direction: isRTL ? 'rtl' : 'ltr' }]}
            >
              <Animated.View style={murmur(ask)}>
                <Text align="center" style={styles.note}>
                  {t('coinEdgeAsk')}
                </Text>
              </Animated.View>
              <Animated.View style={murmur(decide)}>
                <Text align="center" style={[styles.note, styles.decide]}>
                  {t('coinEdgeDecide')}
                </Text>
              </Animated.View>
            </View>
          ) : (
            <Text testID="coinflip-caption" align="center" style={styles.note}>
              {caption === 'heads'
                ? t('coinHeads')
                : caption === 'tails'
                  ? t('coinTails')
                  : t('coinHint')}
            </Text>
          )}
        </View>
      ) : null}

      <View pointerEvents="box-none" style={[styles.header, { top: insets.top }]}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: NAVY },
  header: {
    position: 'absolute',
    left: 0,
    right: 0,
    flexDirection: 'row',
    paddingHorizontal: space.sm,
  },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: space.lg,
  },
  // The website's .coin-note: small and muted.
  note: { color: MUTED, fontSize: 14.5, lineHeight: 27 },
  undecided: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    alignItems: 'baseline',
    columnGap: 10,
  },
  decide: { color: BRASS },
});
