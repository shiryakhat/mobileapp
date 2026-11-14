import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Button, EmptyState, Input, Text } from '@/components/ui';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import { formatTime, joinMeta } from '@/lib/format';
import { usePlayback } from '@/player/store';
import { radius, space, useTheme } from '@/theme';
import { addComment, listComments, subscribeComments, type MinuteComment } from './api';
import { signInWithGitHub, useSession } from './auth';

interface Props {
  episode: Episode;
  onSeek: (sec: number) => void;
}

/** Timestamp-anchored comments. Only mounted when the community flag is on. */
export function CommentsPane({ episode, onSeek }: Props) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const session = useSession();
  const [comments, setComments] = useState<MinuteComment[]>([]);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();
  const positionSec = usePlayback((s) =>
    s.episodeId === episode.id ? Math.floor(s.positionSec) : 0,
  );

  const refresh = useCallback(() => {
    listComments(episode.id)
      .then(setComments)
      .catch((e: Error) => setError(e.message));
  }, [episode.id]);

  useEffect(() => {
    refresh();
    return subscribeComments(episode.id, refresh);
  }, [episode.id, refresh]);

  const submit = () => {
    const text = body.trim();
    if (!text) return;
    addComment(episode.id, positionSec, text)
      .then(() => {
        setBody('');
        refresh();
      })
      .catch((e: Error) => setError(e.message));
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={comments}
        keyExtractor={(c) => c.id}
        ListEmptyComponent={<EmptyState icon="message-circle" text={error ?? t('noComments')} />}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onSeek(item.time_sec)}
            style={{
              marginHorizontal: space.lg,
              marginTop: space.sm,
              padding: space.md,
              gap: 2,
              borderRadius: radius.md,
              backgroundColor: theme.surface,
            }}
          >
            <Text variant="micro" weight="medium" color="accent">
              {joinMeta(formatTime(item.time_sec, locale), item.profiles?.username ?? '—')}
            </Text>
            <Text>{item.body}</Text>
          </Pressable>
        )}
      />
      <View
        style={{ padding: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: theme.line }}
      >
        {session ? (
          <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Input
                value={body}
                onChangeText={setBody}
                maxLength={2000}
                placeholder={t('commentPlaceholder', { t: formatTime(positionSec, locale) })}
                onSubmitEditing={submit}
              />
            </View>
            <Button label={t('send')} onPress={submit} disabled={!body.trim()} />
          </View>
        ) : (
          <Button
            kind="secondary"
            icon="github"
            label={t('signInGithub')}
            onPress={() => void signInWithGitHub().catch((e: Error) => setError(e.message))}
          />
        )}
      </View>
    </View>
  );
}
