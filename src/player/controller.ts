/**
 * Unified player: one API over three engines.
 *
 *  - native  : expo-audio, streams the podcast RSS enclosure (or a downloaded
 *              file; archive.org is the fallback). Survives navigation, plays
 *              in the background and drives the lock-screen / now-playing
 *              controls.
 *  - youtube : the YouTube iframe on the episode screen (video mode, and the
 *              audio fallback for episodes with no audio URL at all).
 *  - video   : expo-video on the episode screen, playing a DOWNLOADED mp4 in
 *              video mode — offline video. Without a local file, video mode
 *              streams through the YouTube iframe as before.
 *
 * Screens only talk to this module and to `usePlayback`.
 */
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
  type AudioStatus,
} from 'expo-audio';
import { AppState, Platform } from 'react-native';
import { getEpisode, type Episode } from '@/content';
import { translate } from '@/i18n';
import { cachedImageUri } from '@/lib/cache';
import { localAudioUri, localVideoUri, useDownloads } from '@/state/downloads';
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

/**
 * How long after a command (play / pause / seek) the YouTube iframe gets to
 * catch up before its reported play state is believed over the user's intent
 * (see `reportYoutube`). Covers the WebView bridge round trip and the burst of
 * state events around a seek; a longer rebuffer is covered by `buffering`.
 */
const YOUTUBE_SETTLE_MS = 1000;

interface YoutubeHandle {
  seekTo: (sec: number) => void;
  /** Send play / pause to the iframe again (it is otherwise only told on a change). */
  resend: (playing: boolean) => void;
}

/** What <LocalVideoSurface/> exposes; commands are imperative, never mirrored props. */
interface VideoHandle {
  play: () => void;
  pause: () => void;
  seekTo: (sec: number) => void;
  setRate: (rate: number) => void;
}

let audio: AudioPlayer | undefined;
let youtube: YoutubeHandle | undefined;
let video: VideoHandle | undefined;
/** Position to jump to once the active engine is ready. */
let pendingSeek: number | undefined;
let lastSavedAt = -1;
/**
 * What the user last asked the active engine to do (play / pause). The engine's
 * own play state is the truth once it has settled, but not while it is still
 * catching up with a command: on Android the native status is stale while the
 * player is buffering (see `resolvePlaying`), and the YouTube iframe keeps
 * emitting the state events of a seek after a pause (see `reportYoutube`).
 */
let wantPlaying = false;
/** The play state the YouTube iframe last reported; undefined until it has. */
let youtubeReported: boolean | undefined;
/** Running while the YouTube iframe is given time to follow the last command. */
let youtubeSettle: ReturnType<typeof setTimeout> | undefined;
/**
 * The native player lost its prepared source (a playback error — typically the
 * network dropping or changing while the app was in the background — or the
 * player being stopped underneath us). `play()` on such a player is a silent
 * no-op, so the source has to be loaded again first (see `reloadNative`).
 */
let needsReload = false;

const state = () => usePlayback.getState();
const set = usePlayback.setState;

/**
 * Episodes whose RSS enclosure failed to load this session; they stream from
 * archive.org instead (see `retryFromArchive`).
 */
const primaryFailed = new Set<string>();

/**
 * Where the native engine plays an episode from: the downloaded file, else the
 * podcast RSS enclosure, else archive.org. An episode downloaded as VIDEO plays
 * its mp4's audio track here, so audio mode works offline for it too.
 *
 * archive.org mirrors every episode (creator "Shir Ya Khat"); the pipeline
 * resolves the file URLs at build time (pipeline/src/archive.ts) into
 * `archiveAudioUrl` / `archiveVideoUrl`, so nothing is looked up at runtime.
 * It backs the audio up twice: as the last entry in this chain (an episode
 * without an RSS enclosure — a special — plays natively instead of through the
 * YouTube iframe), and as a one-off retry when the enclosure errors out.
 * For episodes uploaded as video, `archiveAudioUrl` is the item's mp4: the
 * native player streams its audio track.
 */
export function audioSourceFor(ep: Episode): string | undefined {
  const local = localAudioUri(ep.id) ?? localVideoUri(ep.id);
  if (local) return local;
  if (primaryFailed.has(ep.id) && ep.archiveAudioUrl) return ep.archiveAudioUrl;
  return ep.audioUrl ?? ep.archiveAudioUrl;
}

/**
 * The archive.org mp4 (H.264) of an episode, for the video path. It is what a
 * video download fetches (src/state/downloads.ts); once on disk it plays
 * through the 'video' engine.
 *
 * TODO: it is not STREAMED yet. Without a download, video only plays through
 * the YouTube iframe, which may be filtered or geo-blocked for part of the
 * audience; the 'video' engine could stream this URL as a fallback. Cloudflare
 * (R2 / Stream) is an alternative host if archive.org proves too slow.
 */
export const archiveVideoSourceFor = (ep: Episode): string | undefined => ep.archiveVideoUrl;

/**
 * The RSS enclosure failed (host unreachable, file gone): load the archive.org
 * copy instead, at the same position. Once per episode per session — if that
 * fails too, the error is shown as usual and `play()` retries archive.org.
 * A failing download or archive.org source is left alone.
 */
function retryFromArchive(): boolean {
  const ep = getEpisode(state().episodeId);
  const archive = ep?.archiveAudioUrl;
  if (!ep || !archive || archive === ep.audioUrl || primaryFailed.has(ep.id)) return false;
  if (audioSourceFor(ep) !== ep.audioUrl) return false;
  primaryFailed.add(ep.id);
  reloadNative();
  return true;
}

function engineFor(ep: Episode, mode: PlayerMode): PlayerEngine {
  // Video mode plays the downloaded mp4 when there is one, else it streams.
  if (mode === 'video' && localVideoUri(ep.id)) return 'video';
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
  player.addListener('playbackStatusUpdate', (status) => applyStatus(player, status));
  // Coming back to the app: re-read the engine, in case a status event was
  // missed while the app was in the background (interruption by another app,
  // the system pausing or stopping the player).
  AppState.addEventListener('change', (next) => {
    if (next === 'active') resyncNative();
  });
  audio = player;
  return player;
}

/**
 * The play state to show for a native status.
 *
 * On Android, expo-audio reports a remembered value as `status.playing` while
 * the player is buffering, and that value is only refreshed when playback
 * actually starts or stops — not by `play()` / `pause()` issued *during* the
 * buffering. After a seek to an unbuffered position (a chapter / transcript
 * tap on a stream) every status therefore repeats the pre-seek play state: it
 * would undo the user's pause (or play) in the store, the transport icon would
 * flip back, and the next tap on it would do the opposite of what it shows.
 * So while buffering, the user's intent is the truth; once the engine settles,
 * the engine is (it may have been paused by an interruption or the lock screen).
 */
function resolvePlaying(status: AudioStatus): boolean {
  if (status.didJustFinish) wantPlaying = false;
  else if (Platform.OS === 'android' && status.isBuffering) return wantPlaying;
  else wantPlaying = status.playing;
  return wantPlaying;
}

function applyStatus(player: AudioPlayer, status: AudioStatus): void {
  if (state().engine !== 'native') return;
  if (status.error && retryFromArchive()) return;
  if (status.error) needsReload = true;
  // Android: 'idle' means no prepared source — after an error, or a stop from
  // outside. (It is also reported for an instant while a source is being
  // replaced; the 'buffering' status that follows clears the flag again.)
  else if (Platform.OS === 'android') needsReload = status.playbackState === 'idle';
  if (status.isLoaded && pendingSeek !== undefined) {
    const target = pendingSeek;
    pendingSeek = undefined;
    void player.seekTo(target);
    return;
  }
  const ep = getEpisode(state().episodeId);
  const playing = resolvePlaying(status);
  set({
    playing,
    buffering: status.isBuffering,
    positionSec: pendingSeek ?? status.currentTime,
    durationSec: status.duration > 0 ? status.duration : (ep?.durationSec ?? 0),
    // Keep the error visible until the source has been loaded again.
    error: status.error ?? (needsReload ? state().error : undefined),
  });
  persistProgress(status.didJustFinish || !playing);
}

function resyncNative(): void {
  if (!audio || !state().episodeId || state().engine !== 'native') return;
  try {
    applyStatus(audio, audio.currentStatus);
  } catch {
    // best-effort: the next status event corrects the store
  }
}

/** Load the current episode's source again, at the current position. */
function reloadNative(): void {
  const ep = getEpisode(state().episodeId);
  const uri = ep && audioSourceFor(ep);
  if (!uri) return;
  needsReload = false;
  const { positionSec, rate } = state();
  pendingSeek = positionSec > 0 ? positionSec : undefined;
  set({ error: undefined });
  const player = ensureAudio();
  player.replace({ uri });
  player.setPlaybackRate(rate);
  if (wantPlaying) player.play();
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

/**
 * Make `ep` the current episode. No-op (apart from an optional seek) if it
 * already is — unless `force`d, to pick the engine again (see the downloads
 * subscription below).
 */
export function loadEpisode(ep: Episode, opts: LoadOptions = {}, force = false): void {
  const current = state();
  const mode = opts.mode ?? (current.episodeId === ep.id ? current.mode : 'audio');
  if (!force && current.episodeId === ep.id && current.mode === mode) {
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
  wantPlaying = autoplay;
  needsReload = false;
  forgetYoutube();

  set({
    episodeId: ep.id,
    mode,
    engine,
    // The surface engines start (or not) when their view attaches.
    playing: engine === 'native' ? false : autoplay,
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
  wantPlaying = true;
  if (state().engine === 'native') {
    // A player that lost its source ignores play(): load the episode again.
    if (needsReload) reloadNative();
    else ensureAudio().play();
  } else if (state().engine === 'video') video?.play();
  else awaitYoutube();
  set({ playing: true });
}

export function pause(): void {
  wantPlaying = false;
  if (state().engine === 'native') audio?.pause();
  else if (state().engine === 'video') video?.pause();
  else awaitYoutube();
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
  } else if (engine === 'video') {
    if (video) video.seekTo(target);
    else pendingSeek = target;
  } else if (youtube) {
    youtube.seekTo(target);
    awaitYoutube();
  } else pendingSeek = target;
}

export const skip = (deltaSec: number) => seekTo(state().positionSec + deltaSec);

export function setRate(rate: number): void {
  useSettings.getState().setPlaybackRate(rate);
  set({ rate });
  if (state().engine === 'native') audio?.setPlaybackRate(rate);
  else if (state().engine === 'video') video?.setRate(rate);
}

export function cycleRate(): void {
  const i = RATES.indexOf(state().rate as (typeof RATES)[number]);
  setRate(RATES[(i + 1) % RATES.length]!);
}

/** Stop everything and clear the current episode (mini-player close). */
export function stop(): void {
  persistProgress(true);
  wantPlaying = false;
  forgetYoutube();
  audio?.pause();
  if (state().engine === 'video') video?.pause();
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
  forgetYoutube();
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
    wantPlaying = false;
    forgetYoutube();
    set({ playing: false });
  }
}

function forgetYoutube(): void {
  clearTimeout(youtubeSettle);
  youtubeSettle = undefined;
  youtubeReported = undefined;
}

/** A command was just sent to the iframe: give it time to follow (see `reportYoutube`). */
function awaitYoutube(retry = true): void {
  clearTimeout(youtubeSettle);
  youtubeSettle = setTimeout(() => settleYoutube(retry), YOUTUBE_SETTLE_MS);
}

/**
 * The iframe has had its time. If it is still not doing what the user asked,
 * the command is sent once more (it may have been lost, or overtaken by the
 * seek); if that does not help either, the store follows the iframe, so the
 * transport button at least shows what is really happening.
 */
function settleYoutube(retry: boolean): void {
  youtubeSettle = undefined;
  if (state().engine !== 'youtube' || !youtube) return;
  if (youtubeReported === undefined || youtubeReported === wantPlaying) return;
  // Still rebuffering: the state event that ends it re-opens this check.
  if (state().buffering) return;
  if (retry) {
    youtube.resend(wantPlaying);
    awaitYoutube(false);
  } else {
    wantPlaying = youtubeReported;
    set({ playing: wantPlaying });
    if (!wantPlaying) persistProgress(true);
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
  const { ended, playing, ...rest } = update;
  if (playing === undefined) {
    set(rest);
    persistProgress();
    return;
  }
  youtubeReported = playing;
  if (ended) {
    wantPlaying = false;
    clearTimeout(youtubeSettle);
    youtubeSettle = undefined;
    set({ ...rest, playing: false, buffering: false });
    persistProgress(true);
    return;
  }
  // The store's `playing` is also what <YoutubeSurface/> sends back to the
  // iframe as its `play` prop, so a reported state written into it becomes a
  // command. Around a seek (a chapter / transcript tap) the iframe emits a
  // burst of state events — 'paused' and 'buffering', then 'playing' once it
  // has data — and those still arrive after the user has tapped pause (or
  // play): believing them would flip the transport button back and tell the
  // iframe to resume (or pause). So, as on the native engine, the user's
  // intent is the truth while the iframe is catching up with a command or
  // rebuffering; once it has settled, the iframe is (its own controls in
  // video mode, an interruption).
  if (playing !== wantPlaying) {
    if (youtubeSettle !== undefined || state().buffering) {
      set(rest);
      // Check again once the events have died down (see `settleYoutube`).
      if (youtubeSettle === undefined) awaitYoutube();
      return;
    }
    wantPlaying = playing;
  }
  set({ ...rest, playing });
  persistProgress(!playing);
}

// ── Local video engine bridge (called by <LocalVideoSurface/>) ───────────────

/** What the surface should do once its file is ready to play. */
export interface VideoStart {
  startAt?: number;
  autoplay: boolean;
  rate: number;
}

export function attachVideo(handle: VideoHandle): VideoStart {
  video = handle;
  const startAt = pendingSeek;
  pendingSeek = undefined;
  return { startAt, autoplay: wantPlaying, rate: state().rate };
}

export function detachVideo(handle: VideoHandle): void {
  if (video !== handle) return;
  video = undefined;
  if (state().engine === 'video') {
    persistProgress(true);
    // Remember where we were so re-mounting (or switching to audio) resumes there.
    pendingSeek = state().positionSec;
    wantPlaying = false;
    set({ playing: false, buffering: false });
  }
}

/**
 * The local player's own state. Unlike the iframe, it is commanded
 * imperatively and plays from disk, so what it reports is simply the truth
 * (its native controls, an interruption, the end of the file).
 */
export function reportVideo(update: {
  positionSec?: number;
  durationSec?: number;
  playing?: boolean;
  buffering?: boolean;
  ended?: boolean;
  error?: string;
}): void {
  if (state().engine !== 'video') return;
  const { ended, ...rest } = update;
  if (ended) {
    wantPlaying = false;
    set({ ...rest, playing: false, buffering: false });
    persistProgress(true);
    return;
  }
  if (rest.playing !== undefined) wantPlaying = rest.playing;
  set(rest);
  persistProgress(rest.playing === false);
}

// The mp4 under the 'video' engine was deleted (from the episode screen or the
// library) while it was the current source: pick the engine again, at the same
// position — video mode goes back to streaming through YouTube.
useDownloads.subscribe(() => {
  if (state().engine !== 'video') return;
  const ep = getEpisode(state().episodeId);
  if (ep && !localVideoUri(ep.id)) loadEpisode(ep, {}, true);
});
