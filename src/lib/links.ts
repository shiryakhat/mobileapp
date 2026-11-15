import type { Episode } from '@/content';

const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_LINK_BASE ?? '').replace(/\/+$/, '');

/** Domain of the iOS Universal Links / Android App Links (see app.json and site/.well-known/). */
export const UNIVERSAL_LINK_ORIGIN = 'https://shiryakhat.app';

const query = (timeSec?: number | null): string => {
  const t = timeSec ? Math.floor(timeSec) : 0;
  return t > 0 ? `?t=${t}` : '';
};

/** In-app deep link (handled by expo-router: src/app/episode/[id].tsx). */
export function deepLink(episodeId: string, timeSec?: number | null): string {
  return `shiryakhat://episode/${episodeId}${query(timeSec)}`;
}

/**
 * Universal link: opens the app at the episode (and timestamp) when it is
 * installed, and the web landing page (site/404.html) when it is not.
 */
export function episodeWebLink(episodeId: string, timeSec?: number | null): string {
  return `${UNIVERSAL_LINK_ORIGIN}/episode/${encodeURIComponent(episodeId)}${query(timeSec)}`;
}

/**
 * Rewrites an incoming system URL/path for expo-router (src/app/+native-intent.tsx).
 * `shiryakhat://episode/<id>` and `https://shiryakhat.app/episode/<id>` already
 * match the `episode/[id]` route as they are; only the short form `/e/<id>`
 * needs mapping onto it. Anything else is passed through untouched.
 */
export function resolveIncomingPath(path: string): string {
  const short = path.match(
    /^(?:[a-z][a-z0-9+.-]*:\/\/(?:[^/?#]*\/)?|\/)?e\/([^/?#]+)\/?(\?[^#]*)?(?:#.*)?$/i,
  );
  // `shiryakhat://e/<id>`, `https://shiryakhat.app/e/<id>` and `/e/<id>` all end up here.
  if (short) return `/episode/${short[1]}${short[2] ?? ''}`;
  return path;
}

/**
 * A link that works for people without the app: the YouTube timestamp URL,
 * unless EXPO_PUBLIC_WEB_LINK_BASE is set (e.g. to https://shiryakhat.app, to
 * share the universal link of `episodeWebLink` instead).
 */
export function webLink(ep: Episode, timeSec?: number | null): string {
  const t = timeSec ? Math.floor(timeSec) : 0;
  if (WEB_BASE) return `${WEB_BASE}/episode/${ep.id}${t ? `?t=${t}` : ''}`;
  return `https://youtu.be/${ep.youtubeId}${t ? `?t=${t}` : ''}`;
}

export function shareMessage(opts: {
  ep: Episode;
  title: string;
  quote?: string;
  timeSec?: number | null;
  timeLabel?: string;
}): string {
  const { ep, title, quote, timeSec, timeLabel } = opts;
  return [
    quote ? `«${quote}»` : undefined,
    `${title} — ${ep.code}${timeLabel ? ` · ${timeLabel}` : ''}`,
    webLink(ep, timeSec),
    deepLink(ep.id, timeSec),
  ]
    .filter(Boolean)
    .join('\n');
}
