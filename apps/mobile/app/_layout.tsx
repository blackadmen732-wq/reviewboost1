import { Stack } from "expo-router";
import { AuthProvider, useAuth } from "@/data/auth-context";

function RootNavigator() {
  const { isLoggedIn, activeOrg } = useAuth();

  return (
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
      </Stack.Protected>
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigator />
    </AuthProvider>
  );
}
