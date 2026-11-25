// Gains — day / week / month, from what the server records for each
// completed ride (Earnings/{uid}.dailyBreakdown and moneyByRider).
import React, { useEffect, useMemo, useState } from "react";
import { View, ScrollView, Pressable, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { AppText, Header, EmptyState } from "../components/ui";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { radius, spacing } from "../constants/theme";
import { t } from "../utils/i18n/index";
import { formatFdj, formatTime, shortAddress } from "../utils/format";
import { getDailyBreakdown, watchToday, getRides, djiboutiDay, isDelivery } from "../services/driverApi";

const PERIODS = [
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
];
const DAY_LETTERS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

const addDays = (iso, n) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const dayLabel = (iso) => {
  const d = new Date(`${iso}T12:00:00Z`);
  return `${d.getUTCDate()} ${t(MONTHS[d.getUTCMonth()])}`;
};

export default function EarningsScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useStyles();
  const [period, setPeriod] = useState("week");
  const [breakdown, setBreakdown] = useState({});
  const [today, setToday] = useState({ total: 0, trips: [] });
  const [rides, setRides] = useState([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = () => getDailyBreakdown().then(setBreakdown).catch(() => {});
  useEffect(() => { load(); return watchToday(setToday); }, []);
  useEffect(() => {
    const ids = [...today.trips].reverse().map((x) => x.rideId).filter(Boolean);
    if (ids.length) getRides(ids).then(setRides).catch(() => {}); else setRides([]);
  }, [today.trips.length]);

  const todayIso = djiboutiDay();
  const summary = useMemo(() => {
    let days;
    if (period === "day") days = [todayIso];
    else if (period === "week") {
      const weekday = (new Date(`${todayIso}T12:00:00Z`).getUTCDay() + 6) % 7; // 0 = Monday
      const monday = addDays(todayIso, -weekday);
      days = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    } else days = Array.from({ length: 30 }, (_, i) => addDays(todayIso, i - 29));
    const values = days.map((d) => {
      if (d === todayIso) return { day: d, total: today.total, trips: today.trips.length };
      const v = breakdown[d] || {};
      return { day: d, total: Number(v.total) || 0, trips: Number(v.trips) || 0 };
    });
    const total = values.reduce((s, v) => s + v.total, 0);
    const trips = values.reduce((s, v) => s + v.trips, 0);
    const best = values.reduce((b, v) => (v.total > (b?.total || 0) ? v : b), null);
    const range = period === "day" ? t("Aujourd'hui") : `${dayLabel(days[0])} – ${dayLabel(days[days.length - 1])}`;
    return { values, total, trips, best, range, max: Math.max(1, ...values.map((v) => v.total)) };
  }, [period, breakdown, today, todayIso]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <Header title={t("Gains")} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: 4, gap: spacing.lg, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />}>
        <View style={styles.tabs} accessibilityRole="tablist">
          {PERIODS.map((p) => (
            <Pressable key={p.id} onPress={() => setPeriod(p.id)} accessibilityRole="tab" accessibilityState={{ selected: period === p.id }}
              style={[styles.tab, period === p.id && styles.tabOn]}>
              <AppText variant="bodyStrong" color={period === p.id ? colors.text : colors.textSecondary} style={{ fontSize: 15, fontWeight: period === p.id ? "800" : "700" }}>{t(p.label)}</AppText>
            </Pressable>
          ))}
        </View>

        <View style={styles.card}>
          <AppText variant="overline" color={colors.emphasisAccent}>{summary.range}</AppText>
          <AppText variant="display" color={colors.onEmphasis} style={{ fontSize: 34, lineHeight: 38 }}>{formatFdj(summary.total)}</AppText>
          {period !== "day" ? (
            <>
              <View style={styles.bars} accessible accessibilityLabel={t("Gains par jour")}>
                {summary.values.map((v) => (
                  <View key={v.day} style={{ flex: 1, height: `${Math.max(4, (v.total / summary.max) * 100)}%`, borderRadius: period === "week" ? 6 : 3,
                    backgroundColor: v.day === todayIso ? colors.primary : colors.handle, opacity: v.total ? 1 : 0.5 }} />
                ))}
              </View>
              {period === "week" ? (
                <View style={{ flexDirection: "row", gap: 8, marginTop: -6 }}>
                  {DAY_LETTERS.map((l, i) => (
                    <AppText key={i} variant="caption" color={summary.values[i]?.day === todayIso ? colors.emphasisAccent : colors.onEmphasisMuted}
                      style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: "700" }}>{t(l)}</AppText>
                  ))}
                </View>
              ) : null}
            </>
          ) : null}
        </View>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Stat label={t("Courses")} value={String(summary.trips)} />
          <Stat label={t("Moyenne")} value={summary.trips ? formatFdj(summary.total / summary.trips) : "—"} />
          <Stat label={t("Meilleur jour")} value={summary.best ? dayLabel(summary.best.day) : "—"} />
        </View>

        <View>
          <AppText variant="overline" color={colors.textMuted} style={{ paddingBottom: 4 }}>{t("Aujourd'hui")}</AppText>
          {rides.length === 0 ? (
            <View style={{ paddingVertical: 24 }}>
              <EmptyState icon="car-outline" title={t("Aucune course aujourd'hui")} message={t("Passez en ligne pour recevoir des courses.")} />
            </View>
          ) : rides.map((r) => (
            <View key={r.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong" style={{ fontSize: 15 }} numberOfLines={1}>
                  {`${shortAddress(r.pickupAddress)} → ${shortAddress(r.destinationAddress)}`}
                </AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {[formatTime(r.completedAt || r.createdAt), isDelivery(r) ? t("colis") : t("course"),
                    r.paymentMethod === "business" ? t("entreprise") : t("espèces"), r.demo ? t("démo") : null].filter(Boolean).join(" · ")}
                </AppText>
              </View>
              <AppText variant="bodyStrong" style={{ fontSize: 15, fontWeight: "800" }}>{formatFdj(r.fare)}</AppText>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.stat}>
      <AppText variant="caption" color={colors.textMuted} style={{ fontSize: 12, fontWeight: "700" }}>{label}</AppText>
      <AppText variant="bodyStrong" style={{ fontSize: 16, fontWeight: "800" }} numberOfLines={1} adjustsFontSizeToFit>{value}</AppText>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  tabs: { flexDirection: "row", padding: 4, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  tab: { flex: 1, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  tabOn: { backgroundColor: colors.surface },
  card: { padding: 18, borderRadius: radius.xl, backgroundColor: colors.emphasis, gap: 14 },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: 4, height: 96 },
  stat: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 },
  row: { flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: 1, borderTopColor: colors.divider },
}));
