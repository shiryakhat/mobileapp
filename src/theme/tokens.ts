/**
 * Design tokens. Dark-first: "ink and brass" — the two faces of a coin.
 * Every colour used in the app comes from here.
 */
export interface Palette {
  bg: string;
  surface: string;
  raised: string;
  line: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  onAccent: string;
  accentSoft: string;
  danger: string;
  success: string;
  scrim: string;
}

export const dark: Palette = {
  bg: '#0B0B0D',
  surface: '#131316',
  raised: '#1C1C21',
  line: '#27272D',
  text: '#F3EFE6',
  muted: '#A19D94',
  faint: '#6E6B65',
  accent: '#E4B54A',
  onAccent: '#1A1407',
  accentSoft: 'rgba(228,181,74,0.14)',
  danger: '#EA6A57',
  success: '#62C08F',
  scrim: 'rgba(0,0,0,0.6)',
};

export const light: Palette = {
  bg: '#F7F4EE',
  surface: '#FFFFFF',
  raised: '#EFEBE2',
  line: '#E1DBCF',
  text: '#17150F',
  muted: '#676359',
  faint: '#9B968B',
  accent: '#9A6F0C',
  onAccent: '#FFFFFF',
  accentSoft: 'rgba(154,111,12,0.12)',
  danger: '#C2412D',
  success: '#2E8B5B',
  scrim: 'rgba(20,18,12,0.45)',
};

/** Brand navy of the logo, app icon and launch screen — the same in both themes. */
export const brand = { navy: '#050B3E' } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, pill: 999 } as const;

/** Vazirmatn carries both the Persian and Latin glyphs, so one family serves both languages. */
export const font = {
  regular: 'Vazirmatn_400Regular',
  medium: 'Vazirmatn_500Medium',
  bold: 'Vazirmatn_700Bold',
} as const;

/** Line heights are generous: Persian script needs the vertical room. */
export const type = {
  display: { fontSize: 28, lineHeight: 42 },
  title: { fontSize: 21, lineHeight: 34 },
  heading: { fontSize: 17, lineHeight: 28 },
  body: { fontSize: 15, lineHeight: 26 },
  small: { fontSize: 13, lineHeight: 22 },
  micro: { fontSize: 11, lineHeight: 18 },
} as const;

export type TypeVariant = keyof typeof type;
export const HIT_SLOP = { top: 10, bottom: 10, left: 10, right: 10 } as const;
