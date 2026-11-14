import * as Crypto from 'expo-crypto';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonStorage } from './storage';

export interface Bookmark {
  /** Client-generated UUID; doubles as the primary key for cloud sync. */
  id: string;
  episodeId: string;
  /** null = the whole episode; otherwise a moment in it. */
  timeSec: number | null;
  note?: string;
  createdAt: number;
  updatedAt: number;
  /** Soft delete so removals can propagate to the cloud later. */
  deletedAt?: number;
}

interface BookmarksState {
  items: Bookmark[];
  add: (episodeId: string, timeSec: number | null, note?: string) => Bookmark;
  remove: (id: string) => void;
  toggleEpisode: (episodeId: string) => void;
  /** Replace local state with a merged set (used by cloud sync). */
  replaceAll: (items: Bookmark[]) => void;
}

export const useBookmarks = create<BookmarksState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (episodeId, timeSec, note) => {
        const now = Date.now();
        const bookmark: Bookmark = {
          id: Crypto.randomUUID(),
          episodeId,
          timeSec: timeSec === null ? null : Math.floor(timeSec),
          note: note?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({ items: [bookmark, ...s.items] }));
        return bookmark;
      },
      remove: (id) =>
        set((s) => ({
          items: s.items.map((b) =>
            b.id === id ? { ...b, deletedAt: Date.now(), updatedAt: Date.now() } : b,
          ),
        })),
      toggleEpisode: (episodeId) => {
        const existing = get().items.find(
          (b) => b.episodeId === episodeId && b.timeSec === null && !b.deletedAt,
        );
        if (existing) get().remove(existing.id);
        else get().add(episodeId, null);
      },
      replaceAll: (items) => set({ items }),
    }),
    { name: 'syk.bookmarks', storage: jsonStorage },
  ),
);

export const liveBookmarks = (items: Bookmark[]) => items.filter((b) => !b.deletedAt);

export function useIsEpisodeBookmarked(episodeId: string): boolean {
  return useBookmarks((s) =>
    s.items.some((b) => b.episodeId === episodeId && b.timeSec === null && !b.deletedAt),
  );
}
