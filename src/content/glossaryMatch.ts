import { escapeRegExp, hasPersian } from '@/lib/text';
import { glossary } from './index';

export interface TextSegment {
  text: string;
  /** Glossary slug when this segment is a known term. */
  slug?: string;
}

interface Matcher {
  re: RegExp;
  slugOf: Map<string, string>;
}

let matchers: { en: Matcher | null; fa: Matcher | null } | undefined;

function build(): NonNullable<typeof matchers> {
  const make = (persian: boolean): Matcher | null => {
    const slugOf = new Map<string, string>();
    for (const g of glossary) {
      for (const alias of g.aliases) {
        if (hasPersian(alias) === persian && !slugOf.has(alias)) slugOf.set(alias, g.slug);
      }
    }
    if (slugOf.size === 0) return null;
    // Longest first so "proof of stake" wins over "stake".
    const alt = [...slugOf.keys()]
      .sort((a, b) => b.length - a.length)
      .map((a) => escapeRegExp(a).replace(/ /g, '[\\s\\u200c-]+'))
      .join('|');
    const re = persian
      ? new RegExp(`(?<![\\u0600-\\u06FF])(${alt})(?![\\u0600-\\u06FF])`, 'g')
      : new RegExp(`(?<![A-Za-z0-9])(${alt})(?![A-Za-z0-9])`, 'gi');
    return { re, slugOf };
  };
  return { en: make(false), fa: make(true) };
}

const key = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s\u200c-]+/g, ' ')
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک');

/** Split a transcript line into plain text and tappable glossary terms. */
export function segmentWithGlossary(text: string, lang: 'en' | 'fa'): TextSegment[] {
  matchers ??= build();
  const m = matchers[lang];
  if (!m || !text) return [{ text }];
  const out: TextSegment[] = [];
  let last = 0;
  m.re.lastIndex = 0;
  for (let match = m.re.exec(text); match; match = m.re.exec(text)) {
    const slug = m.slugOf.get(key(match[0]));
    if (!slug) continue;
    if (match.index > last) out.push({ text: text.slice(last, match.index) });
    out.push({ text: match[0], slug });
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out.length ? out : [{ text }];
}
