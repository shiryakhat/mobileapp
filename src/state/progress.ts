import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonStorage } from './storage';

export interface EpisodeProgress {
  positionSec: number;
  durationSec: number;
  updatedAt: number;
}

interface ProgressState {
  byEpisode: Record<string, EpisodeProgress>;
  lastEpisodeId?: string;
  save: (episodeId: string, positionSec: number, durationSec: number) => void;
  clear: (episodeId: string) => void;
}

/** Per-episode resume position. Written (throttled) by the player. */
export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      byEpisode: {},
      save: (episodeId, positionSec, durationSec) =>
        set((s) => ({
          lastEpisodeId: episodeId,
          byEpisode: {
            ...s.byEpisode,
            [episodeId]: { positionSec, durationSec, updatedAt: Date.now() },
          },
        })),
      clear: (episodeId) =>
        set((s) => {
          const next = { ...s.byEpisode };
          delete next[episodeId];
          return { byEpisode: next };
        }),
    }),
    { name: 'syk.progress', storage: jsonStorage },
  ),
);

/** Where to resume: 0 if never played or effectively finished. */
export function resumePosition(p: EpisodeProgress | undefined): number {
  if (!p || p.positionSec < 5) return 0;
  if (p.durationSec > 0 && p.positionSec > p.durationSec - 20) return 0;
  return p.positionSec;
}

export function progressFraction(p: EpisodeProgress | undefined): number {
  if (!p || p.durationSec <= 0) return 0;
  return Math.min(1, Math.max(0, p.positionSec / p.durationSec));
}
