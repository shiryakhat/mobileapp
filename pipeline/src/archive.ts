/**
 * content/episodes.json  ->  content/episodes.json, with archive.org fallback URLs.
 *
 * For every episode, look its archive.org item up (see lib/archive.ts) and
 * record the playable audio / video file URLs, so the app can fall back to
 * archive.org at runtime without ever calling the metadata API itself.
 *
 * Needs the network but not the corpus, so it can run on its own
 * (`npm --prefix pipeline run archive`). It never fails the build: episodes
 * that cannot be resolved simply carry no archive fields.
 */
import { EPISODES_JSON } from './config.js';
import { resolveArchive } from './lib/archive.js';
import { readJson, writeJson } from './lib/io.js';
import type { Episode } from './types.js';

const episodes = readJson<Episode[]>(EPISODES_JSON);
const stats = await resolveArchive(episodes);
writeJson(EPISODES_JSON, episodes);

if (stats.missing.length) console.warn(`! no archive.org item for: ${stats.missing.join(', ')}`);
if (stats.failed.length) {
  console.warn(`! lookup failed (previous values kept) for: ${stats.failed.join(', ')}`);
}
const count = (key: 'archiveAudioUrl' | 'archiveVideoUrl') => episodes.filter((e) => e[key]).length;
console.log(
  `archive.org: ${stats.resolved}/${episodes.length} episodes resolved ` +
    `(${count('archiveAudioUrl')} audio, ${count('archiveVideoUrl')} video)`,
);
