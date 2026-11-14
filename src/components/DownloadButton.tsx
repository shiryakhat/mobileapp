import { Alert } from 'react-native';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import {
  deleteDownload,
  pauseDownload,
  resumeDownload,
  startDownload,
  useDownloads,
} from '@/state/downloads';
import { IconButton } from './ui';

/** One button, four states: download → pause → resume → downloaded (tap to delete). */
export function DownloadButton({ episode }: { episode: Episode }) {
  const { t } = useI18n();
  const item = useDownloads((s) => s.items[episode.id]);
  if (!episode.audioUrl) return null;

  switch (item?.status) {
    case 'downloading':
      return (
        <IconButton
          icon="pause-circle"
          color="accent"
          label={t('downloading')}
          onPress={() => void pauseDownload(episode.id)}
        />
      );
    case 'paused':
      return (
        <IconButton
          icon="play-circle"
          color="accent"
          label={t('resume')}
          onPress={() => resumeDownload(episode)}
        />
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
