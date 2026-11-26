# Caval Driver (DriverApp-Caval)

Driver app for Caval (Expo SDK 53, React Native 0.79, React 19) **and the
backend for both apps**. The customer app is `Caval-Customer-Clean`.

> **Branch `claude/supabase-app`:** this app runs on **Supabase** (project
> *Caval Official Database*, Paris). The backend (database, prices, dispatch,
> notifications, WhatsApp) is in `supabase/`, explained in
> [`supabase/README.md`](supabase/README.md). `main` still runs on Firebase
> until switch-over day; the Firebase code (`functions/`, `firestore.rules`) stays
> until then.

- **Look:** same design system as the customer app (orange `#FF6F00`, Plus
  Jakarta Sans, light and dark themes). Tokens in `constants/theme.js`,
  building blocks in `components/ui/`.
- **Language of the UI:** French by default; English, Arabic (right-to-left)
  and Somali (draft) in Profil → Langue.

## Layout

| Path | What |
|---|---|
| `App.js` | Fonts, theme/language, auth, demo mode, navigation |
| `config/supabase.js` | The Supabase client (URL + publishable key from `app.json` → `extra`) |
| `screens/HomeScreen.js` | Full-screen map, today's earnings, Go button, ride offers |
| `components/OfferSheet.js` | "Nouvelle course" sheet with the 15-second countdown |
| `screens/RideScreen.js` | The ride: pickup, PIN, package photo, stops, hourly timer, delivery code, end |
| `screens/EarningsScreen.js` | Day / week / month earnings, balance with Caval |
| `screens/PaymentScreen.js` | Paiements: balance owed either way, commission, payout methods (Waafi, D-Money…) |
| `screens/ProfileScreen.js`, `ModifyInfo.js`, `PreferencesScreen.js`, `DemoScreen.js` | Profile, my info, language and appearance, demo mode |
| `screens/DriverInboxScreen.js` | Chat with the customer |
| `services/driverApi.js` | Every database call the driver app makes; converts rows to the shape screens use |
| `services/registration.js` | Sign-up: login, photo, carte grise, driver profile |
| `services/NotificationService.js` | Push token, Android channel `rides`, opening the right screen on tap |
| `hooks/useDriverLocation.js` | Position on the map, sent to `driver_locations` while online |
| `context/` | Theme + language, auth, demo mode |
| `utils/i18n/` | `t()` and translations (en, ar, so; aa empty) |
| `supabase/` | **Backend:** migrations, Edge Function (WhatsApp webhook), database tests |
| `scripts/migrate-auth`, `scripts/migrate-data` | Switch-over day: copy logins (passwords kept) and data from Firebase |
| `public/` | Admin dashboard (`/admin`), tracking page (`/t/…`), password reset page (`/reset`) |
| `functions/`, `firestore.rules`, `storage.rules` | Old Firebase backend, still live until switch-over |

## Who does what

- **Server only** (Postgres functions in `supabase/migrations`): ride price,
  choosing and reassigning drivers (`dispatch_ride`, `expire_offers`), driver
  earnings and commission, delivery codes (`confirm_delivery`), pickup PINs
  (`verify_pickup_pin`), notifications and WhatsApp.
- **Driver app:** go online, accept an offer, move a ride through
  `assigned → driver_arrived → picked_up → completed` with RPCs (`accept_ride`,
  `driver_arrived`, `start_ride`, `complete_ride`). Packages are completed by
  `confirm_delivery` with the recipient's code, never by the app. The app can't
  edit a ride directly.
- **Admins:** approve drivers, settle balances and change prices in the
  dashboard (`/admin`) or the Supabase table editor (`app_config`).

Files: photos in the `avatars` bucket (public), carte grise in
`driver-documents` (the driver and admins only), package photos in
`package-photos` (the ride's customer, driver and admins only).

The driver app follows the customer feature switches in `app_config` →
`customer` where it matters: it asks for the pickup PIN only when
`pickupPinEnabled` is on (that's when customers see it).

**Changing the plate or vehicle type** keeps the driver approved but marks the
documents for checking again (`documents_verified = false`).

## Languages

French is the source language and the default. `t("Vous êtes en ligne")`
returns the chosen language's text. To add a string: wrap it in `t()`, add it
to `en.js`, `ar.js` and `so.js` in `utils/i18n/`, and run
`node scripts/check-i18n.js` (CI fails if a French text has no translation).
Never call `t()` at module level: keep constants in French and call
`t(value)` where they are shown. The privacy policy text stays French only.

## Demo mode (test both apps together)

1. In Supabase, table `app_config`, row `demo`: add the user IDs of the driver
   and customer accounts you test with to `testers`. Each app shows its user ID
   in Mode démo. (Your two accounts are already in it.)
2. In each app: Profil → tap the version number 5 times → **Mode démo** → on.
   A "MODE DÉMO" tab shows at the top of the screen.
3. Go online in the driver app, then book a ride or a package in the
   customer app.

What changes in demo mode:
- Both phones act as if they were in Djibouti (Plateau du Serpent).
- Every customer feature switch is on.
- Rides carry `demo: true` and only go to drivers whose profile has
  `demo: true`, and real rides never go to demo drivers (`dispatch_ride`).
- Demo rides earn no loyalty points and never charge a cancellation fee. They're
  left out of balances, business statements and reports.
- Only listed testers can create demo rides or put a driver profile in demo
  mode (`is_demo_tester()`).

## Develop

```bash
npm install
npx expo start
node scripts/check-i18n.js
```

Database tests: paste `supabase/tests/*.sql` into the Supabase SQL editor (each
runs in a transaction that undoes itself and prints its results).

## Build

```bash
eas build --platform ios --profile production --auto-submit
```

Database changes go in `supabase/migrations/` (newest last) and are applied to
the project **before** releasing app builds that depend on them.
