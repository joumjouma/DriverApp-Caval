// "Nouvelle course" — the ride the server offered to this driver, with a
// countdown (the server moves on to the next driver when it runs out).
import React, { useEffect, useRef, useState } from "react";
import { Modal, View, Vibration } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppText, Button, Chip } from "./ui";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { t } from "../utils/i18n/index";
import { formatFdj, formatKm, formatMinutes, formatTime, shortAddress, distanceKm, etaMinutes, PACKAGE_SIZES } from "../utils/format";
import { getContact, isDelivery, isHourly } from "../services/driverApi";
import { radius, spacing } from "../constants/theme";

const OFFER_SECONDS = 15;

function secondsLeft(ride) {
  const end = ride?.countdownExpiryTime?.toDate ? ride.countdownExpiryTime.toDate() : ride?.countdownExpiryTime ? new Date(ride.countdownExpiryTime) : null;
  if (!end || isNaN(end)) return OFFER_SECONDS;
  return Math.max(0, Math.round((end.getTime() - Date.now()) / 1000));
}

/** Title line: "Nouvelle course · Caval Privé", "Colis · Moyen", "Mise à disposition · 3 h" */
export function rideKindLabel(ride) {
  if (isDelivery(ride)) return `${t("Colis")} · ${t(PACKAGE_SIZES[ride.package?.size] || "Colis")}`;
  if (isHourly(ride)) return t("Mise à disposition · {hours} h", { hours: ride.hours || 1 });
  return `${t("Nouvelle course")} · ${ride.rideType || "Caval"}`;
}

export default function OfferSheet({ ride, driverPosition, onAccept, onDecline, busy }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [left, setLeft] = useState(() => secondsLeft(ride));
  const [contact, setContact] = useState(null);
  const shownFor = useRef(null);

  useEffect(() => {
    if (!ride) return undefined;
    if (shownFor.current !== ride.id) {
      shownFor.current = ride.id;
      Vibration.vibrate([0, 400, 200, 400]);
      setContact(null);
      getContact(ride.id).then(setContact).catch(() => {});
    }
    setLeft(secondsLeft(ride));
    const timer = setInterval(() => setLeft(secondsLeft(ride)), 500);
    return () => clearInterval(timer);
  }, [ride?.id, ride?.countdownExpiryTime]);

  if (!ride) return null;

  const pickup = { latitude: ride.pickupLat, longitude: ride.pickupLng };
  const toPickupKm = distanceKm(driverPosition, pickup);
  const delivery = isDelivery(ride);
  const hourly = isHourly(ride);
  const payLine = ride.paymentMethod === "business"
    ? t("Payé par {name}", { name: ride.businessName || t("l'entreprise") })
    : delivery && ride.package?.payer === "recipient" ? t("Espèces · payé par le destinataire") : t("Espèces");
  const tripLine = hourly ? null : [formatKm(ride.distance), ride.duration ? formatMinutes(ride.duration) : null].filter(Boolean).join(" · ");
  const stops = Array.isArray(ride.stops) ? ride.stops : [];

  return (
    <Modal visible transparent animationType="slide" statusBarTranslucent onRequestClose={() => {}}>
      <View style={styles.dim}>
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />

          <View style={styles.top}>
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="overline" color={colors.primaryText}>{rideKindLabel(ride)}</AppText>
              <AppText variant="display">{formatFdj(ride.fare)}</AppText>
              <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, fontWeight: "600" }}>
                {[payLine, tripLine].filter(Boolean).join(" · ")}
              </AppText>
            </View>
            <View accessible accessibilityLabel={t("{n} secondes pour répondre", { n: left })}
              style={[styles.ring, { borderColor: left <= 5 ? colors.error : colors.primary }]}>
              <AppText variant="heading" style={{ fontSize: 20 }}>{left}</AppText>
            </View>
          </View>

          <View style={styles.route}>
            <Stop color={colors.primary} round label={toPickupKm != null ? t("Départ · à {min}", { min: formatMinutes(etaMinutes(toPickupKm)) }) : t("Départ")}
              title={shortAddress(ride.pickupAddress)} note={ride.pickupNote} line />
            {stops.map((s, i) => (
              <Stop key={i} color={colors.textMuted} round label={t("Arrêt {n}", { n: i + 1 })} title={shortAddress(s.address)} line />
            ))}
            {hourly
              ? <Stop color={colors.text} label={t("Mise à disposition")} title={t("{hours} h avec le client", { hours: ride.hours || 1 })} />
              : <Stop color={colors.text} label={t("Arrivée")} title={shortAddress(ride.destinationAddress)} />}
          </View>

          <View style={styles.chips}>
            {contact?.firstName ? <Chip label={contact.firstName} /> : null}
            {ride.scheduledFor ? <Chip tone="orange" label={t("Programmée {time}", { time: formatTime(ride.scheduledFor) })} /> : null}
            {ride.intercity ? <Chip label={t("Interurbain")} /> : null}
            {delivery && ride.package?.description ? <Chip label={ride.package.description} /> : null}
            {ride.demo ? <Chip tone="orange" label={t("Démo")} /> : null}
          </View>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title={t("Refuser")} variant="secondary" onPress={onDecline} disabled={busy} style={{ flex: 1 }} />
            <Button title={t("Accepter")} onPress={onAccept} loading={busy} style={{ flex: 2 }} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Stop({ color, round, label, title, note, line }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 12 }}>
      <View style={{ alignItems: "center", paddingTop: 5 }}>
        <View style={{ width: 12, height: 12, borderRadius: round ? 6 : 3, backgroundColor: color }} />
        {line ? <View style={{ width: 2, flex: 1, backgroundColor: colors.routeLine, marginVertical: 4 }} /> : null}
      </View>
      <View style={{ flex: 1, gap: 2, paddingBottom: line ? 12 : 0 }}>
        <AppText variant="overline" color={colors.textMuted} style={{ fontSize: 12 }}>{label}</AppText>
        <AppText variant="bodyStrong" numberOfLines={2}>{title}</AppText>
        {note ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="flag-outline" size={14} color={colors.primaryText} />
            <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, flex: 1 }}>{note}</AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  dim: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.xl, paddingTop: 10, paddingBottom: spacing.lg, gap: spacing.lg,
  },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.handle },
  top: { flexDirection: "row", alignItems: "center", gap: 12 },
  ring: { width: 64, height: 64, borderRadius: 32, borderWidth: 5, alignItems: "center", justifyContent: "center" },
  route: { padding: 14, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
}));
