/**
 * Offline downloads: state (persisted) + manager (in-memory tasks).
 * Downloads are resumable: pausing stores the platform resume data, so a paused
 * download survives an app restart.
 *
 * An episode is downloaded as ONE kind at a time:
 *  - audio : mirrors `audioSourceFor` in src/player/controller.ts — the RSS
 *            enclosure when present, else the archive.org mp3
 *            (`archiveAudioUrl`), which is how the talk specials (no enclosure)
 *            download. Saved as `audio/<id>.mp3`.
 *  - video : the archive.org mp4 (`archiveVideoUrl`), saved as `video/<id>.mp4`
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
        set((s) => ({
          items: {
            ...s.items,
            [episodeId]: {
              episodeId,
              status: 'downloading',
              bytesWritten: 0,
              totalBytes: 0,
              ...s.items[episodeId],
              ...patch,
              updatedAt: Date.now(),
            },
          },
        })),
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
          if (item.status === 'downloading') {
            item.status = item.pauseState ? 'paused' : 'error';
          }
        }
      },
    },
  ),
);

const tasks = new Map<string, DownloadTask>();
const store = () => useDownloads.getState();

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

/** Where a download of `kind` comes from, if the episode has one. */
export const downloadSourceFor = (ep: Episode, kind: DownloadKind): string | undefined =>
  kind === 'video' ? ep.archiveVideoUrl : (ep.audioUrl ?? ep.archiveAudioUrl);

/** The kinds this episode can be downloaded as; more than one means "ask the user". */
export function downloadKindsFor(ep: Episode): DownloadKind[] {
  const kinds: DownloadKind[] = [];
  if (downloadSourceFor(ep, 'audio')) kinds.push('audio');
  if (downloadSourceFor(ep, 'video')) kinds.push('video');
  return kinds;
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
  if (item?.status !== 'done' || downloadKind(item) !== kind) return undefined;
  try {
    const file = fileFor(episodeId, kind);
    return file.exists ? file.uri : undefined;
  } catch {
    return item.fileUri;
  }
}

/** The downloaded mp3, if the episode was downloaded as audio. */
export const localAudioUri = (episodeId: string) => localUri(episodeId, 'audio');

/** The downloaded mp4, if the episode was downloaded as video. */
export const localVideoUri = (episodeId: string) => localUri(episodeId, 'video');

/** Remove whatever is on disk for an episode, of either kind. */
function removeFiles(episodeId: string): void {
  for (const kind of ['audio', 'video'] as const) {
    try {
      const file = fileFor(episodeId, kind);
      if (file.exists) file.delete();
    } catch {
      // Nothing on disk — fine.
    }
  }
}

function track(episodeId: string, task: DownloadTask, run: Promise<File | null>): void {
  tasks.set(episodeId, task);
  run
    .then((file) => {
      // null => paused or cancelled; state was already updated by the caller.
      if (!file) return;
      tasks.delete(episodeId);
      store().patch(episodeId, {
        status: 'done',
        fileUri: file.uri,
        bytesWritten: file.size ?? store().items[episodeId]?.totalBytes ?? 0,
        totalBytes: file.size ?? store().items[episodeId]?.totalBytes ?? 0,
        pauseState: undefined,
        error: undefined,
      });
    })
    .catch((err: unknown) => {
      tasks.delete(episodeId);
      if (store().items[episodeId]?.status !== 'downloading') return;
      store().patch(episodeId, {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

const onProgress = (episodeId: string) => {
  let last = 0;
  return ({ bytesWritten, totalBytes }: { bytesWritten: number; totalBytes: number }) => {
    const now = Date.now();
    if (now - last < 400 && bytesWritten < totalBytes) return; // throttle re-renders
    last = now;
    store().patch(episodeId, { bytesWritten, totalBytes });
  };
};

/**
 * Download `ep` as `kind`. Without a kind, the one the episode was last
 * downloaded as is used again (retry after an error, re-fetch of a lost file),
 * and audio for an episode that was never downloaded.
 */
export function startDownload(ep: Episode, kind?: DownloadKind): void {
  const want = kind ?? downloadKind(store().items[ep.id]);
  const src = downloadSourceFor(ep, want);
  // "Done" only counts while the file is really there; otherwise fetch it again.
  if (!src || tasks.has(ep.id) || localUri(ep.id, want)) return;
  // One kind per episode: a leftover of this or the other kind goes first.
  removeFiles(ep.id);
  const destination = fileFor(ep.id, want);
  store().patch(ep.id, {
    kind: want,
    status: 'downloading',
    bytesWritten: 0,
    totalBytes: 0,
    error: undefined,
    pauseState: undefined,
    fileUri: undefined,
  });
  const task = File.createDownloadTask(src, destination, { onProgress: onProgress(ep.id) });
  track(ep.id, task, task.downloadAsync());
}

export async function pauseDownload(episodeId: string): Promise<void> {
  const task = tasks.get(episodeId);
  if (!task) return;
  store().patch(episodeId, { status: 'paused' });
  await task.pauseAsync();
  store().patch(episodeId, { pauseState: task.savable() });
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
  store().patch(ep.id, { status: 'downloading', error: undefined });
  track(ep.id, task, task.resumeAsync());
}

export function deleteDownload(episodeId: string): void {
  tasks.get(episodeId)?.cancel();
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
    const audio = audioDir().size;
    const video = videoDir().size;
    if (typeof audio === 'number' && typeof video === 'number') return audio + video;
  } catch {
    // Fall through to the bookkeeping figure (web, or an unreadable folder).
  }
  return Object.values(store().items).reduce((n, i) => n + i.bytesWritten, 0);
}

/** Bytes of finished downloads, of both kinds, by the bookkeeping. */
export function storageStats(): { usedBytes: number; freeBytes: number } {
  const usedBytes = Object.values(store().items)
    .filter((i) => i.status === 'done')
    .reduce((n, i) => n + i.totalBytes, 0);
  let freeBytes = 0;
  try {
    freeBytes = Paths.availableDiskSpace;
  } catch {
    // unavailable on web
  }
  return { usedBytes, freeBytes };
}
