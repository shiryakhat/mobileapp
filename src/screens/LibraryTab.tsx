import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, View } from 'react-native';
import { Button, EmptyState, IconButton, ProgressBar, Segmented, Text } from '@/components/ui';
import { getEpisode } from '@/content';
import { useI18n } from '@/i18n';
import { formatBytes, formatTime, joinMeta } from '@/lib/format';
import { liveBookmarks, useBookmarks, type Bookmark } from '@/state/bookmarks';
import {
  deleteAllDownloads,
  deleteDownload,
  pauseDownload,
  resumeDownload,
  startDownload,
  storageStats,
  useDownloads,
  type DownloadItem,
} from '@/state/downloads';
import { radius, space, useTheme } from '@/theme';

function BookmarkRow({ bookmark }: { bookmark: Bookmark }) {
  const theme = useTheme();
  const { t, pick, locale } = useI18n();
  const episode = getEpisode(bookmark.episodeId);
  if (!episode) return null;
  return (
    <Pressable
      testID={`bookmark-${bookmark.id}`}
      accessibilityRole="button"
      onPress={() =>
        router.push({
          pathname: '/episode/[id]',
          params: {
            id: episode.id,
            ...(bookmark.timeSec !== null ? { t: String(bookmark.timeSec) } : {}),
          },
        })
      }
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        marginHorizontal: space.lg,
        marginBottom: space.sm,
        padding: space.md,
        borderRadius: radius.md,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="micro" weight="medium" color="accent">
          {joinMeta(
            episode.code,
            bookmark.timeSec === null ? t('wholeEpisode') : formatTime(bookmark.timeSec, locale),
          )}
        </Text>
        <Text weight="medium" numberOfLines={1}>
          {pick(episode.titleFa, episode.titleEn)}
        </Text>
        {bookmark.note ? (
          <Text variant="small" color="muted" numberOfLines={2}>
            {bookmark.note}
          </Text>
        ) : null}
      </View>
      <IconButton
        icon="trash-2"
        color="muted"
        size={18}
        label={t('removeBookmark')}
        onPress={() => useBookmarks.getState().remove(bookmark.id)}
      />
    </Pressable>
  );
}

function DownloadRow({ item }: { item: DownloadItem }) {
  const theme = useTheme();
  const { t, pick, locale } = useI18n();
  const episode = getEpisode(item.episodeId);
  if (!episode) return null;
  const fraction = item.totalBytes > 0 ? item.bytesWritten / item.totalBytes : 0;
  const status =
    item.status === 'done'
      ? formatBytes(item.totalBytes, locale)
      : item.status === 'error'
        ? t('downloadFailed')
        : joinMeta(
            t(item.status === 'paused' ? 'paused' : 'downloading'),
            formatBytes(item.bytesWritten, locale),
          );
  return (
    <View
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.sm,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.md,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <Pressable
          style={{ flex: 1, gap: 2 }}
          onPress={() => router.push({ pathname: '/episode/[id]', params: { id: episode.id } })}
        >
          <Text
            variant="micro"
            weight="medium"
            color={item.status === 'error' ? 'danger' : 'accent'}
          >
            {joinMeta(episode.code, status)}
          </Text>
          <Text weight="medium" numberOfLines={1}>
            {pick(episode.titleFa, episode.titleEn)}
          </Text>
        </Pressable>
        {item.status === 'downloading' ? (
          <IconButton
            icon="pause"
            label={t('paused')}
            onPress={() => void pauseDownload(episode.id)}
          />
        ) : item.status === 'paused' ? (
          <IconButton icon="play" label={t('resume')} onPress={() => resumeDownload(episode)} />
        ) : item.status === 'error' ? (
          <IconButton icon="refresh-cw" label={t('retry')} onPress={() => startDownload(episode)} />
        ) : null}
        <IconButton
          icon="trash-2"
          color="muted"
          size={18}
          label={t('delete')}
          onPress={() => deleteDownload(episode.id)}
        />
      </View>
      {item.status !== 'done' ? (
        <View style={{ direction: 'ltr' }}>
          <ProgressBar value={fraction} />
        </View>
      ) : null}
    </View>
  );
}

/** Local-first library: bookmarks and offline downloads with storage management. */
export function LibraryTab() {
  const { t, locale } = useI18n();
  const [pane, setPane] = useState<'bookmarks' | 'downloads'>('bookmarks');
  const allBookmarks = useBookmarks((s) => s.items);
  const downloadMap = useDownloads((s) => s.items);
  const bookmarks = useMemo(() => liveBookmarks(allBookmarks), [allBookmarks]);
  const downloads = useMemo(
    () => Object.values(downloadMap).sort((a, b) => b.updatedAt - a.updatedAt),
    [downloadMap],
  );
  // Recomputed whenever the download map changes.
  const stats = useMemo(() => storageStats(), [downloadMap]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, gap: space.md }}>
        <Text variant="title">{t('tabLibrary')}</Text>
        <Segmented
          value={pane}
          onChange={setPane}
          options={[
            { value: 'bookmarks', label: t('bookmarks') },
            { value: 'downloads', label: t('downloads') },
          ]}
        />
      </View>
      {pane === 'bookmarks' ? (
        <FlatList
          data={bookmarks}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BookmarkRow bookmark={item} />}
          ListEmptyComponent={<EmptyState icon="bookmark" text={t('bookmarksEmpty')} />}
        />
      ) : (
        <FlatList
          data={downloads}
          keyExtractor={(d) => d.episodeId}
          renderItem={({ item }) => <DownloadRow item={item} />}
          ListEmptyComponent={<EmptyState icon="download" text={t('downloadsEmpty')} />}
          ListHeaderComponent={
            downloads.length > 0 ? (
              <Text
                variant="micro"
                color="faint"
                style={{ paddingHorizontal: space.lg, paddingBottom: space.md }}
              >
                {t('storageUsed', {
                  used: formatBytes(stats.usedBytes, locale),
                  free: formatBytes(stats.freeBytes, locale),
                })}
              </Text>
            ) : undefined
          }
          ListFooterComponent={
            downloads.length > 0 ? (
              <Button
                kind="ghost"
                icon="trash-2"
                label={t('deleteAll')}
                style={{ margin: space.lg }}
                onPress={() =>
                  Alert.alert(t('deleteAll'), undefined, [
                    { text: t('cancel'), style: 'cancel' },
                    { text: t('delete'), style: 'destructive', onPress: deleteAllDownloads },
                  ])
                }
              />
            ) : undefined
          }
        />
      )}
    </View>
  );
}
