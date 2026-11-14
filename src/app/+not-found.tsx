import { router } from 'expo-router';
import { View } from 'react-native';
import { Button, Screen, Text } from '@/components/ui';
import { useI18n } from '@/i18n';
import { space } from '@/theme';

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Screen edges={['top', 'bottom']}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.lg }}>
        <Text variant="title" align="center">
          {t('notFound')}
        </Text>
        <Button label={t('tabEpisodes')} onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}
