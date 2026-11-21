import { useState } from 'react';
import { ScrollView } from 'react-native';
import type { Episode } from '@/content';
import { useI18n } from '@/i18n';
import { formatTime, joinMeta } from '@/lib/format';
import { useBookmarks, useEpisodeMarks, useIsEpisodeBookmarked } from '@/state/bookmarks';
import { MarkList } from './MarkList';
import { Button, Input, SectionTitle, Sheet } from './ui';

interface Props {
  episode: Episode;
  /** The position to bookmark, frozen when the sheet opened; undefined = closed. */
  atSec: number | undefined;
  onClose: () => void;
  onSeek: (sec: number) => void;
}

/**
 * Everything behind the player's one bookmark button: mark the current moment
 * (with an optional note), bookmark the episode as a whole, and jump back to or
 * remove the moments already marked.
 */
export function BookmarkSheet({ episode, atSec, onClose, onSeek }: Props) {
  const { t, locale } = useI18n();
  const [note, setNote] = useState('');
  const marks = useEpisodeMarks(episode.id);
  const episodeBookmarked = useIsEpisodeBookmarked(episode.id);
  const visible = atSec !== undefined;

  // Each opening starts with an empty note.
  const close = () => {
    setNote('');
    onClose();
  };
  const addMoment = () => {
    if (atSec === undefined) return;
    useBookmarks.getState().add(episode.id, atSec, note);
    close();
  };

  return (
    <Sheet visible={visible} onClose={close}>
      {/* Nothing played yet: there is no moment to mark, only the episode. */}
      {atSec !== undefined && atSec > 0 ? (
        <>
          <Input
            testID="bookmark-note"
            icon="edit-3"
            value={note}
            onChangeText={setNote}
            onClear={() => setNote('')}
            placeholder={t('notePlaceholder')}
            autoCorrect
            autoCapitalize="sentences"
            returnKeyType="done"
            onSubmitEditing={addMoment}
          />
          <Button
            testID="bookmark-add-moment"
            icon="bookmark"
            label={joinMeta(t('bookmarkMoment'), formatTime(atSec, locale))}
            onPress={addMoment}
          />
        </>
      ) : null}
      <Button
        testID="bookmark-toggle-episode"
        kind="secondary"
        icon={episodeBookmarked ? 'x' : 'bookmark'}
        label={episodeBookmarked ? t('removeEpisodeBookmark') : t('bookmarkEpisode')}
        onPress={() => {
          useBookmarks.getState().toggleEpisode(episode.id);
          close();
        }}
      />
      {marks.length > 0 ? (
        <>
          <SectionTitle>{t('yourBookmarks')}</SectionTitle>
          <ScrollView style={{ maxHeight: 220 }} keyboardShouldPersistTaps="handled">
            <MarkList
              marks={marks}
              onSeek={(sec) => {
                close();
                onSeek(sec);
              }}
            />
          </ScrollView>
        </>
      ) : null}
    </Sheet>
  );
}
