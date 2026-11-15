import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, View } from 'react-native';
import { Chip, EmptyState, Input, Text } from '@/components/ui';
import { getEpisode, glossary, type GlossaryEntry } from '@/content';
import { useI18n } from '@/i18n';
import { normalize } from '@/lib/text';
import { useNav } from '@/state/nav';
import { radius, space, useTheme } from '@/theme';

// The full glossary (358 terms) is static, so sort it once per locale for the whole
// app lifetime and cache it. localeCompare('fa') is slow on Android/Hermes, and
// re-running it on every tab open was the real cause of the glossary load delay.
const sortedCache = new Map<'fa' | 'en', GlossaryEntry[]>();
function sortedGlossary(isRTL: boolean): GlossaryEntry[] {
  const key = isRTL ? 'fa' : 'en';
  let cached = sortedCache.get(key);
  if (!cached) {
    cached = [...glossary].sort((a, b) =>
      isRTL ? a.termFa.localeCompare(b.termFa, 'fa') : a.term.localeCompare(b.term, 'en'),
    );
    sortedCache.set(key, cached);
  }
  return cached;
}

/** How many rows to render on first paint; grows as the user scrolls. */
const PAGE = 60;

function TermRow({
  entry,
  open,
  onToggle,
}: {
  entry: GlossaryEntry;
  open: boolean;
  onToggle: (slug: string) => void;
}) {
  const theme = useTheme();
  const { isRTL, t } = useI18n();
  return (
    <Pressable
      testID={`term-${entry.slug}`}
      accessibilityRole="button"
      accessibilityState={{ expanded: open }}
      onPress={() => onToggle(entry.slug)}
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.sm,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.md,
        backgroundColor: open ? theme.surface : 'transparent',
        borderWidth: 1,
        borderColor: open ? theme.line : 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.md }}>
        <Text weight="medium" style={{ flex: 1 }}>
          {isRTL ? entry.termFa : entry.term}
        </Text>
        <Text variant="small" color="accent" dir={isRTL ? 'ltr' : 'rtl'} align="end">
          {isRTL ? entry.term : entry.termFa}
        </Text>
      </View>
      {open ? (
        <>
          <Text>{isRTL ? entry.definitionFa : entry.definitionEn}</Text>
          <Text variant="small" color="muted" dir={isRTL ? 'ltr' : 'rtl'} align="end">
            {isRTL ? entry.definitionEn : entry.definitionFa}
          </Text>
          <Text variant="micro" color="faint" style={{ marginTop: space.xs }}>
            {t('appearsIn')}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {entry.episodes.map((id) => (
              <Chip
                key={id}
                label={getEpisode(id)?.code ?? id}
                onPress={() => router.push({ pathname: '/episode/[id]', params: { id } })}
              />
            ))}
          </View>
        </>
      ) : null}
    </Pressable>
  );
}

/** Browsable glossary of crypto terms, built by the enrichment pipeline. */
export function GlossaryTab() {
  const { t, isRTL } = useI18n();
  const [typed, setTyped] = useState('');
  const [toggled, setToggled] = useState<string>();
  const listRef = useRef<FlatList<GlossaryEntry>>(null);
  // A term tapped in a transcript arrives via the nav store; while it is set it
  // overrides the local filter/selection, and any local interaction clears it.
  const requested = useNav((s) => s.glossarySlug);
  const query = requested ? '' : typed;
  const openSlug = requested ?? toggled;
  // Render the (358-entry) list only after the tab-switch animation settles, so the
  // transition stays smooth on slower Android devices. The header shows instantly.
  const [listReady, setListReady] = useState(false);
  useEffect(() => {
    // Defer the heavy list mount past the tab-switch animation frames so the
    // transition stays smooth on slower Android devices (the header shows instantly).
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setListReady(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
    };
  }, []);

  const data = useMemo(() => {
    const q = normalize(query).trim();
    if (!q) return sortedGlossary(isRTL); // cached full list, no per-open re-sort
    // Filtered subsets are small, so sorting them inline is cheap.
    return glossary
      .filter((g) => g.aliases.some((a) => a.includes(q)) || normalize(g.term).includes(q))
      .sort((a, b) =>
        isRTL ? a.termFa.localeCompare(b.termFa, 'fa') : a.term.localeCompare(b.term, 'en'),
      );
  }, [query, isRTL]);

  // Incremental rendering: only the first PAGE rows mount up front (keeps the first
  // paint cheap on older phones); more load as the user scrolls.
  const [limit, setLimit] = useState(PAGE);
  // Reset the window to the first page when the result set changes (query/locale),
  // using React's "adjust state during render" pattern instead of an effect.
  const dataKey = `${query}|${isRTL}`;
  const [lastKey, setLastKey] = useState(dataKey);
  if (dataKey !== lastKey) {
    setLastKey(dataKey);
    setLimit(PAGE);
  }
  // Make sure a requested term (tapped from a transcript) is within the rendered
  // window — derived at render time, no extra state.
  const requestedIndex = requested ? data.findIndex((g) => g.slug === requested) : -1;
  const effLimit = requestedIndex >= limit ? requestedIndex + PAGE : limit;
  const paged = useMemo(() => data.slice(0, effLimit), [data, effLimit]);

  useEffect(() => {
    if (!requested || !listReady) return undefined;
    const index = requestedIndex;
    if (index < 5) return undefined;
    const timer = setTimeout(
      () => listRef.current?.scrollToIndex({ index, viewPosition: 0.2, animated: true }),
      100,
    );
    return () => clearTimeout(timer);
  }, [requested, requestedIndex, listReady]);

  const setQuery = (text: string) => {
    useNav.getState().clearGlossarySlug();
    setTyped(text);
  };
  const toggle = (slug: string) => {
    useNav.getState().clearGlossarySlug();
    setToggled(openSlug === slug ? undefined : slug);
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: space.lg, gap: space.sm }}>
        <Text variant="title">{t('tabGlossary')}</Text>
        <Input
          testID="glossary-input"
          icon="search"
          value={query}
          onChangeText={setQuery}
          onClear={() => setQuery('')}
          placeholder={t('glossaryPlaceholder')}
        />
      </View>
      {listReady ? (
        <FlatList
          ref={listRef}
          data={paged}
          extraData={openSlug}
          keyExtractor={(g) => g.slug}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={12}
          maxToRenderPerBatch={12}
          windowSize={9}
          removeClippedSubviews={Platform.OS === 'android'}
          onEndReachedThreshold={0.6}
          onEndReached={() => setLimit((l) => (l < data.length ? l + PAGE : l))}
          onScrollToIndexFailed={({ index, averageItemLength }) =>
            listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })
          }
          renderItem={({ item }) => (
            <TermRow entry={item} open={item.slug === openSlug} onToggle={toggle} />
          )}
          ListEmptyComponent={<EmptyState icon="book-open" text={t('glossaryEmpty')} />}
          contentContainerStyle={{ paddingBottom: space.xl }}
        />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      )}
    </View>
  );
}
