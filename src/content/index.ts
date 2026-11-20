/**
 * Read-only access to the committed content bundle (./content).
 * The app never touches the network or the raw corpus for content.
 */
import {
  enrichmentLoaders,
  episodes as allEpisodes,
  glossary as allGlossary,
  transcriptLoaders,
} from '@content/index.generated';
import type { Enrichment, Episode, GlossaryEntry, Transcript } from '@content/types';

export type {
  Chapter,
  Cue,
  Enrichment,
  Episode,
  GlossaryEntry,
  Quote,
  Transcript,
} from '@content/types';

export const episodes: Episode[] = allEpisodes;
export const glossary: GlossaryEntry[] = allGlossary;

const byId = new Map(episodes.map((e) => [e.id, e]));
export const getEpisode = (id: string | undefined): Episode | undefined =>
  id ? byId.get(id) : undefined;

export interface SeasonSection {
  season: number;
  data: Episode[];
}

/** Specials are numbered in the order they were added, not by date: latest talk first. */
const byDateDesc = (a: Episode, b: Episode) =>
  b.publishedAt.localeCompare(a.publishedAt) || b.episode - a.episode;

/**
 * Newest season first; specials (season 0) last. Episodes newest-first within a
 * season: by episode number, and by date for the specials.
 */
export const seasons: SeasonSection[] = (() => {
  const map = new Map<number, Episode[]>();
  for (const e of episodes) map.set(e.season, [...(map.get(e.season) ?? []), e]);
  return [...map.entries()]
    .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : b - a))
    .map(([season, data]) => ({
      season,
      data: data.sort(season === 0 ? byDateDesc : (a, b) => b.episode - a.episode),
    }));
})();

const transcriptCache = new Map<string, Transcript>();
/** Transcripts are large; they are required lazily and cached. */
export function getTranscript(id: string): Transcript | undefined {
  const cached = transcriptCache.get(id);
  if (cached) return cached;
  const t = transcriptLoaders[id]?.();
  if (t) transcriptCache.set(id, t);
  return t;
}

export function getEnrichment(id: string): Enrichment | undefined {
  return enrichmentLoaders[id]?.();
}

export const glossaryBySlug = new Map(glossary.map((g) => [g.slug, g]));

/** Index of the chapter containing `sec`, or -1. */
export function chapterIndexAt(ep: Episode, sec: number): number {
  for (let i = ep.chapters.length - 1; i >= 0; i--) {
    if (sec >= ep.chapters[i]!.startSec) return i;
  }
  return -1;
}

/** Binary search for the cue active at `ms` (last cue starting at or before it). */
export function cueIndexAt(transcript: Transcript, ms: number): number {
  const cues = transcript.cues;
  let lo = 0;
  let hi = cues.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid]![0] <= ms) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
