import { TextInput, View, type TextInputProps } from 'react-native';
import { useI18n } from '@/i18n';
import { font, radius, space, type as typeScale, useTheme } from '@/theme';
import { Icon, type IconName } from './Icon';
import { IconButton } from './Pressables';

interface Props extends TextInputProps {
  icon?: IconName;
  onClear?: () => void;
}

export function Input({ icon, onClear, style, value, ...rest }: Props) {
  const theme = useTheme();
  const { isRTL, t } = useI18n();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        minHeight: 48,
        paddingStart: space.md,
        paddingEnd: space.xs,
        borderRadius: radius.md,
        backgroundColor: theme.surface,
        borderWidth: 1,
        borderColor: theme.line,
      }}
    >
      {icon ? <Icon name={icon} size={18} color="muted" /> : null}
      <TextInput
        value={value}
        placeholderTextColor={theme.faint}
        selectionColor={theme.accent}
        autoCorrect={false}
        autoCapitalize="none"
        {...rest}
        style={[
          {
            flex: 1,
            color: theme.text,
            fontFamily: font.regular,
            fontSize: typeScale.body.fontSize,
            paddingVertical: space.sm,
            textAlign: 'left', // resolves to the start edge (see ui/Text)
            writingDirection: isRTL ? 'rtl' : 'ltr',
          },
          style,
        ]}
      />
      {value && onClear ? (
        <IconButton icon="x" label={t('close')} size={16} color="muted" onPress={onClear} />
      ) : (
        <View style={{ width: space.sm }} />
      )}
    </View>
  );
}
