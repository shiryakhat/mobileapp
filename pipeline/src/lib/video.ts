/**
 * Which episodes have a real video — the one rule behind `Episode.hasVideo`.
 *
 * The specials (season 0: conference talks, interviews) are filmed. The
 * numbered episodes were audio-only at first: up to S03E06 the YouTube /
 * archive.org upload is the audio over a still image, so the app must not
 * offer it as "video". From S03E07 on the episodes are filmed.
 *
 * `build-episodes` writes the flag and `finalize` re-derives it (offline, and
 * checked in CI), so `content/episodes.json` cannot drift from this rule. The
 * app only ever reads the flag; it never compares seasons or episode numbers.
 */
import type { Episode } from '../types.js';

/** The first numbered episode that has a real video: S03E07. */
export const FIRST_VIDEO_EPISODE = { season: 3, episode: 7 } as const;

export function hasVideoFor(ep: Pick<Episode, 'season' | 'episode'>): boolean {
  // Season 0 = specials.
  if (ep.season === 0) return true;
  const first = FIRST_VIDEO_EPISODE;
  return ep.season > first.season || (ep.season === first.season && ep.episode >= first.episode);
}
