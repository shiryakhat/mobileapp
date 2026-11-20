/**
 * Corpus SRTs -> content/transcripts/<id>.json  (merged bilingual cue list).
 * Specials that are not in the corpus (conference talks) are read from TALKS_DIR.
 * Raw Whisper output; name/term corrections are applied later by `finalize`.
 *
 * A run rewrites every transcript from the SRTs, including ones that were
 * cleaned up by hand in `content/`. To add episodes without touching the rest:
 *   --only sp02,sp03   restrict to ids
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS_DIR, EPISODES_JSON, TALKS_DIR, TRANSCRIPTS_DIR } from './config.js';
import { readJson, writeJson } from './lib/io.js';
import { mergeTracks, parseSrt } from './lib/srt.js';
import type { Cue, Episode, Transcript } from './types.js';

if (!fs.existsSync(CORPUS_DIR)) {
  console.error(`Missing corpus at ${CORPUS_DIR} (set SYK_CORPUS_DIR)`);
  process.exit(1);
}

const onlyAt = process.argv.indexOf('--only');
const only = onlyAt >= 0 ? process.argv[onlyAt + 1]?.split(',') : undefined;
const episodes = readJson<Episode[]>(EPISODES_JSON).filter((e) => !only || only.includes(e.id));
let total = 0;
for (const ep of episodes) {
  const read = (lang: 'en' | 'fa') => {
    const dirs = ep.season === 0 ? [CORPUS_DIR, TALKS_DIR] : [CORPUS_DIR];
    const f = dirs
      .map((dir) => path.join(dir, `${ep.sourceStem}.${lang}.srt`))
      .find((file) => fs.existsSync(file));
    return f ? parseSrt(fs.readFileSync(f, 'utf8')) : [];
  };
  const fa = read('fa');
  const en = read('en');
  if (fa.length === 0 && en.length === 0) {
    console.warn(`! no subtitles for ${ep.id}`);
    continue;
  }
  const cues: Cue[] = mergeTracks(fa, en).map((c) => [c.startMs, c.endMs, c.en, c.fa]);
  const transcript: Transcript = { id: ep.id, cues };
  writeJson(path.join(TRANSCRIPTS_DIR, `${ep.id}.json`), transcript, false);
  total += cues.length;
  console.log(`${ep.id}: ${cues.length} cues (fa ${fa.length} / en ${en.length})`);
}
console.log(`transcripts: ${total} cues across ${episodes.length} episodes`);
