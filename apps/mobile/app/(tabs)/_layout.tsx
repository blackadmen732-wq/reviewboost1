import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors, fonts } from "@/theme";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Feed: "◉",
    Feedback: "✉",
  };
  return (
    <Text style={{ fontSize: 20, color: focused ? colors.brand : colors.inkFaint }}>
      {icons[label] ?? "●"}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkFaint,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { ...fonts.subheading, color: colors.ink },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
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
