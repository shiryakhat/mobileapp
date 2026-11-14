/**
 * Corpus SRTs -> content/transcripts/<id>.json  (merged bilingual cue list).
 * Raw Whisper output; name/term corrections are applied later by `finalize`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CORPUS_DIR, EPISODES_JSON, TRANSCRIPTS_DIR } from './config.js';
import { readJson, writeJson } from './lib/io.js';
import { mergeTracks, parseSrt } from './lib/srt.js';
import type { Cue, Episode, Transcript } from './types.js';

if (!fs.existsSync(CORPUS_DIR)) {
  console.error(`Missing corpus at ${CORPUS_DIR} (set SYK_CORPUS_DIR)`);
  process.exit(1);
}

const episodes = readJson<Episode[]>(EPISODES_JSON);
let total = 0;
for (const ep of episodes) {
  const read = (lang: 'en' | 'fa') => {
    const f = path.join(CORPUS_DIR, `${ep.sourceStem}.${lang}.srt`);
    return fs.existsSync(f) ? parseSrt(fs.readFileSync(f, 'utf8')) : [];
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
