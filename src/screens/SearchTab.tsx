import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { EmptyState, Input, Text } from '@/components/ui';
import { getEpisode } from '@/content';
import { searchArchive, type EpisodeHits, type SearchHit } from '@/content/search';
import { useI18n } from '@/i18n';
import { formatTime, joinMeta } from '@/lib/format';
import { escapeRegExp, hasPersian } from '@/lib/text';
import { useNav } from '@/state/nav';
import { radius, space, useTheme } from '@/theme';

const PREVIEW = 3;

function Highlighted({ text, query, muted }: { text: string; query: string; muted?: boolean }) {
  const { isRTL } = useI18n();
  const parts = useMemo(() => {
    const words = query
      .trim()
      .split(/\s+/)
      .filter((w) => w.length >= 2)
      .map(escapeRegExp);
    if (words.length === 0) return [text];
    return text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  }, [text, query]);
  const rtl = hasPersian(text);
  return (
    <Text
      variant={muted ? 'small' : 'body'}
      color={muted ? 'muted' : 'text'}
      dir={rtl ? 'rtl' : 'ltr'}
      align={rtl === isRTL ? 'start' : 'end'}
      numberOfLines={3}
    >
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <Text key={i} variant={muted ? 'small' : 'body'} color="accent" weight="medium">
            {p}
          </Text>
        ) : (
          p
        ),
      )}
    </Text>
  );
}

function openHit(hit: SearchHit) {
  router.push({
    pathname: '/episode/[id]',
    params: { id: hit.episodeId, t: String(hit.startSec), cue: String(hit.cueIndex) },
  });
}

function EpisodeResult({ group, query }: { group: EpisodeHits; query: string }) {
  const theme = useTheme();
  const { t, n, pick, isRTL, locale } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const episode = getEpisode(group.episodeId);
  if (!episode) return null;
  const hits = expanded ? group.hits : group.hits.slice(0, PREVIEW);
  const remaining = group.total - hits.length;
  return (
    <View
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.md,
        borderRadius: radius.md,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
        overflow: 'hidden',
      }}
    >
      <Pressable
        accessibilityRole="button"
        onPress={() => router.push({ pathname: '/episode/[id]', params: { id: episode.id } })}
        style={{ padding: space.md, gap: 2 }}
      >
        <Text variant="micro" weight="medium" color="accent">
          {joinMeta(episode.code, group.total > 0 && `${n(group.total)}×`)}
        </Text>
        <Text weight="medium" numberOfLines={2}>
          {pick(episode.titleFa, episode.titleEn)}
        </Text>
      </Pressable>
      {hits.map((hit) => (
        <Pressable
          key={hit.cueIndex}
          testID={`hit-${hit.episodeId}-${hit.cueIndex}`}
          accessibilityRole="button"
          onPress={() => openHit(hit)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            gap: space.md,
            padding: space.md,
            borderTopWidth: 1,
            borderTopColor: theme.line,
            backgroundColor: pressed ? theme.raised : 'transparent',
          })}
        >
          <Text
            variant="micro"
            color="faint"
            dir="ltr"
            align="center"
            style={{ width: 48, paddingTop: 5, fontVariant: ['tabular-nums'] }}
          >
            {formatTime(hit.startSec, locale)}
          </Text>
          <View style={{ flex: 1, gap: 2 }}>
            <Highlighted text={isRTL ? hit.fa || hit.en : hit.en || hit.fa} query={query} />
            {(isRTL ? hit.en : hit.fa) && (isRTL ? hit.fa : hit.en) ? (
              <Highlighted text={isRTL ? hit.en : hit.fa} query={query} muted />
            ) : null}
          </View>
        </Pressable>
      ))}
      {remaining > 0 && !expanded ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setExpanded(true)}
          style={{ padding: space.md, borderTopWidth: 1, borderTopColor: theme.line }}
        >
          <Text variant="small" color="accent" align="center">
            {t('moreInEpisode', { n: remaining })}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Full-archive search over every transcript, in either language. */
export function SearchTab() {
  const theme = useTheme();
  const { t } = useI18n();
  const [query, setQuery] = useState(() => useNav.getState().searchQuery ?? '');
  const [found, setFound] = useState<{ query: string; groups: EpisodeHits[] }>();
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return undefined;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchArchive(q, () => cancelled)
        .then((groups) => {
          if (!cancelled) setFound({ query: q, groups });
        })
        .catch(() => {
          if (!cancelled) setFound({ query: q, groups: [] });
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  const state: 'idle' | 'searching' | 'done' =
    q.length < 2 ? 'idle' : found?.query === q ? 'done' : 'searching';
  const results = state === 'done' ? (found?.groups ?? []) : [];
  const total = results.reduce((n, r) => n + r.total, 0);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Text variant="title">{t('tabSearch')}</Text>
        <Input
          testID="search-input"
          icon="search"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={t('searchPlaceholder')}
          returnKeyType="search"
        />
        {state === 'done' && results.length > 0 ? (
          <Text variant="micro" color="faint" testID="search-count">
            {t('searchResults', { n: total, m: results.length })}
          </Text>
        ) : null}
      </View>
      {state === 'searching' ? (
        <ActivityIndicator color={theme.accent} style={{ marginTop: space.xl }} />
      ) : state === 'idle' ? (
        <EmptyState icon="search" text={t('searchHint')} />
      ) : (
        <FlatList
          data={results}
          keyExtractor={(r) => r.episodeId}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          renderItem={({ item }) => <EpisodeResult group={item} query={query} />}
          ListEmptyComponent={<EmptyState icon="search" text={t('searchEmpty', { q })} />}
          contentContainerStyle={{ paddingBottom: space.xl }}
        />
      )}
    </View>
  );
}
