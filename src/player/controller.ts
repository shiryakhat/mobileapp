/**
 * Unified player: one API over two engines.
 *
 *  - native  : expo-audio, streams the podcast RSS enclosure (or a downloaded
 *              file). Survives navigation, plays in the background and drives
 *              the lock-screen / now-playing controls.
 *  - youtube : the YouTube iframe on the episode screen (video mode, and the
 *              audio fallback for episodes with no public audio URL).
 *
 * Screens only talk to this module and to `usePlayback`.
 */
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { getEpisode, type Episode } from '@/content';
import { translate } from '@/i18n';
import { cachedImageUri } from '@/lib/cache';
import { localAudioUri } from '@/state/downloads';
import { resumePosition, useProgress } from '@/state/progress';
import { useSettings } from '@/state/settings';
import { localArtworkUri, resolveLocalArtwork } from './artwork';
import { usePlayback, type PlayerEngine, type PlayerMode } from './store';

export const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const SAVE_EVERY_SEC = 5;
/**
 * How far ahead of the playhead a stream is buffered. The platform defaults
 * (~50 s on Android, "system decides" on iOS) stall on short skips and on a
 * flaky connection; two minutes of podcast audio is only 1-2 MB of memory.
 * Downloaded episodes play from disk and do not buffer at all.
 */
const BUFFER_AHEAD_SEC = 120;

interface YoutubeHandle {
  seekTo: (sec: number) => void;
}

let audio: AudioPlayer | undefined;
let youtube: YoutubeHandle | undefined;
/** Position to jump to once the active engine is ready. */
let pendingSeek: number | undefined;
let lastSavedAt = -1;

const state = () => usePlayback.getState();
const set = usePlayback.setState;

// TODO: archive.org as a fallback source. Most episodes are also on archive.org
// (creator "Shir Ya Khat": https://archive.org/search?query=creator%3A%22Shir+Ya+Khat%22),
// which could back up the audio (and video) when the RSS enclosure is unavailable.
// Not wired up yet; downloads (src/state/downloads.ts) would need the same fallback.
// Do VIDEO downloads in the same piece of work: downloads are audio-only today and
// video only streams from YouTube, which may be filtered or geo-blocked for part of
// the audience. The video files could come from archive.org too, or be hosted on
// Cloudflare (R2 / Stream) for easier access.
function audioSourceFor(ep: Episode): string | undefined {
  return localAudioUri(ep.id) ?? ep.audioUrl;
}

function engineFor(ep: Episode, mode: PlayerMode): PlayerEngine {
  return mode === 'audio' && audioSourceFor(ep) ? 'native' : 'youtube';
}

function persistProgress(force = false): void {
  const { episodeId, positionSec, durationSec } = state();
  if (!episodeId || positionSec <= 0) return;
  if (!force && Math.abs(positionSec - lastSavedAt) < SAVE_EVERY_SEC) return;
  lastSavedAt = positionSec;
  useProgress.getState().save(episodeId, positionSec, durationSec);
}

function ensureAudio(): AudioPlayer {
  if (audio) return audio;
  void setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: true,
    interruptionMode: 'doNotMix',
  }).catch(() => undefined);
  const player = createAudioPlayer(null, {
    updateInterval: 500,
    preferredForwardBufferDuration: BUFFER_AHEAD_SEC,
  });
  player.addListener('playbackStatusUpdate', (status) => {
    if (state().engine !== 'native') return;
    if (status.isLoaded && pendingSeek !== undefined) {
      const target = pendingSeek;
      pendingSeek = undefined;
      void player.seekTo(target);
      return;
    }
    const ep = getEpisode(state().episodeId);
    set({
      playing: status.playing,
      buffering: status.isBuffering,
      positionSec: pendingSeek ?? status.currentTime,
      durationSec: status.duration > 0 ? status.duration : (ep?.durationSec ?? 0),
      error: status.error ?? undefined,
    });
    if (status.didJustFinish) {
      set({ playing: false });
      persistProgress(true);
    } else persistProgress(!status.playing);
  });
  audio = player;
  return player;
}

/** True once the episode player exists — from then on it owns the audio session mode. */
export const hasEpisodePlayer = (): boolean => audio !== undefined;

function activateLockScreen(ep: Episode): void {
  const locale = useSettings.getState().locale;
  const metadata = (artworkUrl: string) => ({
    title: locale === 'fa' ? ep.titleFa : ep.titleEn,
    artist: translate(locale, 'appName'),
    albumTitle: ep.code,
    artworkUrl,
  });
  const player = ensureAudio();
  const local = localArtworkUri(ep);
  try {
    player.setActiveForLockScreen(
      true,
      // The bundled episode artwork; until it is resolved (or when the episode
      // has none) the cached YouTube thumbnail, so there is artwork offline too.
      metadata(local ?? cachedImageUri(ep.youtubeThumb) ?? ep.youtubeThumb),
      { showSeekForward: true, showSeekBackward: true },
    );
  } catch {
    // Lock-screen controls are best-effort (unsupported on web).
  }
  if (local) return;
  void resolveLocalArtwork(ep).then((uri) => {
    if (!uri || state().episodeId !== ep.id || state().engine !== 'native') return;
    try {
      player.updateLockScreenMetadata(metadata(uri));
    } catch {
      // best-effort
    }
  });
}

export interface LoadOptions {
  mode?: PlayerMode;
  /** Explicit start position (deep links, search hits). Defaults to the saved position. */
  startAt?: number;
  autoplay?: boolean;
}

/** Make `ep` the current episode. No-op (apart from an optional seek) if it already is. */
export function loadEpisode(ep: Episode, opts: LoadOptions = {}): void {
  const current = state();
  const mode = opts.mode ?? (current.episodeId === ep.id ? current.mode : 'audio');
  if (current.episodeId === ep.id && current.mode === mode) {
    if (opts.startAt !== undefined) seekTo(opts.startAt);
    if (opts.autoplay) play();
    return;
  }
  persistProgress(true);

  const sameEpisode = current.episodeId === ep.id;
  const startAt =
    opts.startAt ??
    (sameEpisode ? current.positionSec : resumePosition(useProgress.getState().byEpisode[ep.id]));
  const engine = engineFor(ep, mode);
  const rate = useSettings.getState().playbackRate;
  const autoplay = opts.autoplay ?? (sameEpisode && current.playing);
  lastSavedAt = -1;
  pendingSeek = startAt > 0 ? startAt : undefined;

  set({
    episodeId: ep.id,
    mode,
    engine,
    playing: engine === 'youtube' ? autoplay : false,
    buffering: false,
    positionSec: startAt,
    durationSec: ep.durationSec,
    rate,
    error: undefined,
  });

  if (engine === 'native') {
    const player = ensureAudio();
    player.replace({ uri: audioSourceFor(ep)! });
    player.setPlaybackRate(rate);
    activateLockScreen(ep);
    if (autoplay) player.play();
  } else {
    audio?.pause();
  }
}

export function setMode(mode: PlayerMode): void {
  const ep = getEpisode(state().episodeId);
  if (ep && mode !== state().mode) loadEpisode(ep, { mode });
}

export function play(): void {
  if (state().engine === 'native') ensureAudio().play();
  set({ playing: true });
}

export function pause(): void {
  if (state().engine === 'native') audio?.pause();
  set({ playing: false });
  persistProgress(true);
}

export function toggle(): void {
  if (state().playing) pause();
  else play();
}

export function seekTo(sec: number): void {
  const { durationSec, engine } = state();
  const target = Math.max(0, durationSec > 0 ? Math.min(sec, durationSec - 1) : sec);
  set({ positionSec: target });
  if (engine === 'native') {
    if (audio?.isLoaded) void audio.seekTo(target);
    else pendingSeek = target;
  } else if (youtube) youtube.seekTo(target);
  else pendingSeek = target;
}

export const skip = (deltaSec: number) => seekTo(state().positionSec + deltaSec);

export function setRate(rate: number): void {
  useSettings.getState().setPlaybackRate(rate);
  set({ rate });
  if (state().engine === 'native') audio?.setPlaybackRate(rate);
}

export function cycleRate(): void {
  const i = RATES.indexOf(state().rate as (typeof RATES)[number]);
  setRate(RATES[(i + 1) % RATES.length]!);
}

/** Stop everything and clear the current episode (mini-player close). */
export function stop(): void {
  persistProgress(true);
  audio?.pause();
  try {
    audio?.clearLockScreenControls();
  } catch {
    // best-effort
  }
  set({ episodeId: undefined, playing: false, positionSec: 0 });
}

// ── YouTube engine bridge (called by <YoutubeSurface/>) ──────────────────────

/** Returns the position the surface should start from, if any. */
export function attachYoutube(handle: YoutubeHandle): number | undefined {
  youtube = handle;
  const start = pendingSeek;
  pendingSeek = undefined;
  return start;
}

export function detachYoutube(handle: YoutubeHandle): void {
  if (youtube !== handle) return;
  youtube = undefined;
  if (state().engine === 'youtube') {
    persistProgress(true);
    // Remember where we were so re-mounting (or switching to audio) resumes there.
    pendingSeek = state().positionSec;
    set({ playing: false });
  }
}

export function reportYoutube(update: {
  positionSec?: number;
  durationSec?: number;
  playing?: boolean;
  buffering?: boolean;
  ended?: boolean;
}): void {
  if (state().engine !== 'youtube') return;
  const { ended, ...rest } = update;
  set(rest);
  persistProgress(Boolean(ended) || update.playing === false);
}
