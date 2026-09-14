import { Tabs } from "expo-router";
import { Platform, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, fonts } from "@/theme";

const TAB_ICONS: Record<string, { active: keyof typeof Ionicons.glyphMap; inactive: keyof typeof Ionicons.glyphMap }> = {
  Home: { active: "home", inactive: "home-outline" },
  Feedback: { active: "chatbubble-ellipses", inactive: "chatbubble-ellipses-outline" },
  Tags: { active: "pricetag", inactive: "pricetag-outline" },
  Settings: { active: "settings", inactive: "settings-outline" },
};

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  const icons = TAB_ICONS[label] ?? { active: "ellipse", inactive: "ellipse-outline" };
  const name = focused ? icons.active : icons.inactive;
  return (
    <View style={styles.iconWrap}>
      <Ionicons
        name={name}
        size={24}
        color={focused ? colors.brandText : colors.inkFaint}
      />
    </View>
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
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          ...Platform.select({
            ios: { height: 88, paddingBottom: 28 },
            android: { height: 64, paddingBottom: 8 },
            default: {},
          }),
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
      }}
    >
      <Tabs.Screen
        name="feed"
        options={{
          title: "Home",
          tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} />,
          tabBarAccessibilityLabel: "Home",
        }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: "Feedback",
          tabBarIcon: ({ focused }) => <TabIcon label="Feedback" focused={focused} />,
          tabBarAccessibilityLabel: "Feedback",
        }}
      />
      <Tabs.Screen
        name="stands"
        options={{
          title: "Tags",
          tabBarIcon: ({ focused }) => <TabIcon label="Tags" focused={focused} />,
          tabBarAccessibilityLabel: "Tags",
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ focused }) => <TabIcon label="Settings" focused={focused} />,
          tabBarAccessibilityLabel: "Settings",
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: "center",
    justifyContent: "center",
    width: 28,
    height: 28,
  },
});
