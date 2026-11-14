/**
 * Claude cleaning + enrichment pass (the only step that needs ANTHROPIC_API_KEY).
 *
 * Per episode -> content/enrichment/<id>.json:
 *   bilingual summary, key quotes (timestamped), glossary terms, name/term corrections.
 *
 * Resumable + idempotent: content/enrichment/manifest.json records what is done;
 * re-running skips finished episodes. Flags:
 *   --only s07e07,s07e06   restrict to ids
 *   --limit N              process at most N pending episodes
 *   --concurrency N        parallel requests in direct mode (default 3)
 *   --batch                use the Message Batches API (50% cheaper, async; resumable)
 *   --force                redo episodes even if already done
 */
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ENRICHMENT_DIR, ENRICHMENT_MANIFEST, EPISODES_JSON, TRANSCRIPTS_DIR } from './config.js';
import { readJson, readJsonIfExists, writeJson } from './lib/io.js';
import type { Enrichment, Episode, Transcript } from './types.js';

const MODEL = process.env.SYK_ENRICH_MODEL ?? 'claude-sonnet-4-6';
const PROMPT_VERSION = 1;
const MAX_TOKENS = 8000;

const OutputSchema = z.object({
  summaryFa: z.string(),
  summaryEn: z.string(),
  quotes: z.array(
    z.object({
      startSec: z.number(),
      fa: z.string(),
      en: z.string(),
      speaker: z.string(),
    }),
  ),
  glossary: z.array(
    z.object({
      term: z.string(),
      termFa: z.string(),
      definitionEn: z.string(),
      definitionFa: z.string(),
    }),
  ),
  corrections: z.array(
    z.object({
      lang: z.enum(['en', 'fa']),
      wrong: z.string(),
      right: z.string(),
    }),
  ),
});
type Output = z.infer<typeof OutputSchema>;

const SYSTEM = `You are the editor of "Shir ya Khat" (شیر یا خط, "Heads or Tails"), a Persian-language blockchain podcast recorded as live panels by the CoinIran community.

You receive one episode: metadata, then its machine transcript. Each line is "[seconds] Persian original ¦ machine English translation". Both tracks are raw Whisper output and unproofread. Whisper regularly mis-hears proper nouns: the show name appears as "Shenakht" / "شناخت"; projects, people and crypto terms are garbled (e.g. «تورنیدو کشت» = Tornado Cash). Use the metadata and your domain knowledge to recover the correct forms.

Return:
- summaryFa / summaryEn: 2-3 sentences each on what the episode covers and why it matters. No hype, no "in this episode we".
- quotes: 3-5 memorable, self-contained lines actually said in the episode. Lightly clean them (fix names, drop filler) without changing meaning. startSec = the timestamp of the line where the quote begins. fa = Persian, en = natural English. speaker = first name if clear from context, else "".
- glossary: 5-12 crypto/blockchain terms that matter in this episode. term = canonical English name; termFa = the usual Persian rendering; definitionEn / definitionFa = one plain sentence each (max 25 words), written for a curious newcomer.
- corrections: up to 30 systematic mis-transcriptions worth fixing by global find-and-replace. wrong = the exact string as it appears in the transcript (at least 4 characters and specific enough that replacing every occurrence is safe); right = the correct form; lang = which track it occurs in. Only names and technical terms, never style edits.

Persian must read as natural, fluent Persian written by a native editor: correct نیم‌فاصله, Persian punctuation («», ،), no word-for-word translationese.`;

interface ManifestEntry {
  status: 'done' | 'error';
  at: string;
  promptVersion: number;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  error?: string;
}
interface Manifest {
  episodes: Record<string, ManifestEntry>;
  /** In-flight Message Batches job, so `--batch` can resume polling after a crash. */
  pendingBatch?: { id: string; episodeIds: string[]; createdAt: string };
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const manifest: Manifest = readJsonIfExists<Manifest>(ENRICHMENT_MANIFEST) ?? { episodes: {} };
const saveManifest = () => writeJson(ENRICHMENT_MANIFEST, manifest);
const outFile = (id: string) => path.join(ENRICHMENT_DIR, `${id}.json`);

function isDone(id: string): boolean {
  const m = manifest.episodes[id];
  return m?.status === 'done' && m.promptVersion === PROMPT_VERSION && fs.existsSync(outFile(id));
}

function buildUserMessage(ep: Episode, transcript: Transcript): string {
  const meta = [
    `Episode: ${ep.code}`,
    `Title (EN): ${ep.titleEn}`,
    `Title (FA): ${ep.titleFa}`,
    `Published: ${ep.publishedAt}`,
    ep.keywords.length ? `Keywords: ${ep.keywords.join(', ')}` : '',
    ep.descriptionFa ? `Description (FA): ${ep.descriptionFa}` : '',
    ep.descriptionEn ? `Description (EN): ${ep.descriptionEn}` : '',
    ep.chapters.length ? `Chapters: ${ep.chapters.map((c) => c.title).join(' / ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const lines = transcript.cues
    .map(([startMs, , en, fa]) => `[${Math.round(startMs / 1000)}] ${fa} ¦ ${en}`)
    .join('\n');
  return `<metadata>\n${meta}\n</metadata>\n\n<transcript>\n${lines}\n</transcript>`;
}

function buildParams(ep: Episode, transcript: Transcript) {
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    messages: [{ role: 'user' as const, content: buildUserMessage(ep, transcript) }],
    output_config: { format: zodOutputFormat(OutputSchema) },
  };
}

function parseOutput(message: Anthropic.Message): Output {
  if (message.stop_reason !== 'end_turn') {
    throw new Error(`unexpected stop_reason: ${message.stop_reason}`);
  }
  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
  return OutputSchema.parse(JSON.parse(text));
}

function persist(ep: Episode, transcript: Transcript, out: Output, usage: Anthropic.Usage): void {
  // Snap quote timestamps onto real cue starts and keep them inside the episode.
  const starts = transcript.cues.map((c) => c[0] / 1000);
  const snap = (sec: number) => {
    const clamped = Math.min(Math.max(0, sec), ep.durationSec);
    let best = starts[0] ?? 0;
    for (const s of starts) if (Math.abs(s - clamped) < Math.abs(best - clamped)) best = s;
    return Math.round(best);
  };
  const enrichment: Enrichment = {
    id: ep.id,
    model: MODEL,
    generatedAt: new Date().toISOString(),
    summaryFa: out.summaryFa.trim(),
    summaryEn: out.summaryEn.trim(),
    quotes: out.quotes.map((q) => ({
      startSec: snap(q.startSec),
      fa: q.fa.trim(),
      en: q.en.trim(),
      ...(q.speaker.trim() ? { speaker: q.speaker.trim() } : {}),
    })),
    glossary: out.glossary,
    corrections: out.corrections.filter((c) => c.wrong.trim().length >= 4 && c.wrong !== c.right),
  };
  writeJson(outFile(ep.id), enrichment);
  manifest.episodes[ep.id] = {
    status: 'done',
    at: enrichment.generatedAt,
    promptVersion: PROMPT_VERSION,
    model: MODEL,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
  };
  saveManifest();
}

function recordError(id: string, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  manifest.episodes[id] = {
    status: 'error',
    at: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    model: MODEL,
    error: msg.slice(0, 500),
  };
  saveManifest();
  console.error(`✗ ${id}: ${msg.slice(0, 200)}`);
}

async function runDirect(client: Anthropic, todo: Episode[], concurrency: number): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const ep = todo[next++];
      if (!ep) return;
      const transcript = readJson<Transcript>(path.join(TRANSCRIPTS_DIR, `${ep.id}.json`));
      try {
        const message = await client.messages.stream(buildParams(ep, transcript)).finalMessage();
        persist(ep, transcript, parseOutput(message), message.usage);
        console.log(
          `✓ ${ep.id}  in ${message.usage.input_tokens}  out ${message.usage.output_tokens}`,
        );
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) throw err; // no point continuing
        recordError(ep.id, err);
      }
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));
}

async function runBatch(client: Anthropic, todo: Episode[], byId: Map<string, Episode>) {
  if (!manifest.pendingBatch) {
    if (todo.length === 0) return;
    const batch = await client.messages.batches.create({
      requests: todo.map((ep) => ({
        custom_id: ep.id,
        params: buildParams(ep, readJson<Transcript>(path.join(TRANSCRIPTS_DIR, `${ep.id}.json`))),
      })),
    });
    manifest.pendingBatch = {
      id: batch.id,
      episodeIds: todo.map((e) => e.id),
      createdAt: new Date().toISOString(),
    };
    saveManifest();
    console.log(`submitted batch ${batch.id} (${todo.length} episodes)`);
  } else {
    console.log(`resuming batch ${manifest.pendingBatch.id}`);
  }
  const batchId = manifest.pendingBatch.id;
  for (;;) {
    const b = await client.messages.batches.retrieve(batchId);
    if (b.processing_status === 'ended') break;
    console.log(`  batch ${b.processing_status}: ${JSON.stringify(b.request_counts)}`);
    await new Promise((r) => setTimeout(r, 60_000));
  }
  for await (const result of await client.messages.batches.results(batchId)) {
    const ep = byId.get(result.custom_id);
    if (!ep) continue;
    if (result.result.type !== 'succeeded') {
      recordError(ep.id, new Error(`batch result: ${result.result.type}`));
      continue;
    }
    try {
      const transcript = readJson<Transcript>(path.join(TRANSCRIPTS_DIR, `${ep.id}.json`));
      const message = result.result.message;
      persist(ep, transcript, parseOutput(message), message.usage);
      console.log(`✓ ${ep.id}`);
    } catch (err) {
      recordError(ep.id, err);
    }
  }
  delete manifest.pendingBatch;
  saveManifest();
}

async function main(): Promise<void> {
  const episodes = readJson<Episode[]>(EPISODES_JSON);
  const byId = new Map(episodes.map((e) => [e.id, e]));
  const only = arg('only')?.split(',');
  const limit = Number(arg('limit') ?? Infinity);
  const todo = episodes
    .filter((e) => (only ? only.includes(e.id) : true))
    .filter((e) => fs.existsSync(path.join(TRANSCRIPTS_DIR, `${e.id}.json`)))
    .filter((e) => flag('force') || !isDone(e.id))
    .slice(0, limit);

  const done = episodes.filter((e) => isDone(e.id)).length;
  console.log(
    `enrich: ${done}/${episodes.length} already done, ${todo.length} to process (${MODEL})`,
  );
  if (todo.length === 0 && !manifest.pendingBatch) return;

  const client = new Anthropic({ maxRetries: 6 });
  if (flag('batch')) await runBatch(client, todo, byId);
  else await runDirect(client, todo, Number(arg('concurrency') ?? 3));

  const finished = episodes.filter((e) => isDone(e.id)).length;
  console.log(`enrich: ${finished}/${episodes.length} done`);
}

await main();
