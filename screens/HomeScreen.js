// Accueil chauffeur (option C): full-screen map, today's earnings at the top,
// one big Go button to go online, and the offer sheet when a ride comes in.
import React, { useEffect, useRef, useState } from "react";
import { View, Pressable, Alert, Image, StatusBar } from "react-native";
import MapView, { Marker } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useIsFocused } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { AppText, IconButton } from "../components/ui";
import OfferSheet from "../components/OfferSheet";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { useDemo } from "../context/DemoContext";
import { DARK_MAP_STYLE } from "../constants/mapStyle";
import { radius, shadow } from "../constants/theme";
import { t } from "../utils/i18n/index";
import { formatFdj, formatDuration } from "../utils/format";
import useDriverLocation, { currentPosition, stopBackground } from "../hooks/useDriverLocation";
import {
  watchDriver, watchOffer, watchActiveRide, watchToday, setOnline, acceptOffer, declineOffer,
} from "../services/driverApi";
import notificationService from "../services/NotificationService";
import PrivacyPolicyModal from "../components/PrivacyPolicyModal";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useAuth } from "../context/AuthContext";
import { reportError } from "../utils/report";

const initials = (d) => `${(d?.firstName || "")[0] || ""}${(d?.lastName || "")[0] || ""}`.toUpperCase() || "C";

export default function HomeScreen() {
  const navigation = useNavigation();
  const focused = useIsFocused();
  const { colors, isDark } = useTheme();
  const styles = useStyles();
  const { demo } = useDemo();
  const mapRef = useRef(null);

  const { logout } = useAuth();
  const [driver, setDriver] = useState(undefined); // undefined = loading, null = no driver profile
  const [privacyOk, setPrivacyOk] = useState(true);
  const [today, setToday] = useState({ total: 0, trips: [] });
  const [offer, setOffer] = useState(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [now, setNow] = useState(Date.now());

  const online = driver?.isOnline === true;
  const approved = driver?.isApproved === true || driver?.approvalStatus === "approved";
  const { position, denied } = useDriverLocation({ share: online, demo });

  // Driver profile, today's earnings, push notifications
  useEffect(() => {
    const offDriver = watchDriver(setDriver);
    const offToday = watchToday(setToday);
    notificationService.initialize().catch(() => {});
    AsyncStorage.getItem("privacyPolicyAccepted").then((v) => setPrivacyOk(v === "true")).catch(() => {});
    return () => { offDriver(); offToday(); };
  }, []);

  // A ride in progress (after a restart or an accepted offer) → ride screen
  useEffect(() => watchActiveRide((ride) => {
    if (ride && focused) navigation.navigate("Ride", { rideId: ride.id });
  }), [focused]);

  // Offers only while online
  useEffect(() => {
    if (!online) { setOffer(null); return undefined; }
    return watchOffer(setOffer);
  }, [online]);

  // Online time ticker
  useEffect(() => {
    if (!online) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [online]);

  // Follow the driver on the map
  useEffect(() => {
    if (position && mapRef.current) {
      mapRef.current.animateToRegion({ ...position, latitudeDelta: 0.02, longitudeDelta: 0.02 }, 600);
    }
  }, [position?.latitude ? Math.round(position.latitude * 1000) : 0, position?.longitude ? Math.round(position.longitude * 1000) : 0]);

  const toggle = async () => {
    if (!driver) return;
    if (!approved) { navigation.navigate("ApprovalStatusScreen"); return; }
    if (!online && denied && !demo) {
      Alert.alert(t("Localisation désactivée"), t("Autorisez la localisation dans les réglages du téléphone pour recevoir des courses."));
      return;
    }
    setSwitching(true);
    try {
      const pos = online ? null : position || (await currentPosition());
      await setOnline(!online, pos);
      if (online) stopBackground();
    } catch (e) {
      reportError(e, { where: "toggleOnline" });
      Alert.alert(t("Erreur"), t("Impossible de changer votre statut. Vérifiez votre connexion."));
    } finally {
      setSwitching(false);
    }
  };

  const accept = async () => {
    if (!offer) return;
    setBusy(true);
    try {
      await acceptOffer(offer, driver);
      const id = offer.id;
      setOffer(null);
      navigation.navigate("Ride", { rideId: id });
    } catch (e) {
      reportError(e, { where: "acceptOffer" });
      Alert.alert(t("Course indisponible"), t("Cette course n'est plus disponible."));
      setOffer(null);
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    if (!offer) return;
    const id = offer.id;
    setOffer(null);
    declineOffer(id).catch((e) => reportError(e, { where: "declineOffer" }));
  };

  const onlineSince = driver?.onlineStartTime?.toDate ? driver.onlineStartTime.toDate().getTime() : null;
  const onlineSec = online && onlineSince ? (now - onlineSince) / 1000 : 0;

  let status;
  if (driver === undefined) status = { dot: colors.chevron, title: t("Chargement…"), sub: "" };
  else if (driver === null) status = { dot: colors.warning, title: t("Profil chauffeur introuvable"), sub: t("Inscription en cours ? Patientez quelques secondes. Sinon, touchez pour vous déconnecter.") };
  else if (!approved) status = { dot: colors.warning, title: t("Compte en attente de validation"), sub: t("Touchez pour voir où en est votre dossier") };
  else if (online) status = { dot: colors.success, title: t("Vous êtes en ligne"), sub: onlineSec > 60 ? t("Recherche de courses · {time}", { time: formatDuration(onlineSec) }) : t("Recherche de courses près de vous") };
  else status = { dot: colors.chevron, title: t("Vous êtes hors ligne"), sub: t("Appuyez sur Go pour recevoir des courses") };

  return (
    <View style={{ flex: 1, backgroundColor: colors.map }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        customMapStyle={isDark ? DARK_MAP_STYLE : []}
        initialRegion={{ latitude: 11.5946, longitude: 43.1475, latitudeDelta: 0.05, longitudeDelta: 0.05 }}
        showsCompass={false}
        toolbarEnabled={false}
        accessibilityElementsHidden
      >
        {position ? (
          <Marker coordinate={position} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <View style={styles.car}><Ionicons name="car" size={18} color={colors.onEmphasis} /></View>
          </Marker>
        ) : null}
      </MapView>

      {/* Top: profile, today's earnings, recenter */}
      <SafeAreaView edges={["top"]} style={styles.top} pointerEvents="box-none">
        <Pressable onPress={() => navigation.navigate("Profile")} accessibilityRole="button" accessibilityLabel={t("Profil")} style={styles.avatar}>
          {driver?.photo
            ? <Image source={{ uri: driver.photo }} style={{ width: 48, height: 48, borderRadius: 24 }} />
            : <AppText variant="bodyStrong" color={colors.primaryText}>{initials(driver)}</AppText>}
        </Pressable>
        <Pressable onPress={() => navigation.navigate("EarningsScreen")} accessibilityRole="button"
          accessibilityLabel={t("Gains du jour : {amount}", { amount: formatFdj(today.total) })} style={styles.pill}>
          <AppText variant="bodyStrong" color={colors.onEmphasis} style={{ fontSize: 17 }}>{formatFdj(today.total)}</AppText>
          <AppText variant="caption" color={colors.emphasisAccent} style={{ fontSize: 12, fontWeight: "700" }}>
            {t("aujourd'hui · {n} courses", { n: today.trips.length })}
          </AppText>
        </Pressable>
        <IconButton icon="locate" floating label={t("Centrer sur ma position")}
          onPress={() => position && mapRef.current?.animateToRegion({ ...position, latitudeDelta: 0.015, longitudeDelta: 0.015 }, 400)} />
      </SafeAreaView>

      {/* Go / Stop */}
      <View style={styles.goWrap} pointerEvents="box-none">
        <Pressable onPress={toggle} disabled={switching || !driver} accessibilityRole="button"
          accessibilityLabel={online ? t("Passer hors ligne") : t("Passer en ligne")}
          style={({ pressed }) => [styles.go, online && styles.stop, (pressed || switching) && { opacity: 0.8 }]}>
          <Ionicons name="power" size={26} color={online ? colors.onEmphasis : colors.onPrimary} />
          <AppText variant="bodyStrong" color={online ? colors.onEmphasis : colors.onPrimary} style={{ fontSize: 17, fontWeight: "800" }}>
            {online ? t("Stop") : t("Go")}
          </AppText>
        </Pressable>
      </View>

      {/* Status bar */}
      <SafeAreaView edges={["bottom"]} style={styles.bottom} pointerEvents="box-none">
        <Pressable style={styles.status} onPress={driver === null ? () => logout().catch(() => {}) : !approved && driver ? () => navigation.navigate("ApprovalStatusScreen") : undefined}
          accessibilityRole={!approved ? "button" : undefined}>
          <View style={[styles.dot, { backgroundColor: status.dot }]} />
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" style={{ fontSize: 17, fontWeight: "800" }}>{status.title}</AppText>
            {status.sub ? <AppText variant="caption" color={colors.textMuted}>{status.sub}</AppText> : null}
          </View>
          <IconButton icon="stats-chart" size={44} label={t("Gains")} onPress={() => navigation.navigate("EarningsScreen")} />
        </Pressable>
      </SafeAreaView>

      <PrivacyPolicyModal visible={!privacyOk && !!driver} onAccept={() => { AsyncStorage.setItem("privacyPolicyAccepted", "true").catch(() => {}); setPrivacyOk(true); }} />

      {offer && focused ? (
        <OfferSheet ride={offer} driverPosition={position} onAccept={accept} onDecline={decline} busy={busy} />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 8 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primaryLight, alignItems: "center", justifyContent: "center", overflow: "hidden", ...shadow.float },
  pill: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.emphasis, alignItems: "center", ...shadow.float },
  car: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.emphasis, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.white },
  goWrap: { position: "absolute", left: 0, right: 0, bottom: 150, alignItems: "center" },
  go: {
    width: 104, height: 104, borderRadius: 52, borderWidth: 6, borderColor: colors.surface, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center", gap: 2, ...shadow.sheet,
  },
  stop: { backgroundColor: colors.emphasis, width: 88, height: 88, borderRadius: 44 },
  bottom: { position: "absolute", left: 12, right: 12, bottom: 0 },
  status: {
    flexDirection: "row", alignItems: "center", gap: 14, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 12,
    borderRadius: 22, backgroundColor: colors.surface, ...shadow.sheet,
  },
  dot: { width: 12, height: 12, borderRadius: 6 },
}));
