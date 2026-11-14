import { router } from 'expo-router';
import { View } from 'react-native';
import { glossaryBySlug } from '@/content';
import { useI18n } from '@/i18n';
import { useNav } from '@/state/nav';
import { space } from '@/theme';
import { Button, Sheet, Text } from './ui';

interface Props {
  slug: string | undefined;
  onClose: () => void;
}

/** Tap-to-define: a bilingual definition for a crypto term. */
export function GlossarySheet({ slug, onClose }: Props) {
  const { t, isRTL } = useI18n();
  const entry = slug ? glossaryBySlug.get(slug) : undefined;
  return (
    <Sheet visible={Boolean(entry)} onClose={onClose}>
      {entry ? (
        <View style={{ gap: space.md }}>
          <View>
            <Text variant="title">{isRTL ? entry.termFa : entry.term}</Text>
            <Text variant="small" color="accent" dir={isRTL ? 'ltr' : 'rtl'} align="end">
              {isRTL ? entry.term : entry.termFa}
            </Text>
          </View>
          <Text>{isRTL ? entry.definitionFa : entry.definitionEn}</Text>
          <Text variant="small" color="muted" dir={isRTL ? 'ltr' : 'rtl'} align="end">
            {isRTL ? entry.definitionEn : entry.definitionFa}
          </Text>
          <Button
            kind="secondary"
            icon="book-open"
            label={t('openGlossary')}
            onPress={() => {
              onClose();
              useNav.getState().openGlossary(entry.slug);
              router.dismissTo('/');
            }}
          />
        </View>
      ) : null}
    </Sheet>
  );
}
