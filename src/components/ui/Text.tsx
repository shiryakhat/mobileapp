import { useContext } from 'react';
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { useI18n } from '@/i18n';
import {
  font,
  scaleType,
  type as typeScale,
  useResponsive,
  useTheme,
  type Palette,
  type TypeVariant,
} from '@/theme';
import { TypeScaleOverride } from './Content';

type ColorKey = keyof Pick<
  Palette,
  'text' | 'muted' | 'faint' | 'accent' | 'onAccent' | 'danger' | 'success'
>;

export interface TextProps extends RNTextProps {
  variant?: TypeVariant;
  color?: ColorKey;
  weight?: keyof typeof font;
  /** Logical alignment: `start` is the right edge in Farsi and the left edge in English. */
  align?: 'start' | 'center' | 'end';
  /** Force the paragraph direction, e.g. an English line shown inside the Farsi UI. */
  dir?: 'rtl' | 'ltr';
}

export function Text({
  variant = 'body',
  color = 'text',
  weight,
  align = 'start',
  dir,
  style,
  ...rest
}: TextProps) {
  const theme = useTheme();
  const { isRTL } = useI18n();
  // Type grows modestly on tablets; a subtree can pin it (the share card does).
  const pinned = useContext(TypeScaleOverride);
  const responsive = useResponsive();
  const scale = pinned ?? responsive.typeScale;
  const rtl = dir ? dir === 'rtl' : isRTL;
  // React Native resolves `left`/`right` against the inherited layout direction
  // (so `left` is the start edge in RTL, verified on iOS) — map logical to that.
  const textAlign: TextStyle['textAlign'] =
    align === 'center' ? 'center' : align === 'start' ? 'left' : 'right';
  const defaultWeight =
    variant === 'display' || variant === 'title'
      ? 'bold'
      : variant === 'heading'
        ? 'medium'
        : 'regular';
  return (
    <RNText
      {...rest}
      style={[
        scaleType(typeScale[variant], scale),
        {
          color: theme[color],
          fontFamily: font[weight ?? defaultWeight],
          textAlign,
          writingDirection: rtl ? 'rtl' : 'ltr',
        },
        style,
      ]}
    />
  );
}
