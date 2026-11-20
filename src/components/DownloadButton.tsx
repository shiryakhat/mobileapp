import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import {
  deleteDownload,
  downloadKind,
  downloadKindsFor,
  pauseDownload,
  resumeDownload,
  startDownload,
  toBytes,
  useDownloads,
  type DownloadItem,
  type DownloadKind,
} from '@/state/downloads';
import { brand, dark, HIT_SLOP, radius, space, useTheme } from '@/theme';
import { Icon, IconButton, ProgressRing, Sheet, Text, type IconName } from './ui';

/** Same footprint as an <IconButton/>, so the control does not jump between states. */
const BOX = 40;

/** Share of the file on disk, 0–1 (0 until the server has announced the size). */
export const downloadFraction = (item: Pick<DownloadItem, 'bytesWritten' | 'totalBytes'>) => {
  // Coerced on the way in: this runs during render, where a stray BigInt (what
  // the native progress event carries) would throw and take the screen down.
  const written = toBytes(item.bytesWritten);
  const total = toBytes(item.totalBytes);
  return total > 0 ? Math.min(1, written / total) : 0;
};

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

const KIND_ICON: Record<DownloadKind, IconName> = { audio: 'headphones', video: 'film' };

/** One row of the chooser: what you get, and what it costs in space. */
function KindOption({ kind, onPress }: { kind: DownloadKind; onPress: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <Pressable
      testID={`download-${kind}`}
      accessibilityRole="button"
      accessibilityLabel={t(kind)}
      accessibilityHint={t(kind === 'video' ? 'downloadVideoHint' : 'downloadAudioHint')}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: theme.raised,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Icon name={KIND_ICON[kind]} size={20} color="accent" />
      <View style={{ flex: 1, gap: 2 }}>
        <Text weight="medium">{t(kind)}</Text>
        <Text variant="small" color="muted">
          {t(kind === 'video' ? 'downloadVideoHint' : 'downloadAudioHint')}
        </Text>
      </View>
      <Icon name="download" size={18} color="muted" />
    </Pressable>
  );
}

/**
 * One button, four states: download → pause → resume → downloaded (tap to delete).
 *
 * Starting a download asks "Audio or Video?" in a bottom sheet when the episode
 * has both (an archive.org mp4 next to its audio); with a single kind on offer
 * it just starts, as it always did.
 */
export function DownloadButton({ episode }: { episode: Episode }) {
  const { t } = useI18n();
  const item = useDownloads((s) => s.items[episode.id]);
  const [choosing, setChoosing] = useState(false);
  // Downloadable as audio (the RSS enclosure, or the archive.org mp3 fallback
  // the talk specials have) and / or as video (the archive.org mp4).
  const kinds = downloadKindsFor(episode);
  if (kinds.length === 0) return null;
  const kind = downloadKind(item);

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
          // The kind on disk is told apart at a glance: a film strip for video.
          icon={kind === 'video' ? 'film' : 'check-circle'}
          color="success"
          testID={`downloaded-${kind}`}
          label={t(kind === 'video' ? 'downloadedVideo' : 'downloadedAudio')}
          onPress={() =>
            Alert.alert(t(kind === 'video' ? 'downloadedVideo' : 'downloadedAudio'), undefined, [
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
        <>
          <IconButton
            testID="download-button"
            icon="download"
            label={t(kinds.length === 1 && kinds[0] === 'audio' ? 'download' : 'downloadEpisode')}
            onPress={() => {
              if (kinds.length > 1) setChoosing(true);
              else startDownload(episode, kinds[0]);
            }}
          />
          {kinds.length > 1 ? (
            <Sheet visible={choosing} onClose={() => setChoosing(false)}>
              <Text variant="title">{t('downloadChoose')}</Text>
              {kinds.map((k) => (
                <KindOption
                  key={k}
                  kind={k}
                  onPress={() => {
                    setChoosing(false);
                    startDownload(episode, k);
                  }}
                />
              ))}
            </Sheet>
          ) : null}
        </>
      );
  }
}
