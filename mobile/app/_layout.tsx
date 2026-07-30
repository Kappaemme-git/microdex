import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { Stack } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { fontAssets } from '@/lib/fonts';
import { ThemeProvider, useTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync().catch(() => undefined);

function ThemedStack() {
  const { theme } = useTheme();
  return (
    <Stack
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="pair" />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <ThemedStack />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
