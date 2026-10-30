import { Redirect } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { LaunchScreen } from "@/components/launch-screen";

export default function Index() {
  const { isLoggedIn, isLoading, activeOrg } = useAuth();

  if (isLoading) {
    return <LaunchScreen />;
  }

  if (!isLoggedIn) return <Redirect href="/login" />;
  if (!activeOrg) return <Redirect href="/select-org" />;
  return <Redirect href="/(tabs)/feed" />;
}
