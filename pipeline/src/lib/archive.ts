/**
 * archive.org as a fallback media host: resolve an item's playable files.
 *
 * Every episode's upload is mirrored at archive.org under a deterministic
 * identifier (`shiryakhat-<youtubeId>`, see `archiveIdFor`). The metadata API
 * lists the item's files; the app only ever sees the resolved download URLs.
 */
import {
  ARCHIVE_DOWNLOAD_URL,
  ARCHIVE_ID_OVERRIDES,
  ARCHIVE_ID_PREFIX,
  ARCHIVE_METADATA_URL,
} from '../config.js';
import type { Episode } from '../types.js';

export interface ArchiveFile {
  name: string;
  format?: string;
  source?: string;
  size?: string;
}

export interface ArchiveMedia {
  audioUrl?: string;
  videoUrl?: string;
}

/** `found: false` = the item does not exist (or has been taken down). */
export type ArchiveLookup = { found: true; files: ArchiveFile[] } | { found: false };

/**
 * The archive.org item of an episode: an explicit override (config, or an
 * `archiveId` already in episodes.json — e.g. a special uploaded there under
 * its own name) wins over the `shiryakhat-<youtubeId>` convention.
 */
export function archiveIdFor(
  ep: Pick<Episode, 'id' | 'youtubeId' | 'archiveId'>,
): string | undefined {
  const explicit = ARCHIVE_ID_OVERRIDES[ep.id] ?? ep.archiveId;
  if (explicit) return explicit;
  return ep.youtubeId ? `${ARCHIVE_ID_PREFIX}${ep.youtubeId}` : undefined;
}

const ext = (f: ArchiveFile) => /\.([a-z0-9]+)$/i.exec(f.name)?.[1]?.toLowerCase() ?? '';
const isOriginal = (f: ArchiveFile) => f.source === 'original';
const sizeOf = (f: ArchiveFile) => Number(f.size) || Number.MAX_SAFE_INTEGER;

/** Each path segment is escaped: file names carry spaces, brackets and Persian text. */
export function archiveDownloadUrl(identifier: string, name: string): string {
  const file = name.split('/').map(encodeURIComponent).join('/');
  return `${ARCHIVE_DOWNLOAD_URL}/${encodeURIComponent(identifier)}/${file}`;
}

/**
 * Pick the files the app can play.
 *
 *  - video: an mp4, preferring archive.org's own "h.264 IA" derivative (known
 *    to be H.264 — the original YouTube download may be AV1 / VP9 in an mp4
 *    container, which older devices cannot decode), then the original.
 *  - audio: an mp3 (original before derivative), else ogg. Items uploaded as
 *    video have no audio-only file; for those the smallest mp4 is used — the
 *    native players stream just its audio track — so the fallback still exists.
 */
export function pickArchiveMedia(identifier: string, files: ArchiveFile[]): ArchiveMedia {
  const first = (candidates: ArchiveFile[], rank: (f: ArchiveFile) => number) =>
    [...candidates].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))[0];

  const mp4s = files.filter((f) => ext(f) === 'mp4');
  const video = first(mp4s, (f) => (/h\.264/i.test(f.format ?? '') ? 0 : isOriginal(f) ? 1 : 2));
  const audio =
    first(
      files.filter((f) => ext(f) === 'mp3'),
      (f) => (isOriginal(f) ? 0 : 1),
    ) ??
    first(
      files.filter((f) => ext(f) === 'ogg' || ext(f) === 'oga'),
      (f) => (isOriginal(f) ? 0 : 1),
    ) ??
    first(mp4s, sizeOf);

  const url = (f: ArchiveFile | undefined) => f && archiveDownloadUrl(identifier, f.name);
  return { audioUrl: url(audio), videoUrl: url(video) };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * GET the item's metadata. Retries on 429 / 5xx (honouring Retry-After) and
 * throws when the network keeps failing; a missing item is `found: false`
 * (the API answers 200 with an empty object for unknown identifiers).
 */
export async function fetchArchiveFiles(identifier: string, attempts = 4): Promise<ArchiveLookup> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** attempt);
    try {
      const res = await fetch(`${ARCHIVE_METADATA_URL}/${encodeURIComponent(identifier)}`, {
        headers: { accept: 'application/json', 'user-agent': 'shiryakhat-content-pipeline' },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 404) return { found: false };
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('retry-after'));
        if (retryAfter > 0) await sleep(Math.min(retryAfter, 60) * 1000);
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { files?: ArchiveFile[]; is_dark?: boolean };
      if (!Array.isArray(body.files) || body.is_dark) return { found: false };
      return { found: true, files: body.files };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export interface ArchiveStats {
  resolved: number;
  missing: string[];
  failed: string[];
}

/**
 * Fill `archiveId` / `archiveAudioUrl` / `archiveVideoUrl` on every episode, in place.
 * Never throws: a missing item clears the fields, a network failure keeps
 * whatever the previous build resolved (possibly nothing). Requests are serial
 * with a short pause, which is plenty for ~50 items and polite to archive.org.
 */
export async function resolveArchive(
  episodes: Episode[],
  opts: { pauseMs?: number; lookup?: (identifier: string) => Promise<ArchiveLookup> } = {},
): Promise<ArchiveStats> {
  const lookup = opts.lookup ?? fetchArchiveFiles;
  const stats: ArchiveStats = { resolved: 0, missing: [], failed: [] };
  for (const ep of episodes) {
    const identifier = archiveIdFor(ep);
    if (!identifier) continue;
    let media: ArchiveMedia | undefined;
    try {
      const item = await lookup(identifier);
      media = item.found ? pickArchiveMedia(identifier, item.files) : {};
    } catch (err) {
      console.warn(`! archive.org lookup failed for ${ep.id} (${identifier}): ${String(err)}`);
      stats.failed.push(ep.id);
    }
    if (media) {
      const found = Boolean(media.audioUrl || media.videoUrl);
      if (!found) stats.missing.push(ep.id);
      // An explicit id is source data and survives; a derived one is only kept with media.
      ep.archiveId = found || ep.archiveId ? identifier : undefined;
      ep.archiveAudioUrl = media.audioUrl;
      ep.archiveVideoUrl = media.videoUrl;
    }
    if (ep.archiveAudioUrl || ep.archiveVideoUrl) stats.resolved++;
    await sleep(opts.pauseMs ?? 250);
  }
  return stats;
}
