import { Tabs } from "expo-router";
import { Icon, type SFSymbol } from "@/components/icon";
import { useHome } from "@/data/home";
import { colors } from "@/theme";

/**
 * The daily places, the same as the website's bottom bar: Home, Feedback,
 * Texts, Tags — and only Home, Feedback, Tags while the server says texting is
 * switched off (`data/features.ts`). Settings is secondary (AGENTS.md), so it
 * is the gear at the top of each screen, not another tab.
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
  const { unreadCount, features } = useHome();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkMuted,
        // The label keeps its full height. In the browser build the 49-point
        // bar squeezed it to 10 px and cut the words in half; on iPhone a
        // Text never shrinks, so this only stops the web doing what iOS
        // doesn't.
        tabBarLabelStyle: { fontSize: 11, fontWeight: "500", flexShrink: 0 },
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
        options={{
          title: "Texts",
          tabBarIcon: ({ focused }) => <TabIcon label="Texts" focused={focused} />,
          // Off: the route stays (an old link lands on Home), the tab goes.
          ...(features.texting ? {} : { href: null }),
        }}
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
