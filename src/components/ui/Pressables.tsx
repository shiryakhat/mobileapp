import type { ReactNode } from 'react';
import { Pressable, View, type PressableProps, type ViewStyle } from 'react-native';
import { useI18n } from '@/i18n';
import { HIT_SLOP, radius, space, useTheme, type Palette } from '@/theme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

interface IconButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  icon: IconName;
  label: string;
  size?: number;
  color?: keyof Palette;
  /** Filled circular background. */
  filled?: boolean;
  style?: ViewStyle;
}

export function IconButton({
  icon,
  label,
  size = 20,
  color = 'text',
  filled,
  style,
  ...rest
}: IconButtonProps) {
  const theme = useTheme();
  const box = Math.max(40, size + 20);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={HIT_SLOP}
      {...rest}
      style={({ pressed }) => [
        {
          width: box,
          height: box,
          borderRadius: box / 2,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: filled ? theme.raised : 'transparent',
          opacity: rest.disabled ? 0.35 : pressed ? 0.6 : 1,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size} color={color} />
    </Pressable>
  );
}

interface ChipProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  icon?: IconName;
  active?: boolean;
  style?: ViewStyle;
}

export function Chip({ label, icon, active, style, ...rest }: ChipProps) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      {...rest}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.xs + 2,
          paddingHorizontal: space.md,
          height: 34,
          borderRadius: radius.pill,
          backgroundColor: active ? theme.accentSoft : theme.raised,
          borderWidth: 1,
          borderColor: active ? theme.accent : 'transparent',
          opacity: rest.disabled ? 0.4 : pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={14} color={active ? 'accent' : 'muted'} /> : null}
      <Text variant="small" weight="medium" color={active ? 'accent' : 'text'}>
        {label}
      </Text>
    </Pressable>
  );
}

interface ButtonProps extends Omit<PressableProps, 'style' | 'children'> {
  label: string;
  icon?: IconName;
  kind?: 'primary' | 'secondary' | 'ghost';
  style?: ViewStyle;
}

export function Button({ label, icon, kind = 'primary', style, ...rest }: ButtonProps) {
  const theme = useTheme();
  const bg =
    kind === 'primary' ? theme.accent : kind === 'secondary' ? theme.raised : 'transparent';
  const fg = kind === 'primary' ? 'onAccent' : 'text';
  return (
    <Pressable
      accessibilityRole="button"
      {...rest}
      style={({ pressed }) => [
        {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: space.sm,
          height: 48,
          paddingHorizontal: space.xl,
          borderRadius: radius.md,
          backgroundColor: bg,
          opacity: rest.disabled ? 0.4 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {icon ? <Icon name={icon} size={18} color={fg} /> : null}
      <Text variant="body" weight="medium" color={fg}>
        {label}
      </Text>
    </Pressable>
  );
}

interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  style?: ViewStyle;
  testID?: string;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  style,
  testID,
}: SegmentedProps<T>) {
  const theme = useTheme();
  const { dir } = useI18n();
  return (
    <View
      testID={testID}
      accessibilityRole="tablist"
      style={[
        {
          flexDirection: 'row',
          // Re-assert the UI direction: this control also lives inside LTR-pinned rows.
          direction: dir,
          backgroundColor: theme.surface,
          borderRadius: radius.md,
          padding: 3,
          borderWidth: 1,
          borderColor: theme.line,
        },
        style,
      ]}
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.value)}
            style={{
              flex: 1,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.md - 3,
              backgroundColor: selected ? theme.raised : 'transparent',
            }}
          >
            <Text
              variant="small"
              weight="medium"
              color={selected ? 'text' : 'muted'}
              align="center"
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ProgressBar({ value, height = 3 }: { value: number; height?: number }) {
  const theme = useTheme();
  return (
    // Media progress always runs left-to-right, like the scrubber.
    <View
      style={{
        direction: 'ltr',
        height,
        borderRadius: height,
        backgroundColor: theme.line,
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          width: `${Math.min(100, Math.max(0, value * 100))}%`,
          height,
          backgroundColor: theme.accent,
        }}
      />
    </View>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.line }} />;
}

export function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  return (
    <View style={{ alignItems: 'center', gap: space.md, padding: space.xxl, paddingTop: 64 }}>
      <Icon name={icon} size={28} color="faint" />
      <Text color="muted" align="center">
        {text}
      </Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <Text variant="micro" weight="medium" color="faint" style={{ letterSpacing: 0.4 }}>
      {children}
    </Text>
  );
}
