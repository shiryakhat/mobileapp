import { useColorScheme } from 'react-native';
import { useSettings } from '@/state/settings';
import { dark, light, type Palette } from './tokens';

export * from './tokens';

export function useTheme(): Palette & { isDark: boolean } {
  const pref = useSettings((s) => s.theme);
  const system = useColorScheme();
  const isDark = pref === 'system' ? system !== 'light' : pref === 'dark';
  return { ...(isDark ? dark : light), isDark };
}
