import { cueIndexAt, episodes, getEnrichment, getTranscript, glossary, seasons } from '@/content';
import { segmentWithGlossary } from '@/content/glossaryMatch';
import { searchArchive } from '@/content/search';
import { episodeThumb, episodeThumbCodes } from '@/content/thumbs';
import { normalize, tokenize } from '@/lib/text';

describe('content bundle', () => {
  it('ships every episode with the fields the app relies on', () => {
    expect(episodes.length).toBeGreaterThanOrEqual(41);
    for (const e of episodes) {
      expect(e.id).toMatch(/^(s\d{2}e\d{2}|sp\d{2})$/);
      expect(e.youtubeId).toHaveLength(11);
      expect(e.titleFa || e.titleEn).toBeTruthy();
      expect(e.durationSec).toBeGreaterThan(0);
      expect(e.youtubeThumb).toMatch(/^https:\/\/i\.ytimg\.com\//);
      expect(e.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    expect(new Set(episodes.map((e) => e.id)).size).toBe(episodes.length);
  });

  it('groups seasons newest first with specials last', () => {
    expect(seasons[0]!.season).toBe(7);
    expect(seasons.at(-1)!.season).toBe(0);
  });

  it('has a transcript with ordered cues for every episode', () => {
    for (const e of episodes) {
      const t = getTranscript(e.id);
      expect(t?.cues.length).toBeGreaterThan(100);
      const starts = t!.cues.map((c) => c[0]);
      expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    }
  });

  it('keeps chapters ordered and inside the episode', () => {
    for (const e of episodes) {
      let prev = -1;
      for (const c of e.chapters) {
        expect(c.startSec).toBeGreaterThan(prev);
        expect(c.startSec).toBeLessThanOrEqual(e.durationSec);
        prev = c.startSec;
      }
    }
  });

  it('keeps enrichment quotes inside the episode', () => {
    for (const e of episodes) {
      const enrichment = getEnrichment(e.id);
      if (!enrichment) continue;
      expect(enrichment.summaryFa.length).toBeGreaterThan(20);
      expect(enrichment.summaryEn.length).toBeGreaterThan(20);
      for (const q of enrichment.quotes) {
        expect(q.startSec).toBeGreaterThanOrEqual(0);
        expect(q.startSec).toBeLessThanOrEqual(e.durationSec);
      }
    }
  });

  it('cleans the mis-heard show name out of the transcripts', () => {
    for (const e of episodes) {
      const text = getTranscript(e.id)!
        .cues.map((c) => c[2])
        .join(' ');
      expect(text).not.toMatch(/Shenakht/);
    }
  });
});

describe('cueIndexAt', () => {
  const t = {
    id: 'x',
    cues: [
      [1000, 2000, 'a', ''],
      [3000, 4000, 'b', ''],
      [5000, 6000, 'c', ''],
    ] as [number, number, string, string][],
  };
  it('finds the last cue starting at or before the position', () => {
    expect(cueIndexAt(t, 0)).toBe(-1);
    expect(cueIndexAt(t, 1000)).toBe(0);
    expect(cueIndexAt(t, 2999)).toBe(0);
    expect(cueIndexAt(t, 3000)).toBe(1);
    expect(cueIndexAt(t, 99999)).toBe(2);
  });
});

describe('text normalisation', () => {
  it('unifies Arabic/Persian letter variants, digits and ZWNJ', () => {
    expect(normalize('كيف‌پول ۱۲۳')).toBe('کیف پول 123');
    expect(tokenize('Tornado-Cash، تورنادو کش!')).toEqual(['tornado', 'cash', 'تورنادو', 'کش']);
  });
});

describe('episode thumbnails', () => {
  it('bundles artwork only for real episodes, keyed by code', () => {
    const codes = new Set(episodes.map((e) => e.code));
    expect(episodeThumbCodes().length).toBeGreaterThanOrEqual(40);
    for (const code of episodeThumbCodes()) expect(codes.has(code)).toBe(true);
    expect(episodeThumb({ code: 'S01E01' })).toBeDefined();
  });

  it('leaves episodes without bundled artwork to their YouTube thumbnail', () => {
    expect(episodeThumb({ code: 'SP01' })).toBeUndefined();
  });
});

describe('archive search', () => {
  it('finds English phrases with episode + timestamp hits', async () => {
    const results = await searchArchive('tornado cash');
    expect(results.length).toBeGreaterThan(0);
    const privacy = results.find((r) => r.episodeId === 's07e07');
    expect(privacy?.total).toBeGreaterThan(10);
    expect(privacy!.hits[0]!.startSec).toBeGreaterThanOrEqual(0);
    expect(normalize(`${privacy!.hits[0]!.en} ${privacy!.hits[0]!.fa}`)).toContain('tornado');
  });

  it('finds Persian queries and prefix-matches the last word', async () => {
    expect((await searchArchive('لایتنینگ')).length).toBeGreaterThan(1);
    expect((await searchArchive('ether')).some((r) => r.total > 0)).toBe(true);
  });

  it('returns nothing for gibberish or too-short input', async () => {
    expect(await searchArchive('zzqqxxyy')).toEqual([]);
    expect(await searchArchive('a')).toEqual([]);
  });
});

describe('glossary', () => {
  it('has bilingual entries', () => {
    expect(glossary.length).toBeGreaterThan(50);
    for (const g of glossary) {
      expect(g.term && g.termFa && g.definitionEn && g.definitionFa).toBeTruthy();
    }
  });

  it('marks known terms inside a transcript line', () => {
    const term = glossary.find((g) => g.slug === 'smart-contract') ?? glossary[0]!;
    const segments = segmentWithGlossary(`We deployed a ${term.term} yesterday.`, 'en');
    expect(segments.some((s) => s.slug === term.slug)).toBe(true);
    expect(segments.map((s) => s.text).join('')).toBe(`We deployed a ${term.term} yesterday.`);
  });
});
