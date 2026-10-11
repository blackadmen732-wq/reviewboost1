import { View, Text, StyleSheet } from "react-native";

import { colors, radii, fonts } from "@/theme";

/**
 * Who you are signed in as, at the top of Account.
 *
 * The app's half of `frontend/features/dashboard/profile-card.tsx`. Same
 * three parts in the same order — a round mark, the business, the sign-in
 * address — because this and Settings are the same screen behind two doors.
 *
 * Initials rather than a photo, and the business rather than a person's
 * name, for the reasons written on the web one: `avatar_url` has never been
 * written, and `display_name` is only ever the part of the email before the
 * @, which above the email itself reads as a bug.
 */

/** Up to two initials, from the words that have letters in them. */
export function initialsOf(name: string): string {
  const words = name.split(/\s+/).filter((word) => /\p{L}/u.test(word));
  const letters = words.slice(0, 2).map((word) => [...word].find((c) => /\p{L}/u.test(c)) ?? "");
  return letters.join("").toUpperCase() || "?";
}

export function ProfileCard({
  businessName,
  email,
}: {
  businessName: string;
  email: string | null;
}) {
  return (
    <View style={styles.card}>
      <View style={styles.mark}>
        <Text style={styles.markText}>{initialsOf(businessName)}</Text>
      </View>
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {businessName}
        </Text>
        <Text style={styles.email} numberOfLines={1}>
          {email ?? "No email on this account"}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 20,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  mark: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandSoft,
  },
  markText: { fontSize: 17, ...fonts.subheading, color: colors.brandText },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 20, ...fonts.subheading, color: colors.ink },
  email: { marginTop: 2, fontSize: 14, ...fonts.body, color: colors.inkFaint },
});
