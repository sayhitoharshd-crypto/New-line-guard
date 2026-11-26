import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

function money(value: number) {
  return `₹${Math.max(0, value).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function paymentLabel(status?: string) {
  switch (status) {
    case "settled": return { label: "Reporter payout settled", color: "#16A36A", icon: "check-circle" as const };
    case "captured": return { label: "Payment received · payout pending", color: "#D18A18", icon: "clock" as const };
    case "pending": return { label: "Checkout started · awaiting confirmation", color: "#D18A18", icon: "clock" as const };
    case "failed": return { label: "Payment failed", color: "#D94B58", icon: "x-circle" as const };
    default: return { label: "Not paid", color: "#8B8798", icon: "minus-circle" as const };
  }
}

export default function PaymentsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { myReports, authUser } = useApp();
  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const rows = myReports
    .filter((r) => r.reporterId === authUser?.id || r.accusedId === authUser?.id)
    .filter((r) => (r.agreedCompensation ?? 0) > 0 || r.paymentStatus === "pending" || r.paymentStatus === "captured" || r.paymentStatus === "settled")
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const reporterRows = rows.filter((r) => r.reporterId === authUser?.id);
  const accusedRows = rows.filter((r) => r.accusedId === authUser?.id);
  const received = reporterRows.filter((r) => r.paymentStatus === "settled").reduce((sum, r) => sum + Math.min((r.agreedCompensation ?? 0) / 2, 100), 0);
  const toReceive = reporterRows.filter((r) => r.paymentStatus === "captured").reduce((sum, r) => sum + Math.min((r.agreedCompensation ?? 0) / 2, 100), 0);
  const toPay = accusedRows.filter((r) => r.paymentStatus !== "captured" && r.paymentStatus !== "settled").reduce((sum, r) => sum + (r.agreedCompensation ?? 0), 0);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]} style={[styles.hero, { paddingTop: topPad + 12 }]}>
        <Pressable onPress={() => router.back()} style={styles.back}><Feather name="arrow-left" size={22} color="#FFF" /></Pressable>
        <Text style={styles.eyebrow}>LINEGUARD MONEY</Text>
        <Text style={styles.title}>Payments</Text>
        <Text style={styles.subtitle}>Track compensation you owe and money you may receive.</Text>
        <View style={styles.summaryRow}>
          <View style={styles.summaryCard}><Text style={styles.summaryCaption}>Received</Text><Text style={styles.summaryAmount}>{money(received)}</Text><Text style={styles.summaryHint}>Settled reporter payouts</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryCaption}>Payout pending</Text><Text style={styles.summaryAmount}>{money(toReceive)}</Text><Text style={styles.summaryHint}>Captured, not yet settled</Text></View>
          <View style={styles.summaryCard}><Text style={styles.summaryCaption}>You may owe</Text><Text style={styles.summaryAmount}>{money(toPay)}</Text><Text style={styles.summaryHint}>Agreed unpaid cases</Text></View>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 + bottomPad }} showsVerticalScrollIndicator={false}>
        <View style={[styles.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="shield-check" size={20} color={colors.primary} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.infoTitle, { color: colors.foreground }]}>Protected payment flow</Text>
            <Text style={[styles.infoText, { color: colors.mutedForeground }]}>The accused pays only after both participants confirm the same amount. A payment is marked received only after the payment provider confirms it on LineGuard's server.</Text>
          </View>
        </View>

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your payment activity</Text>
        {rows.length === 0 ? (
          <View style={[styles.empty, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="credit-card" size={34} color={colors.primary} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No payments yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>When a case has agreed compensation, its payment and payout progress will appear here.</Text>
            <Pressable onPress={() => router.push("/(tabs)/cases")} style={[styles.primaryButton, { backgroundColor: colors.primary }]}><Text style={styles.primaryButtonText}>Open My Cases</Text></Pressable>
          </View>
        ) : rows.map((r) => {
          const isReporter = r.reporterId === authUser?.id;
          const total = r.agreedCompensation ?? 0;
          const reporterShare = Math.min(total / 2, 100);
          const lineGuardShare = total - reporterShare;
          const status = paymentLabel(r.paymentStatus);
          const canPay = !isReporter && r.caseStatus === "agreed" && r.paymentStatus !== "captured" && r.paymentStatus !== "settled";
          return (
            <View key={r.id} style={[styles.caseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.caseTop}>
                <View style={[styles.rolePill, { backgroundColor: isReporter ? "#7C3AED18" : "#E0782518" }]}><Feather name={isReporter ? "trending-up" : "credit-card"} size={13} color={isReporter ? "#8B5CF6" : "#D97706"} /><Text style={{ color: isReporter ? "#8B5CF6" : "#D97706", fontSize: 11, fontWeight: "800" }}>{isReporter ? "REPORTER · RECEIVE" : "ACCUSED · PAY"}</Text></View>
                <Text style={[styles.caseAmount, { color: colors.foreground }]}>{money(total)}</Text>
              </View>
              <Text style={[styles.caseDescription, { color: colors.foreground }]} numberOfLines={2}>{r.description}</Text>
              <View style={styles.statusLine}><Feather name={status.icon} size={15} color={status.color} /><Text style={{ color: status.color, fontSize: 12, fontWeight: "700", flex: 1 }}>{status.label}</Text></View>
              <View style={[styles.breakdown, { backgroundColor: colors.background }]}>
                <View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, { color: colors.mutedForeground }]}>Reporter share (max ₹100)</Text><Text style={[styles.breakdownValue, { color: colors.foreground }]}>{money(reporterShare)}</Text></View>
                <View style={styles.breakdownRow}><Text style={[styles.breakdownLabel, { color: colors.mutedForeground }]}>LineGuard share</Text><Text style={[styles.breakdownValue, { color: colors.foreground }]}>{money(lineGuardShare)}</Text></View>
                <Text style={[styles.feeNote, { color: colors.mutedForeground }]}>Payment-provider fees are separate and are not included here.</Text>
              </View>
              {canPay ? <Pressable onPress={() => router.push(`/detail/${r.id}`)} style={[styles.primaryButton, { backgroundColor: colors.primary }]}><Feather name="lock" size={15} color="#FFF" /><Text style={styles.primaryButtonText}>Review case & pay securely</Text></Pressable> : <Pressable onPress={() => router.push(`/detail/${r.id}`)} style={[styles.secondaryButton, { borderColor: colors.border }]}><Text style={[styles.secondaryButtonText, { color: colors.primary }]}>View case details</Text><Feather name="chevron-right" size={16} color={colors.primary} /></Pressable>}
            </View>
          );
        })}
        <Text style={[styles.disclaimer, { color: colors.mutedForeground }]}>Displayed amounts are based on case agreement and server-reported payment status. This screen is not a bank balance or wallet. Money is not held by LineGuard unless a verified provider transaction confirms it.</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 }, hero: { paddingHorizontal: 20, paddingBottom: 20, gap: 7 }, back: { width: 38, height: 38, justifyContent: "center" }, eyebrow: { color: "rgba(255,255,255,.7)", fontSize: 10, fontWeight: "800", letterSpacing: 2 }, title: { color: "#FFF", fontSize: 30, fontWeight: "900" }, subtitle: { color: "rgba(255,255,255,.82)", fontSize: 13 }, summaryRow: { flexDirection: "row", gap: 7, marginTop: 12 }, summaryCard: { flex: 1, minHeight: 82, padding: 9, borderRadius: 13, backgroundColor: "rgba(255,255,255,.16)" }, summaryCaption: { color: "rgba(255,255,255,.8)", fontSize: 10, fontWeight: "700" }, summaryAmount: { color: "#FFF", fontSize: 18, fontWeight: "900", marginTop: 5 }, summaryHint: { color: "rgba(255,255,255,.7)", fontSize: 9, marginTop: 3 }, infoCard: { flexDirection: "row", gap: 12, padding: 14, borderWidth: 1, borderRadius: 15, marginBottom: 20 }, infoTitle: { fontSize: 14, fontWeight: "800" }, infoText: { fontSize: 12, lineHeight: 18, marginTop: 4 }, sectionTitle: { fontSize: 18, fontWeight: "900", marginBottom: 12 }, empty: { borderWidth: 1, borderRadius: 18, padding: 24, alignItems: "center", gap: 10 }, emptyTitle: { fontSize: 17, fontWeight: "800" }, emptyText: { fontSize: 13, textAlign: "center", lineHeight: 19 }, caseCard: { borderWidth: 1, borderRadius: 17, padding: 14, marginBottom: 12, gap: 10 }, caseTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }, rolePill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20 }, caseAmount: { fontSize: 20, fontWeight: "900" }, caseDescription: { fontSize: 14, fontWeight: "700", lineHeight: 19 }, statusLine: { flexDirection: "row", alignItems: "center", gap: 7 }, breakdown: { padding: 11, borderRadius: 11, gap: 7 }, breakdownRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, breakdownLabel: { fontSize: 12 }, breakdownValue: { fontSize: 13, fontWeight: "800" }, feeNote: { fontSize: 10, lineHeight: 14 }, primaryButton: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8, paddingHorizontal: 14, marginTop: 3 }, primaryButtonText: { color: "#FFF", fontSize: 13, fontWeight: "800" }, secondaryButton: { minHeight: 42, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 5 }, secondaryButtonText: { fontSize: 13, fontWeight: "800" }, disclaimer: { fontSize: 10, lineHeight: 15, marginTop: 10, textAlign: "center" },
});
