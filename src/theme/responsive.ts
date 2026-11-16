/**
 * Responsive layout: the app is designed for phones, and on wide screens (iPad,
 * Android tablets, unfolded foldables) its content sits in a centred column
 * instead of stretching edge to edge. Below the tablet breakpoint every value
 * here is the identity, so the phone layout is untouched.
 */
import { useMemo } from 'react';
import { useWindowDimensions } from 'react-native';

/** Window widths (dp/pt) at which the layout changes. 600 is Android's `sw600dp`. */
export const breakpoints = { tablet: 600, wide: 900 } as const;

/** Widest the content column gets: a comfortable measure for transcripts and settings. */
export const MAX_CONTENT_WIDTH = 760;

/** Clear space kept on each side of the column on tablets too narrow to reach the cap. */
export const TABLET_GUTTER = 24;

export interface Layout {
  /** At or past the tablet breakpoint. */
  isTablet: boolean;
  /** At or past the wide breakpoint (full-size iPads, landscape tablets). */
  isWide: boolean;
  /** Width of the centred content column; the full window on phones. */
  contentWidth: number;
  /** Space left on each side of the column; 0 on phones. */
  gutter: number;
  /** Multiplier for type sizes; 1 on phones. */
  typeScale: number;
  /** Multiplier for artwork and other fixed-size pieces; 1 on phones. */
  sizeScale: number;
}

export function layoutFor(width: number): Layout {
  const isTablet = width >= breakpoints.tablet;
  const isWide = width >= breakpoints.wide;
  if (!isTablet) {
    return {
      isTablet,
      isWide,
      contentWidth: width,
      gutter: 0,
      typeScale: 1,
      sizeScale: 1,
    };
  }
  const contentWidth = Math.min(width - 2 * TABLET_GUTTER, MAX_CONTENT_WIDTH);
  return {
    isTablet,
    isWide,
    contentWidth,
    gutter: (width - contentWidth) / 2,
    typeScale: isWide ? 1.15 : 1.1,
    sizeScale: isWide ? 1.4 : 1.25,
  };
}

/** Scale a type style, keeping sizes on whole points. */
export function scaleType<T extends { fontSize: number; lineHeight: number }>(
  style: T,
  scale: number,
): T {
  if (scale === 1) return style;
  return {
    ...style,
    fontSize: Math.round(style.fontSize * scale),
    lineHeight: Math.round(style.lineHeight * scale),
  };
}

/** The layout for the current window; follows rotation, split view and folding. */
export function useResponsive(): Layout {
  const { width } = useWindowDimensions();
  return useMemo(() => layoutFor(width), [width]);
}
