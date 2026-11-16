import type { Episode } from '@/content';

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

/** `url` with `?t=<whole seconds>` added (or replaced); unchanged without a position. */
export function withTime(url: string, timeSec?: number | null): string {
  const t = timeSec ? Math.floor(timeSec) : 0;
  if (!(t > 0)) return url;
  const [, base, search = '', hash = ''] = url.match(/^([^?#]*)(\?[^#]*)?(#.*)?$/) ?? [, url];
  const kept = search
    .slice(1)
    .split('&')
    .filter((pair) => pair && !/^t=/.test(pair));
  return `${base}?${[...kept, `t=${t}`].join('&')}${hash}`;
}

/**
 * A link that works for people without the app: the episode's article on
 * shiryakhat.net, or its YouTube video when it has none. Carries the position
 * as `?t=` like the universal link does.
 */
export function webLink(ep: Episode, timeSec?: number | null): string {
  return withTime(ep.webUrl ?? `https://youtu.be/${ep.youtubeId}`, timeSec);
}

/**
 * The text that is shared or copied: the quote, the episode, then both links,
 * each under its label: the universal link (opens the app) and the web page.
 */
export function shareMessage(opts: {
  ep: Episode;
  title: string;
  quote?: string;
  timeSec?: number | null;
  timeLabel?: string;
  labels: { app: string; web: string };
}): string {
  const { ep, title, quote, timeSec, timeLabel, labels } = opts;
  return [
    quote ? `«${quote}»` : undefined,
    `${title} — ${ep.code}${timeLabel ? ` · ${timeLabel}` : ''}`,
    '',
    `${labels.app}:`,
    episodeWebLink(ep.id, timeSec),
    `${labels.web}:`,
    webLink(ep, timeSec),
  ]
    .filter((line) => line !== undefined)
    .join('\n');
}
