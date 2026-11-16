import type { ReactNode } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import { radius, space, useResponsive, useTheme } from '@/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
}

/** Minimal bottom sheet. Modals are a separate native root, so direction is re-applied. */
export function Sheet({ visible, onClose, children }: Props) {
  const theme = useTheme();
  const { dir, t } = useI18n();
  const insets = useSafeAreaInsets();
  const { isTablet, contentWidth } = useResponsive();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        accessibilityLabel={t('close')}
        onPress={onClose}
        style={{ flex: 1, backgroundColor: theme.scrim }}
      />
      <View
        style={{
          direction: dir,
          backgroundColor: theme.surface,
          borderTopLeftRadius: radius.lg,
          borderTopRightRadius: radius.lg,
          padding: space.xl,
          paddingBottom: insets.bottom + space.xl,
          gap: space.md,
          marginTop: -radius.lg,
          // On tablets the sheet is a centred card-width panel, not a full-width slab.
          ...(isTablet ? { width: '100%', maxWidth: contentWidth, alignSelf: 'center' } : null),
        }}
      >
        <View
          style={{
            alignSelf: 'center',
            width: 36,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.line,
            marginBottom: space.xs,
          }}
        />
        {children}
      </View>
    </Modal>
  );
}
