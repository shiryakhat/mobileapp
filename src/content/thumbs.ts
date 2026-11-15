/**
 * Bundled per-episode artwork (square, at most 640 px), keyed by episode code.
 * A static require map so Metro can bundle the pictures, like
 * content/index.generated.ts does for transcripts. The files live in
 * assets/episode-thumbs/<CODE>.jpg; an episode without one (a special, or one
 * added before its artwork exists) keeps using its YouTube thumbnail.
 */
import type { Episode } from '@content/types';

const thumbs: Record<string, number> = {
  S01E01: require('../../assets/episode-thumbs/S01E01.jpg'),
  S01E02: require('../../assets/episode-thumbs/S01E02.jpg'),
  S01E03: require('../../assets/episode-thumbs/S01E03.jpg'),
  S01E04: require('../../assets/episode-thumbs/S01E04.jpg'),
  S01E05: require('../../assets/episode-thumbs/S01E05.jpg'),
  S01E06: require('../../assets/episode-thumbs/S01E06.jpg'),
  S01E07: require('../../assets/episode-thumbs/S01E07.jpg'),
  S01E08: require('../../assets/episode-thumbs/S01E08.jpg'),
  S01E09: require('../../assets/episode-thumbs/S01E09.jpg'),
  S01E10: require('../../assets/episode-thumbs/S01E10.jpg'),
  S02E01: require('../../assets/episode-thumbs/S02E01.jpg'),
  S02E02: require('../../assets/episode-thumbs/S02E02.jpg'),
  S02E03: require('../../assets/episode-thumbs/S02E03.jpg'),
  S03E01: require('../../assets/episode-thumbs/S03E01.jpg'),
  S03E02: require('../../assets/episode-thumbs/S03E02.jpg'),
  S03E03: require('../../assets/episode-thumbs/S03E03.jpg'),
  S03E04: require('../../assets/episode-thumbs/S03E04.jpg'),
  S03E05: require('../../assets/episode-thumbs/S03E05.jpg'),
  S03E06: require('../../assets/episode-thumbs/S03E06.jpg'),
  S03E07: require('../../assets/episode-thumbs/S03E07.jpg'),
  S04E01: require('../../assets/episode-thumbs/S04E01.jpg'),
  S04E02: require('../../assets/episode-thumbs/S04E02.jpg'),
  S04E03: require('../../assets/episode-thumbs/S04E03.jpg'),
  S04E04: require('../../assets/episode-thumbs/S04E04.jpg'),
  S04E05: require('../../assets/episode-thumbs/S04E05.jpg'),
  S04E06: require('../../assets/episode-thumbs/S04E06.jpg'),
  S05E01: require('../../assets/episode-thumbs/S05E01.jpg'),
  S05E02: require('../../assets/episode-thumbs/S05E02.jpg'),
  S06E01: require('../../assets/episode-thumbs/S06E01.jpg'),
  S06E02: require('../../assets/episode-thumbs/S06E02.jpg'),
  S06E03: require('../../assets/episode-thumbs/S06E03.jpg'),
  S06E04: require('../../assets/episode-thumbs/S06E04.jpg'),
  S06E05: require('../../assets/episode-thumbs/S06E05.jpg'),
  S07E01: require('../../assets/episode-thumbs/S07E01.jpg'),
  S07E02: require('../../assets/episode-thumbs/S07E02.jpg'),
  S07E03: require('../../assets/episode-thumbs/S07E03.jpg'),
  S07E04: require('../../assets/episode-thumbs/S07E04.jpg'),
  S07E05: require('../../assets/episode-thumbs/S07E05.jpg'),
  S07E06: require('../../assets/episode-thumbs/S07E06.jpg'),
  S07E07: require('../../assets/episode-thumbs/S07E07.jpg'),
};

/** Metro asset id of the episode's bundled thumbnail, if it has one. */
export const episodeThumb = (episode: Pick<Episode, 'code'>): number | undefined =>
  thumbs[episode.code];

/** Episode codes that have a bundled thumbnail. */
export const episodeThumbCodes = (): string[] => Object.keys(thumbs);
