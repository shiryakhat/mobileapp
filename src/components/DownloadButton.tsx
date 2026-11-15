import Feather from '@expo/vector-icons/Feather';
import { Alert, Pressable } from 'react-native';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import {
  deleteDownload,
  pauseDownload,
  resumeDownload,
  startDownload,
  useDownloads,
  type DownloadItem,
} from '@/state/downloads';
import { brand, dark, HIT_SLOP } from '@/theme';
import { IconButton, ProgressRing } from './ui';

/** Same footprint as an <IconButton/>, so the control does not jump between states. */
const BOX = 40;

/** Share of the file on disk, 0–1 (0 until the server has announced the size). */
export const downloadFraction = (item: Pick<DownloadItem, 'bytesWritten' | 'totalBytes'>) =>
  item.totalBytes > 0 ? Math.min(1, Math.max(0, item.bytesWritten / item.totalBytes)) : 0;

/**
 * A download in flight: the round icon with its live progress as a ring around
 * it. Brand colours in both themes (gold arc on a navy disc, like the logo),
 * so they come from the dark palette directly. Paused keeps the arc where it
 * stopped, dimmed.
 */
function DownloadRing({
  item,
  label,
  onPress,
}: {
  item: DownloadItem;
  label: string;
  onPress: () => void;
}) {
  const paused = item.status === 'paused';
  const fraction = downloadFraction(item);
  return (
    <Pressable
      testID="download-progress"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(fraction * 100) }}
      hitSlop={HIT_SLOP}
      onPress={onPress}
      style={({ pressed }) => ({
        width: BOX,
        height: BOX,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <ProgressRing
        value={fraction}
        color={paused ? dark.muted : dark.accent}
        trackColor={dark.accentSoft}
        fill={brand.navy}
      >
        <Feather name={paused ? 'play' : 'pause'} size={13} color={dark.accent} />
      </ProgressRing>
    </Pressable>
  );
}

/** One button, four states: download → pause → resume → downloaded (tap to delete). */
export function DownloadButton({ episode }: { episode: Episode }) {
  const { t } = useI18n();
  const item = useDownloads((s) => s.items[episode.id]);
  if (!episode.audioUrl) return null;

  switch (item?.status) {
    case 'downloading':
      return (
        <DownloadRing
          item={item}
          label={t('downloading')}
          onPress={() => void pauseDownload(episode.id)}
        />
      );
    case 'paused':
      return (
        <DownloadRing item={item} label={t('resume')} onPress={() => resumeDownload(episode)} />
      );
    case 'error':
      return (
        <IconButton
          icon="alert-circle"
          color="danger"
          label={t('retry')}
          onPress={() => startDownload(episode)}
        />
      );
    case 'done':
      return (
        <IconButton
          icon="check-circle"
          color="success"
          label={t('downloaded')}
          onPress={() =>
            Alert.alert(t('downloaded'), undefined, [
              { text: t('cancel'), style: 'cancel' },
              {
                text: t('delete'),
                style: 'destructive',
                onPress: () => deleteDownload(episode.id),
              },
            ])
          }
        />
      );
    default:
      return (
        <IconButton
          testID="download-button"
          icon="download"
          label={t('download')}
          onPress={() => startDownload(episode)}
        />
      );
  }
}
