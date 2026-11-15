import { useNavigation } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import { cycleRate, seekTo, setMode, skip, toggle } from '@/player/controller';
import { usePlayback } from '@/player/store';
import { radius, space, useTheme } from '@/theme';
import { Scrubber } from './Scrubber';
import { Icon, IconButton, Segmented, Text } from './ui';

/** Transport for the current episode: scrubber, skip, play/pause, speed, video/audio. */
export function PlayerControls({ episode }: { episode: Episode }) {
  const theme = useTheme();
  const { t, n } = useI18n();
  const positionSec = usePlayback((s) => s.positionSec);
  const durationSec = usePlayback((s) => s.durationSec) || episode.durationSec;
  const playing = usePlayback((s) => s.playing);
  const buffering = usePlayback((s) => s.buffering);
  const rate = usePlayback((s) => s.rate);
  const mode = usePlayback((s) => s.mode);
  const navigation = useNavigation();
  // Suspend the screen's swipe-back while the timeline is being dragged so a
  // horizontal scrub (especially near the left edge) doesn't pop the screen.
  const onScrub = (active: boolean) => {
    try {
      navigation.setOptions({ gestureEnabled: !active });
    } catch {
      /* not inside a stack screen */
    }
  };

  return (
    <View style={{ gap: space.sm, paddingHorizontal: space.lg, paddingTop: space.sm }}>
      <Scrubber
        positionSec={positionSec}
        durationSec={durationSec}
        chapters={episode.chapters}
        onSeek={seekTo}
        onScrub={onScrub}
      />
      {/* Transport order is fixed LTR, like the timeline above it. */}
      <View
        style={{
          direction: 'ltr',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${t('speed')} ${rate}×`}
          onPress={cycleRate}
          style={{
            minWidth: 56,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: theme.raised,
          }}
        >
          <Text variant="small" weight="medium" align="center" dir="ltr">
            {n(rate)}×
          </Text>
        </Pressable>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <IconButton icon="rotate-ccw" label={t('back15')} onPress={() => skip(-15)} />
          <Pressable
            testID="play-toggle"
            accessibilityRole="button"
            accessibilityLabel={playing ? t('pause') : t('play')}
            onPress={toggle}
            style={({ pressed }) => ({
              width: 60,
              height: 60,
              borderRadius: 30,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.accent,
              opacity: pressed ? 0.85 : 1,
            })}
          >
            {buffering && playing ? (
              <ActivityIndicator color={theme.onAccent} />
            ) : (
              <View style={{ marginLeft: playing ? 0 : 3 }}>
                <Icon name={playing ? 'pause' : 'play'} size={26} color="onAccent" />
              </View>
            )}
          </Pressable>
          <IconButton icon="rotate-cw" label={t('forward30')} onPress={() => skip(30)} />
        </View>

        <Segmented
          style={{ width: 112 }}
          value={mode}
          onChange={setMode}
          options={[
            { value: 'audio', label: t('audio') },
            { value: 'video', label: t('video') },
          ]}
        />
      </View>
    </View>
  );
}
