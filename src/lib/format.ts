import { digits } from '@/i18n';
import type { Locale } from '@/state/settings';

/** 3725 -> "1:02:05"; 125 -> "2:05". Digits are localised. */
export function formatTime(totalSec: number, locale: Locale = 'en'): string {
  const s = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return digits(h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`, locale);
}

export function formatMinutes(totalSec: number): number {
  return Math.max(1, Math.round(totalSec / 60));
}

/** Jalali calendar in Farsi, Gregorian in English. */
export function formatDate(iso: string, locale: Locale): string {
  const date = new Date(`${iso}T12:00:00Z`);
  try {
    return new Intl.DateTimeFormat(locale === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(date);
  } catch {
    return digits(iso, locale);
  }
}

export function formatBytes(bytes: number, locale: Locale): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return digits('0 MB', locale);
  const mb = bytes / (1024 * 1024);
  const text = mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return digits(text, locale);
}

/**
 * Join mixed-direction fragments (e.g. "S07E07" + a Persian date) with a dot.
 * Each fragment is wrapped in Unicode isolates so the bidi algorithm cannot
 * reorder digits and Latin codes across the separator.
 */
export function joinMeta(...parts: (string | undefined | null | false)[]): string {
  return parts
    .filter((p): p is string => Boolean(p))
    .map((p) => `\u2068${p}\u2069`)
    .join('  ·  ');
}
