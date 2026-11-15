/**
 * Offline audio downloads: state (persisted) + manager (in-memory tasks).
 * Audio only — video stays streamed in v1. Downloads are resumable: pausing
 * stores the platform resume data, so a paused download survives an app restart.
 *
 * TODO: video downloads, together with the archive.org fallback (and possibly
 * Cloudflare R2 / Stream hosting) — see the note at `audioSourceFor` in
 * src/player/controller.ts.
 */
import { Directory, DownloadTask, File, Paths, type DownloadPauseState } from 'expo-file-system';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Episode } from '@/content';
import { jsonStorage } from './storage';

export type DownloadStatus = 'downloading' | 'paused' | 'done' | 'error';

export interface DownloadItem {
  episodeId: string;
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

const fileFor = (episodeId: string) => new File(audioDir(), `${episodeId}.mp3`);

/**
 * file:// URI of the downloaded audio, if the episode is fully downloaded.
 * The path is rebuilt on every call rather than read back from the persisted
 * `fileUri`: iOS moves the app's container (and with it every absolute path)
 * on app updates, which would silently break offline playback. If the file is
 * gone the caller falls back to streaming.
 */
export function localAudioUri(episodeId: string): string | undefined {
  const item = store().items[episodeId];
  if (item?.status !== 'done') return undefined;
  try {
    const file = fileFor(episodeId);
    return file.exists ? file.uri : undefined;
  } catch {
    return item.fileUri;
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

export function startDownload(ep: Episode): void {
  // "Done" only counts while the file is really there; otherwise fetch it again.
  if (!ep.audioUrl || tasks.has(ep.id) || localAudioUri(ep.id)) return;
  const destination = fileFor(ep.id);
  if (destination.exists) destination.delete();
  store().patch(ep.id, {
    status: 'downloading',
    bytesWritten: 0,
    totalBytes: 0,
    error: undefined,
    pauseState: undefined,
    fileUri: undefined,
  });
  const task = File.createDownloadTask(ep.audioUrl, destination, { onProgress: onProgress(ep.id) });
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
  try {
    const file = fileFor(episodeId);
    if (file.exists) file.delete();
  } catch {
    // Nothing on disk — fine.
  }
  store().drop(episodeId);
}

export function deleteAllDownloads(): void {
  for (const id of Object.keys(store().items)) deleteDownload(id);
}

/** Bytes the downloads folder really occupies, unfinished downloads included. */
export function downloadsBytes(): number {
  try {
    const size = audioDir().size;
    if (typeof size === 'number') return size;
  } catch {
    // Fall through to the bookkeeping figure (web, or an unreadable folder).
  }
  return Object.values(store().items).reduce((n, i) => n + i.bytesWritten, 0);
}

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
