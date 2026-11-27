// The ride, from "En route vers le client" to "Course terminée" (option A).
// Follows the ride row live (Supabase realtime); each step moves the status forward:
//   assigned → driver_arrived → picked_up → completed
// Rides: pickup PIN (verifyPickupPin) before picked_up.
// Packages: photo at pickup, delivery code at drop-off (confirmDelivery).
// Hourly hire: timer from pickup.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { View, ScrollView, Pressable, Image, Linking, KeyboardAvoidingView, Platform, StatusBar } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { AppText, Button, IconButton, ModalSheet, ErrorBanner, Chip } from "../components/ui";
import CodeInput from "../components/CodeInput";
import { useTheme, makeStyles } from "../context/ThemeContext";
import { useDemo } from "../context/DemoContext";
import { DARK_MAP_STYLE } from "../constants/mapStyle";
import { APP_CONFIG } from "../constants/appConfig";
import { radius, shadow, spacing } from "../constants/theme";
import { t } from "../utils/i18n/index";
import { formatFdj, formatMinutes, shortAddress, distanceKm, etaMinutes, call, whatsapp, navigateTo, PACKAGE_SIZES } from "../utils/format";
import useDriverLocation from "../hooks/useDriverLocation";
import {
  watchRide, getContact, markArrived, verifyPickupPin, uploadPickupPhoto, markPickedUp,
  completeRide, confirmDelivery, cancelByDriver, demoDeliveryCode, isDelivery, isHourly, cashMoment, getFeatureFlags,
} from "../services/driverApi";
import { reportError } from "../utils/report";
import { createConversation } from "../utils/messaging";
import { me } from "../config/supabase";
import { showAlert } from "../components/Dialog";

const PROBLEMS = [
  { id: "no_show", label: "Client absent au point de départ" },
  { id: "wrong_address", label: "Adresse incorrecte" },
  { id: "customer_cancelled", label: "Le client annule la course" },
  { id: "vehicle_problem", label: "Problème avec le véhicule" },
  { id: "other", label: "Autre problème" },
];

// Database error codes → the names this screen checks
const CODES = { "54000": "resource-exhausted", "42501": "permission-denied", "55000": "failed-precondition", "22023": "invalid-argument" };
const errCode = (e) => CODES[String(e?.code || "")] || String(e?.code || "");

export default function RideScreen() {
  const navigation = useNavigation();
  const { rideId } = useRoute().params || {};
  const { colors, isDark } = useTheme();
  const styles = useStyles();
  const { demo } = useDemo();
  const mapRef = useRef(null);
  const { position } = useDriverLocation({ share: true, demo });

  const [ride, setRide] = useState(null);
  const [contact, setContact] = useState(null);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [photoUri, setPhotoUri] = useState(null);
  const [stopIndex, setStopIndex] = useState(0);
  const [problemOpen, setProblemOpen] = useState(false);
  const [done, setDone] = useState(null); // completed ride summary
  const [now, setNow] = useState(Date.now());
  const [pinOn, setPinOn] = useState(false); // customers see the PIN only when appConfig/customer.pickupPinEnabled is on
  const handledEnd = useRef(false);

  useEffect(() => { getFeatureFlags().then((f) => setPinOn(f.pickupPinEnabled === true)).catch(() => {}); }, []);
  // Demo rides always ask for the PIN, except robot rides (already verified)
  const pinRequired = (demo || pinOn) && !ride?.pickupPinVerified;
  // Robot customer's package: show the code, since nobody can give it to you
  const [demoCode, setDemoCode] = useState(null);
  useEffect(() => {
    if (ride?.robotCustomer && ride?.status === "picked_up" && !demoCode) demoDeliveryCode(ride.id).then(setDemoCode).catch(() => {});
  }, [ride?.robotCustomer, ride?.status]);

  useEffect(() => {
    if (!rideId) { navigation.goBack(); return undefined; }
    getContact(rideId).then(setContact).catch(() => {});
    return watchRide(rideId, setRide);
  }, [rideId]);

  // Ride ended elsewhere (customer cancelled, admin, server completed a delivery)
  useEffect(() => {
    if (!ride || handledEnd.current) return;
    if (ride.status === "completed") { handledEnd.current = true; setDone(ride); return; }
    if (["cancelled", "declined", "cancelled_by_driver", "no_drivers_available"].includes(ride.status)) {
      handledEnd.current = true;
      if (ride.cancelledBy !== "driver") {
        showAlert(t("Course annulée"), t("Le client a annulé la course."), [{ text: t("OK"), onPress: () => navigation.navigate("Home") }]);
      } else navigation.navigate("Home");
    }
  }, [ride?.status]);

  // Reset the code field between steps
  useEffect(() => { setCode(""); setCodeError(""); }, [ride?.status]);

  // Hourly timer
  useEffect(() => {
    if (!isHourly(ride) || ride?.status !== "picked_up") return undefined;
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, [ride?.status, ride?.serviceType]);

  const delivery = isDelivery(ride);
  const hourly = isHourly(ride);
  const status = ride?.status;
  const goingToPickup = status === "assigned";
  const atPickup = status === "driver_arrived";
  const onBoard = status === "picked_up";
  const stops = Array.isArray(ride?.stops) ? ride.stops : [];
  const pickup = ride ? { latitude: ride.pickupLat, longitude: ride.pickupLng } : null;
  const destination = ride ? { latitude: ride.destinationLat, longitude: ride.destinationLng } : null;
  const nextStop = onBoard && stopIndex < stops.length ? stops[stopIndex] : null;
  const target = goingToPickup || atPickup ? pickup : nextStop || destination;
  const km = distanceKm(position, target);
  const cash = cashMoment(ride);
  const collectNow = (cash === "pickup" && (goingToPickup || atPickup)) || (cash === "dropoff" && (onBoard || goingToPickup));

  // Fit driver + target on the map
  useEffect(() => {
    if (!mapRef.current || !target?.latitude) return;
    const pts = [target, position].filter((p) => p?.latitude);
    mapRef.current.fitToCoordinates(pts, { edgePadding: { top: 140, right: 60, bottom: 460, left: 60 }, animated: true });
  }, [target?.latitude, target?.longitude, !!position]);

  // ---------------------------------------------------------- actions
  const run = async (fn, where) => {
    setBusy(true);
    try { await fn(); } catch (e) {
      reportError(e, { where });
      showAlert(t("Erreur"), t("Action impossible. Vérifiez votre connexion et réessayez."));
    } finally { setBusy(false); }
  };

  const arrived = () => run(() => markArrived(rideId), "markArrived");

  const startRide = async () => {
    if (code.length !== 4) { setCodeError(t("Entrez les 4 chiffres du code.")); return; }
    setBusy(true);
    setCodeError("");
    try {
      const res = await verifyPickupPin(rideId, code);
      if (res?.ok) { await markPickedUp(rideId); return; }
      setCodeError(t("Code incorrect, il reste {n} essais.", { n: res?.attemptsLeft ?? 0 }));
    } catch (e) {
      const c = errCode(e);
      if (c === "resource-exhausted") setCodeError(t("Trop d'essais. Contactez le support Caval."));
      else if (c === "not-found" && !/ride not found/i.test(e?.message || "")) {
        // verifyPickupPin isn't deployed yet: start without the check
        await markPickedUp(rideId).catch(() => {});
      } else {
        reportError(e, { where: "verifyPickupPin" });
        setCodeError(t("Vérification impossible. Vérifiez votre connexion."));
      }
    } finally { setBusy(false); }
  };

  const takePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { showAlert(t("Appareil photo"), t("Autorisez l'appareil photo pour photographier le colis.")); return; }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.5, allowsEditing: false });
    if (!res.canceled && res.assets?.[0]?.uri) setPhotoUri(res.assets[0].uri);
  };

  const pickedUpPackage = () => run(async () => {
    if (!photoUri) throw new Error("no photo");
    await uploadPickupPhoto(rideId, photoUri);
    await markPickedUp(rideId);
  }, "pickedUpPackage");

  const finish = () => {
    if (nextStop) { setStopIndex((i) => i + 1); return; }
    showAlert(hourly ? t("Terminer la mise à disposition ?") : t("Terminer la course ?"),
      cash === "dropoff" ? t("Vérifiez que vous avez encaissé {fare}.", { fare: formatFdj(ride.fare) }) : undefined, [
        { text: t("Annuler"), style: "cancel" },
        { text: t("Terminer"), onPress: () => run(() => completeRide(rideId), "completeRide") },
      ]);
  };

  const deliver = async () => {
    if (code.length !== 4) { setCodeError(t("Entrez les 4 chiffres du code.")); return; }
    setBusy(true);
    setCodeError("");
    try {
      const res = await confirmDelivery(rideId, code);
      if (!res?.delivered) setCodeError(t("Code incorrect, il reste {n} essais.", { n: res?.attemptsLeft ?? 0 }));
    } catch (e) {
      const c = errCode(e);
      if (c === "resource-exhausted") setCodeError(t("Trop d'essais. Contactez le support Caval."));
      else { reportError(e, { where: "confirmDelivery" }); setCodeError(t("Vérification impossible. Vérifiez votre connexion.")); }
    } finally { setBusy(false); }
  };

  const reportProblem = (p) => {
    setProblemOpen(false);
    // Waited 5 min at pickup and the passenger didn't come: the customer pays a late fee to the driver
    const waited = ride?.arrivedAt ? (Date.now() - ride.arrivedAt.toMillis()) / 60000 : 0;
    const msg = p.id === "no_show"
      ? (waited >= 5 ? t("Le client paiera des frais d'annulation, ajoutés à votre solde.") : t("Attendez 5 minutes au point de départ pour que le client paie des frais d'annulation."))
      : t(p.label);
    showAlert(t("Annuler la course ?"), msg, [
      { text: t("Non"), style: "cancel" },
      { text: t("Oui, annuler"), style: "destructive", onPress: () => run(() => cancelByDriver(rideId, p.id), "cancelByDriver") },
    ]);
  };

  // In-app chat with the customer (conversations/{driverId_customerId})
  const openChat = async () => {
    if (!ride?.userId) { whatsapp(person.phone); return; }
    try {
      const conversationId = await createConversation(me(), ride.userId);
      navigation.navigate("DriverInboxScreen", { conversationId, customerName: contact?.firstName || t("Client"), customerPhoto: contact?.photo || null });
    } catch (e) {
      reportError(e, { where: "openChat" });
      whatsapp(person.phone);
    }
  };

  const support = () => {
    const msg = t("Bonjour, j'ai un problème avec la course {id}.", { id: rideId });
    Linking.openURL(`https://wa.me/${APP_CONFIG.supportPhone.replace(/[^\d]/g, "")}?text=${encodeURIComponent(msg)}`).catch(() => {});
  };

  // ---------------------------------------------------------- texts
  const header = useMemo(() => {
    if (!ride) return { over: t("Chargement…"), title: "" };
    if (goingToPickup) return { over: delivery ? t("En route vers l'expéditeur") : t("En route vers le client"), title: shortAddress(ride.pickupAddress), note: ride.pickupNote };
    if (atPickup) return { over: t("Vous êtes arrivé"), title: delivery ? t("Récupérez le colis") : t("Le client vous rejoint"), note: ride.pickupNote };
    if (hourly) return { over: t("Mise à disposition · {hours} h", { hours: ride.hours || 1 }), title: t("Avec le client") };
    if (delivery) return { over: `${t("Colis")} · ${t(PACKAGE_SIZES[ride.package?.size] || "Colis")}`, title: t("Livrer à {name}", { name: ride.package?.recipientName || "" }), note: ride.package?.note };
    if (nextStop) return { over: t("Arrêt {n} sur {total}", { n: stopIndex + 1, total: stops.length }), title: shortAddress(nextStop.address) };
    return { over: t("Course en cours"), title: shortAddress(ride.destinationAddress) };
  }, [ride, status, stopIndex]);

  const pill = goingToPickup && km != null
    ? t("Client dans {min} · {km}", { min: formatMinutes(etaMinutes(km)), km: `${(Math.round(km * 10) / 10).toString().replace(".", ",")} km` })
    : atPickup ? t("Arrivé au point de départ")
      : hourly && onBoard ? hourlyLine(ride, now)
        : onBoard && km != null ? t("Arrivée dans {min}", { min: formatMinutes(etaMinutes(km)) }) : null;

  // Person to contact: the customer/passenger before pickup, the recipient after (packages)
  const person = delivery && onBoard
    ? { name: ride.package?.recipientName, phone: ride.package?.recipientPhone, sub: t("Destinataire") }
    : { name: contact?.firstName || t("Client"), phone: contact?.number, sub: contact?.bookedBy ? t("Réservé par {name}", { name: contact.bookedBy }) : delivery ? t("Expéditeur") : null, photo: contact?.photo };

  if (done) return <Finished ride={done} onHome={() => navigation.navigate("Home")} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.map }}>
      <StatusBar barStyle={isDark ? "light-content" : "dark-content"} />
      <MapView ref={mapRef} style={{ flex: 1 }} customMapStyle={isDark ? DARK_MAP_STYLE : []} showsCompass={false} toolbarEnabled={false}
        initialRegion={{ latitude: pickup?.latitude || 11.5946, longitude: pickup?.longitude || 43.1475, latitudeDelta: 0.04, longitudeDelta: 0.04 }}>
        {position ? <Marker coordinate={position} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}><View style={styles.car}><Ionicons name="car" size={18} color={colors.onEmphasis} /></View></Marker> : null}
        {target?.latitude ? <Marker coordinate={target} pinColor={colors.primary} /> : null}
        {position && target?.latitude ? <Polyline coordinates={[position, target]} strokeColor={colors.primary} strokeWidth={4} lineDashPattern={[2, 8]} /> : null}
      </MapView>

      <SafeAreaView edges={["top"]} style={styles.top} pointerEvents="box-none">
        {pill ? <View style={styles.pill}><AppText variant="bodyStrong" color={colors.onEmphasis} style={{ fontSize: 15 }}>{pill}</AppText></View> : <View />}
        {target?.latitude && !atPickup ? (
          <Pressable onPress={() => navigateTo(target.latitude, target.longitude)} accessibilityRole="button" style={styles.navBtn}>
            <Ionicons name="navigate" size={18} color={colors.text} />
            <AppText variant="bodyStrong" style={{ fontSize: 15, fontWeight: "800" }}>{t("Naviguer")}</AppText>
          </Pressable>
        ) : null}
      </SafeAreaView>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap} pointerEvents="box-none">
        <SafeAreaView edges={["bottom"]} style={styles.sheet}>
          <View style={styles.handle} />
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: spacing.lg, paddingBottom: 4 }} bounces={false}>
            <View style={{ gap: 2 }}>
              <AppText variant="overline" color={colors.primaryText}>{header.over}</AppText>
              {header.title ? <AppText variant="heading">{header.title}</AppText> : null}
              {header.note ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingTop: 2 }}>
                  <Ionicons name="flag-outline" size={14} color={colors.primaryText} />
                  <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, flex: 1 }}>{header.note}</AppText>
                </View>
              ) : null}
            </View>

            {ride?.demo ? <Chip tone="orange" label={t("Course de démonstration")} /> : null}

            {/* Person */}
            <View style={styles.person}>
              {person.photo ? <Image source={{ uri: person.photo }} style={styles.avatar} />
                : <View style={styles.avatar}><AppText variant="bodyStrong" color={colors.textSecondary}>{(person.name || "C")[0]}</AppText></View>}
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{person.name}</AppText>
                {person.sub ? <AppText variant="caption" color={colors.textMuted}>{person.sub}</AppText> : null}
              </View>
              <IconButton icon="call" label={t("Appeler {name}", { name: person.name || "" })} onPress={() => call(person.phone)} size={46} />
              {!(delivery && onBoard) ? <IconButton icon="chatbubble-ellipses-outline" label={t("Message à {name}", { name: person.name || "" })} onPress={openChat} size={46} /> : null}
              <IconButton icon="logo-whatsapp" color={colors.success} label={t("WhatsApp à {name}", { name: person.name || "" })} onPress={() => whatsapp(person.phone)} size={46} />
            </View>

            {/* Money */}
            {cash === "none" ? (
              <Notice tone="success" icon="checkmark" text={t("Payé par {name} — ne pas encaisser", { name: ride?.businessName || t("l'entreprise") })} />
            ) : delivery && cash === "pickup" && onBoard ? (
              <Notice tone="success" icon="checkmark" text={t("Déjà payé par l'expéditeur — rien à encaisser")} />
            ) : collectNow && ride ? (
              <View style={styles.money}>
                <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, fontWeight: "600", flex: 1 }}>
                  {cash === "pickup" ? t("Encaisser à la récupération") : delivery ? t("Encaisser auprès du destinataire") : t("À encaisser en espèces")}
                </AppText>
                <AppText variant="bodyStrong" style={{ fontSize: 17, fontWeight: "800" }}>{formatFdj(ride.fare)}</AppText>
              </View>
            ) : null}

            {/* Step action */}
            {goingToPickup ? (
              <Button title={t("Je suis arrivé")} onPress={arrived} loading={busy} />
            ) : atPickup && delivery ? (
              <>
                <AppText variant="bodyStrong">{t("Photo du colis")}</AppText>
                <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, marginTop: -10 }}>{t("Obligatoire : elle vous protège si l'expéditeur conteste l'état du colis.")}</AppText>
                {photoUri ? <Image source={{ uri: photoUri }} style={styles.photo} accessibilityLabel={t("Photo du colis")} /> : null}
                <Button title={photoUri ? t("Reprendre la photo") : t("Prendre la photo")} icon="camera-outline" variant={photoUri ? "outline" : "secondary"} onPress={takePhoto} />
                <Button title={t("Colis récupéré")} onPress={pickedUpPackage} loading={busy} disabled={!photoUri} />
              </>
            ) : atPickup && !pinRequired ? (
              <Button title={hourly ? t("Commencer la mise à disposition") : t("Démarrer la course")} onPress={() => run(() => markPickedUp(rideId), "markPickedUp")} loading={busy} />
            ) : atPickup ? (
              <>
                <AppText variant="bodyStrong">{t("Code de départ")}</AppText>
                <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, marginTop: -10 }}>{t("Demandez au client le code à 4 chiffres affiché dans son application.")}</AppText>
                <CodeInput value={code} onChange={setCode} label={t("Code de départ")} error={!!codeError} />
                <ErrorBanner message={codeError} />
                <Button title={hourly ? t("Commencer la mise à disposition") : t("Démarrer la course")} onPress={startRide} loading={busy} />
              </>
            ) : onBoard && delivery ? (
              <>
                <AppText variant="bodyStrong">{t("Code de livraison")}</AppText>
                <AppText variant="caption" color={colors.textSecondary} style={{ fontSize: 14, marginTop: -10 }}>{t("Demandez au destinataire le code à 4 chiffres reçu par WhatsApp.")}</AppText>
                {demoCode ? <Chip tone="orange" label={t("Démo : le code est {code}", { code: demoCode })} /> : null}
                <CodeInput value={code} onChange={setCode} label={t("Code de livraison")} error={!!codeError} />
                <ErrorBanner message={codeError} />
                <Button title={t("Confirmer la livraison")} onPress={deliver} loading={busy} />
              </>
            ) : onBoard ? (
              <Button title={nextStop ? t("Arrêt suivant") : hourly ? t("Terminer la mise à disposition") : t("Terminer la course")} onPress={finish} loading={busy} />
            ) : null}

            <Button title={t("J'ai un problème")} variant="ghost" size="sm" onPress={() => setProblemOpen(true)} />
          </ScrollView>
        </SafeAreaView>
      </KeyboardAvoidingView>

      <ModalSheet visible={problemOpen} onClose={() => setProblemOpen(false)} title={t("Problème rencontré")}>
        {PROBLEMS.map((p) => (
          <Button key={p.id} title={t(p.label)} variant="outline" size="md" onPress={() => reportProblem(p)} />
        ))}
        <Button title={t("Contacter le support WhatsApp")} icon="logo-whatsapp" variant="secondary" size="md" onPress={support} />
      </ModalSheet>
    </View>
  );
}

function hourlyLine(ride, now) {
  const start = ride.pickedUpAt?.toDate ? ride.pickedUpAt.toDate().getTime() : null;
  if (!start) return t("Mise à disposition en cours");
  const usedMin = (now - start) / 60000;
  const leftMin = (ride.hours || 1) * 60 - usedMin;
  return leftMin > 0 ? t("Temps restant : {time}", { time: formatMinutes(leftMin) }) : t("Temps écoulé : +{time}", { time: formatMinutes(-leftMin) });
}

function Notice({ tone, icon, text }) {
  const { colors } = useTheme();
  const [bg, fg] = tone === "success" ? [colors.successSoft, colors.successText] : [colors.primarySoft, colors.primaryText];
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: bg }}>
      <Ionicons name={icon} size={18} color={fg} />
      <AppText variant="caption" color={fg} style={{ fontSize: 14, fontWeight: "700", flex: 1 }}>{text}</AppText>
    </View>
  );
}

function Finished({ ride, onHome }) {
  const { colors } = useTheme();
  const delivery = isDelivery(ride);
  const cash = cashMoment(ride);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: "center", gap: 14 }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: colors.successSoft, alignItems: "center", justifyContent: "center", alignSelf: "center" }}>
        <Ionicons name="checkmark" size={36} color={colors.successText} />
      </View>
      <AppText variant="title" style={{ textAlign: "center" }} accessibilityRole="header">
        {delivery ? t("Colis livré") : t("Course terminée")}
      </AppText>
      <AppText variant="display" style={{ textAlign: "center" }}>{formatFdj(ride.fare)}</AppText>
      <AppText color={colors.textSecondary} style={{ textAlign: "center" }}>
        {cash === "none" ? t("Payé par l'entreprise. Caval vous reverse ce montant.") : t("Encaissé en espèces. Vos gains sont mis à jour automatiquement.")}
      </AppText>
      <Button title={t("Retour à l'accueil")} onPress={onHome} style={{ marginTop: 12 }} />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingTop: 8 },
  pill: { paddingVertical: 10, paddingHorizontal: 18, borderRadius: radius.pill, backgroundColor: colors.emphasis, flexShrink: 1, marginRight: 8, ...shadow.float },
  navBtn: { height: 48, paddingHorizontal: 16, borderRadius: radius.pill, backgroundColor: colors.surface, flexDirection: "row", alignItems: "center", gap: 8, ...shadow.float },
  car: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.emphasis, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: colors.white },
  sheetWrap: { position: "absolute", left: 0, right: 0, bottom: 0, maxHeight: "72%" },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingHorizontal: spacing.xl, paddingTop: 10, ...shadow.sheet },
  handle: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.handle, marginBottom: 12 },
  person: { flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: radius.xl, borderWidth: 1.5, borderColor: colors.border },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  money: { flexDirection: "row", alignItems: "center", padding: 12, paddingHorizontal: 14, borderRadius: radius.md, backgroundColor: colors.surfaceRaised },
  photo: { width: "100%", height: 160, borderRadius: radius.lg },
}));
