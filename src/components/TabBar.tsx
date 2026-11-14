import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useI18n } from '@/i18n';
import type { Dict } from '@/i18n/en';
import { useNav, type TabKey } from '@/state/nav';
import { space, useTheme } from '@/theme';
import { Icon, Text, type IconName } from './ui';

const TABS: { key: TabKey; icon: IconName; label: keyof Dict }[] = [
  { key: 'episodes', icon: 'headphones', label: 'tabEpisodes' },
  { key: 'search', icon: 'search', label: 'tabSearch' },
  { key: 'glossary', icon: 'book-open', label: 'tabGlossary' },
  { key: 'library', icon: 'bookmark', label: 'tabLibrary' },
  { key: 'settings', icon: 'sliders', label: 'tabSettings' },
];

/** Custom bottom bar: inherits the screen direction, so tab order mirrors in Farsi. */
export function TabBar() {
  const theme = useTheme();
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  const tab = useNav((s) => s.tab);
  const setTab = useNav((s) => s.setTab);
  return (
    <View
      accessibilityRole="tablist"
      style={{
        flexDirection: 'row',
        paddingBottom: Math.max(insets.bottom, space.sm),
        paddingTop: space.sm,
        backgroundColor: theme.surface,
        borderTopWidth: 1,
        borderTopColor: theme.line,
      }}
    >
      {TABS.map(({ key, icon, label }) => {
        const selected = key === tab;
        return (
          <Pressable
            key={key}
            testID={`tab-${key}`}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={t(label)}
            onPress={() => setTab(key)}
            style={{ flex: 1, alignItems: 'center', gap: 2, paddingVertical: 4 }}
          >
            <Icon name={icon} size={21} color={selected ? 'accent' : 'faint'} />
            <Text
              variant="micro"
              weight="medium"
              color={selected ? 'accent' : 'faint'}
              align="center"
            >
              {t(label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
