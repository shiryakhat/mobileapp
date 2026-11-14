/** Text normalisation shared by the pipeline and (re-implemented identically) the app search. */

const ARABIC_RANGE = /[\u0600-\u06FF]/;

export function hasPersian(s: string): boolean {
  return ARABIC_RANGE.test(s);
}

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '') // harakat + tatweel
    .replace(/[\u200C\u200D\u200E\u200F]/g, ' ') // ZWNJ etc. -> space
    .replace(/[يى]/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[ۀة]/g, 'ه')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ؤ/g, 'و')
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function tokenize(s: string): string[] {
  return (
    normalize(s)
      // Letters only: the Arabic block also holds punctuation that must split words.
      .split(/[^a-z0-9\u0620-\u064A\u066E-\u06D3\u06D5\u06FA-\u06FC]+/)
      .filter((t) => t.length >= 2)
  );
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
