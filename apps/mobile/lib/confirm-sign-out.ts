import { Alert, Platform } from "react-native";

/**
 * Asked before signing out: one tap ended the session, and getting back in
 * means another code from the email. A plain yes or no, Sign out in red, as
 * iOS asks. In the browser build, the browser's own confirm.
 */
export function confirmSignOut(): Promise<boolean> {
  const title = "Sign out?";
  const body = "You’ll need to sign in again to see your ratings.";
  if (Platform.OS === "web") {
    const ask = typeof window !== "undefined" ? window.confirm : undefined;
    return Promise.resolve(typeof ask === "function" ? ask(`${title}\n\n${body}`) : true);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      body,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "Sign out", style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
