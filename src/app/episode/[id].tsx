import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, ScrollView, useWindowDimensions, View } from 'react-native';
import { CommentsPane } from '@/community/CommentsPane';
import { ChapterList } from '@/components/ChapterList';
import { DownloadButton } from '@/components/DownloadButton';
import { EpisodeArtwork } from '@/components/EpisodeArtwork';
import { PlayerControls } from '@/components/PlayerControls';
import { TranscriptView } from '@/components/TranscriptView';
import { YoutubeSurface } from '@/components/YoutubeSurface';
import { Button, Chip, IconButton, Screen, SectionTitle, Segmented, Text } from '@/components/ui';
import { getEnrichment, getEpisode, getTranscript, type Episode } from '@/content';
import { useI18n } from '@/i18n';
import { communityEnabled } from '@/lib/flags';
import { formatDate, formatMinutes, formatTime, joinMeta } from '@/lib/format';
import { loadEpisode } from '@/player/controller';
import { usePlayback } from '@/player/store';
import { useBookmarks, useIsEpisodeBookmarked } from '@/state/bookmarks';
import { resumePosition, useProgress } from '@/state/progress';
import { radius, space, useTheme } from '@/theme';
import NotFound from '../+not-found';

type Pane = 'about' | 'chapters' | 'transcript' | 'discussion';

function AboutPane({ episode, onSeek }: { episode: Episode; onSeek: (sec: number) => void }) {
  const theme = useTheme();
  const { t, pick, other, isRTL, locale } = useI18n();
  const enrichment = useMemo(() => getEnrichment(episode.id), [episode.id]);
  const description = pick(episode.descriptionFa, episode.descriptionEn);
  const links = [
    { label: 'YouTube', url: `https://youtu.be/${episode.youtubeId}` },
    { label: 'Spotify', url: episode.spotifyUrl },
    { label: 'Apple Podcasts', url: episode.appleUrl },
    { label: 'Castbox', url: episode.castboxUrl },
    { label: t('website'), url: episode.webUrl },
  ].filter((l): l is { label: string; url: string } => Boolean(l.url));

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.xl }}>
      {enrichment ? (
        <>
          <View style={{ gap: space.sm }}>
            <SectionTitle>{t('summary')}</SectionTitle>
            <Text testID="episode-summary">{pick(enrichment.summaryFa, enrichment.summaryEn)}</Text>
            <Text variant="small" color="muted" dir={isRTL ? 'ltr' : 'rtl'} align="end">
              {other(enrichment.summaryFa, enrichment.summaryEn)}
            </Text>
          </View>
          <View style={{ gap: space.md }}>
            <SectionTitle>{t('keyQuotes')}</SectionTitle>
            {enrichment.quotes.map((q) => {
              const text = pick(q.fa, q.en);
              return (
                <View
                  key={`${q.startSec}-${q.en.slice(0, 12)}`}
                  style={{
                    padding: space.md,
                    gap: space.sm,
                    borderRadius: radius.md,
                    backgroundColor: theme.surface,
                    borderStartWidth: 3,
                    borderStartColor: theme.accent,
                  }}
                >
                  <Text weight="medium">{text}</Text>
                  <Text variant="small" color="muted" dir={isRTL ? 'ltr' : 'rtl'} align="end">
                    {other(q.fa, q.en)}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                    <Chip
                      icon="play"
                      label={joinMeta(formatTime(q.startSec, locale), q.speaker)}
                      onPress={() => onSeek(q.startSec)}
                    />
                    <View style={{ flex: 1 }} />
                    <IconButton
                      icon="bookmark"
                      size={18}
                      color="muted"
                      label={t('bookmarkMoment')}
                      onPress={() => useBookmarks.getState().add(episode.id, q.startSec, text)}
                    />
                    <IconButton
                      icon="share"
                      size={18}
                      color="muted"
                      label={t('shareCard')}
                      onPress={() =>
                        router.push({
                          pathname: '/share',
                          params: { id: episode.id, t: String(q.startSec), quote: text },
                        })
                      }
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </>
      ) : (
        <Text variant="small" color="faint">
          {t('noEnrichment')}
        </Text>
      )}

      {description ? (
        <View style={{ gap: space.sm }}>
          <SectionTitle>{t('description')}</SectionTitle>
          <Text color="muted">{description}</Text>
        </View>
      ) : null}

      <View style={{ gap: space.sm }}>
        <SectionTitle>{t('listenElsewhere')}</SectionTitle>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
          {links.map((l) => (
            <Chip
              key={l.label}
              icon="external-link"
              label={l.label}
              onPress={() => void Linking.openURL(l.url)}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

interface EpisodeScreenProps {
  episode: Episode;
  startAt?: number;
  cue?: number;
  initialPane?: Pane;
}

function EpisodeScreen({ episode, startAt, cue, initialPane }: EpisodeScreenProps) {
  const { t, pick, other, isRTL, locale } = useI18n();
  const { width } = useWindowDimensions();
  const [pane, setPane] = useState<Pane>(
    initialPane ?? (cue !== undefined ? 'transcript' : 'about'),
  );
  const bookmarked = useIsEpisodeBookmarked(episode.id);

  const isCurrent = usePlayback((s) => s.episodeId === episode.id);
  const mode = usePlayback((s) => s.mode);
  const engine = usePlayback((s) => s.engine);
  const saved = useProgress((s) => s.byEpisode[episode.id]);
  const transcript = useMemo(() => getTranscript(episode.id), [episode.id]);

  // Opening an episode makes it current unless something else is actively playing;
  // browsing never interrupts what you are listening to.
  useEffect(() => {
    const playback = usePlayback.getState();
    if (playback.episodeId === episode.id) {
      if (startAt !== undefined) loadEpisode(episode, { startAt });
    } else if (!playback.playing) {
      loadEpisode(episode, { startAt });
    }
  }, [episode, startAt]);

  /** Seek within this episode, taking over playback if another episode was current. */
  const seekHere = useCallback(
    (sec: number) => loadEpisode(episode, { startAt: sec, autoplay: true }),
    [episode],
  );

  const primary = pick(episode.titleFa, episode.titleEn);
  const secondary = other(episode.titleFa, episode.titleEn);
  const showVideo = isCurrent && engine === 'youtube' && mode === 'video';
  const youtubeAudio = isCurrent && engine === 'youtube' && mode === 'audio';
  const resumeAt = resumePosition(saved);

  const panes: { value: Pane; label: string }[] = [
    { value: 'about', label: t('about') },
    { value: 'chapters', label: t('chapters') },
    { value: 'transcript', label: t('transcript') },
    ...(communityEnabled ? [{ value: 'discussion' as const, label: t('discussion') }] : []),
  ];

  return (
    <Screen testID="episode-screen">
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.xs }}>
        <IconButton
          testID="back-button"
          icon="chevron-left"
          label={t('close')}
          onPress={() => router.back()}
        />
        <Text variant="small" weight="medium" color="accent" style={{ flex: 1 }}>
          {episode.code}
        </Text>
        <DownloadButton episode={episode} />
        <IconButton
          testID="bookmark-button"
          icon="bookmark"
          color={bookmarked ? 'accent' : 'text'}
          label={bookmarked ? t('removeBookmark') : t('bookmarkEpisode')}
          onPress={() => useBookmarks.getState().toggleEpisode(episode.id)}
        />
        <IconButton
          testID="share-button"
          icon="share"
          label={t('share')}
          onPress={() => {
            // "Share at this minute": while this episode is the one in the player,
            // the share carries where it is.
            const { episodeId, positionSec } = usePlayback.getState();
            const at = episodeId === episode.id ? Math.floor(positionSec) : 0;
            router.push({
              pathname: '/share',
              params: at > 0 ? { id: episode.id, t: String(at) } : { id: episode.id },
            });
          }}
        />
      </View>

      {showVideo ? (
        <YoutubeSurface videoId={episode.youtubeId} width={width} />
      ) : (
        <View
          style={{ flexDirection: 'row', gap: space.md, padding: space.lg, paddingTop: space.sm }}
        >
          <EpisodeArtwork episode={episode} size={96} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="bold" numberOfLines={2} testID="episode-title">
              {primary}
            </Text>
            {secondary && secondary !== primary ? (
              <Text
                variant="small"
                color="muted"
                numberOfLines={1}
                dir={isRTL ? 'ltr' : 'rtl'}
                align="end"
              >
                {secondary}
              </Text>
            ) : null}
            <Text variant="micro" color="faint">
              {joinMeta(
                formatDate(episode.publishedAt, locale),
                t('minutes', { n: formatMinutes(episode.durationSec) }),
              )}
            </Text>
          </View>
          {youtubeAudio ? (
            <YoutubeSurface videoId={episode.youtubeId} width={width} hidden />
          ) : null}
        </View>
      )}

      {isCurrent ? (
        <PlayerControls episode={episode} />
      ) : (
        <View style={{ paddingHorizontal: space.lg }}>
          <Button
            testID="play-episode"
            icon="play"
            label={resumeAt > 0 ? t('resumeFrom', { t: formatTime(resumeAt, locale) }) : t('play')}
            onPress={() => loadEpisode(episode, { autoplay: true })}
          />
        </View>
      )}

      <Segmented
        style={{ marginHorizontal: space.lg, marginTop: space.md }}
        value={pane}
        onChange={setPane}
        options={panes}
      />

      <View style={{ flex: 1 }}>
        {pane === 'about' ? <AboutPane episode={episode} onSeek={seekHere} /> : null}
        {pane === 'chapters' ? (
          <ScrollView>
            <ChapterList episode={episode} onSeek={seekHere} />
          </ScrollView>
        ) : null}
        {pane === 'transcript' ? (
          <TranscriptView
            episode={episode}
            transcript={transcript}
            onSeek={seekHere}
            initialCueIndex={cue}
          />
        ) : null}
        {pane === 'discussion' && communityEnabled ? (
          <CommentsPane episode={episode} onSeek={seekHere} />
        ) : null}
      </View>
    </Screen>
  );
}

const toNumber = (v: string | string[] | undefined): number | undefined => {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) && n >= 0 && v !== undefined && v !== '' ? n : undefined;
};

/** Route: /episode/[id]?t=<seconds>&cue=<index>&pane=<about|chapters|transcript> — the deep-link target. */
export default function EpisodeRoute() {
  const params = useLocalSearchParams<{ id: string; t?: string; cue?: string; pane?: string }>();
  const pane = (['about', 'chapters', 'transcript'] as const).find((p) => p === params.pane);
  const episode = getEpisode(params.id);
  if (!episode) return <NotFound />;
  return (
    <EpisodeScreen
      // Re-mount when a deep link targets a different pane/cue of the same episode.
      key={`${episode.id}|${pane ?? ''}|${params.cue ?? ''}`}
      episode={episode}
      startAt={toNumber(params.t)}
      cue={toNumber(params.cue)}
      initialPane={pane}
    />
  );
}
