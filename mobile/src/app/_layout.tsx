import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { StatusBar } from 'expo-status-bar'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { KeyboardProvider } from 'react-native-keyboard-controller'

import { session } from '@/state/session'
import { PictureHost } from '@/ui/picture'
import { useTheme } from '@/ui/theme'

// The splash stays up until the paired Macs are read from secure storage, so the first screen is the right one.
void SplashScreen.preventAutoHideAsync()
void session.whenLoaded().finally(() => SplashScreen.hideAsync())

export default function Root() {
  const t = useTheme()
  const base = t.dark ? DarkTheme : DefaultTheme
  const nav = { ...base, colors: { ...base.colors, background: t.bg, card: t.panel, text: t.fg, primary: t.accent, border: t.line, notification: t.waiting } }
  const sheet = { presentation: 'formSheet' as const, sheetGrabberVisible: true, sheetCornerRadius: 28, contentStyle: { backgroundColor: t.bg } }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <KeyboardProvider>
        <ThemeProvider value={nav}>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="pair" options={{ gestureEnabled: true }} />
            <Stack.Screen name="demo" />
            <Stack.Screen name="thread/[id]" options={{ gestureEnabled: true }} />
            <Stack.Screen name="agent/[name]" options={{ ...sheet, sheetAllowedDetents: [0.78, 1] }} />
            <Stack.Screen name="ask/[id]" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
            <Stack.Screen name="workspaces" options={{ ...sheet, sheetAllowedDetents: 'fitToContents' }} />
            <Stack.Screen name="channel" options={{ ...sheet, sheetAllowedDetents: [0.9, 1] }} />
          </Stack>
          <PictureHost />
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  )
}
