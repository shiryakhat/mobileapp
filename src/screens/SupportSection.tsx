import Feather from '@expo/vector-icons/Feather';
import { Pressable, View } from 'react-native';
import { SectionTitle, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { openDonation, openSupportSite } from '@/lib/support';
import { brand, dark, HIT_SLOP, radius, space } from '@/theme';

/**
 * Settings → Support us. The card wears the brand's navy and gold in both
 * themes (like the logo), so its colours come from the dark palette directly
 * rather than from the active theme.
 */
export function SupportSection() {
  const { t, isRTL } = useI18n();
  return (
    <View style={{ gap: space.sm }}>
      <SectionTitle>{t('support')}</SectionTitle>
      <View
        testID="support-card"
        style={{
          padding: space.lg,
          gap: space.md,
          borderRadius: radius.md,
          backgroundColor: brand.navy,
          borderWidth: 1,
          borderColor: dark.accentSoft,
        }}
      >
        <Text variant="small" style={{ color: dark.text }}>
          {t('supportBody')}
        </Text>

        <Pressable
          testID="donate-button"
          accessibilityRole="link"
          accessibilityHint={t('donateHint')}
          onPress={() => void openDonation()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.sm,
            height: 48,
            paddingHorizontal: space.xl,
            borderRadius: radius.md,
            backgroundColor: dark.accent,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <Feather name="heart" size={18} color={dark.onAccent} />
          <Text weight="medium" style={{ color: dark.onAccent }}>
            {t('donate')}
          </Text>
        </Pressable>
        <Text variant="micro" align="center" style={{ color: dark.muted }}>
          {t('donateHint')}
        </Text>

        <Pressable
          testID="support-site-link"
          accessibilityRole="link"
          hitSlop={HIT_SLOP}
          onPress={() => void openSupportSite()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: space.xs + 2,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text variant="small" weight="medium" style={{ color: dark.accent }}>
            {t('otherWaysToSupport')}
          </Text>
          <Feather
            name="external-link"
            size={14}
            color={dark.accent}
            // Directional glyph: mirrored in RTL, like <Icon/> does.
            style={isRTL ? { transform: [{ scaleX: -1 }] } : undefined}
          />
        </Pressable>
      </View>
    </View>
  );
}
