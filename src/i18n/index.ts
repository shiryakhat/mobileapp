import { useCallback, useMemo } from 'react';
import { useSettings, type Locale } from '@/state/settings';
import { en, type Dict } from './en';
import { fa } from './fa';

const dicts: Record<Locale, Dict> = { en, fa };
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

export const isRTLLocale = (locale: Locale) => locale === 'fa';

/** Localise digits: Persian numerals in Farsi, ASCII in English. */
export function digits(value: string | number, locale: Locale): string {
  const s = String(value);
  return locale === 'fa' ? s.replace(/\d/g, (d) => FA_DIGITS[Number(d)]!) : s;
}

export function translate(
  locale: Locale,
  key: keyof Dict,
  vars?: Record<string, string | number>,
): string {
  let s: string = dicts[locale][key] ?? en[key];
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, typeof v === 'number' ? digits(v, locale) : v);
    }
  }
  return s;
}

export interface I18n {
  locale: Locale;
  isRTL: boolean;
  /** Layout direction to hand to a root View's `direction` style. */
  dir: 'rtl' | 'ltr';
  t: (key: keyof Dict, vars?: Record<string, string | number>) => string;
  /** Pick the string for the current locale, falling back to the other language. */
  pick: (faText: string | undefined, enText: string | undefined) => string;
  /** The other language's string (for the secondary line of bilingual titles). */
  other: (faText: string | undefined, enText: string | undefined) => string;
  n: (value: string | number) => string;
}

export function useI18n(): I18n {
  const locale = useSettings((s) => s.locale);
  const t = useCallback<I18n['t']>((key, vars) => translate(locale, key, vars), [locale]);
  return useMemo(() => {
    const isRTL = isRTLLocale(locale);
    return {
      locale,
      isRTL,
      dir: isRTL ? 'rtl' : 'ltr',
      t,
      pick: (f, e) => (isRTL ? f || e : e || f) ?? '',
      other: (f, e) => (isRTL ? e : f) ?? '',
      n: (v) => digits(v, locale),
    };
  }, [locale, t]);
}
