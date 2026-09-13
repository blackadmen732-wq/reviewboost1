import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors, fonts } from "@/theme";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Home: "⌂",
    Feedback: "✉",
    Tags: "⬡",
    Settings: "⚙",
  };
  return (
    <Text style={{ fontSize: 20, color: focused ? colors.brandText : colors.inkFaint }}>
      {icons[label] ?? "●"}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brandText,
        tabBarInactiveTintColor: colors.inkFaint,
        headerStyle: { backgroundColor: colors.surface },
        headerTitleStyle: { ...fonts.subheading, color: colors.ink },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: "Feedback",
          tabBarIcon: ({ focused }) => <TabIcon label="Feedback" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="stands"
        options={{
          title: "Tags",
          tabBarIcon: ({ focused }) => <TabIcon label="Tags" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => <TabIcon label="Settings" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
