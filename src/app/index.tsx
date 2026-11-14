import { useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { MiniPlayer } from '@/components/MiniPlayer';
import { TabBar } from '@/components/TabBar';
import { Screen } from '@/components/ui';
import { EpisodesTab } from '@/screens/EpisodesTab';
import { GlossaryTab } from '@/screens/GlossaryTab';
import { LibraryTab } from '@/screens/LibraryTab';
import { SearchTab } from '@/screens/SearchTab';
import { SettingsTab } from '@/screens/SettingsTab';
import { useNav, type TabKey } from '@/state/nav';

const PANES: Record<TabKey, () => React.JSX.Element> = {
  episodes: EpisodesTab,
  search: SearchTab,
  glossary: GlossaryTab,
  library: LibraryTab,
  settings: SettingsTab,
};

const TAB_KEYS = Object.keys(PANES) as TabKey[];

/** Home: five panes behind a custom tab bar, with the mini player docked above it. */
export default function Home() {
  const tab = useNav((s) => s.tab);
  // Deep links: shiryakhat://?tab=glossary  ·  shiryakhat://?tab=search&q=tornado
  const params = useLocalSearchParams<{ tab?: string; q?: string }>();
  useEffect(() => {
    const requested = TAB_KEYS.find((k) => k === params.tab);
    if (requested === 'search' && params.q) useNav.getState().openSearch(params.q);
    else if (requested) useNav.getState().setTab(requested);
  }, [params.tab, params.q]);
  const Pane = PANES[tab];
  return (
    <Screen testID="home">
      <View style={{ flex: 1 }}>
        <Pane />
      </View>
      <MiniPlayer />
      <TabBar />
    </Screen>
  );
}
