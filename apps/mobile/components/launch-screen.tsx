import {
  Image,
  Platform,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

/** The user's launch treatment; separate from the everyday R/Geist lockup. */
export const LAUNCH_BACKGROUND = "#005B3E";
// Android's system launch icon uses a 192dp circular safe region.
// Keep the whole wide wordmark inside it; iOS supports the reference's width.
export const LAUNCH_IMAGE_WIDTH = Platform.OS === "android" ? 180 : 320;
const LOGO_ASPECT = 1964 / 801;

export function LaunchScreen({ onReady }: { onReady?: () => void }) {
  const { width } = useWindowDimensions();
  return (
    <View style={styles.screen} accessibilityLabel="ReviewBoost is opening">
      <Image
        source={require("../assets/launch-wordmark.png")}
        style={{
          width: Math.min(LAUNCH_IMAGE_WIDTH, width),
          aspectRatio: LOGO_ASPECT,
        }}
        resizeMode="contain"
        accessibilityLabel="ReviewBoost"
        accessibilityRole="image"
        accessibilityIgnoresInvertColors
        onLoadEnd={onReady}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: LAUNCH_BACKGROUND,
  },
});
