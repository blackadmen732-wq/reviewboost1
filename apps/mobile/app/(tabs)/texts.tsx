import { View, Text, StyleSheet, ScrollView } from "react-native";
import { colors, fonts } from "@/theme";
import { useOrg } from "@/hooks/useOrg";

export default function TextsTab() {
  const { org } = useOrg();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Text Requests</Text>
      <Text style={styles.subtitle}>
        Ask a customer for a review by text message.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Coming soon</Text>
        <Text style={styles.cardBody}>
          Text Requests will be available here once Stripe billing is connected.
          Use the web app to send text requests in the meantime.
        </Text>
      </View>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Segments remaining</Text>
        <Text style={styles.balanceValue}>--</Text>
        <Text style={styles.balanceSub}>
          Included segments renew each billing period.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: 20, paddingBottom: 40 },
  title: { ...fonts.heading, color: colors.ink, marginBottom: 4 },
  subtitle: { ...fonts.body, color: colors.inkFaint, marginBottom: 24 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
    marginBottom: 16,
  },
  cardTitle: { ...fonts.subheading, color: colors.ink, marginBottom: 8 },
  cardBody: { ...fonts.body, color: colors.inkFaint, lineHeight: 22 },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  balanceLabel: { ...fonts.caption, color: colors.inkFaint, textTransform: "uppercase", letterSpacing: 1 },
  balanceValue: { ...fonts.heading, color: colors.ink, fontSize: 32, marginTop: 4 },
  balanceSub: { ...fonts.caption, color: colors.inkFaint, marginTop: 8 },
});
