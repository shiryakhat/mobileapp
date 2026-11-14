import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { getEpisode } from '@/content';
import { useI18n } from '@/i18n';
import { stop, toggle } from '@/player/controller';
import { usePlayback } from '@/player/store';
import { radius, space, useTheme } from '@/theme';
import { IconButton, ProgressBar, Text } from './ui';

/** Persistent now-playing bar above the tab bar (native audio engine only). */
export function MiniPlayer() {
  const theme = useTheme();
  const { pick, t } = useI18n();
  const episodeId = usePlayback((s) => s.episodeId);
  const engine = usePlayback((s) => s.engine);
  const playing = usePlayback((s) => s.playing);
  const fraction = usePlayback((s) => (s.durationSec > 0 ? s.positionSec / s.durationSec : 0));
  const episode = getEpisode(episodeId);
  if (!episode || engine !== 'native') return null;

  return (
    <Pressable
      testID="mini-player"
      accessibilityRole="button"
      accessibilityLabel={pick(episode.titleFa, episode.titleEn)}
      onPress={() => router.push({ pathname: '/episode/[id]', params: { id: episode.id } })}
      style={{
        marginHorizontal: space.md,
        marginBottom: space.sm,
        borderRadius: radius.md,
        backgroundColor: theme.raised,
        overflow: 'hidden',
      }}
    >
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.sm }}
      >
        <Image
          source={{ uri: episode.youtubeThumb }}
          style={{ width: 64, height: 36, borderRadius: 6, backgroundColor: theme.line }}
          contentFit="cover"
        />
        <View style={{ flex: 1 }}>
          <Text variant="small" weight="medium" numberOfLines={1}>
            {pick(episode.titleFa, episode.titleEn)}
          </Text>
          <Text variant="micro" color="muted" numberOfLines={1}>
            {episode.code}
          </Text>
        </View>
        <IconButton
          icon={playing ? 'pause' : 'play'}
          label={playing ? t('pause') : t('play')}
          onPress={toggle}
        />
        <IconButton icon="x" label={t('close')} color="muted" onPress={stop} />
      </View>
      {/* Timeline: LTR in every locale. */}
      <View style={{ direction: 'ltr' }}>
        <ProgressBar value={fraction} height={2} />
      </View>
    </Pressable>
  );
}
