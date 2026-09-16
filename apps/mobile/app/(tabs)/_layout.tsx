import { Tabs } from "expo-router";
import { Text } from "react-native";
import { colors, fonts } from "@/theme";

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons: Record<string, string> = {
    Feed: "◉",
    Feedback: "✉",
    Texts: "➤",
    Tags: "⬡",
    Account: "☰",
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
      <Tabs.Screen
        name="text-requests"
        options={{
          // The header says the product's name; the bar has room for one word.
          title: "Text Requests",
          tabBarLabel: "Texts",
          tabBarIcon: ({ focused }) => <TabIcon label="Texts" focused={focused} />,
        }}
      />
      {/* "Tags" is what the product calls the physical thing on the counter.
          The route stays /stands so existing deep links keep working. */}
      <Tabs.Screen
        name="stands"
        options={{
          title: "Tags",
          tabBarIcon: ({ focused }) => <TabIcon label="Tags" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          title: "Account",
          tabBarIcon: ({ focused }) => <TabIcon label="Account" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
