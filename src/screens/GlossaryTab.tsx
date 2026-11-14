import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Chip, EmptyState, Input, Text } from '@/components/ui';
import { getEpisode, glossary, type GlossaryEntry } from '@/content';
import { useI18n } from '@/i18n';
import { normalize } from '@/lib/text';
import { useNav } from '@/state/nav';
import { radius, space, useTheme } from '@/theme';

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

  const data = useMemo(() => {
    const q = normalize(query).trim();
    const list = q
      ? glossary.filter(
          (g) => g.aliases.some((a) => a.includes(q)) || normalize(g.term).includes(q),
        )
      : glossary;
    return [...list].sort((a, b) =>
      isRTL ? a.termFa.localeCompare(b.termFa, 'fa') : a.term.localeCompare(b.term, 'en'),
    );
  }, [query, isRTL]);

  useEffect(() => {
    if (!requested) return undefined;
    const index = data.findIndex((g) => g.slug === requested);
    if (index < 5) return undefined;
    const timer = setTimeout(
      () => listRef.current?.scrollToIndex({ index, viewPosition: 0.2, animated: true }),
      100,
    );
    return () => clearTimeout(timer);
  }, [requested, data]);

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
      <FlatList
        ref={listRef}
        data={data}
        extraData={openSlug}
        keyExtractor={(g) => g.slug}
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={({ index, averageItemLength }) =>
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: true })
        }
        renderItem={({ item }) => (
          <TermRow entry={item} open={item.slug === openSlug} onToggle={toggle} />
        )}
        ListEmptyComponent={<EmptyState icon="book-open" text={t('glossaryEmpty')} />}
        contentContainerStyle={{ paddingBottom: space.xl }}
      />
    </View>
  );
}
