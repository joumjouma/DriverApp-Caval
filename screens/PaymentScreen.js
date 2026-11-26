// Paiements: what the driver owes Caval or is owed, the commission, and how
// they want to be paid (mobile money). Most rides are paid in cash to the
// driver, so the balance is settled weekly with the Caval team.
//   balance > 0  → Caval owes the driver (promos, credit, cancellation fees)
//   balance < 0  → the driver owes Caval its commission
import React, { useEffect, useState } from "react";
import { View, Switch, Linking, RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { AppText, Header, Card, Button, ErrorBanner } from "../components/ui";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { radius, spacing } from "../constants/theme";
import { APP_CONFIG } from "../constants/appConfig";
import { t } from "../utils/i18n/index";
import { formatFdj } from "../utils/format";
import { getBalance, getDriver, getPricing, updateDriver } from "../services/driverApi";
import { reportError } from "../utils/report";

const METHODS = [
  { id: "waafi", label: "Waafi" },
  { id: "dmoney", label: "D-Money" },
  { id: "cacpay", label: "CAC Pay" },
  { id: "sabapay", label: "Saba Pay" },
];

export default function PaymentScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useStyles();
  const [balance, setBalance] = useState(null);
  const [driver, setDriver] = useState(null);
  const [commission, setCommission] = useState(null);
  const [payout, setPayout] = useState({});
  const [error, setError] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [b, d, p] = await Promise.all([getBalance(), getDriver(), getPricing()]);
      setBalance(b); setDriver(d); setPayout(d?.payout || {});
      const c = p.commission || {};
      const since = d?.approvalDate?.toDate?.() || d?.createdAt?.toDate?.();
      const freeDays = Number(c.newDriverFreeDays) || 0;
      const freeUntil = since && freeDays ? new Date(since.getTime() + freeDays * 86400000) : null;
      const waived = (c.waivedUntil && new Date(c.waivedUntil) > new Date()) || (freeUntil && freeUntil > new Date());
      setCommission({ percent: Number(c.percent) || 0, waived, until: waived ? (freeUntil || new Date(c.waivedUntil)) : null });
      setError("");
    } catch (e) {
      reportError(e, { where: "PaymentScreen.load" });
      setError(t("Impossible de charger vos paiements. Vérifiez votre connexion."));
    }
  };
  useEffect(() => { load(); }, []);

  const toggle = async (id, on) => {
    const next = { ...payout, [id]: on };
    setPayout(next);
    await updateDriver({ payout: next }).catch((e) => { reportError(e, { where: "savePayout" }); setPayout(payout); setError(t("Impossible d'enregistrer. Réessayez.")); });
  };

  const contact = () => Linking.openURL(`https://wa.me/${APP_CONFIG.supportPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(t("Bonjour, je voudrais régler mon solde Caval."))}`).catch(() => {});

  const b = balance?.balance || 0;
  const tone = b > 0 ? colors.successText : b < 0 ? colors.errorText : colors.text;
  const headline = b > 0 ? t("Caval vous doit") : b < 0 ? t("Vous devez à Caval") : t("Vous êtes à jour");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <Header title={t("Paiements")} onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={{ padding: spacing.xl, paddingTop: 4, gap: spacing.lg, paddingBottom: 48 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} tintColor={colors.primary} />}>
        {error ? <ErrorBanner message={error} /> : null}

        <View style={styles.hero}>
          <AppText variant="overline" color={colors.emphasisAccent}>{t("Solde avec Caval")}</AppText>
          <AppText variant="bodyStrong" color={colors.onEmphasis}>{headline}</AppText>
          <AppText variant="display" color={colors.onEmphasis} style={{ fontSize: 34, lineHeight: 38 }}>
            {balance ? formatFdj(Math.abs(b)) : "—"}
          </AppText>
          <AppText variant="caption" color={colors.onEmphasisMuted}>
            {t("Réglé chaque semaine avec l'équipe Caval, par mobile money ou au bureau.")}
          </AppText>
          {b !== 0 ? <Button title={t("Régler avec Caval")} onPress={contact} style={{ marginTop: 6 }} /> : null}
        </View>

        <Card style={{ gap: 8 }}>
          <AppText variant="heading">{t("Comment ça marche")}</AppText>
          <Line label={t("Le client vous paie en espèces")} value={t("vous gardez l'argent")} />
          <Line label={t("Commission Caval")} value={commission ? (commission.waived ? t("0 % (offert)") : `${commission.percent} %`) : "—"} />
          {commission?.waived && commission.until ? (
            <AppText variant="caption" color={colors.successText}>
              {t("Sans commission jusqu'au {date}.", { date: commission.until.toLocaleDateString() })}
            </AppText>
          ) : null}
          <Line label={t("Codes promo et crédit client")} value={t("payés par Caval")} />
          <Line label={t("Client absent ou annulation tardive")} value={t("frais pour vous")} />
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 4 }}>
            {t("Vous êtes toujours payé sur le prix complet de la course. Quand un client utilise une réduction, Caval vous doit la différence.")}
          </AppText>
        </Card>

        {balance ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Stat label={t("Gagné au total")} value={formatFdj(balance.earned)} />
            <Stat label={t("Commission payée")} value={formatFdj(balance.commission)} />
          </View>
        ) : null}

        <Card style={{ gap: 4 }}>
          <AppText variant="heading">{t("Recevoir mes paiements")}</AppText>
          <AppText variant="caption" color={colors.textMuted} style={{ marginBottom: 6 }}>{t("Quand Caval vous doit de l'argent, nous payons sur l'un de ces comptes.")}</AppText>
          {METHODS.map((m, i) => (
            <View key={m.id} style={[styles.method, i === METHODS.length - 1 && { borderBottomWidth: 0 }]}>
              <AppText variant="bodyStrong" style={{ flex: 1 }}>{m.label}</AppText>
              <Switch value={!!payout[m.id]} onValueChange={(v) => toggle(m.id, v)} trackColor={{ true: colors.primary }}
                accessibilityLabel={m.label} />
            </View>
          ))}
          <AppText variant="caption" color={colors.textMuted} style={{ marginTop: 6 }}>
            {t("Paiement sur le numéro {phone}.", { phone: driver?.phoneNumber || "—" })}
          </AppText>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}

function Line({ label, value }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
      <AppText variant="body" style={{ flex: 1 }}>{label}</AppText>
      <AppText variant="bodyStrong" color={colors.textSecondary}>{value}</AppText>
    </View>
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
  hero: { padding: 18, borderRadius: radius.xl, backgroundColor: colors.emphasis, gap: 6 },
  method: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.divider },
  stat: { flex: 1, padding: 12, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 2 },
}));
