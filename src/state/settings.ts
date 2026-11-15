import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { jsonStorage } from './storage';

export type Locale = 'fa' | 'en';
export type ThemePref = 'dark' | 'light' | 'system';
export type TranscriptLangs = 'both' | 'fa' | 'en';

interface SettingsState {
  /** Farsi (RTL) is the default; English is a toggle. */
  locale: Locale;
  theme: ThemePref;
  transcriptLangs: TranscriptLangs;
  playbackRate: number;
  /** Play the coin sound on the launch screen. */
  splashSound: boolean;
  setLocale: (locale: Locale) => void;
  setTheme: (theme: ThemePref) => void;
  setTranscriptLangs: (v: TranscriptLangs) => void;
  setPlaybackRate: (rate: number) => void;
  setSplashSound: (on: boolean) => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      locale: 'fa',
      theme: 'dark',
      transcriptLangs: 'both',
      playbackRate: 1,
      splashSound: true,
      setLocale: (locale) => set({ locale }),
      setTheme: (theme) => set({ theme }),
      setTranscriptLangs: (transcriptLangs) => set({ transcriptLangs }),
      setPlaybackRate: (playbackRate) => set({ playbackRate }),
      setSplashSound: (splashSound) => set({ splashSound }),
    }),
    { name: 'syk.settings', storage: jsonStorage },
  ),
);

/** False until the persisted settings have been read back from disk (a few ms after launch). */
export const useSettingsHydrated = (): boolean =>
  useSyncExternalStore(
    useSettings.persist.onFinishHydration,
    useSettings.persist.hasHydrated,
    () => true,
  );
