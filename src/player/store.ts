import { create } from 'zustand';

export type PlayerMode = 'audio' | 'video';
/** Which engine is actually producing sound. */
export type PlayerEngine = 'native' | 'youtube' | 'video';

interface PlaybackState {
  episodeId?: string;
  mode: PlayerMode;
  engine: PlayerEngine;
  /** Desired/actual play state. The YouTube view follows this as a prop. */
  playing: boolean;
  buffering: boolean;
  positionSec: number;
  durationSec: number;
  rate: number;
  error?: string;
}

export const usePlayback = create<PlaybackState>(() => ({
  mode: 'audio',
  engine: 'native',
  playing: false,
  buffering: false,
  positionSec: 0,
  durationSec: 0,
  rate: 1,
}));
