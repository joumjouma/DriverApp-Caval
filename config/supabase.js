// Supabase (project "Caval Official Database", Paris), shared with the customer app.
// The URL and publishable key come from app.json → extra; both are meant to be public:
// what each user may read or change is enforced by row-level security in the database.
import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import Constants from "expo-constants";
import { createClient } from "@supabase/supabase-js";

const extra = Constants.expoConfig?.extra || {};

export const supabase = createClient(extra.supabaseUrl, extra.supabaseKey, {
  auth: { storage: AsyncStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

// Refresh the session only while the app is in the foreground (Supabase's advice for React Native).
AppState.addEventListener("change", (state) => {
  if (state === "active") supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

// Signed-in user id, kept in sync for code outside React (services, background task).
let currentId = null;
supabase.auth.getSession().then(({ data }) => { currentId = data.session?.user?.id || null; });
supabase.auth.onAuthStateChange((_e, session) => { currentId = session?.user?.id || null; });
export const me = () => currentId;

/** Error from a Supabase call → thrown Error with the server message (and code). */
export function check({ data, error }) {
  if (error) {
    const e = new Error(error.message || "Erreur serveur");
    e.code = error.code;
    e.details = error.details;
    throw e;
  }
  return data;
}

/** Make a local file (image picker uri) uploadable. */
export async function fileBody(uri) {
  const res = await fetch(uri);
  return await res.arrayBuffer();
}
