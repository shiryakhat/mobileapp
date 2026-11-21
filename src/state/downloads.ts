/**
 * Offline downloads: state (persisted) + manager (in-memory tasks).
 * Downloads are resumable: pausing stores the platform resume data, so a paused
 * download survives an app restart.
 *
 * An episode downloads one kind at a time, and can keep both on disk: the kind
 * fetched last is the item itself (`kind`, `status`, …), a finished download of
 * the other kind stays next to it as `also`.
 *  - audio : mirrors `audioSourceFor` in src/player/controller.ts — the RSS
 *            enclosure when present, else the archive.org mp3
 *            (`archiveAudioUrl`), which is how the talk specials (no enclosure)
 *            download. Saved as `audio/<id>.mp3`.
 *  - video : the archive.org mp4 (`archiveVideoUrl`) of an episode that has a
 *            real video (`hasVideo`), saved as `video/<id>.mp4`
 *            and played offline by <LocalVideoSurface/> (expo-video). Its audio
 *            track also serves audio mode, so a video download covers both.
 */
import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from 'expo-file-system';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Episode } from '@/content';
import { jsonStorage } from './storage';

export type DownloadKind = 'audio' | 'video';
export type DownloadStatus = 'downloading' | 'paused' | 'done' | 'error';

export interface DownloadItem {
  episodeId: string;
  /** What is (being) downloaded. Absent on items persisted before v1.3.0: audio. */
  kind?: DownloadKind;
  status: DownloadStatus;
  bytesWritten: number;
  totalBytes: number;
  fileUri?: string;
  pauseState?: DownloadPauseState;
  error?: string;
  /**
   * A finished download of the other kind, kept on disk next to this one (an
   * episode with both an mp3 and an mp4 can hold both; v1.3.2).
   */
  also?: { kind: DownloadKind; totalBytes: number };
  /**
   * When the episode entered the downloads list. Set once and never touched by
   * progress, pause/resume or retry, so it is what the list is ordered by
   * (v1.3.4). Absent on items persisted before that until they are rehydrated.
   */
  addedAt?: number;
  /** Last change of any kind — moves on every progress tick; never sort by it. */
  updatedAt: number;
}

interface DownloadsState {
  items: Record<string, DownloadItem>;
  patch: (episodeId: string, patch: Partial<DownloadItem>) => void;
  drop: (episodeId: string) => void;
}

export const useDownloads = create<DownloadsState>()(
  persist(
    (set) => ({
      items: {},
      patch: (episodeId, patch) =>
        set((s) => {
          const now = Date.now();
          const previous = s.items[episodeId];
          return {
            items: {
              ...s.items,
              [episodeId]: {
                episodeId,
                status: 'downloading',
                bytesWritten: 0,
                totalBytes: 0,
                ...previous,
                ...patch,
                // Fixed from the moment the item exists (see `sortDownloads`).
                addedAt: previous ? (previous.addedAt ?? previous.updatedAt) : now,
                updatedAt: now,
              },
            },
          };
        }),
      drop: (episodeId) =>
        set((s) => {
          const next = { ...s.items };
          delete next[episodeId];
          return { items: next };
        }),
    }),
    {
      name: 'syk.downloads',
      storage: jsonStorage,
      // A download that was mid-flight when the app died can only be restarted.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const item of Object.values(state.items)) {
          // Items from before v1.3.4: their last change is the best "added" we have.
          item.addedAt ??= item.updatedAt;
          if (item.status === 'downloading') {
            item.status = item.pauseState ? 'paused' : 'error';
          }
        }
      },
    },
  ),
);

/**
 * The downloads list, in display order: most recently added first.
 *
 * The order only depends on `addedAt` (and the id, to break ties), which do not
 * change while bytes arrive. Sorting by `updatedAt` — as the list did up to
 * v1.3.3 — made the rows of concurrent downloads swap places on every progress
 * tick, because each tick bumps `updatedAt`.
 */
export function sortDownloads(items: Record<string, DownloadItem>): DownloadItem[] {
  const added = (item: DownloadItem) => item.addedAt ?? item.updatedAt;
  return Object.values(items).sort(
    (a, b) => added(b) - added(a) || a.episodeId.localeCompare(b.episodeId),
  );
}

const tasks = new Map<string, DownloadTask>();
const store = () => useDownloads.getState();

/**
 * A byte count as a plain, finite, non-negative number.
 *
 * expo-file-system's native progress events carry `bytesWritten` / `totalBytes`
 * as Int64, which reaches JS as a **BigInt** (typed `number`). A BigInt in the
 * store is poison: `JSON.stringify` throws on it (the persist middleware) and so
 * does `Math.min/max` (the progress ring, during render) — which took the whole
 * app down the moment a download reported progress (v1.3.0, build 36).
 * Everything that enters the store goes through here. Unknown sizes (-1) are 0.
 */
export function toBytes(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Mark a download as failed; the button then offers a retry. Never throws. */
function fail(episodeId: string, err: unknown): void {
  tasks.delete(episodeId);
  try {
    store().patch(episodeId, { status: 'error', error: message(err), pauseState: undefined });
  } catch {
    // Nothing more we can do; the caller must still not crash.
  }
}

function audioDir(): Directory {
  const dir = new Directory(Paths.document, 'audio');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function videoDir(): Directory {
  const dir = new Directory(Paths.document, 'video');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

const fileFor = (episodeId: string, kind: DownloadKind) =>
  kind === 'video'
    ? new File(videoDir(), `${episodeId}.mp4`)
    : new File(audioDir(), `${episodeId}.mp3`);

/** The kind an item was downloaded as (items from before v1.3.0 are audio). */
export const downloadKind = (item: Pick<DownloadItem, 'kind'> | undefined): DownloadKind =>
  item?.kind ?? 'audio';

/**
 * Where a download of `kind` comes from, if the episode has one. Video only
 * for an episode that has a real one (`Episode.hasVideo`), whatever archive.org
 * holds for it.
 */
export const downloadSourceFor = (ep: Episode, kind: DownloadKind): string | undefined =>
  kind === 'video'
    ? ep.hasVideo
      ? ep.archiveVideoUrl
      : undefined
    : (ep.audioUrl ?? ep.archiveAudioUrl);

/** The kinds this episode can be downloaded as; more than one means "ask the user". */
export function downloadKindsFor(ep: Episode): DownloadKind[] {
  const kinds: DownloadKind[] = [];
  if (downloadSourceFor(ep, 'audio')) kinds.push('audio');
  if (downloadSourceFor(ep, 'video')) kinds.push('video');
  return kinds;
}

/** The kinds that are finished and kept on disk for an item: audio first, then video. */
export function downloadedKinds(
  item: Pick<DownloadItem, 'kind' | 'status' | 'also'> | undefined,
): DownloadKind[] {
  if (!item) return [];
  const have = new Set<DownloadKind>();
  if (item.status === 'done') have.add(downloadKind(item));
  if (item.also) have.add(item.also.kind);
  return (['audio', 'video'] as const).filter((k) => have.has(k));
}

/** What the menu of a downloaded episode offers, in order. */
export type ManageAction =
  | 'download-audio'
  | 'download-video'
  | 'delete-audio'
  | 'delete-video'
  /** Both kinds are on disk: remove them together. */
  | 'delete-all'
  /** The episode only exists as one kind: plain "Delete download". */
  | 'delete';

/**
 * The choices for an episode that is already downloaded:
 *  - one kind on disk, the other available → download the other, delete this one;
 *  - both on disk → delete either, or both;
 *  - one kind on disk and nothing else to get → delete the download.
 */
export function manageActionsFor(
  ep: Episode,
  item: Pick<DownloadItem, 'kind' | 'status' | 'also'> | undefined,
): ManageAction[] {
  const have = downloadedKinds(item);
  if (have.length === 0) return [];
  if (have.length > 1) return [...have.map((k) => `delete-${k}` as const), 'delete-all'];
  const missing = downloadKindsFor(ep).filter((k) => !have.includes(k));
  if (missing.length === 0) return ['delete'];
  return [...missing.map((k) => `download-${k}` as const), `delete-${have[0]!}` as const];
}

/**
 * file:// URI of the finished download, if it is of `kind`.
 * The path is rebuilt on every call rather than read back from the persisted
 * `fileUri`: iOS moves the app's container (and with it every absolute path)
 * on app updates, which would silently break offline playback. If the file is
 * gone the caller falls back to streaming.
 */
function localUri(episodeId: string, kind: DownloadKind): string | undefined {
  const item = store().items[episodeId];
  if (!item) return undefined;
  const primary = item.status === 'done' && downloadKind(item) === kind;
  if (!primary && item.also?.kind !== kind) return undefined;
  try {
    const file = fileFor(episodeId, kind);
    return file.exists ? file.uri : undefined;
  } catch {
    return primary ? item.fileUri : undefined;
  }
}

/** The downloaded mp3, if the episode has an audio download. */
export const localAudioUri = (episodeId: string) => localUri(episodeId, 'audio');

/** The downloaded mp4, if the episode has a video download. */
export const localVideoUri = (episodeId: string) => localUri(episodeId, 'video');

/** Remove what is on disk for an episode as `kind`. Never throws. */
function removeFile(episodeId: string, kind: DownloadKind): void {
  try {
    const file = fileFor(episodeId, kind);
    if (file.exists) file.delete();
  } catch {
    // Nothing on disk — fine.
  }
}

/** Remove whatever is on disk for an episode, of either kind. */
function removeFiles(episodeId: string): void {
  for (const kind of ['audio', 'video'] as const) removeFile(episodeId, kind);
}

const otherKind = (kind: DownloadKind): DownloadKind => (kind === 'video' ? 'audio' : 'video');

/**
 * The finished download of the other kind that stays on disk while `want` is
 * (re)fetched — its file must really be there.
 */
function keptBeside(item: DownloadItem | undefined, want: DownloadKind): DownloadItem['also'] {
  const other = otherKind(want);
  if (!item || !localUri(item.episodeId, other)) return undefined;
  return item.also?.kind === other
    ? item.also
    : { kind: other, totalBytes: toBytes(item.totalBytes) };
}

function track(episodeId: string, task: DownloadTask, run: Promise<File | null>): void {
  tasks.set(episodeId, task);
  run
    .then((file) => {
      // null => paused or cancelled; state was already updated by the caller.
      if (!file) return;
      tasks.delete(episodeId);
      const size = toBytes(file.size) || toBytes(store().items[episodeId]?.totalBytes);
      store().patch(episodeId, {
        status: 'done',
        fileUri: file.uri,
        bytesWritten: size,
        totalBytes: size,
        pauseState: undefined,
        error: undefined,
      });
    })
    .catch((err: unknown) => {
      tasks.delete(episodeId);
      if (store().items[episodeId]?.status !== 'downloading') return;
      fail(episodeId, err);
    });
}

const onProgress = (episodeId: string) => {
  let last = 0;
  return (progress: { bytesWritten: number | bigint; totalBytes: number | bigint }) => {
    // Called straight from a native event: it must never throw.
    try {
      // Native sends Int64 → BigInt; the store only ever holds plain numbers.
      const bytesWritten = toBytes(progress?.bytesWritten);
      const totalBytes = toBytes(progress?.totalBytes);
      const now = Date.now();
      if (now - last < 400 && bytesWritten < totalBytes) return; // throttle re-renders
      last = now;
      // A late event must not revive a download that was paused, failed or deleted.
      if (store().items[episodeId]?.status !== 'downloading') return;
      store().patch(episodeId, { bytesWritten, totalBytes });
    } catch {
      // A missed progress tick is harmless.
    }
  };
};

/**
 * Download `ep` as `kind`. Without a kind, the one the episode was last
 * downloaded as is used again (retry after an error, re-fetch of a lost file),
 * and audio for an episode that was never downloaded.
 */
export function startDownload(ep: Episode, kind?: DownloadKind): void {
  // Runs inside a press handler: whatever the file system or the native task
  // throws ends as the item's `error` state (tap to retry), never as a crash.
  try {
    const previous = store().items[ep.id];
    // A retry of a kind the episode no longer offers (a video download begun
    // before the episode became audio-only) fetches the audio instead.
    const again = downloadKind(previous);
    const want = kind ?? (downloadSourceFor(ep, again) ? again : 'audio');
    const src = downloadSourceFor(ep, want);
    // "Done" only counts while the file is really there; otherwise fetch it again.
    if (!src || tasks.has(ep.id) || localUri(ep.id, want)) return;
    // A finished download of the other kind stays (audio next to video); any
    // other leftover — of this kind, or an unfinished one of the other — goes first.
    const also = keptBeside(previous, want);
    removeFile(ep.id, want);
    if (!also) removeFile(ep.id, otherKind(want));
    store().patch(ep.id, {
      kind: want,
      also,
      status: 'downloading',
      bytesWritten: 0,
      totalBytes: 0,
      error: undefined,
      pauseState: undefined,
      fileUri: undefined,
    });
    const destination = fileFor(ep.id, want);
    const task = File.createDownloadTask(src, destination, { onProgress: onProgress(ep.id) });
    track(ep.id, task, task.downloadAsync());
  } catch (err) {
    fail(ep.id, err);
  }
}

export async function pauseDownload(episodeId: string): Promise<void> {
  const task = tasks.get(episodeId);
  if (!task) return;
  try {
    store().patch(episodeId, { status: 'paused' });
    await task.pauseAsync();
    store().patch(episodeId, { pauseState: task.savable() });
  } catch {
    // No resume data (e.g. paused before the first byte): the item stays
    // 'paused' without it, and resuming starts the download over.
    tasks.delete(episodeId);
  }
}

export function resumeDownload(ep: Episode): void {
  const item = store().items[ep.id];
  let task = tasks.get(ep.id);
  if (!task && item?.pauseState) {
    try {
      // Rebuild the task from persisted resume data (e.g. after an app restart).
      task = DownloadTask.fromSavable(item.pauseState, { onProgress: onProgress(ep.id) });
    } catch {
      task = undefined;
    }
  }
  if (!task) {
    startDownload(ep);
    return;
  }
  try {
    store().patch(ep.id, { status: 'downloading', error: undefined });
    track(ep.id, task, task.resumeAsync());
  } catch (err) {
    fail(ep.id, err);
  }
}

/**
 * Delete an episode's download. With a `kind`, only that file goes and a
 * finished download of the other kind is kept; without one, everything goes.
 */
export function deleteDownload(episodeId: string, kind?: DownloadKind): void {
  const item = store().items[episodeId];
  if (kind && item) {
    if (item.also?.kind === kind) {
      removeFile(episodeId, kind);
      store().patch(episodeId, { also: undefined });
      return;
    }
    // Nothing of that kind here: leave the other one alone.
    if (downloadKind(item) !== kind) return;
    if (item.also) {
      // The kept download of the other kind takes over as the item.
      try {
        tasks.get(episodeId)?.cancel();
      } catch {
        // Already finished or released — nothing to cancel.
      }
      tasks.delete(episodeId);
      removeFile(episodeId, kind);
      store().patch(episodeId, {
        kind: item.also.kind,
        status: 'done',
        bytesWritten: item.also.totalBytes,
        totalBytes: item.also.totalBytes,
        fileUri: undefined, // rebuilt from the id on every read (see localUri)
        pauseState: undefined,
        error: undefined,
        also: undefined,
      });
      return;
    }
  }
  try {
    tasks.get(episodeId)?.cancel();
  } catch {
    // Already finished or released — nothing to cancel.
  }
  tasks.delete(episodeId);
  removeFiles(episodeId);
  store().drop(episodeId);
}

export function deleteAllDownloads(): void {
  for (const id of Object.keys(store().items)) deleteDownload(id);
}

/** Bytes the download folders (audio + video) really occupy, unfinished downloads included. */
export function downloadsBytes(): number {
  try {
    const audio: unknown = audioDir().size;
    const video: unknown = videoDir().size;
    if (audio != null && video != null) return toBytes(audio) + toBytes(video);
  } catch {
    // Fall through to the bookkeeping figure (web, or an unreadable folder).
  }
  return Object.values(store().items).reduce(
    (n, i) => n + toBytes(i.bytesWritten) + toBytes(i.also?.totalBytes),
    0,
  );
}

/** Bytes of finished downloads, of both kinds, by the bookkeeping. */
export function storageStats(): { usedBytes: number; freeBytes: number } {
  const usedBytes = Object.values(store().items).reduce(
    (n, i) => n + (i.status === 'done' ? toBytes(i.totalBytes) : 0) + toBytes(i.also?.totalBytes),
    0,
  );
  let freeBytes = 0;
  try {
    freeBytes = toBytes(Paths.availableDiskSpace);
  } catch {
    // unavailable on web
  }
  return { usedBytes, freeBytes };
}
