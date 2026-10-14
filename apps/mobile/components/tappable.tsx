import { forwardRef } from "react";
import { Platform, Pressable, type PressableProps, type View, type ViewStyle } from "react-native";

/**
 * Pressable with the press feedback each platform expects.
 *
 * Every row and button in the app was a bare Pressable with a fixed style, so
 * a tap showed nothing until the next screen arrived — the loudest "this is
 * not a native app" tell. Here a row highlights while the finger is down
 * (iOS: dims; Android: the system ripple), and a button dims and settles to
 * 98% (Android buttons dim, with the ripple kept to rows). The change is
 * applied on press-in and removed on release: instant, never an animation to
 * wait for, and nothing that reduced motion needs to turn off.
 */
export const Tappable = forwardRef<View, PressableProps & { kind?: "row" | "button" }>(function Tappable(
  { kind = "button", style, android_ripple, ...props },
  ref,
) {
  const ripple = Platform.OS === "android" && kind === "row";
  return (
    <Pressable
      ref={ref}
      android_ripple={android_ripple ?? (ripple ? { color: "rgba(23, 26, 24, 0.08)" } : undefined)}
      style={(state) => {
        const base = typeof style === "function" ? style(state) : style;
        if (!state.pressed || ripple) return base;
        return [base, kind === "row" ? PRESSED_ROW : PRESSED_BUTTON];
      }}
      {...props}
    />
  );
});

const PRESSED_ROW: ViewStyle = { opacity: 0.6 };
const PRESSED_BUTTON: ViewStyle = { opacity: 0.8, transform: [{ scale: 0.98 }] };
