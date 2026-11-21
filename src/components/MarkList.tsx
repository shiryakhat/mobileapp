import { Pressable, View } from 'react-native';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';
import { hasPersian } from '@/lib/text';
import { useBookmarks, type Mark } from '@/state/bookmarks';
import { radius, space, useTheme } from '@/theme';
import { IconButton, Text } from './ui';

interface Props {
  marks: Mark[];
  onSeek: (sec: number) => void;
}

/** An episode's bookmarked moments in playback order: tap to jump there, bin to remove. */
export function MarkList({ marks, onSeek }: Props) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  return (
    <View style={{ gap: 2 }}>
      {marks.map((mark) => (
        <Pressable
          key={mark.id}
          testID={`mark-${mark.id}`}
          accessibilityRole="button"
          onPress={() => onSeek(mark.timeSec)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingVertical: space.xs,
            paddingStart: space.md,
            borderRadius: radius.md,
            backgroundColor: pressed ? theme.raised : 'transparent',
          })}
        >
          <Text
            variant="small"
            weight="medium"
            color="accent"
            dir="ltr"
            align="center"
            style={{ width: 62, fontVariant: ['tabular-nums'] }}
          >
            {formatTime(mark.timeSec, locale)}
          </Text>
          {mark.note ? (
            <Text
              style={{ flex: 1 }}
              variant="small"
              numberOfLines={3}
              dir={hasPersian(mark.note) ? 'rtl' : 'ltr'}
              align="start"
            >
              {mark.note}
            </Text>
          ) : (
            <Text style={{ flex: 1 }} variant="small" color="faint">
              {t('bookmarked')}
            </Text>
          )}
          <IconButton
            testID={`mark-delete-${mark.id}`}
            icon="trash-2"
            color="muted"
            size={18}
            label={t('removeBookmark')}
            onPress={() => useBookmarks.getState().remove(mark.id)}
          />
        </Pressable>
      ))}
    </View>
  );
}
