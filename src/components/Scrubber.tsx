import { useRef, useState, type ComponentRef } from 'react';
import { View, type GestureResponderEvent } from 'react-native';
import type { Chapter } from '@/content';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';
import { useTheme } from '@/theme';
import { Text } from './ui';

interface Props {
  positionSec: number;
  durationSec: number;
  chapters?: Chapter[];
  onSeek: (sec: number) => void;
}

const TRACK = 4;
const THUMB = 14;

/**
 * Playback timeline. Deliberately NOT mirrored in RTL: media timelines run
 * left-to-right in every locale (as on iOS/Android system players).
 */
export function Scrubber({ positionSec, durationSec, chapters = [], onSeek }: Props) {
  const theme = useTheme();
  const { locale, t } = useI18n();
  const trackRef = useRef<ComponentRef<typeof View>>(null);
  const geometry = useRef({ x: 0, width: 1 });
  const [dragSec, setDragSec] = useState<number | null>(null);

  const secAt = (e: GestureResponderEvent) => {
    const { x, width } = geometry.current;
    const f = Math.min(1, Math.max(0, (e.nativeEvent.pageX - x) / width));
    return f * durationSec;
  };

  const shown = dragSec ?? positionSec;
  const fraction = durationSec > 0 ? Math.min(1, shown / durationSec) : 0;

  return (
    <View style={{ direction: 'ltr' }}>
      <View
        ref={trackRef}
        accessibilityRole="adjustable"
        accessibilityLabel={t('seekHere')}
        accessibilityValue={{ min: 0, max: Math.round(durationSec), now: Math.round(shown) }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) =>
          onSeek(positionSec + (e.nativeEvent.actionName === 'increment' ? 30 : -15))
        }
        onStartShouldSetResponder={() => durationSec > 0}
        onMoveShouldSetResponder={() => durationSec > 0}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          const pageX = e.nativeEvent.pageX;
          trackRef.current?.measureInWindow((x, _y, width) => {
            geometry.current = { x, width: Math.max(1, width) };
            const f = Math.min(1, Math.max(0, (pageX - x) / Math.max(1, width)));
            setDragSec(f * durationSec);
          });
        }}
        onResponderMove={(e) => setDragSec(secAt(e))}
        onResponderRelease={(e) => {
          onSeek(secAt(e));
          setDragSec(null);
        }}
        onResponderTerminate={() => setDragSec(null)}
        style={{ height: 28, justifyContent: 'center' }}
      >
        <View style={{ height: TRACK, borderRadius: TRACK, backgroundColor: theme.line }}>
          <View
            style={{
              width: `${fraction * 100}%`,
              height: TRACK,
              borderRadius: TRACK,
              backgroundColor: theme.accent,
            }}
          />
          {durationSec > 0
            ? chapters.slice(1).map((c) => (
                <View
                  key={c.startSec}
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: `${(c.startSec / durationSec) * 100}%`,
                    width: 2,
                    height: TRACK,
                    backgroundColor: theme.bg,
                  }}
                />
              ))
            : null}
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${fraction * 100}%`,
            marginLeft: -THUMB / 2,
            width: THUMB,
            height: THUMB,
            borderRadius: THUMB / 2,
            backgroundColor: theme.accent,
            transform: [{ scale: dragSec === null ? 1 : 1.35 }],
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="micro" color="muted" dir="ltr">
          {formatTime(shown, locale)}
        </Text>
        <Text variant="micro" color="muted" dir="ltr" align="end">
          {formatTime(durationSec, locale)}
        </Text>
      </View>
    </View>
  );
}
