export interface SrtCue {
  startMs: number;
  endMs: number;
  text: string;
}

function toMs(h: string, m: string, s: string, ms: string): number {
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + Number(ms);
}

const TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})/;

export function parseSrt(raw: string): SrtCue[] {
  const cues: SrtCue[] = [];
  const blocks = raw
    .replace(/^\uFEFF/, '')
    .replace(/\r/g, '')
    .split(/\n{2,}/);
  for (const block of blocks) {
    const lines = block.split('\n');
    const ti = lines.findIndex((l) => TIME.test(l));
    if (ti < 0) continue;
    const m = TIME.exec(lines[ti]!)!;
    const text = lines
      .slice(ti + 1)
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    cues.push({
      startMs: toMs(m[1]!, m[2]!, m[3]!, m[4]!),
      endMs: toMs(m[5]!, m[6]!, m[7]!, m[8]!),
      text,
    });
  }
  return cues.sort((a, b) => a.startMs - b.startMs);
}

/**
 * Merge two cue tracks into one bilingual list aligned by timestamp.
 * The FA track (source language) drives the timeline; every EN cue is attached
 * to the FA cue it overlaps most (or the nearest one), so nothing is dropped
 * even when the two tracks are segmented differently.
 */
export function mergeTracks(
  fa: SrtCue[],
  en: SrtCue[],
): { startMs: number; endMs: number; en: string; fa: string }[] {
  if (fa.length === 0)
    return en.map((c) => ({ startMs: c.startMs, endMs: c.endMs, en: c.text, fa: '' }));
  const out = fa.map((c) => ({ startMs: c.startMs, endMs: c.endMs, fa: c.text, en: '' }));
  let j = 0;
  for (const e of en) {
    while (j < out.length - 1 && out[j]!.endMs <= e.startMs) j++;
    let best = j;
    let bestScore = -Infinity;
    for (let k = Math.max(0, j - 1); k <= Math.min(out.length - 1, j + 2); k++) {
      const o = out[k]!;
      const overlap = Math.min(o.endMs, e.endMs) - Math.max(o.startMs, e.startMs);
      const score = overlap > 0 ? overlap : -Math.abs(o.startMs - e.startMs);
      if (score > bestScore) {
        bestScore = score;
        best = k;
      }
    }
    const target = out[best]!;
    target.en = target.en ? `${target.en} ${e.text}` : e.text;
  }
  return out;
}
