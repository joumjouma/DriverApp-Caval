// Driver position: shown on the map and sent to driver_locations while online,
// so the server can pick the closest driver and customers can follow the car.
// In demo mode the phone pretends to be in Djibouti (DEMO_CENTER).
import { useEffect, useRef, useState } from "react";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { reportPosition } from "../services/driverApi";
import { isDemo, demoPosition, DEMO_CENTER } from "../context/DemoContext";
import { t } from "../utils/i18n/index";
import { ensurePermission } from "../components/Dialog";

// One explanation at a time, even if several screens ask together
let asking = null;
function askLocation() {
  asking = asking || ensurePermission({
    get: Location.getForegroundPermissionsAsync, request: Location.requestForegroundPermissionsAsync, icon: "location-outline",
    title: t("Votre position"),
    message: t("Caval utilise votre position pour vous proposer les courses proches et guider le client jusqu'à vous pendant que vous êtes en ligne."),
    settingsHint: t("Activez la localisation dans les réglages pour passer en ligne."),
  }).finally(() => { asking = null; });
  return asking;
}

const TASK = "background-location-task";
const SEND_EVERY_MS = 10000;

// Background updates (app in the background during a ride or while online)
if (!TaskManager.isTaskDefined(TASK)) {
  TaskManager.defineTask(TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length || isDemo()) return;
    const { latitude, longitude } = data.locations[0].coords;
    await reportPosition({ latitude, longitude });
  });
}

async function startBackground() {
  try {
    if (!(await Location.isBackgroundLocationAvailableAsync())) return;
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) return;
    const ok = await ensurePermission({
      get: Location.getBackgroundPermissionsAsync, request: Location.requestBackgroundPermissionsAsync, icon: "navigate-outline",
      title: t("Position en arrière-plan"),
      message: t("Choisissez « Toujours » pour continuer à recevoir des courses quand l'écran est éteint ou que vous utilisez le GPS."),
    });
    if (!ok) return;
    await Location.startLocationUpdatesAsync(TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 15000,
      distanceInterval: 20,
      showsBackgroundLocationIndicator: true,
      foregroundService: { notificationTitle: t("Caval chauffeur"), notificationBody: t("Votre position est partagée pendant que vous êtes en ligne.") },
    });
  } catch (e) { /* background location is optional */ }
}

export async function stopBackground() {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK)) await Location.stopLocationUpdatesAsync(TASK);
  } catch (e) { /* ignore */ }
}

/** Current position once (demo-aware). null if location is refused. */
export async function currentPosition() {
  if (isDemo()) return demoPosition(150);
  try {
    if (!(await askLocation())) return null;
    // Last known position first (instant); a fresh fix can take long indoors, so give up after 8 s
    const last = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60000 }).catch(() => null);
    if (last) return { latitude: last.coords.latitude, longitude: last.coords.longitude, heading: last.coords.heading };
    const p = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((resolve) => setTimeout(() => resolve(null), 8000)),
    ]);
    if (!p) return null;
    return { latitude: p.coords.latitude, longitude: p.coords.longitude, heading: p.coords.heading };
  } catch (e) {
    return null;
  }
}

/**
 * Watches the position. `share` = also send it to the server (driver_locations; online or in a ride).
 * Returns { position, denied }.
 */
export default function useDriverLocation({ share, demo }) {
  const [position, setPosition] = useState(null);
  const [denied, setDenied] = useState(false);
  const lastSent = useRef(0);

  useEffect(() => {
    let sub = null;
    let timer = null;
    let cancelled = false;

    const handle = (p) => {
      if (cancelled) return;
      setPosition(p);
      if (share && Date.now() - lastSent.current > SEND_EVERY_MS) {
        lastSent.current = Date.now();
        reportPosition(p);
      }
    };

    (async () => {
      if (demo) {
        // Fixed point in Djibouti, with a little movement so the map looks alive
        const base = demoPosition(150);
        handle(base);
        timer = setInterval(() => handle({
          latitude: base.latitude + (Math.random() - 0.5) * 0.0004,
          longitude: base.longitude + (Math.random() - 0.5) * 0.0004,
        }), SEND_EVERY_MS);
        await stopBackground();
        return;
      }
      if (!(await askLocation())) { setDenied(true); return; }
      setDenied(false);
      const first = await Location.getLastKnownPositionAsync().catch(() => null);
      if (first) handle({ latitude: first.coords.latitude, longitude: first.coords.longitude });
      sub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 15 },
        (p) => handle({ latitude: p.coords.latitude, longitude: p.coords.longitude, heading: p.coords.heading }),
      ).catch(() => null);
      if (share) startBackground(); else stopBackground();
    })();

    return () => { cancelled = true; sub?.remove?.(); if (timer) clearInterval(timer); };
  }, [share, demo]);

  return { position: position || (demo ? DEMO_CENTER : null), denied };
}
