import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "@/data/auth-context";
import { LaunchOverlay } from "@/components/launch-overlay";

function RootNavigator() {
  const { isLoggedIn, activeOrg, isLoading } = useAuth();

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!isLoggedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn && !activeOrg}>
          <Stack.Screen name="select-org" />
        </Stack.Protected>
        <Stack.Protected guard={isLoggedIn && !!activeOrg}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="feedback/[id]" />
          <Stack.Screen name="stand/[id]" />
        </Stack.Protected>
      </Stack>
      {/* Over the navigator, not instead of it: the first screen mounts and
          settles behind the green while the wordmark is still writing, so the
          overlay leaves onto a finished screen rather than a loading one. */}
      <LaunchOverlay ready={!isLoading} />
    </>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
