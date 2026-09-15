import { useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "expo-router";
import { useAuth } from "@/data/auth-context";
import { useTextRequests, type TextRequestItem } from "@/data/use-text-requests";
import { balanceView } from "@/data/billing-view";
import { relativeTime } from "@/components/relative-time";
import { colors, radii, fonts } from "@/theme";

/**
 * Text Requests.
 *
 * Every number is the ledger's. Nothing on this screen knows what a plan
 * includes — a business on Growth sees what Growth has left, a business
 * mid-month sees what is left of it, and a trial sees zero, because that is
 * what a trial has.
 */
function BalanceCard({
  balance,
}: {
  balance: { monthly: number; purchased: number; total: number } | null;
}) {
  const view = balanceView(balance);

  if (view.kind === "loading") {
    // Zero is a real state. Showing it before the fetch returns would tell an
    // owner something untrue about their account.
    return (
      <View style={styles.balanceCard}>
        <ActivityIndicator color={colors.brandText} />
      </View>
    );
  }

  return (
    <View style={styles.balanceCard}>
      <Text style={styles.balanceLabel}>Messages you can send</Text>
      <Text style={styles.balanceTotal}>{view.total}</Text>
      <View style={styles.balanceSplit}>
        <Text style={styles.balancePart}>{view.monthly} included this month</Text>
        <Text style={styles.balancePart}>{view.purchased} purchased</Text>
      </View>
      {view.monthly > 0 ? (
        <Text style={styles.balanceNote}>
          Included messages are used first and do not carry over.
        </Text>
      ) : null}
      {!view.canSend ? (
        <Text style={styles.balanceNote}>
          You have no messages left. Buy more, or wait for your next billing date.
        </Text>
      ) : null}
    </View>
  );
}

function RequestRow({ item }: { item: TextRequestItem }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowPhone}>••• {item.recipientLastFour ?? "????"}</Text>
      <View style={styles.rowMeta}>
        <Text style={styles.rowStatus}>{item.status}</Text>
        <Text style={styles.rowTime}>{relativeTime(item.createdAt)}</Text>
      </View>
    </View>
  );
}

export default function TextRequestsScreen() {
  const { activeOrg } = useAuth();
  const { items, balance, loading, refreshing, error, refresh } =
    useTextRequests(activeOrg?.orgId);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <SafeAreaView style={styles.screen} edges={["bottom"]}>
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <RequestRow item={item} />}
        ListHeaderComponent={
          <View>
            <BalanceCard balance={balance} />
            {error ? (
              <View style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <Text style={styles.sectionTitle}>Recent</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={styles.loading} color={colors.brandText} />
          ) : (
            <Text style={styles.empty}>Nothing sent yet.</Text>
          )
        }
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
        contentContainerStyle={styles.list}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  list: { padding: 16, gap: 8 },
  balanceCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    marginBottom: 16,
  },
  balanceLabel: { ...fonts.label, color: colors.inkFaint },
  balanceTotal: { ...fonts.heading, color: colors.ink, marginTop: 4 },
  balanceSplit: { flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: 8 },
  balancePart: { ...fonts.body, color: colors.inkFaint },
  balanceNote: { ...fonts.label, color: colors.inkFaint, marginTop: 8 },
  sectionTitle: { ...fonts.subheading, color: colors.ink, marginBottom: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: colors.surface,
    borderRadius: radii.control,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowPhone: { ...fonts.body, color: colors.ink },
  rowMeta: { alignItems: "flex-end" },
  rowStatus: { ...fonts.label, color: colors.inkFaint },
  rowTime: { ...fonts.label, color: colors.inkFaint },
  loading: { marginTop: 24 },
  empty: { ...fonts.body, color: colors.inkFaint, marginTop: 8 },
  errorBox: {
    backgroundColor: colors.dangerBg,
    borderRadius: radii.control,
    padding: 12,
    marginBottom: 16,
  },
  errorText: { ...fonts.body, color: colors.danger },
});
