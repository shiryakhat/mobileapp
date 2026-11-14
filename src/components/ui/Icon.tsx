import Feather from '@expo/vector-icons/Feather';
import type { ComponentProps } from 'react';
import { useI18n } from '@/i18n';
import { useTheme, type Palette } from '@/theme';

export type IconName = ComponentProps<typeof Feather>['name'];

/** Directional glyphs that must mirror in RTL. */
const MIRRORED = new Set<IconName>([
  'chevron-left',
  'chevron-right',
  'arrow-left',
  'arrow-right',
  'corner-up-left',
  'corner-up-right',
  'list',
  'external-link',
  'log-out',
  'log-in',
]);

interface Props {
  name: IconName;
  size?: number;
  color?: keyof Palette;
}

export function Icon({ name, size = 20, color = 'text' }: Props) {
  const theme = useTheme();
  const { isRTL } = useI18n();
  const flip = isRTL && MIRRORED.has(name);
  return (
    <Feather
      name={name}
      size={size}
      color={theme[color] as string}
      style={flip ? { transform: [{ scaleX: -1 }] } : undefined}
    />
  );
}
