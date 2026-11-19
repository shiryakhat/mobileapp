# Updating or fixing existing content

How to change content that is **already in the bundle** — a corrected transcript, new or
edited chapters, a mis-transcribed name — without leaving derived files stale. For a
brand-new episode see [add-episode.md](add-episode.md).

## 0. The one rule

After **any** change to `content/episodes.json`, `content/transcripts/`, or
`content/enrichment/`, re-run `finalize` and commit what it regenerates:

```bash
npm run pipeline:finalize   # offline: no corpus, no network, no API key
npm run pipeline:check      # re-runs finalize; fails if a derived file differs from git
git add content/
```

CI enforces this. The "Content pipeline" job runs `npm run check:content` in `pipeline/`:
it re-runs `finalize` and fails the PR if any of these change:

- `content/glossary.json`
- `content/search-index.json`
- `content/index.generated.ts`
- `content/transcripts/*.json` (finalize applies name/term corrections in place)

A red "Verify derived content is in sync" step means: run `npm run pipeline:finalize`
locally, commit the result, push.

## 1. What runs where

| step          | command (repo root)                      | needs                            | where                     |
| ------------- | ---------------------------------------- | -------------------------------- | ------------------------- |
| `episodes`    | `npm --prefix pipeline run episodes`     | corpus, website clone, RSS cache | **local only**            |
| `archive`     | `npm --prefix pipeline run archive`      | network (archive.org)            | **local only**            |
| `transcripts` | `npm --prefix pipeline run transcripts`  | corpus                           | **local only**            |
| `enrich`      | `npm run pipeline:enrich -- --only <id>` | `ANTHROPIC_API_KEY`, network     | **local only**            |
| `finalize`    | `npm run pipeline:finalize`              | nothing                          | local + **checked in CI** |

The corpus (`/Volumes/Beezhan/data/podcasts`, override `SYK_CORPUS_DIR`) does not exist in
CI, so CI cannot tell whether `episodes.json` or a transcript matches the corpus. It only
proves the finalize outputs match the committed inputs. Corpus-derived files are your
responsibility to rebuild locally.

## 2. Fix a transcript

Use this when the SRTs in the corpus were corrected or re-transcribed
(`<stem>.fa.srt` / `<stem>.en.srt`).

```bash
npm --prefix pipeline run transcripts   # corpus SRTs -> content/transcripts/<id>.json
npm run pipeline:finalize               # re-apply corrections, rebuild search index
git status --short content/
```

`transcripts` rebuilds **every** episode from the corpus; there is no `--only`. Expect
only the episode you fixed to differ. If others changed too, review them and drop the
ones you did not intend, then finalize again:

```bash
git checkout -- content/transcripts/<other-id>.json
npm run pipeline:finalize
```

Commit:

```bash
git add content/transcripts/<id>.json content/search-index.json \
        content/glossary.json content/index.generated.ts
git commit -m "content: fix <CODE> transcript"
```

If the meaning of the episode changed (not just typos), also re-enrich it so the summary,
quotes and corrections match, then finalize again:

```bash
npm run pipeline:enrich -- --only <id> --force
npm run pipeline:finalize
```

A one-off fix made by editing `content/transcripts/<id>.json` directly works, but the next
`transcripts` run overwrites it from the corpus. Fix the SRT in the corpus, or add a
correction (section 4), so it survives.

## 3. Add or edit chapters

Chapters live in `episodes[].chapters` in `content/episodes.json`. Edit them there
directly:

```json
"chapters": [
  { "startSec": 0, "endSec": 312, "title": "Intro" },
  { "startSec": 312, "endSec": 1840, "title": "Tornado Cash sanctions" }
]
```

The app reads chapters straight from `episodes.json`; nothing derived depends on them, so
`finalize` produces no diff for a chapters-only edit. Run `npm run pipeline:check` anyway
— it confirms nothing else drifted.

**Preservation guard.** `pipeline/src/build-episodes.ts` rebuilds `episodes.json` from the
corpus, but keeps hand-authored chapters: when neither the primary YouTube upload nor a
same-length alternate upload supplies chapters, it falls back to
`previous.get(id)?.chapters` — whatever the last build wrote (see the "Preserve
hand-authored chapters" comment; the same fallback covers specials). The reverse also
holds: if YouTube **does** supply chapters, they win and replace your edits on the next
`episodes` run. After any `npm --prefix pipeline run episodes`, check
`git diff content/episodes.json` before committing.

Other fields in `episodes.json` are not preserved this way (except `audioUrl`, kept when
the RSS cache has no entry, and the archive.org fields below).

**archive.org fallback.** `npm --prefix pipeline run archive` looks every episode up at
`https://archive.org/metadata/shiryakhat-<youtubeId>` and writes `archiveId`,
`archiveAudioUrl` and `archiveVideoUrl` into `episodes.json`; the app plays those when the
RSS enclosure is missing or unreachable. It needs the network but not the corpus, never
fails (an unreachable archive.org keeps the previous values, a missing item clears them),
and `episodes` carries the fields over. For an item that does not follow the naming
convention (a talk uploaded on its own), set `archiveId` in `SPECIALS` or
`ARCHIVE_ID_OVERRIDES` (`pipeline/src/config.ts`). Titles feed the search index, so a title edit needs
`finalize`.

```bash
git add content/episodes.json
git commit -m "content: chapters for <CODE>"
```

## 4. Correct a name or term

Whisper garbles proper nouns. Corrections are applied by `finalize` to the transcripts:

- **Everywhere** — add a rule to the `BASELINE` array in `pipeline/src/finalize.ts`:

  ```ts
  { lang: 'en', wrong: 'Kirsten Davis', right: 'Creston Davis' },
  { lang: 'fa', wrong: 'پادکست شناخت', right: 'پادکست شیر یا خط' },
  ```

- **One episode only** — add the same shape to `corrections` in
  `content/enrichment/<id>.json`.

Then:

```bash
npm run pipeline:finalize   # prints "transcripts: N corrections applied"
git add pipeline/src/finalize.ts content/
git commit -m "content: correct <name>"
```

Rules `finalize` silently skips: `wrong` shorter than 4 characters, `right` that contains
`wrong` (would stack on re-runs), and the real words in `UNSAFE_WRONG` (شناخت, خط, شیر).
Matching is whole-word and case-sensitive. A correction rewrites the committed transcript,
so it cannot be undone by deleting the rule — rebuild that transcript from the corpus
(section 2).

## 5. Change enrichment (summary, quotes, glossary)

Hand-edit `content/enrichment/<id>.json`, or regenerate it
(`npm run pipeline:enrich -- --only <id> --force`). Glossary terms and corrections flow
into derived files, so:

```bash
npm run pipeline:finalize
git add content/
```

## 6. Validate and ship

```bash
npm run check            # lint + typecheck + jest (content.test.ts validates the bundle)
npm run pipeline:check   # derived content in sync
```

Open a PR (never push to `main`); see [add-episode.md](add-episode.md#7-commit-as-a-pr).

## Checklist

- [ ] Source edited in the right place (corpus SRT, `episodes.json`, `BASELINE`, enrichment)
- [ ] Corpus-dependent steps (`episodes`, `transcripts`, `enrich`) re-run locally if needed
- [ ] `npm run pipeline:finalize` run, regenerated files staged
- [ ] `npm run pipeline:check` and `npm run check` green
