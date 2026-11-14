import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { cueIndexAt, type Cue, type Episode, type Transcript } from '@/content';
import { segmentWithGlossary } from '@/content/glossaryMatch';
import { useI18n } from '@/i18n';
import { formatTime, joinMeta } from '@/lib/format';
import { usePlayback } from '@/player/store';
import { useBookmarks } from '@/state/bookmarks';
import { useSettings, type TranscriptLangs } from '@/state/settings';
import { radius, space, useTheme } from '@/theme';
import { GlossarySheet } from './GlossarySheet';
import { Button, Chip, EmptyState, Sheet, Text } from './ui';

interface Props {
  episode: Episode;
  transcript: Transcript | undefined;
  onSeek: (sec: number) => void;
  /** Cue to reveal first (e.g. arriving from a search hit). */
  initialCueIndex?: number;
}

interface RowProps {
  cue: Cue;
  index: number;
  active: boolean;
  langs: TranscriptLangs;
  uiRTL: boolean;
  timeLabel: string;
  onPress: (index: number) => void;
  onLongPress: (index: number) => void;
  onTerm: (slug: string) => void;
}

const Line = memo(function Line({
  text,
  lang,
  primary,
  uiRTL,
  onTerm,
}: {
  text: string;
  lang: 'fa' | 'en';
  primary: boolean;
  uiRTL: boolean;
  onTerm: (slug: string) => void;
}) {
  const segments = useMemo(() => segmentWithGlossary(text, lang), [text, lang]);
  const rtl = lang === 'fa';
  return (
    <Text
      variant={primary ? 'body' : 'small'}
      color={primary ? 'text' : 'muted'}
      dir={rtl ? 'rtl' : 'ltr'}
      // Each language aligns to its own natural edge.
      align={rtl === uiRTL ? 'start' : 'end'}
    >
      {segments.map((s, i) =>
        s.slug ? (
          <Text
            key={i}
            variant={primary ? 'body' : 'small'}
            color="accent"
            onPress={() => onTerm(s.slug!)}
            style={{ textDecorationLine: 'underline', textDecorationStyle: 'dotted' }}
          >
            {s.text}
          </Text>
        ) : (
          s.text
        ),
      )}
    </Text>
  );
});

const Row = memo(function Row({
  cue,
  index,
  active,
  langs,
  uiRTL,
  timeLabel,
  onPress,
  onLongPress,
  onTerm,
}: RowProps) {
  const theme = useTheme();
  const [, , en, fa] = cue;
  const first: 'fa' | 'en' = langs === 'en' ? 'en' : langs === 'fa' ? 'fa' : uiRTL ? 'fa' : 'en';
  const second: 'fa' | 'en' = first === 'fa' ? 'en' : 'fa';
  const textOf = (l: 'fa' | 'en') => (l === 'fa' ? fa : en);
  return (
    <Pressable
      testID={`cue-${index}`}
      onPress={() => onPress(index)}
      onLongPress={() => onLongPress(index)}
      style={{
        flexDirection: 'row',
        gap: space.md,
        paddingVertical: space.sm + 2,
        paddingHorizontal: space.md,
        marginHorizontal: space.sm,
        borderRadius: radius.md,
        backgroundColor: active ? theme.accentSoft : 'transparent',
      }}
    >
      <Text
        variant="micro"
        color={active ? 'accent' : 'faint'}
        dir="ltr"
        align="center"
        style={{ width: 48, paddingTop: 5, fontVariant: ['tabular-nums'] }}
      >
        {timeLabel}
      </Text>
      <View style={{ flex: 1, gap: 2 }}>
        {textOf(first) ? (
          <Line text={textOf(first)} lang={first} primary uiRTL={uiRTL} onTerm={onTerm} />
        ) : null}
        {langs === 'both' && textOf(second) ? (
          <Line text={textOf(second)} lang={second} primary={false} uiRTL={uiRTL} onTerm={onTerm} />
        ) : null}
      </View>
    </Pressable>
  );
});

/** Bilingual transcript synced to playback: tap a line to seek, long-press for actions. */
export function TranscriptView({ episode, transcript, onSeek, initialCueIndex }: Props) {
  const { t, isRTL, locale } = useI18n();
  const langs = useSettings((s) => s.transcriptLangs);
  const setLangs = useSettings((s) => s.setTranscriptLangs);
  const listRef = useRef<FlatList<Cue>>(null);
  const [follow, setFollow] = useState(initialCueIndex === undefined);
  const [termSlug, setTermSlug] = useState<string>();
  const [actionIndex, setActionIndex] = useState<number>();
  const [copied, setCopied] = useState(false);

  const active = usePlayback((s) =>
    transcript && s.episodeId === episode.id ? cueIndexAt(transcript, s.positionSec * 1000) : -1,
  );

  const reveal = useCallback((index: number, animated: boolean) => {
    if (index < 0) return;
    listRef.current?.scrollToIndex({ index, viewPosition: 0.25, animated });
  }, []);

  useEffect(() => {
    if (follow) reveal(active, true);
  }, [active, follow, reveal]);

  useEffect(() => {
    if (initialCueIndex !== undefined) {
      const timer = setTimeout(() => reveal(initialCueIndex, false), 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [initialCueIndex, reveal]);

  const cues = transcript?.cues;
  const onPress = useCallback(
    (index: number) => {
      const cue = cues?.[index];
      if (!cue) return;
      setFollow(true);
      onSeek(cue[0] / 1000);
    },
    [cues, onSeek],
  );

  if (!transcript || transcript.cues.length === 0) {
    return <EmptyState icon="file-text" text={t('noTranscript')} />;
  }

  const actionCue = actionIndex !== undefined ? transcript.cues[actionIndex] : undefined;
  const actionSec = actionCue ? Math.floor(actionCue[0] / 1000) : 0;
  const actionText = actionCue
    ? isRTL
      ? actionCue[3] || actionCue[2]
      : actionCue[2] || actionCue[3]
    : '';
  const closeActions = () => {
    setActionIndex(undefined);
    setCopied(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
        }}
      >
        {(['both', 'fa', 'en'] as const).map((v) => (
          <Chip
            key={v}
            label={t(v === 'both' ? 'langBoth' : v === 'fa' ? 'langFa' : 'langEn')}
            active={langs === v}
            onPress={() => setLangs(v)}
          />
        ))}
        <View style={{ flex: 1 }} />
        {!follow ? (
          <Chip icon="crosshair" label={t('followPlayback')} onPress={() => setFollow(true)} />
        ) : null}
      </View>
      <FlatList
        ref={listRef}
        testID="transcript-list"
        data={transcript.cues}
        extraData={`${active}|${langs}|${locale}`}
        keyExtractor={(_, i) => String(i)}
        initialNumToRender={24}
        windowSize={9}
        onScrollBeginDrag={() => setFollow(false)}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          // Rows have variable height: jump near the target, then settle on it.
          listRef.current?.scrollToOffset({ offset: index * averageItemLength, animated: false });
          setTimeout(() => reveal(index, false), 80);
        }}
        ListFooterComponent={
          <Text variant="micro" color="faint" align="center" style={{ padding: space.xl }}>
            {t('transcriptNote')}
          </Text>
        }
        renderItem={({ item, index }) => (
          <Row
            cue={item}
            index={index}
            active={index === active}
            langs={langs}
            uiRTL={isRTL}
            timeLabel={formatTime(item[0] / 1000, locale)}
            onPress={onPress}
            onLongPress={setActionIndex}
            onTerm={setTermSlug}
          />
        )}
      />

      <GlossarySheet slug={termSlug} onClose={() => setTermSlug(undefined)} />

      <Sheet visible={Boolean(actionCue)} onClose={closeActions}>
        <Text variant="small" color="muted" numberOfLines={3}>
          {actionText}
        </Text>
        <Button
          kind="secondary"
          icon="play"
          label={joinMeta(t('seekHere'), formatTime(actionSec, locale))}
          onPress={() => {
            if (actionIndex !== undefined) onPress(actionIndex);
            closeActions();
          }}
        />
        <Button
          kind="secondary"
          icon="bookmark"
          label={t('bookmarkMoment')}
          onPress={() => {
            useBookmarks.getState().add(episode.id, actionSec, actionText);
            closeActions();
          }}
        />
        <Button
          kind="secondary"
          icon="share"
          label={t('shareCard')}
          onPress={() => {
            closeActions();
            router.push({
              pathname: '/share',
              params: { id: episode.id, t: String(actionSec), quote: actionText },
            });
          }}
        />
        <Button
          kind="ghost"
          icon="copy"
          label={copied ? t('copied') : t('copyText')}
          onPress={() => {
            void Clipboard.setStringAsync(actionText).then(() => setCopied(true));
          }}
        />
      </Sheet>
    </View>
  );
}
