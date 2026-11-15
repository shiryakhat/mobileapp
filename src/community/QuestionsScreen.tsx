import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import {
  Button,
  EmptyState,
  Icon,
  IconButton,
  Input,
  Screen,
  Segmented,
  Text,
} from '@/components/ui';
import { useI18n } from '@/i18n';
import { joinMeta } from '@/lib/format';
import { radius, space, useTheme } from '@/theme';
import {
  askQuestion,
  cachedQuestions,
  listQuestions,
  myVotes,
  setVote,
  type Question,
} from './api';
import { signInWithGitHub, useSession } from './auth';

/** "Ask for the next episode" + topic suggestions, with upvotes. */
export function QuestionsScreen() {
  const theme = useTheme();
  const { t, n } = useI18n();
  const session = useSession();
  const userId = session?.user.id;
  const [questions, setQuestions] = useState<Question[]>(cachedQuestions);
  const [votes, setVotes] = useState<Set<string>>(new Set());
  const [kind, setKind] = useState<Question['kind']>('question');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string>();

  const refresh = useCallback(() => {
    listQuestions()
      .then(setQuestions)
      .catch((e: Error) => setError(e.message));
    if (userId) {
      myVotes(userId)
        .then(setVotes)
        .catch(() => undefined);
    }
  }, [userId]);

  useEffect(refresh, [refresh]);

  const submit = () => {
    const text = body.trim();
    if (text.length < 3) return;
    askQuestion(kind, text)
      .then(() => {
        setBody('');
        refresh();
      })
      .catch((e: Error) => setError(e.message));
  };

  const toggleVote = (q: Question) => {
    if (!userId) return;
    setVote(q.id, userId, !votes.has(q.id))
      .then(refresh)
      .catch((e: Error) => setError(e.message));
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <View
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, padding: space.sm }}
      >
        <IconButton icon="chevron-left" label={t('close')} onPress={() => router.back()} />
        <Text variant="heading" style={{ flex: 1 }}>
          {t('questions')}
        </Text>
      </View>
      <FlatList
        data={questions}
        keyExtractor={(q) => q.id}
        ListEmptyComponent={<EmptyState icon="help-circle" text={error ?? t('noComments')} />}
        renderItem={({ item }) => {
          const voted = votes.has(item.id);
          return (
            <View
              style={{
                flexDirection: 'row',
                gap: space.md,
                marginHorizontal: space.lg,
                marginBottom: space.sm,
                padding: space.md,
                borderRadius: radius.md,
                backgroundColor: theme.surface,
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: voted }}
                disabled={!userId}
                onPress={() => toggleVote(item)}
                style={{ alignItems: 'center', width: 40 }}
              >
                <Icon name="chevron-up" color={voted ? 'accent' : 'muted'} />
                <Text
                  variant="small"
                  weight="medium"
                  color={voted ? 'accent' : 'muted'}
                  align="center"
                >
                  {n(item.upvote_count)}
                </Text>
              </Pressable>
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="micro" color="accent">
                  {joinMeta(
                    t(item.kind === 'topic' ? 'kindTopic' : 'kindQuestion'),
                    item.profiles?.username ?? '—',
                  )}
                </Text>
                <Text>{item.body}</Text>
              </View>
            </View>
          );
        }}
      />
      <View
        style={{ padding: space.lg, gap: space.sm, borderTopWidth: 1, borderTopColor: theme.line }}
      >
        {session ? (
          <>
            <Segmented
              value={kind}
              onChange={setKind}
              options={[
                { value: 'question', label: t('kindQuestion') },
                { value: 'topic', label: t('kindTopic') },
              ]}
            />
            <Input
              value={body}
              onChangeText={setBody}
              maxLength={1000}
              placeholder={t('askPlaceholder')}
            />
            <Button label={t('send')} onPress={submit} disabled={body.trim().length < 3} />
          </>
        ) : (
          <Button
            kind="secondary"
            icon="github"
            label={t('signInGithub')}
            onPress={() => void signInWithGitHub().catch((e: Error) => setError(e.message))}
          />
        )}
      </View>
    </Screen>
  );
}
