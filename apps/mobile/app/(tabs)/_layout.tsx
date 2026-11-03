import { Tabs } from "expo-router";
import { Icon, type SFSymbol } from "@/components/icon";
import { useHome } from "@/data/home";
import { colors } from "@/theme";

/**
 * The four daily places, the same four as the website's bottom bar: Home,
 * Feedback, Texts, Tags. Settings is secondary (AGENTS.md), so it is the gear
 * at the top of each screen, not a fifth tab.
 *
 * Icons are SF Symbols on iPhone; the active tab is ink, as on the website,
 * since green is the brand rather than a control colour. The label under each
 * icon is what VoiceOver reads, and Feedback carries the unread count.
 */
const ICONS: Record<string, { outline: SFSymbol; filled: SFSymbol; glyph: string }> = {
  Home: { outline: "house", filled: "house.fill", glyph: "⌂" },
  Feedback: { outline: "bubble.left", filled: "bubble.left.fill", glyph: "✉" },
  Texts: { outline: "paperplane", filled: "paperplane.fill", glyph: "➤" },
  Tags: { outline: "qrcode", filled: "qrcode", glyph: "▦" },
};

function TabIcon({ label, focused }: { label: keyof typeof ICONS; focused: boolean }) {
  const icon = ICONS[label]!;
  return (
    <Icon
      name={focused ? icon.filled : icon.outline}
      glyph={icon.glyph}
      size={24}
      color={focused ? colors.ink : colors.inkMuted}
      weight={focused ? "semibold" : "regular"}
    />
  );
}

export default function TabLayout() {
  const { unreadCount } = useHome();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500" },
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarBadgeStyle: { backgroundColor: colors.ink, color: colors.onAction, fontSize: 11 },
      }}
    >
      <Tabs.Screen
        name="home"
        options={{ title: "Home", tabBarIcon: ({ focused }) => <TabIcon label="Home" focused={focused} /> }}
      />
      <Tabs.Screen
        name="feedback"
        options={{
          title: "Feedback",
          tabBarIcon: ({ focused }) => <TabIcon label="Feedback" focused={focused} />,
          ...(unreadCount > 0 ? { tabBarBadge: unreadCount > 99 ? "99+" : unreadCount } : {}),
        }}
      />
      <Tabs.Screen
        name="text-requests"
        options={{ title: "Texts", tabBarIcon: ({ focused }) => <TabIcon label="Texts" focused={focused} /> }}
      />
      {/* "Tags" is what the product calls the physical thing on the counter.
          The route stays /stands so existing deep links keep working. */}
      <Tabs.Screen
        name="stands"
        options={{ title: "Tags", tabBarIcon: ({ focused }) => <TabIcon label="Tags" focused={focused} /> }}
      />
    </Tabs>
  );
}
