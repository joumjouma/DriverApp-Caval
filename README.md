# Caval Driver (DriverApp-Caval)

Driver app for Caval (Expo SDK 53, React Native 0.79, React 19) **and the
backend for both apps**: Cloud Functions, Firestore rules, Storage rules and
the hosted admin dashboard for the Firebase project `eco-share-92ef1`. The
customer app is `Caval-Customer-Clean`.

- **Look:** same design system as the customer app (orange `#FF6F00`, Plus
  Jakarta Sans, light and dark themes). Tokens in `constants/theme.js`,
  building blocks in `components/ui/`.
- **Language of the UI:** French by default; English, Arabic (right-to-left)
  and Somali (draft) in Profil → Langue.

## Moving to Supabase

The backend is being moved to Supabase (project **Caval Official Database**, Paris).
Progress, and **all prices, commission, driver pay, cancellation fees and rewards
with the market research behind them**, are in [`supabase/README.md`](supabase/README.md).
Until the cutover, the live apps keep the Firebase prices in `functions/`.

## Layout

| Path | What |
|---|---|
| `App.js` | Fonts, theme/language, auth, demo mode, navigation |
| `screens/HomeScreen.js` | Full-screen map, today's earnings, Go button, ride offers |
| `components/OfferSheet.js` | "Nouvelle course" sheet with the 15-second countdown |
| `screens/RideScreen.js` | The ride: pickup, PIN, package photo, stops, hourly timer, delivery code, end |
| `screens/EarningsScreen.js` | Day / week / month earnings |
| `screens/ProfileScreen.js`, `PreferencesScreen.js`, `DemoScreen.js` | Profile, language and appearance, demo mode |
| `services/driverApi.js` | Every Firestore / Cloud Functions call the driver app makes |
| `hooks/useDriverLocation.js` | Position on the map and sent to Firestore while online |
| `context/` | Theme + language, auth, demo mode |
| `utils/i18n/` | `t()` and translations (en, ar, so; aa empty) |
| `functions/` | Cloud Functions — pricing, ride assignment, earnings, WhatsApp, packages, PIN, … |
| `firestore.rules`, `storage.rules` | Security rules for both apps |
| `firestore-tests/` | Emulator tests for the Firestore rules |
| `public/` | Admin dashboard (`/admin`) and live tracking page (`track.html`) |
| `types/firestore.d.ts` | Shared data model (same file in the customer repo) |
| `docs/` | Feature specs (`PACKAGES.md`, `CUSTOMER_FEATURES.md`, `WAVE3.md`) and older notes |

## Who does what

- **Server only** (Cloud Functions): ride price, choosing and reassigning
  drivers (`selectBestDriverForNewRideRequest`, `declineRide`), driver
  earnings (`moneyByRider`, `Earnings`), delivery codes (`confirmDelivery`),
  pickup PINs (`verifyPickupPin`), WhatsApp.
- **Driver app**: go online, accept a ride offer, move a ride through
  `assigned → driver_arrived → picked_up → completed`. Packages are
  completed by `confirmDelivery` with the recipient's code, never by the app.
- **Admins**: approve drivers and change feature switches / prices in the
  dashboard (`/admin`) or the Firebase Console.

The driver app follows the customer feature switches in `appConfig/customer`
where it matters: it asks for the pickup PIN only when `pickupPinEnabled` is
on (that's when customers see it).

## Languages

French is the source language and the default. `t("Vous êtes en ligne")`
returns the chosen language's text. To add a string: wrap it in `t()`, add it
to `en.js`, `ar.js` and `so.js` in `utils/i18n/`, and run
`node scripts/check-i18n.js` (CI fails if a French text has no translation).
Never call `t()` at module level: keep constants in French and call
`t(value)` where they are shown. The privacy policy text stays French only.

## Demo mode (test both apps together)

1. In Firestore, create `appConfig/demo` with a field `testers` (array of
   user IDs): the driver account and the customer account you test with.
   Each app shows its user ID in Mode démo.
2. In each app: Profil → tap the version number 5 times → **Mode démo** → on.
   A "MODE DÉMO" tab shows at the top of the screen.
3. Go online in the driver app, then book a ride or a package in the
   customer app.

What changes in demo mode: both phones act as if they were in Djibouti
(Plateau du Serpent); every customer feature switch is on; rides carry
`demo: true` and only go to drivers whose profile has `demo: true`
(`sameWorld` in `functions/index.js`), and real rides never go to demo
drivers. Demo rides earn no loyalty points and are left out of business
statements. The Firestore rules only let listed testers create demo rides or
put a driver profile in demo mode.

## Develop

```bash
yarn install
npx expo start
yarn typecheck
node scripts/check-i18n.js
cd firestore-tests && npm install && npm test   # needs Java 11+
```

## Deploy (from this repo only)

```bash
firebase functions:secrets:set ULTRAMSG_TOKEN    # once
firebase deploy --only storage,firestore:rules,firestore:indexes,functions,hosting
eas build --platform ios --profile production --auto-submit
```

Deploy the server (functions + rules) **before** releasing app builds that
depend on it.
