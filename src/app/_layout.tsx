import {
  useFonts,
  Vazirmatn_400Regular,
  Vazirmatn_500Medium,
  Vazirmatn_700Bold,
} from '@expo-google-fonts/vazirmatn';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router/stack';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CoinSplash } from '@/components/CoinSplash';
import { useSettingsHydrated } from '@/state/settings';
import { useTheme } from '@/theme';

// The native splash stays up until the coin screen has drawn (see <CoinSplash/>).
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

export default function RootLayout() {
  const theme = useTheme();
  const [loaded, error] = useFonts({
    Vazirmatn_400Regular,
    Vazirmatn_500Medium,
    Vazirmatn_700Bold,
  });
  const hydrated = useSettingsHydrated();
  const [splashing, setSplashing] = useState(true);

  // Never block launch on fonts: fall back to the system face if they fail.
  // Waiting for the saved settings avoids a flash of the default language/theme.
  const ready = (loaded || error != null) && hydrated;

  return (
    <SafeAreaProvider>
      <StatusBar style={splashing || theme.isDark ? 'light' : 'dark'} />
      {/* The coin gives up waiting after ~2 s; from then on the app shows regardless. */}
      {ready || !splashing ? (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.bg },
          }}
        >
          <Stack.Screen name="index" />
          {/* Keep swipe-to-go-back, but narrow its trigger to a 20pt left-edge strip
              so dragging the audio timeline (inset 24pt) never pops the screen. */}
          <Stack.Screen
            name="episode/[id]"
            options={{ gestureEnabled: true, gestureResponseDistance: { start: 20 } }}
          />
          <Stack.Screen name="share" options={{ presentation: 'modal' }} />
          <Stack.Screen name="questions" />
        </Stack>
      ) : null}
      {splashing ? <CoinSplash ready={ready} onDone={() => setSplashing(false)} /> : null}
    </SafeAreaProvider>
  );
}
