import { Tabs } from "expo-router";
import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Text } from "react-native";
import { colors, fonts } from "@/theme";

/**
 * Tab icons are SF Symbols on iPhone — the system's own icon set, so they sit
 * at the weight and optical size of the rest of iOS and follow Bold Text.
 * They used to be text glyphs (◉ ✉ ➤ ⬡ ☰), which read as placeholder art.
 * Other platforms keep the glyph as a fallback until they get icons of their
 * own. The label under each icon is what VoiceOver reads.
 */
type SFSymbol = Extract<SymbolViewProps["name"], string>;

const ICONS: Record<string, { outline: SFSymbol; filled: SFSymbol; glyph: string }> = {
  Feed: { outline: "dot.radiowaves.left.and.right", filled: "dot.radiowaves.left.and.right", glyph: "◉" },
  Feedback: { outline: "text.bubble", filled: "text.bubble.fill", glyph: "✉" },
  Texts: { outline: "paperplane", filled: "paperplane.fill", glyph: "➤" },
  Tags: { outline: "qrcode", filled: "qrcode", glyph: "⬡" },
  Account: { outline: "person.crop.circle", filled: "person.crop.circle.fill", glyph: "☰" },
};

function TabIcon({ label, focused }: { label: keyof typeof ICONS; focused: boolean }) {
  const icon = ICONS[label]!;
  const color = focused ? colors.brandText : colors.inkFaint;
  return (
    <SymbolView
      name={{ ios: focused ? icon.filled : icon.outline }}
      size={24}
      tintColor={color}
      weight={focused ? "semibold" : "regular"}
      fallback={<Text style={{ fontSize: 20, color }}>{icon.glyph}</Text>}
    />
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
