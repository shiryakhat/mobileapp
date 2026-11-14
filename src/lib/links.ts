import type { Episode } from '@/content';

const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_LINK_BASE ?? '').replace(/\/+$/, '');

/** In-app deep link (handled by expo-router: src/app/episode/[id].tsx). */
export function deepLink(episodeId: string, timeSec?: number | null): string {
  const t = timeSec ? `?t=${Math.floor(timeSec)}` : '';
  return `shiryakhat://episode/${episodeId}${t}`;
}

/**
 * A link that works for people without the app. Until universal links are set
 * up on shiryakhat.net (EXPO_PUBLIC_WEB_LINK_BASE), this is the YouTube
 * timestamp URL.
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
