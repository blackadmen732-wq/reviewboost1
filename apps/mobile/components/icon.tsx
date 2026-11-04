import { SymbolView, type SymbolViewProps } from "expo-symbols";
import { Text } from "react-native";

export type SFSymbol = Extract<SymbolViewProps["name"], string>;

/**
 * An SF Symbol on iPhone, with a plain glyph where SF Symbols do not exist
 * (Android, the web build used for walkthroughs). Decorative unless a label
 * is given: the control around it says what it does.
 */
export function Icon({
  name,
  glyph,
  size = 20,
  color,
  weight = "regular",
}: {
  name: SFSymbol;
  glyph: string;
  size?: number;
  color: string;
  weight?: SymbolViewProps["weight"];
}) {
  return (
    <SymbolView
      name={{ ios: name }}
      size={size}
      tintColor={color}
      weight={weight}
      fallback={
        <Text
          style={{ fontSize: size * 0.9, lineHeight: size, color, textAlign: "center", minWidth: size }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        >
          {glyph}
        </Text>
      }
    />
  );
}
