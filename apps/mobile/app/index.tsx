import { Redirect } from "expo-router";
import { useAuth } from "@/data/auth-context";

export default function Index() {
  const { isLoggedIn, activeOrg } = useAuth();

  if (!isLoggedIn) return <Redirect href="/login" />;
  if (!activeOrg) return <Redirect href="/select-org" />;
  return <Redirect href="/(tabs)/feed" />;
}
