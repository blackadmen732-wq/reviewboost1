import { Stack } from "expo-router";
import { getFocusedRouteNameFromRoute } from "expo-router/react-navigation";
import { Platform, StatusBar, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { AuthProvider, useAuth } from "@/data/auth-context";
import { HomeProvider } from "@/data/home";
import { LAUNCH_BACKGROUND, LaunchScreen } from "@/components/launch-screen";
import { tabTitle } from "@/lib/tab-titles";
import { colors } from "@/theme";

// Retain the native launch image until the first app-owned screen is ready.
// No delay or minimum display time: fast restoration goes straight to content.
if (Platform.OS !== "web") {
  void SplashScreen.preventAutoHideAsync().catch(() => undefined);
}
function dismissNativeLaunch() {
  if (Platform.OS !== "web") {
    void SplashScreen.hideAsync().catch(() => undefined);
  }
}

function RootNavigator() {
  const { isLoggedIn, activeOrg, isLoading } = useAuth();

  if (isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: LAUNCH_BACKGROUND }}>
        <StatusBar
          barStyle="light-content"
          backgroundColor={LAUNCH_BACKGROUND}
        />
        <LaunchScreen onReady={dismissNativeLaunch} />
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.canvas }}
      onLayout={dismissNativeLaunch}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.canvas} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn && !activeOrg}>
          <Stack.Screen name="select-org" />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn && !!activeOrg}>
          {/* Named after the open tab, so a back button over it reads
              "Feedback, back", not the folder name "(tabs), back". */}
          <Stack.Screen
            name="(tabs)"
            options={({ route }) => ({ title: tabTitle(getFocusedRouteNameFromRoute(route)) })}
          />
          <Stack.Screen name="feedback/[id]" />
          <Stack.Screen name="stand/[id]" />
          <Stack.Screen name="account" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <HomeProvider>
        <RootNavigator />
      </HomeProvider>
    </AuthProvider>
  );
}
