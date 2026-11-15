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
          {/* Swipe-to-go-back is disabled on the player screen: dragging the audio
              timeline must never pop/drag it. Navigate back with the header chevron. */}
          <Stack.Screen name="episode/[id]" options={{ gestureEnabled: false }} />
          <Stack.Screen name="share" options={{ presentation: 'modal' }} />
          <Stack.Screen name="questions" />
          {/* Easter egg: four quick taps on the version number in Settings. */}
          <Stack.Screen
            name="coinflip"
            options={{ presentation: 'fullScreenModal', animation: 'fade' }}
          />
        </Stack>
      ) : null}
      {splashing ? <CoinSplash ready={ready} onDone={() => setSplashing(false)} /> : null}
    </SafeAreaProvider>
  );
}
