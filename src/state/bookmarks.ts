import * as Crypto from 'expo-crypto';
import { useMemo } from 'react';
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
  /** Bookmark the whole episode (`timeSec` null) or a moment in it, with an optional note. */
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
        const at = timeSec === null ? null : Math.max(0, Math.floor(timeSec));
        const text = note?.trim() || undefined;
        // Marking the same second twice keeps one mark; a new note replaces the old one.
        const existing = get().items.find(
          (b) => b.episodeId === episodeId && b.timeSec === at && !b.deletedAt,
        );
        if (existing) {
          if (!text || text === existing.note) return existing;
          const updated: Bookmark = { ...existing, note: text, updatedAt: now };
          set((s) => ({ items: s.items.map((b) => (b.id === existing.id ? updated : b)) }));
          return updated;
        }
        const bookmark: Bookmark = {
          id: Crypto.randomUUID(),
          episodeId,
          timeSec: at,
          note: text,
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

/** A bookmark at a moment of an episode, as opposed to the episode as a whole. */
export type Mark = Bookmark & { timeSec: number };

/** An episode's moment bookmarks in playback order. */
export function episodeMarks(items: Bookmark[], episodeId: string): Mark[] {
  return items
    .filter((b): b is Mark => b.episodeId === episodeId && b.timeSec !== null && !b.deletedAt)
    .sort((a, b) => a.timeSec - b.timeSec || a.createdAt - b.createdAt);
}

export function useEpisodeMarks(episodeId: string): Mark[] {
  const items = useBookmarks((s) => s.items);
  return useMemo(() => episodeMarks(items, episodeId), [items, episodeId]);
}

/** True when the episode has any bookmark: the episode itself or a moment in it. */
export function useHasBookmarks(episodeId: string): boolean {
  return useBookmarks((s) => s.items.some((b) => b.episodeId === episodeId && !b.deletedAt));
}
