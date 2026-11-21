import type { Episode } from '@content/types';

/** How long a new episode stays pinned as the featured card. */
export const FEATURED_PIN_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The most recently published episode (`publishedAt` is an ISO date, so it sorts as text). */
export function newestEpisode(list: readonly Episode[]): Episode | undefined {
  let newest: Episode | undefined;
  for (const e of list) if (!newest || e.publishedAt > newest.publishedAt) newest = e;
  return newest;
}

/**
 * The episode for the featured card at the top of the Episodes screen: the
 * newest one during its first two weeks, otherwise a uniformly random pick.
 * Call it once per mount / refresh — every call draws again.
 */
export function pickFeatured(
  list: readonly Episode[],
  now: number = Date.now(),
  random: () => number = Math.random,
): Episode | undefined {
  const newest = newestEpisode(list);
  if (!newest) return undefined;
  const age = now - Date.parse(newest.publishedAt);
  if (age <= FEATURED_PIN_DAYS * DAY_MS) return newest;
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))];
}
