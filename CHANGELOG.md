# Changelog

User-facing changes to the Shir ya Khat app, newest first. The store "What's New" text for the
current release is in [RELEASE_NOTES.md](RELEASE_NOTES.md).

## v1.3.5

- **Fixed:** play / pause in Video mode — the commands were not reaching the YouTube player.
- Episodes before S03E07 are now audio-only. Their "video" was only a static image, so the
  Audio / Video switch and the video download are no longer offered for them.
- S03E07 now has its correct interview video and transcript.
- Offline video downloads are now 720p H.264 files, about 49% smaller (17.2 GB → 8.7 GB across
  35 videos). The full-resolution masters are kept on archive.org.

(#58)

## v1.3.4 — 2026-11-21

- **In-episode bookmarks and notes.** The bookmark button on an episode now marks the current
  moment, with an optional note. Long-press a transcript line to bookmark that line. Marked
  moments are listed on the episode and in Library → Bookmarks; tap one to jump back to it.
- **Fixed:** the downloads list no longer reorders or jumps while several files download at once.

(#57)

## v1.3.3 — 2026-11-21

- The featured card on the Episodes screen shows a random episode on each refresh. A newly
  published episode stays pinned on top for its first 14 days.

(#56)

## v1.3.2 — 2026-11-20

- Tap a downloaded item to manage it: download the other medium (audio or video), or delete.
- Talk specials show their conference name and date, and are sorted newest first.

(#55)

## v1.3.1 — 2026-11-20

- **Fixed:** a crash when starting a download after choosing Audio or Video (the file system
  reported byte counts as BigInt).

(#54)

## v1.3.0 — 2026-11-20

- **Offline video downloads.** Episodes backed by an archive.org video can be downloaded as video
  and watched offline.
- An Audio / Video chooser when downloading those episodes.

(#53)

## v1.2.2 — 2026-11-20

- Talk specials can be downloaded for offline listening, via archive.org.

(#52)

## v1.2.1 — 2026-11-20

- Talk specials play as native audio via archive.org, so they keep playing in the background
  with lock-screen controls like regular episodes.

(#51)

## v1.2.0 — 2026-11-20

- Updated Farsi and English transcripts for every podcast episode.
- 14 conference talks added as specials.
- Audio falls back to archive.org when the podcast host is unreachable.

(#47, #48, #49, #50)
