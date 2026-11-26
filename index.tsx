import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ReportCard } from "@/components/ReportCard";
import { useApp } from "@/context/AppContext";
import { useColors } from "@/hooks/useColors";

const FILTERS = ["All", "With media"] as const;
type Filter = (typeof FILTERS)[number];

const REAL_WORLD_EXAMPLES = [
  {
    id: "chhatarpur-hospital-2025",
    title: "Chhatarpur hospital queue dispute",
    date: "April 2025 · Madhya Pradesh",
    summary: "A reported queue dispute; the patient and hospital authorities gave conflicting accounts.",
    source: "Hindustan Times",
    mediaLabel: "Reported video",
    url: "https://www.hindustantimes.com/india-news/elderly-man-dragged-in-madhya-pradesh-hospital-for-breaking-queue-101745139825112.html",
  },
  {
    id: "delhi-metro-gates-2025",
    title: "Passengers jump Delhi Metro fare gates",
    date: "February 2025 · Jama Masjid, Delhi",
    summary: "Passengers were filmed jumping fare gates during a brief crowd surge; DMRC described it as a momentary reaction.",
    source: "NDTV",
    mediaLabel: "Original video report",
    url: "https://www.ndtv.com/india-news/delhi-metro-clarifies-after-viral-video-shows-passengers-jumping-over-gates-jama-masjid-metro-station-violet-line-7717843",
  },
  {
    id: "rajasthan-toll-queue-2026",
    title: "Car bypasses a Rajasthan toll queue",
    date: "June 2026 · Rajasthan",
    summary: "A reported clip shows a car moving alongside a long toll queue and merging near the front.",
    source: "India Today",
    mediaLabel: "Original video report",
    url: "https://www.indiatoday.in/trending-news/story/men-flaunt-toll-queue-jumping-in-rajasthan-face-backlash-online-2923866-2026-06-09",
  },
] as const;

function FABButton({ onPress }: { onPress: () => void }) {
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));
  return (
    <Animated.View style={[animStyle, styles.fabWrapper]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.9); }}
        onPressOut={() => { scale.value = withSpring(1); }}
        style={styles.fabInner}
      >
        <LinearGradient
          colors={["#8B5CF6", "#EC4899", "#F97316"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.fabGradient}
        >
          <Feather name="plus" size={28} color="#FFF" />
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

export default function FeedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { reports, authUser: user, refreshCases } = useApp();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [refreshing, setRefreshing] = useState(false);

  const filtered = reports.filter(r => r.isPublicListing && (() => {
    const matchesSearch =
      !search ||
      r.description.toLowerCase().includes(search.toLowerCase()) ||
      r.location.address.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "All" || r.mediaUris.length > 0;
    return matchesSearch && matchesFilter;
  })());

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try { await refreshCases(); } finally { setRefreshing(false); }
  }, [refreshCases]);

  const handleFAB = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push("/report-modal");
  };

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;
  if (!user) return null;
  const initials = user.name.split(" ").map((n: string) => n[0]).join("").substring(0, 2).toUpperCase();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.gradientStart, colors.gradientMid, colors.gradientEnd]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.heroHeader, { paddingTop: topPad + 16 }]}
      >
        <View style={styles.topRow}>
          <View style={styles.brandRow}>
            <View style={styles.logoCircle}>
              <Feather name="shield" size={16} color="#FFF" />
            </View>
            <Text style={styles.brandName}>LINEGUARD</Text>
          </View>
          <Pressable
            onPress={() => router.push("/(tabs)/profile")}
            style={[styles.avatarBtn, { backgroundColor: user.color }]}
          >
            <Text style={styles.avatarBtnText}>{initials}</Text>
          </Pressable>
        </View>

        <Text style={styles.heroTitle}>Public{"\n"}Case Board</Text>
        <Text style={styles.heroSub}>Report concerns. Seek fair resolution.</Text>

        <View style={styles.statsStrip}>
          <View style={styles.statItem}>
            <Text style={styles.statBig}>{reports.filter(r => r.isPublicListing).length}</Text>
            <Text style={styles.statSmall}>Reports</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statBig}>{reports.filter(r => r.isPublicListing && r.status === "guilty").length}</Text>
            <Text style={styles.statSmall}>Resolved</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statBig}>{reports.filter(r => r.isPublicListing && r.apologyStatus === "approved").length}</Text>
            <Text style={styles.statSmall}>Approved Apologies</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={[styles.boardNotice, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="shield" size={16} color={colors.primary} />
        <Text style={[styles.boardNoticeText, { color: colors.mutedForeground }]}>Only cases with both participants’ explicit public-listing consent and an approved apology appear here. Upvotes can feature an eligible case; a strong downvote majority temporarily hides it for human review. Votes are community feedback, not proof or a legal finding. Contact details and exact locations are hidden.</Text>
      </View>

      <View style={[styles.controlsBar, { backgroundColor: colors.background }]}>
        <View style={[styles.searchBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: colors.foreground }]}
            placeholder="Search incidents..."
            placeholderTextColor={colors.mutedForeground}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <Pressable onPress={() => setSearch("")}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </Pressable>
          )}
        </View>

        <FlatList
          horizontal
          data={FILTERS}
          keyExtractor={item => item}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterList}
          renderItem={({ item }) => {
            const active = filter === item;
            return (
              <Pressable
                onPress={() => setFilter(item)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary : colors.card,
                    borderColor: active ? colors.primary : colors.border,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                {active && item === "All" && <Feather name="list" size={12} color="#FFF" />}
                {active && item === "With media" && <Feather name="image" size={12} color="#FFF" />}
                <Text style={[styles.chipText, { color: active ? "#FFF" : colors.mutedForeground }]}>
                  {item}
                </Text>
              </Pressable>
            );
          }}
        />
      </View>

      <FlatList
        data={filtered}
        ListHeaderComponent={
          <View style={styles.examplesSection}>
            <View style={styles.examplesHeadingRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.examplesTitle, { color: colors.foreground }]}>Real-world examples</Text>
                <Text style={[styles.examplesSubtitle, { color: colors.mutedForeground }]}>Public news examples · Not LineGuard user-submitted cases</Text>
              </View>
              <Feather name="external-link" size={16} color={colors.mutedForeground} />
            </View>
            {REAL_WORLD_EXAMPLES.map(example => (
              <Pressable
                key={example.id}
                accessibilityRole="link"
                accessibilityLabel={`Open ${example.source} report: ${example.title}`}
                onPress={() => { void Linking.openURL(example.url); }}
                style={({ pressed }) => [
                  styles.exampleCard,
                  { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.82 : 1 },
                ]}
              >
                <View style={styles.exampleMediaIcon}>
                  <Feather name="play-circle" size={24} color="#FFFFFF" />
                </View>
                <View style={styles.exampleBody}>
                  <Text style={[styles.exampleDate, { color: colors.mutedForeground }]}>{example.date} · {example.mediaLabel}</Text>
                  <Text style={[styles.exampleCardTitle, { color: colors.foreground }]}>{example.title}</Text>
                  <Text style={[styles.exampleSummary, { color: colors.mutedForeground }]}>{example.summary}</Text>
                  <Text style={[styles.exampleSource, { color: colors.primary }]}>Read/watch at {example.source} ↗</Text>
                </View>
              </Pressable>
            ))}
            <Text style={[styles.examplesSubtitle, { color: colors.mutedForeground, marginBottom: 8 }]}>User-submitted public cases appear below when eligible. These examples have no voting controls.</Text>
          </View>
        }
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <ReportCard
            report={item}
            isOwner={item.reporterId === user.id}
            onPress={() => router.push(`/detail/${item.id}`)}
          />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: 120 + bottomPad }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={true}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <LinearGradient
              colors={[colors.gradientStart + "22", colors.gradientEnd + "22"]}
              style={styles.emptyIcon}
            >
              <Feather name="inbox" size={36} color={colors.primary} />
            </LinearGradient>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No incidents found</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {search ? "Try a different search" : "No mutually approved public cases yet"}
            </Text>
          </View>
        }
      />

      <FABButton onPress={handleFAB} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  heroHeader: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    gap: 6,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  logoCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  brandName: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 2.5,
  },
  avatarBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.4)",
  },
  avatarBtnText: {
    color: "#FFF",
    fontSize: 13,
    fontFamily: "Inter_700Bold",
  },
  heroTitle: {
    color: "#FFFFFF",
    fontSize: 40,
    fontFamily: "Inter_700Bold",
    lineHeight: 46,
    marginBottom: 4,
  },
  heroSub: {
    color: "rgba(255,255,255,0.75)",
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    marginBottom: 16,
  },
  statsStrip: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 14,
    padding: 12,
    alignItems: "center",
    justifyContent: "space-around",
    marginTop: 4,
  },
  statItem: { alignItems: "center", flex: 1 },
  statBig: {
    color: "#FFFFFF",
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  statSmall: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 11,
    fontFamily: "Inter_500Medium",
    marginTop: 1,
  },
  statDivider: {
    width: 1,
    height: 28,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  boardNotice: { marginHorizontal: 16, marginTop: 12, marginBottom: 2, padding: 11, borderRadius: 12, borderWidth: 1, flexDirection: "row", alignItems: "center", gap: 9 },
  boardNoticeText: { flex: 1, fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  controlsBar: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
    gap: 10,
  },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 2,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  filterList: {
    gap: 8,
    paddingBottom: 4,
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    shadowColor: "#6D28D9",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  chipText: {
    fontSize: 13,
    fontFamily: "Inter_600SemiBold",
  },
  examplesSection: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 8, gap: 10 },
  examplesHeadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 },
  examplesTitle: { fontSize: 18, fontFamily: "Inter_700Bold" },
  examplesSubtitle: { fontSize: 11, lineHeight: 16, fontFamily: "Inter_500Medium" },
  exampleCard: { flexDirection: "row", gap: 10, borderWidth: 1, borderRadius: 14, padding: 11 },
  exampleMediaIcon: { width: 42, height: 42, borderRadius: 10, backgroundColor: "#7C3AED", alignItems: "center", justifyContent: "center" },
  exampleBody: { flex: 1, gap: 3 },
  exampleDate: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  exampleCardTitle: { fontSize: 13, fontFamily: "Inter_700Bold" },
  exampleSummary: { fontSize: 11, lineHeight: 15, fontFamily: "Inter_400Regular" },
  exampleSource: { fontSize: 11, fontFamily: "Inter_600SemiBold", marginTop: 3 },
  list: { paddingTop: 8 },
  empty: {
    alignItems: "center",
    paddingTop: 60,
    gap: 12,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    marginTop: 4,
  },
  emptyText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    paddingHorizontal: 32,
  },
  fabWrapper: {
    position: "absolute",
    right: 20,
    bottom: Platform.OS === "web" ? 118 : 84,
  },
  fabInner: {
    borderRadius: 32,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  fabGradient: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
});
