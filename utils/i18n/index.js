// Translations. French is the source language: t("Où allez-vous ?") returns
// the string in the current language, or the French text if there's no
// translation yet. The language is set by ThemeProvider (Préférences) and
// the navigator remounts when it changes, so screens re-render.
import { I18nManager } from "react-native";
import en from "./en";
import ar from "./ar";
import so from "./so";
import aa from "./aa";

const DICTS = { en, ar, so, aa };

export const LANGUAGES = [
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
  { id: "ar", label: "العربية" },
  { id: "so", label: "Soomaali", draft: true },
  { id: "aa", label: "Qafar af", draft: true },
].filter((l) => l.id === "fr" || Object.keys(DICTS[l.id] || {}).length > 0);

let current = "fr";
export const getLanguage = () => current;
export function setLanguage(id) {
  current = LANGUAGES.some((l) => l.id === id) ? id : "fr";
}
/**
 * t("Bonjour {name}", { name }) → translated text with {placeholders} filled.
 * Missing translation → the French text (should not happen: see scripts/check-i18n.js).
 */
export function t(fr, vars) {
  if (!fr) return fr;
  let out = current === "fr" ? fr : DICTS[current]?.[fr] ?? fr;
  if (vars) for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k] ?? ""));
  return out;
}

/**
 * The layout is always left-to-right, in every language (Arabic text still
 * reads right-to-left inside each line). Flipping the whole layout only takes
 * effect after a restart and iOS remembers it, which left the app mirrored.
 * Undoes any flip saved by an older version or by an Arabic phone. Never asks
 * for a restart.
 */
export function applyDirection() {
  if (I18nManager.isRTL || I18nManager.getConstants?.().isRTL) I18nManager.forceRTL(false);
  I18nManager.allowRTL(false);
  return false;
}
applyDirection();

// Language code for Google Maps / Geocoding results (addresses).
// Somali/Afar aren't supported by Google, so they fall back to French (Djibouti's address language).
export function mapsLanguage() {
  return current === "en" ? "en" : current === "ar" ? "ar" : "fr";
}
