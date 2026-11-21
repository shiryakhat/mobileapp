import { FlashList, type FlashListRef } from '@shopify/flash-list';
import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { cueIndexAt, type Cue, type Episode, type Transcript } from '@/content';
import { segmentWithGlossary } from '@/content/glossaryMatch';
import { useI18n } from '@/i18n';
import { formatTime, joinMeta } from '@/lib/format';
import { usePlayback } from '@/player/store';
import { useBookmarks, useEpisodeMarks } from '@/state/bookmarks';
import { useSettings, type TranscriptLangs } from '@/state/settings';
import { radius, space, useTheme } from '@/theme';
import { GlossarySheet } from './GlossarySheet';
import { Button, Chip, EmptyState, Input, Sheet, Text } from './ui';

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
  /** A bookmarked moment falls on this line. */
  marked: boolean;
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
  marked,
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
      <View style={{ width: 48, alignItems: 'center', gap: space.xs }}>
        <Text
          variant="micro"
          color={active || marked ? 'accent' : 'faint'}
          dir="ltr"
          align="center"
          style={{ paddingTop: 5, fontVariant: ['tabular-nums'] }}
        >
          {timeLabel}
        </Text>
        {marked ? (
          <View
            testID={`cue-mark-${index}`}
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.accent }}
          />
        ) : null}
      </View>
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

/** Follow-mode hops up to this many rows animate; anything farther jumps. */
const MAX_ANIMATED_HOP = 12;
/** Where the revealed cue sits in the viewport (0 = top edge, 1 = bottom edge). */
const REVEAL_POSITION = 0.3;

/** Bilingual transcript synced to playback: tap a line to seek, long-press for actions. */
export function TranscriptView({ episode, transcript, onSeek, initialCueIndex }: Props) {
  const { t, isRTL, locale } = useI18n();
  const langs = useSettings((s) => s.transcriptLangs);
  const setLangs = useSettings((s) => s.setTranscriptLangs);
  const listRef = useRef<FlashListRef<Cue>>(null);
  const [follow, setFollow] = useState(initialCueIndex === undefined);
  const [loaded, setLoaded] = useState(false);
  const [termSlug, setTermSlug] = useState<string>();
  const [actionIndex, setActionIndex] = useState<number>();
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');
  const marks = useEpisodeMarks(episode.id);

  const active = usePlayback((s) =>
    transcript && s.episodeId === episode.id ? cueIndexAt(transcript, s.positionSec * 1000) : -1,
  );

  // Rows have variable height (bilingual lines wrap differently). FlashList lays out
  // unmeasured rows from estimates and corrects as it renders around the target, so a
  // non-animated scrollToIndex lands on a far cue in one jump — no walking through the
  // windows in between. Only short follow-mode hops animate.
  //
  // The list also opens already scrolled to its first target (the requested cue, or
  // wherever playback is) rather than starting at the top; that needs the viewport
  // height up front, so the list mounts once its container has been measured.
  const [openAt] = useState(() => initialCueIndex ?? active);
  const [viewportHeight, setViewportHeight] = useState(0);
  const lastRevealed = useRef(initialCueIndex === undefined ? openAt : -1);

  const reveal = useCallback((index: number, animated: boolean) => {
    if (index < 0) return;
    void listRef.current?.scrollToIndex({ index, viewPosition: REVEAL_POSITION, animated });
  }, []);

  useEffect(() => {
    if (!loaded) return;
    if (!follow) {
      // The user may have scrolled anywhere; the next sync must jump, not travel.
      lastRevealed.current = -1;
      return;
    }
    const prev = lastRevealed.current;
    if (active === prev) return;
    lastRevealed.current = active;
    reveal(active, prev >= 0 && Math.abs(active - prev) <= MAX_ANIMATED_HOP);
  }, [active, follow, loaded, reveal]);

  // The line each bookmarked moment falls on. Marks are whole seconds, so a mark made
  // from a line that starts mid-second is looked up at the end of that second.
  const markedCues = useMemo(
    () =>
      new Set(transcript ? marks.map((m) => cueIndexAt(transcript, m.timeSec * 1000 + 999)) : []),
    [marks, transcript],
  );
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
  const actionMark = actionCue ? marks.find((m) => m.timeSec === actionSec) : undefined;
  const closeActions = () => {
    setActionIndex(undefined);
    setCopied(false);
    setNote('');
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
      <View
        testID="transcript-viewport"
        style={{ flex: 1 }}
        onLayout={(e) => setViewportHeight(e.nativeEvent.layout.height)}
      >
        {viewportHeight > 0 ? (
          <FlashList
            ref={listRef}
            testID="transcript-list"
            data={transcript.cues}
            extraData={`${active}|${langs}|${locale}|${[...markedCues].join()}`}
            keyExtractor={(_, i) => String(i)}
            initialScrollIndex={openAt > 0 ? openAt : undefined}
            initialScrollIndexParams={{ viewOffset: -viewportHeight * REVEAL_POSITION }}
            onLoad={() => setLoaded(true)}
            onScrollBeginDrag={() => setFollow(false)}
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
                marked={markedCues.has(index)}
                langs={langs}
                uiRTL={isRTL}
                timeLabel={formatTime(item[0] / 1000, locale)}
                onPress={onPress}
                onLongPress={setActionIndex}
                onTerm={setTermSlug}
              />
            )}
          />
        ) : null}
      </View>

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
        {actionMark ? (
          <Button
            testID="cue-remove-bookmark"
            kind="secondary"
            icon="x"
            label={t('removeBookmark')}
            onPress={() => {
              useBookmarks.getState().remove(actionMark.id);
              closeActions();
            }}
          />
        ) : (
          <>
            <Input
              testID="cue-note"
              icon="edit-3"
              value={note}
              onChangeText={setNote}
              onClear={() => setNote('')}
              placeholder={t('notePlaceholder')}
              autoCorrect
              autoCapitalize="sentences"
            />
            <Button
              testID="cue-bookmark"
              kind="secondary"
              icon="bookmark"
              label={t('bookmarkMoment')}
              onPress={() => {
                // Without a note of the user's own, the line itself is the note.
                useBookmarks.getState().add(episode.id, actionSec, note.trim() || actionText);
                closeActions();
              }}
            />
          </>
        )}
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
