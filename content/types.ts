/** Shapes of the committed content bundle. Single source of truth for the pipeline and the app. */

export interface Chapter {
  startSec: number;
  endSec: number;
  title: string;
}

export interface Episode {
  /** Stable slug, e.g. "s07e07" (or "sp01" for specials). */
  id: string;
  youtubeId: string;
  /** Other uploads of the same episode (re-uploads / audio-only mirrors). */
  altYoutubeIds: string[];
  season: number;
  episode: number;
  code: string;
  titleFa: string;
  titleEn: string;
  /**
   * Specials that are talks: the conference / venue / show the talk was given
   * at (e.g. "Devcon 5"). Shown with the date in place of the "SP<n>" code.
   */
  conferenceEn?: string;
  conferenceFa?: string;
  /** ISO date (YYYY-MM-DD). */
  publishedAt: string;
  durationSec: number;
  chapters: Chapter[];
  youtubeThumb: string;
  descriptionFa: string;
  descriptionEn: string;
  keywords: string[];
  /** Public RSS enclosure; when absent the app falls back to YouTube for audio. */
  audioUrl?: string;
  /**
   * archive.org item mirroring this episode. Defaults to `shiryakhat-<youtubeId>`;
   * set it in the source data when an item (e.g. a special) is named differently.
   */
  archiveId?: string;
  /**
   * Fallback audio from archive.org, resolved at build time by the pipeline.
   * An mp3 where the item has one; otherwise the item's mp4, of which the
   * native player streams the audio track.
   */
  archiveAudioUrl?: string;
  /** Fallback H.264 mp4 from archive.org (absent for audio-only episodes). */
  archiveVideoUrl?: string;
  spotifyUrl?: string;
  appleUrl?: string;
  castboxUrl?: string;
  webUrl?: string;
  viewCount?: number;
  likeCount?: number;
  /** Stem of the corpus file used for the transcript (pipeline bookkeeping). */
  sourceStem: string;
}

/** Columnar cue: [startMs, endMs, en, fa]. */
export type Cue = [number, number, string, string];

export interface Transcript {
  id: string;
  cues: Cue[];
}

export interface Quote {
  startSec: number;
  fa: string;
  en: string;
  speaker?: string;
}

export interface GlossaryTerm {
  term: string;
  termFa: string;
  definitionEn: string;
  definitionFa: string;
}

export interface Correction {
  lang: 'en' | 'fa';
  wrong: string;
  right: string;
}

export interface Enrichment {
  id: string;
  model: string;
  generatedAt: string;
  summaryFa: string;
  summaryEn: string;
  quotes: Quote[];
  glossary: GlossaryTerm[];
  corrections: Correction[];
}

export interface GlossaryEntry extends GlossaryTerm {
  slug: string;
  /** Lower-cased surface forms used for inline tap-to-define matching. */
  aliases: string[];
  episodes: string[];
}

export interface SearchIndex {
  version: 1;
  episodes: string[];
  /** token -> indices into `episodes` that contain it. Sorted by token. */
  tokens: Record<string, number[]>;
}
