import { Pressable, View } from 'react-native';
import { chapterIndexAt, type Episode } from '@/content';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';
import { hasPersian } from '@/lib/text';
import { usePlayback } from '@/player/store';
import { radius, space, useTheme } from '@/theme';
import { EmptyState, Text } from './ui';

interface Props {
  episode: Episode;
  onSeek: (sec: number) => void;
}

/** Chapter markers (from YouTube chapters); tap to seek. */
export function ChapterList({ episode, onSeek }: Props) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const active = usePlayback((s) =>
    s.episodeId === episode.id ? chapterIndexAt(episode, s.positionSec) : -1,
  );
  if (episode.chapters.length === 0) return <EmptyState icon="list" text={t('noChapters')} />;
  return (
    <View style={{ padding: space.md, gap: 2 }}>
      {episode.chapters.map((c, i) => {
        const isActive = i === active;
        return (
          <Pressable
            key={c.startSec}
            testID={`chapter-${i}`}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            onPress={() => onSeek(c.startSec)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              paddingVertical: space.md,
              paddingHorizontal: space.md,
              borderRadius: radius.md,
              backgroundColor: isActive
                ? theme.accentSoft
                : pressed
                  ? theme.surface
                  : 'transparent',
            })}
          >
            <Text
              variant="small"
              weight="medium"
              color={isActive ? 'accent' : 'muted'}
              dir="ltr"
              align="center"
              style={{ width: 62, fontVariant: ['tabular-nums'] }}
            >
              {formatTime(c.startSec, locale)}
            </Text>
            {/* Chapter titles are authored in Persian; talks given in English keep English ones. */}
            <Text
              style={{ flex: 1 }}
              weight={isActive ? 'medium' : 'regular'}
              dir={hasPersian(c.title) ? 'rtl' : 'ltr'}
              align="start"
            >
              {c.title}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
