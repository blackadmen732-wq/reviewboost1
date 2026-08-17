import { Tabs } from "expo-router";
import { Text } from "react-native";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Feed: "◉",
    Feedback: "✉",
  };
  return (
    <Text style={{ fontSize: 20, color: focused ? "#2563EB" : "#9CA3AF" }}>
      {icons[label] ?? "●"}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#2563EB",
        tabBarInactiveTintColor: "#9CA3AF",
        headerStyle: { backgroundColor: "#FFFFFF" },
        headerTitleStyle: { fontWeight: "600", color: "#111827" },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Live Feed",
          tabBarIcon: ({ focused }) => <TabIcon label="Feed" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: "Feedback",
          tabBarIcon: ({ focused }) => <TabIcon label="Feedback" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
