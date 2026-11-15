/**
 * Disk cache for everything the app fetches at runtime, so that whatever was
 * loaded once opens instantly and keeps working offline:
 *
 *  - images : remote pictures (episode thumbnails, lock-screen artwork)
 *  - data   : small network responses (community lists) as JSON
 *
 * It lives in the OS cache directory under `syk-cache/` and holds only derived,
 * re-creatable data: "Clear cache" wipes exactly this folder. Episodes the user
 * downloaded on purpose live in the documents directory (state/downloads) and
 * are never touched from here.
 *
 * Every function is best-effort — a cache failure must degrade to "fetch it
 * again", never to an error. There is no file system on web; there the cache
 * is simply always empty.
 */
import { Directory, File, Paths } from 'expo-file-system';
import { Image } from 'expo-image';
import { useEffect, useMemo } from 'react';
import { Platform } from 'react-native';

const supported = Platform.OS !== 'web';
const ROOT = 'syk-cache';
/** Suffix of a download in flight; it is moved into place only once complete. */
const PART = '.part';

type Bucket = 'images' | 'data';

const root = () => new Directory(Paths.cache, ROOT);

function bucket(name: Bucket): Directory {
  const dir = new Directory(root(), name);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** cyrb53: a small, well-spread string hash. Collisions are irrelevant at this scale. */
function hash(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

function imageName(url: string): string {
  const ext = /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? 'img';
  return `${hash(url)}.${ext}`;
}

// ── Images ───────────────────────────────────────────────────────────────────

/** File name -> file:// URI of every cached image; read from disk once per launch. */
let images: Map<string, string> | undefined;
const inFlight = new Map<string, Promise<string | undefined>>();

function imageIndex(): Map<string, string> {
  if (images) return images;
  images = new Map();
  try {
    for (const entry of bucket('images').list()) {
      if (entry instanceof File && !entry.name.endsWith(PART)) images.set(entry.name, entry.uri);
    }
  } catch {
    // Unreadable cache: behave as empty.
  }
  return images;
}

/** file:// URI of the cached copy of `url`, if there is one. Synchronous and cheap. */
export function cachedImageUri(url: string | undefined): string | undefined {
  if (!supported || !url) return undefined;
  return imageIndex().get(imageName(url));
}

async function downloadImage(url: string): Promise<string | undefined> {
  try {
    const dir = bucket('images');
    const name = imageName(url);
    // A failed download can leave a partial file behind (Android), so fetch
    // next to the final name and move into place only when complete.
    const part = new File(dir, name + PART);
    await File.downloadFileAsync(url, part, { idempotent: true });
    const file = new File(dir, name);
    part.moveSync(file, { overwrite: true });
    imageIndex().set(name, file.uri);
    return file.uri;
  } catch {
    return undefined;
  }
}

/** Make sure `url` is on disk. Resolves to its file:// URI, or undefined if it could not be fetched. */
export function cacheImage(url: string): Promise<string | undefined> {
  if (!supported) return Promise.resolve(undefined);
  const hit = cachedImageUri(url);
  if (hit) return Promise.resolve(hit);
  let job = inFlight.get(url);
  if (!job) {
    job = downloadImage(url).finally(() => inFlight.delete(url));
    inFlight.set(url, job);
  }
  return job;
}

/** Drop a cached image that turned out to be unusable (e.g. purged by the OS). */
export function forgetImage(url: string): void {
  images?.delete(imageName(url));
}

/**
 * Quietly fetch the images that are not cached yet, one at a time. Stops at the
 * first failure — that usually means "offline", and the next launch tries again.
 */
export async function warmImageCache(urls: string[]): Promise<void> {
  for (const url of urls) {
    if (cachedImageUri(url)) continue;
    if (!(await cacheImage(url))) return;
  }
}

/**
 * What to hand to an <Image>: the cached file when there is one, otherwise the
 * remote URL — which is then cached for next time. The value is stable for the
 * lifetime of a URL, so a finished download never swaps the picture mid-view.
 */
export function useCachedImage(url: string): string {
  const uri = useMemo(() => cachedImageUri(url) ?? url, [url]);
  useEffect(() => {
    if (uri === url) void cacheImage(url);
  }, [uri, url]);
  return uri;
}

// ── JSON data ────────────────────────────────────────────────────────────────

const dataFile = (key: string) =>
  new File(bucket('data'), `${key.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);

/** Last value stored under `key`, read synchronously (these files are small). */
export function readCachedJson<T>(key: string): T | undefined {
  if (!supported) return undefined;
  try {
    const file = dataFile(key);
    return file.exists ? (JSON.parse(file.textSync()) as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeCachedJson(key: string, value: unknown): void {
  if (!supported) return;
  try {
    const file = dataFile(key);
    if (!file.exists) file.create({ intermediates: true, overwrite: true });
    file.writeSync(JSON.stringify(value));
  } catch {
    // Not cached this time.
  }
}

/**
 * Run a network call with a disk fallback: a fresh result is stored under
 * `key`; when the call fails (offline) the last stored result is returned
 * instead. Rethrows only when there is nothing cached either.
 */
export async function withCachedFallback<T>(key: string, load: () => Promise<T>): Promise<T> {
  try {
    const fresh = await load();
    writeCachedJson(key, fresh);
    return fresh;
  } catch (err) {
    const cached = readCachedJson<T>(key);
    if (cached !== undefined) return cached;
    throw err;
  }
}

// ── Size & clearing ──────────────────────────────────────────────────────────

/** Bytes currently used by the cache folder. */
export function cacheBytes(): number {
  if (!supported) return 0;
  try {
    const dir = root();
    return dir.exists ? (dir.size ?? 0) : 0;
  } catch {
    return 0;
  }
}

/**
 * Remove every cached image and response. Only derived data: downloaded
 * episodes, bookmarks, progress and settings are stored elsewhere and stay.
 */
export async function clearCache(): Promise<void> {
  images = undefined;
  inFlight.clear();
  if (supported) {
    try {
      const dir = root();
      if (dir.exists) dir.delete();
    } catch {
      // Nothing to delete.
    }
  }
  // expo-image keeps its own copies of whatever it loaded straight from the network.
  try {
    await Promise.allSettled([Image.clearDiskCache(), Image.clearMemoryCache()]);
  } catch {
    // Not available on this platform.
  }
}
