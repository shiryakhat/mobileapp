import { router } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, View } from 'react-native';
import { EpisodeCard } from '@/components/EpisodeCard';
import { Chip, Icon, ProgressBar, Text } from '@/components/ui';
import { getEpisode, seasons, type Episode, type SeasonSection } from '@/content';
import { useI18n } from '@/i18n';
import { formatTime } from '@/lib/format';
import { progressFraction, resumePosition, useProgress } from '@/state/progress';
import { useSettings } from '@/state/settings';
import { radius, space, useTheme } from '@/theme';

function openEpisode(episode: Episode) {
  router.push({ pathname: '/episode/[id]', params: { id: episode.id } });
}

function ContinueCard() {
  const theme = useTheme();
  const { t, pick, locale } = useI18n();
  const lastId = useProgress((s) => s.lastEpisodeId);
  const progress = useProgress((s) => (lastId ? s.byEpisode[lastId] : undefined));
  const episode = getEpisode(lastId);
  const at = resumePosition(progress);
  if (!episode || at === 0) return null;
  return (
    <Pressable
      testID="continue-card"
      accessibilityRole="button"
      onPress={() => openEpisode(episode)}
      style={{
        marginHorizontal: space.lg,
        marginBottom: space.md,
        padding: space.md,
        gap: space.sm,
        borderRadius: radius.md,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: theme.accentSoft,
          }}
        >
          <Icon name="play" size={16} color="accent" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="micro" weight="medium" color="accent">
            {t('resumeFrom', { t: formatTime(at, locale) })}
          </Text>
          <Text variant="small" weight="medium" numberOfLines={1}>
            {pick(episode.titleFa, episode.titleEn)}
          </Text>
        </View>
      </View>
      <View style={{ direction: 'ltr' }}>
        <ProgressBar value={progressFraction(progress)} />
      </View>
    </Pressable>
  );
}

/** Every season, or the one picked in the top bar (0 = specials). */
type SeasonFilter = 'all' | number;

/**
 * Episodes grouped by season; the newest episode leads as a hero card. The
 * season chips in the top bar filter the list to one season.
 */
export function EpisodesTab() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const setLocale = useSettings((s) => s.setLocale);
  const [filter, setFilter] = useState<SeasonFilter>('all');
  const sections = useMemo(
    () => (filter === 'all' ? seasons : seasons.filter((s) => s.season === filter)),
    [filter],
  );
  const latestId = seasons[0]?.data[0]?.id;

  const seasonLabel = useCallback(
    (season: number) => (season === 0 ? t('specials') : t('season', { n: season })),
    [t],
  );

  const header = useMemo(
    () => (
      <View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: space.lg,
            paddingTop: space.md,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="display" testID="app-title">
              {t('appName')}
            </Text>
            <Text variant="small" color="muted">
              {t('tagline')}
            </Text>
          </View>
          <Chip
            testID="locale-toggle"
            icon="globe"
            label={locale === 'fa' ? 'EN' : 'فا'}
            accessibilityLabel={t('language')}
            onPress={() => setLocale(locale === 'fa' ? 'en' : 'fa')}
          />
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: space.sm, padding: space.lg }}
        >
          <Chip
            testID="season-chip-all"
            label={t('allSeasons')}
            active={filter === 'all'}
            onPress={() => setFilter('all')}
          />
          {seasons.map((s) => (
            <Chip
              key={s.season}
              testID={`season-chip-${s.season}`}
              label={seasonLabel(s.season)}
              active={filter === s.season}
              onPress={() => setFilter(s.season)}
            />
          ))}
        </ScrollView>
        <ContinueCard />
      </View>
    ),
    [filter, locale, seasonLabel, setLocale, t],
  );

  return (
    <SectionList<Episode, SeasonSection>
      testID="episodes-list"
      sections={sections}
      keyExtractor={(e) => e.id}
      ListHeaderComponent={header}
      stickySectionHeadersEnabled
      initialNumToRender={8}
      contentContainerStyle={{ paddingBottom: space.xl }}
      renderSectionHeader={({ section }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            paddingHorizontal: space.lg,
            paddingVertical: space.sm,
            backgroundColor: theme.bg,
          }}
        >
          <Text variant="heading" weight="bold">
            {seasonLabel(section.season)}
          </Text>
          <Text variant="micro" color="faint">
            {t('episodesCount', { n: section.data.length })}
          </Text>
        </View>
      )}
      renderItem={({ item }) => (
        <EpisodeCard episode={item} onPress={openEpisode} hero={item.id === latestId} />
      )}
    />
  );
}
