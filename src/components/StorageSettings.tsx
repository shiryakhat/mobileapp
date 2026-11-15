import { useMemo, useReducer, useState } from 'react';
import { Alert, View } from 'react-native';
import { useI18n } from '@/i18n';
import { cacheBytes, clearCache } from '@/lib/cache';
import { formatBytes, joinMeta } from '@/lib/format';
import { deleteAllDownloads, downloadsBytes, useDownloads } from '@/state/downloads';
import { space } from '@/theme';
import { Button, Text } from './ui';

const measure = () => ({ cache: cacheBytes(), downloads: downloadsBytes() });

/**
 * Settings → Storage. Two kinds of data, kept visibly apart:
 *  - the cache (thumbnails, fetched lists): derived, cleared without loss;
 *  - downloads: episodes the user saved for offline — only ever removed by the
 *    explicitly labelled "Delete all downloads".
 */
export function StorageSettings() {
  const { t, locale } = useI18n();
  const downloads = useDownloads((s) => s.items);
  const hasDownloads = Object.keys(downloads).length > 0;
  const [status, setStatus] = useState<string>();
  const [cleared, refresh] = useReducer((n: number) => n + 1, 0);
  // Re-measured whenever a download progresses or is deleted, and after a clear.
  const sizes = useMemo(() => measure(), [downloads, cleared]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirmClearCache = () =>
    Alert.alert(t('clearCache'), t('clearCacheConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('clearCache'),
        style: 'destructive',
        onPress: () => {
          void clearCache().then(() => {
            refresh();
            setStatus(t('cacheCleared'));
          });
        },
      },
    ]);

  const confirmDeleteDownloads = () =>
    Alert.alert(t('deleteAll'), t('deleteAllConfirm'), [
      { text: t('cancel'), style: 'cancel' },
      {
        text: t('delete'),
        style: 'destructive',
        onPress: () => {
          deleteAllDownloads();
          setStatus(undefined);
        },
      },
    ]);

  return (
    <>
      <View style={{ gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Text style={{ flex: 1 }}>{t('storageTotal')}</Text>
          <Text testID="storage-total" weight="medium" color="accent">
            {formatBytes(sizes.cache + sizes.downloads, locale)}
          </Text>
        </View>
        <Text testID="storage-breakdown" variant="small" color="muted">
          {joinMeta(
            `${t('cacheSize')} ${formatBytes(sizes.cache, locale)}`,
            `${t('downloads')} ${formatBytes(sizes.downloads, locale)}`,
          )}
        </Text>
      </View>
      <Button
        testID="clear-cache"
        kind="secondary"
        icon="trash-2"
        label={t('clearCache')}
        onPress={confirmClearCache}
      />
      {hasDownloads ? (
        <Button
          testID="delete-downloads"
          kind="ghost"
          icon="download"
          label={t('deleteAll')}
          onPress={confirmDeleteDownloads}
        />
      ) : null}
      <Text variant="micro" color="faint">
        {status ?? t('cacheHint')}
      </Text>
    </>
  );
}
