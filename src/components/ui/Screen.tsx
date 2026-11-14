import type { ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { useTheme } from '@/theme';

interface Props {
  children: ReactNode;
  /** Which safe-area edges to pad. */
  edges?: ('top' | 'bottom')[];
  style?: ViewStyle;
  testID?: string;
}

/**
 * Root of every screen (and modal). Sets the layout direction for the subtree,
 * so the whole UI mirrors in Farsi without an app reload: rows flip and
 * start/end spacing resolves correctly.
 */
export function Screen({ children, edges = ['top'], style, testID }: Props) {
  const theme = useTheme();
  const { dir } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View
      testID={testID}
      style={[
        {
          flex: 1,
          direction: dir,
          backgroundColor: theme.bg,
          paddingTop: edges.includes('top') ? insets.top : 0,
          paddingBottom: edges.includes('bottom') ? insets.bottom : 0,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
