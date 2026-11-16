import { createContext, type ReactNode } from 'react';
import { View, type ViewStyle } from 'react-native';
import { useResponsive } from '@/theme';

interface Props {
  children: ReactNode;
  /** Take the remaining height (the default); pass `false` for a bar or a strip. */
  fill?: boolean;
  style?: ViewStyle;
  testID?: string;
}

/**
 * The centred, max-width column that screens lay their content in. On phones it
 * is a plain (optionally flex) view; on tablets it caps the width and centres.
 */
export function Content({ children, fill = true, style, testID }: Props) {
  const { isTablet, contentWidth } = useResponsive();
  return (
    <View
      testID={testID}
      style={[
        fill ? { flex: 1 } : null,
        isTablet ? { width: '100%', maxWidth: contentWidth, alignSelf: 'center' } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

/**
 * Pins the type scale for a subtree, whatever the screen: the share card is
 * captured as an image and must look the same on every device.
 */
export const TypeScaleOverride = createContext<number | null>(null);
