/**
 * Offline post-processing over the committed bundle (no corpus, no network):
 *   0. re-derive `hasVideo` on every episode -> content/episodes.json
 *   1. merge per-episode enrichment glossaries -> content/glossary.json
 *   2. apply name/term corrections to content/transcripts/*.json (idempotent)
 *   3. build content/search-index.json (token -> episodes inverted index)
 *   4. emit content/index.generated.ts (static require map for Metro)
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ENRICHMENT_DIR,
  EPISODES_JSON,
  GENERATED_TS,
  GLOSSARY_JSON,
  SEARCH_INDEX_JSON,
  TRANSCRIPTS_DIR,
} from './config.js';
import { readJson, readJsonIfExists, writeJson, writeText } from './lib/io.js';
import { escapeRegExp, hasPersian, normalize, slugify, tokenize } from './lib/text.js';
import { hasVideoFor } from './lib/video.js';
import type {
  Correction,
  Enrichment,
  Episode,
  GlossaryEntry,
  SearchIndex,
  Transcript,
} from './types.js';

/** Applied to every transcript regardless of enrichment. */
const BASELINE: Correction[] = [
  { lang: 'en', wrong: 'Shenakht', right: 'Shir ya Khat' },
  { lang: 'en', wrong: 'Shir Ya Khat', right: 'Shir ya Khat' },
  // S03E07 (English interview) whisper mis-hearings of the show and names.
  { lang: 'en', wrong: 'Shiria Khat', right: 'Shir ya Khat' },
  { lang: 'en', wrong: 'Shiriakhat', right: 'Shir ya Khat' },
  { lang: 'en', wrong: 'Shri Akhat', right: 'Shir ya Khat' },
  { lang: 'en', wrong: 'Sheer ya Khat', right: 'Shir ya Khat' },
  { lang: 'en', wrong: 'Kirsten Davis', right: 'Creston Davis' },
  { lang: 'en', wrong: 'Kirsten', right: 'Creston' },
  { lang: 'en', wrong: 'Shayane', right: 'Shayan' },
  { lang: 'en', wrong: 'Thank you Shahin', right: 'Thank you Shayan' },
  { lang: 'fa', wrong: 'پادکست شناخت', right: 'پادکست شیر یا خط' },
];
const SHOW_NAME = /Shir[ -]?ya[ -]?Khat/gi;
/** Real words Whisper also produces as mis-hearings; never blanket-replace these. */
const UNSAFE_WRONG = new Set(['شناخت', 'خط', 'شیر']);

const episodes = readJson<Episode[]>(EPISODES_JSON);

// 0. derived episode fields --------------------------------------------------
// `hasVideo` follows from the season / episode number alone (lib/video.ts). It
// is stamped here as well as in build-episodes, so an episode added or edited
// by hand gets it too, and CI (check:content) fails if the file disagrees.
let restamped = 0;
for (const ep of episodes) {
  const hasVideo = hasVideoFor(ep);
  if (ep.hasVideo === hasVideo) continue;
  ep.hasVideo = hasVideo;
  restamped++;
}
if (restamped > 0) writeJson(EPISODES_JSON, episodes);
console.log(
  `episodes: ${episodes.filter((e) => e.hasVideo).length}/${episodes.length} with video` +
    (restamped > 0 ? ` (${restamped} updated)` : ''),
);

const enrichments = new Map<string, Enrichment>();
for (const ep of episodes) {
  const e = readJsonIfExists<Enrichment>(path.join(ENRICHMENT_DIR, `${ep.id}.json`));
  if (e) enrichments.set(ep.id, e);
}

// 1. glossary ---------------------------------------------------------------
function splitParen(s: string): string[] {
  const m = /^(.*?)\s*\(([^)]+)\)\s*$/.exec(s.trim());
  return (m ? [m[1]!, m[2]!] : [s]).map((x) => x.trim()).filter(Boolean);
}

const glossary = new Map<string, GlossaryEntry>();
/** English alias -> slug, so "AMM" and "Automated Market Maker (AMM)" land on one entry. */
const enAliasToSlug = new Map<string, string>();
for (const ep of episodes) {
  for (const g of enrichments.get(ep.id)?.glossary ?? []) {
    const [canonical = g.term, ...enRest] = splitParen(g.term);
    const enAliases = [canonical, ...enRest]
      .map((a) => normalize(a).trim())
      .filter((a) => a.length >= 3);
    const faAliases = splitParen(g.termFa)
      .map((a) => normalize(a).trim())
      .filter((a) => a.length >= 3);
    const slug = enAliases.map((a) => enAliasToSlug.get(a)).find(Boolean) ?? slugify(canonical);
    if (!slug) continue;
    const aliases = [...enAliases, ...faAliases];
    const existing = glossary.get(slug);
    if (existing) {
      existing.aliases = [...new Set([...existing.aliases, ...aliases])];
      if (!existing.episodes.includes(ep.id)) existing.episodes.push(ep.id);
    } else {
      glossary.set(slug, {
        slug,
        term: canonical,
        termFa: g.termFa.trim(),
        definitionEn: g.definitionEn.trim(),
        definitionFa: g.definitionFa.trim(),
        aliases: [...new Set(aliases)],
        episodes: [ep.id],
      });
    }
    for (const a of enAliases) if (!enAliasToSlug.has(a)) enAliasToSlug.set(a, slug);
  }
}
const glossaryList = [...glossary.values()].sort((a, b) => a.term.localeCompare(b.term));
writeJson(GLOSSARY_JSON, glossaryList);
console.log(
  `glossary.json: ${glossaryList.length} terms from ${enrichments.size} enriched episodes`,
);

// 2. corrections ------------------------------------------------------------
function compile(c: Correction): { re: RegExp; right: string } | undefined {
  const wrong = c.wrong.trim();
  // One canonical spelling of the show name, whatever casing a rule proposes;
  // otherwise per-episode rules and the baseline undo each other on every run.
  const right = c.right.trim().replace(SHOW_NAME, 'Shir ya Khat');
  if (wrong.length < 4 || !right || right === wrong || UNSAFE_WRONG.has(wrong)) return undefined;
  // Idempotence: if the fix contains the mistake, re-running would stack replacements.
  if (right.includes(wrong)) return undefined;
  const body = escapeRegExp(wrong);
  const re =
    c.lang === 'en' && !hasPersian(wrong)
      ? new RegExp(`(?<![A-Za-z0-9])${body}(?![A-Za-z0-9])`, 'g')
      : new RegExp(`(?<![\\u0600-\\u06FF])${body}(?![\\u0600-\\u06FF])`, 'g');
  return { re, right };
}

let replaced = 0;
const transcripts = new Map<string, Transcript>();
for (const ep of episodes) {
  const file = path.join(TRANSCRIPTS_DIR, `${ep.id}.json`);
  const t = readJsonIfExists<Transcript>(file);
  if (!t) continue;
  // Baseline last, so it also normalises whatever the episode rules produced.
  const all = [...(enrichments.get(ep.id)?.corrections ?? []), ...BASELINE];
  const rules: Record<'en' | 'fa', { re: RegExp; right: string }[]> = { en: [], fa: [] };
  for (const c of all) {
    const r = compile(c);
    if (r) rules[c.lang].push(r);
  }
  let changed = false;
  for (const cue of t.cues) {
    for (const [idx, list] of [
      [2, rules.en],
      [3, rules.fa],
    ] as const) {
      let text = cue[idx];
      for (const { re, right } of list) {
        text = text.replace(re, () => {
          replaced++;
          return right;
        });
      }
      if (text !== cue[idx]) {
        cue[idx] = text;
        changed = true;
      }
    }
  }
  if (changed) writeJson(file, t, false);
  transcripts.set(ep.id, t);
}
console.log(`transcripts: ${replaced} corrections applied`);

// 3. search index -----------------------------------------------------------
const tokenMap = new Map<string, Set<number>>();
const ids = episodes.filter((e) => transcripts.has(e.id)).map((e) => e.id);
ids.forEach((id, i) => {
  const ep = episodes.find((e) => e.id === id)!;
  const add = (s: string) => {
    for (const tok of tokenize(s)) {
      if (/^\d+$/.test(tok) || tok.length > 32) continue;
      let set = tokenMap.get(tok);
      if (!set) tokenMap.set(tok, (set = new Set()));
      set.add(i);
    }
  };
  add(`${ep.titleEn} ${ep.titleFa}`);
  for (const cue of transcripts.get(id)!.cues) {
    add(cue[2]);
    add(cue[3]);
  }
});
const tokens: Record<string, number[]> = {};
for (const tok of [...tokenMap.keys()].sort())
  tokens[tok] = [...tokenMap.get(tok)!].sort((a, b) => a - b);
const index: SearchIndex = { version: 1, episodes: ids, tokens };
writeJson(SEARCH_INDEX_JSON, index, false);
console.log(
  `search-index.json: ${tokenMap.size} tokens, ${(fs.statSync(SEARCH_INDEX_JSON).size / 1024).toFixed(0)} KB`,
);

// 4. generated module -------------------------------------------------------
const req = (dir: string, list: string[]) =>
  list.map((id) => `  '${id}': () => require('./${dir}/${id}.json'),`).join('\n');
writeText(
  GENERATED_TS,
  `/* eslint-disable */
// AUTO-GENERATED by pipeline/src/finalize.ts — do not edit.
// Static require map so Metro can bundle the content and load transcripts lazily.
import type { Enrichment, Episode, GlossaryEntry, SearchIndex, Transcript } from './types';

export const episodes: Episode[] = require('./episodes.json');
export const glossary: GlossaryEntry[] = require('./glossary.json');
export const loadSearchIndex = (): SearchIndex => require('./search-index.json');

export const transcriptLoaders: Record<string, () => Transcript> = {
${req('transcripts', ids)}
};

export const enrichmentLoaders: Record<string, () => Enrichment> = {
${req('enrichment', [...enrichments.keys()])}
};
`,
);
console.log(`index.generated.ts: ${ids.length} transcripts, ${enrichments.size} enrichments`);
