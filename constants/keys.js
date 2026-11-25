// Public client keys. EXPO_PUBLIC_* variables are inlined at build time
// (set them as EAS environment variables to rotate without a code change).
// The fallback is the key the app already shipped with. Restrict it to the
// app's bundle IDs in Google Cloud Console.
export const GOOGLE_MAPS_KEY =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY || 'AIzaSyBnVN-ACYzcA0Sy8BcPLpXG50Y9T8jhJGE';
