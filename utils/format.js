// Display helpers shared by the driver screens.
import { Linking } from "react-native";
import { t } from "./i18n/index";

/** 12450 → "12 450 Fdj" */
export const formatFdj = (n) => `${String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} Fdj`;

/** First two parts of a Google address */
export const shortAddress = (a) => (a || "").split(",").slice(0, 2).join(",").trim() || t("Point sur la carte");

/** 12.34 → "12,3 km" (French decimal comma) */
export const formatKm = (km) => (km == null || isNaN(km) ? "" : `${(Math.round(km * 10) / 10).toString().replace(".", ",")} km`);

/** Minutes → "14 min" or "1 h 05" */
export function formatMinutes(min) {
  const m = Math.max(0, Math.round(Number(min) || 0));
  if (m < 60) return t("{n} min", { n: m });
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** Seconds online → "2 h 15" / "12 min" */
export const formatDuration = (sec) => formatMinutes((Number(sec) || 0) / 60);

/** Timestamp ({toDate}) / Date / ISO → "07:30" */
export function formatTime(v) {
  const d = v?.toDate ? v.toDate() : v ? new Date(v) : null;
  if (!d || isNaN(d)) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Straight-line distance in km */
export function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const dLat = ((b.latitude - a.latitude) * Math.PI) / 180;
  const dLng = ((b.longitude - a.longitude) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.latitude * Math.PI) / 180) * Math.cos((b.latitude * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** Rough city driving time: 25 km/h, at least 1 min */
export const etaMinutes = (km) => (km == null ? null : Math.max(1, Math.round((km / 25) * 60)));

export const call = (phone) => phone && Linking.openURL(`tel:${phone}`);
export const whatsapp = (phone) => phone && Linking.openURL(`https://wa.me/${String(phone).replace(/[^\d]/g, "")}`);

/** Opens Google Maps (or Apple Maps) with turn-by-turn directions */
export function navigateTo(lat, lng) {
  if (lat == null || lng == null) return;
  Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`).catch(() =>
    Linking.openURL(`http://maps.apple.com/?daddr=${lat},${lng}`));
}

/** Package size label */
export const PACKAGE_SIZES = { petit: "Petit", moyen: "Moyen", grand: "Grand" };
