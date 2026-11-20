import { memo } from 'react';
import { Pressable, View } from 'react-native';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import { episodeMeta, formatTime } from '@/lib/format';
import { progressFraction, useProgress } from '@/state/progress';
import { radius, space, useResponsive, useTheme } from '@/theme';
import { CachedImage } from './CachedImage';
import { ProgressBar, Text } from './ui';

interface Props {
  episode: Episode;
  onPress: (episode: Episode) => void;
  /** Large lead card (latest episode). */
  hero?: boolean;
}

function Thumb({ episode, width }: { episode: Episode; width: number | '100%' }) {
  const theme = useTheme();
  const { locale } = useI18n();
  return (
    <View
      style={{
        width,
        aspectRatio: 16 / 9,
        borderRadius: radius.md,
        overflow: 'hidden',
        backgroundColor: theme.raised,
      }}
    >
      <CachedImage
        uri={episode.youtubeThumb}
        style={{ flex: 1 }}
        contentFit="cover"
        transition={200}
        recyclingKey={episode.id}
      />
      <View
        style={{
          position: 'absolute',
          bottom: 6,
          end: 6,
          paddingHorizontal: 6,
          borderRadius: 6,
          backgroundColor: 'rgba(0,0,0,0.72)',
        }}
      >
        <Text variant="micro" weight="medium" style={{ color: '#fff' }}>
          {formatTime(episode.durationSec, locale)}
        </Text>
      </View>
    </View>
  );
}

export const EpisodeCard = memo(function EpisodeCard({ episode, onPress, hero }: Props) {
  const { pick, other, locale, isRTL } = useI18n();
  const { sizeScale } = useResponsive();
  const progress = useProgress((s) => s.byEpisode[episode.id]);
  const fraction = progressFraction(progress);
  const primary = pick(episode.titleFa, episode.titleEn);
  const secondary = other(episode.titleFa, episode.titleEn);
  const meta = episodeMeta(episode, locale);

  const titles = (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="micro" weight="medium" color="accent">
        {meta}
      </Text>
      <Text
        variant={hero ? 'title' : 'body'}
        weight={hero ? 'bold' : 'medium'}
        numberOfLines={hero ? 3 : 2}
      >
        {primary}
      </Text>
      {secondary && secondary !== primary ? (
        // The other language keeps its own paragraph direction but aligns with the UI edge.
        <Text
          variant="small"
          color="muted"
          numberOfLines={1}
          dir={isRTL ? 'ltr' : 'rtl'}
          align="end"
        >
          {secondary}
        </Text>
      ) : null}
      {fraction > 0.01 ? (
        <View style={{ marginTop: space.sm }}>
          <ProgressBar value={fraction} />
        </View>
      ) : null}
    </View>
  );

  return (
    <Pressable
      testID={`episode-card-${episode.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${primary}, ${episode.code}`}
      onPress={() => onPress(episode)}
      style={({ pressed }) => ({
        flexDirection: hero ? 'column' : 'row',
        gap: hero ? space.md : space.md,
        paddingHorizontal: space.lg,
        paddingVertical: hero ? space.md : space.sm + 2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Thumb episode={episode} width={hero ? '100%' : Math.round(132 * sizeScale)} />
      {titles}
    </Pressable>
  );
});
