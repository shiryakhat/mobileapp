/**
 * Full-archive search.
 *
 * Two stages keep it fast without shipping a heavy FTS engine:
 *   1. the precomputed inverted index (token -> episodes) narrows the query to
 *      the few episodes that can match (with prefix matching on the last token);
 *   2. only those transcripts are loaded and scanned cue-by-cue.
 * The scan yields between episodes so typing stays responsive.
 */
import { loadSearchIndex } from '@content/index.generated';
import { normalize, tokenize } from '@/lib/text';
import { episodes, getEpisode, getTranscript } from './index';

export interface SearchHit {
  episodeId: string;
  cueIndex: number;
  startSec: number;
  fa: string;
  en: string;
}

export interface EpisodeHits {
  episodeId: string;
  titleMatch: boolean;
  total: number;
  hits: SearchHit[];
}

const MAX_HITS_PER_EPISODE = 50;

let sortedTokens: string[] | undefined;
function tokensSorted(): string[] {
  return (sortedTokens ??= Object.keys(loadSearchIndex().tokens));
}

/** Episodes (as indices into index.episodes) containing a token; prefix-matched if asked. */
function episodesFor(token: string, prefix: boolean): Set<number> {
  const index = loadSearchIndex();
  const out = new Set<number>(index.tokens[token] ?? []);
  if (prefix) {
    const keys = tokensSorted();
    let lo = 0;
    let hi = keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (keys[mid]! < token) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo; i < keys.length && keys[i]!.startsWith(token); i++) {
      for (const e of index.tokens[keys[i]!]!) out.add(e);
    }
  }
  return out;
}

const normalizedCache = new Map<string, string[]>();
function normalizedCues(id: string): string[] {
  let cached = normalizedCache.get(id);
  if (!cached) {
    const t = getTranscript(id);
    cached = t ? t.cues.map((c) => normalize(`${c[2]}\n${c[3]}`)) : [];
    normalizedCache.set(id, cached);
  }
  return cached;
}

const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export async function searchArchive(
  query: string,
  isCancelled: () => boolean = () => false,
): Promise<EpisodeHits[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const index = loadSearchIndex();

  let candidates: Set<number> | undefined;
  tokens.forEach((tok, i) => {
    const set = episodesFor(tok, i === tokens.length - 1);
    candidates = candidates ? new Set([...candidates].filter((e) => set.has(e))) : set;
  });

  const phrase = normalize(query).trim().replace(/\s+/g, ' ');
  const results: EpisodeHits[] = [];
  const order = new Map(episodes.map((e, i) => [e.id, i]));
  const ids = [...(candidates ?? [])]
    .map((i) => index.episodes[i]!)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  for (const id of ids) {
    if (isCancelled()) return [];
    const ep = getEpisode(id);
    const transcript = getTranscript(id);
    if (!ep || !transcript) continue;
    const title = normalize(`${ep.titleEn} ${ep.titleFa}`);
    const titleMatch = tokens.every((t) => title.includes(t));
    const cues = normalizedCues(id);
    const hits: SearchHit[] = [];
    let total = 0;
    for (let i = 0; i < cues.length; i++) {
      const text = cues[i]!;
      if (!tokens.every((t) => text.includes(t))) continue;
      total++;
      if (hits.length < MAX_HITS_PER_EPISODE) {
        const cue = transcript.cues[i]!;
        hits.push({
          episodeId: id,
          cueIndex: i,
          startSec: Math.floor(cue[0] / 1000),
          en: cue[2],
          fa: cue[3],
        });
      }
    }
    if (total > 0 || titleMatch) {
      // Exact-phrase matches float to the top within an episode.
      hits.sort(
        (a, b) =>
          Number(cues[b.cueIndex]!.includes(phrase)) - Number(cues[a.cueIndex]!.includes(phrase)) ||
          a.cueIndex - b.cueIndex,
      );
      results.push({ episodeId: id, titleMatch, total, hits });
    }
    await yieldToUI();
  }
  return results.sort((a, b) => Number(b.titleMatch) - Number(a.titleMatch) || b.total - a.total);
}
