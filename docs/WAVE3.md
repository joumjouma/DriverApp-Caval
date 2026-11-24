# Wave 3 — tracking page, WhatsApp bot, businesses, support, admin dashboard

Branch `claude/wave3-backend` (on top of `claude/wave2-backend`). Not deployed.

## Deploy

```bash
firebase functions:secrets:set WHATSAPP_WEBHOOK_KEY   # any long random string
firebase deploy --only firestore:rules,firestore:indexes,storage,functions,hosting
cd functions && node scripts/set-admin.js you@example.com   # once per admin
```

Then:
- **Dashboard:** https://eco-share-92ef1.web.app/admin (email + password of an
  account that has the admin claim; sign out/in after `set-admin.js`).
- **UltraMsg webhook:** in the UltraMsg dashboard, set the webhook URL to the
  `whatsappWebhook` function URL with `?key=<WHATSAPP_WEBHOOK_KEY>` and enable
  "message received". The bot answers on the UltraMsg number.
- The Google API key must allow the web domain (`eco-share-92ef1.web.app`) if
  it is restricted to the apps; otherwise the dashboard can't sign in.

## Live tracking links — `/t/{token}`
- `createShareLink({ rideId })` (customer) → `{ url }`, valid 24 h.
- Package recipients get a link in the delivery WhatsApp automatically.
- `track?t=…` (public JSON) returns status, driver first name, car, plate,
  live position while the ride is active, pickup/destination. Nothing else
  (no phone numbers, no customer name except the package recipient's first
  name on their own link). Follows retries and scheduled dispatch.
- Page: `public/track.html` (OpenStreetMap, refreshes every 10 s, dark mode).

## WhatsApp bot — `whatsappWebhook`
Menu: 1 Commander · 2 Suivre ma course · 3 Prix · 4 Parler à quelqu'un.
- A shared **location** creates a `whatsappLeads` entry (type `ride`) for the
  team to call back. It does not create a ride: the sender has no account.
- "2" looks up the customer by phone (`Customers.number`) and replies with the
  current ride.
- Anything else is logged for the team; the menu is sent at most once an hour.
- Leads are handled in the dashboard (WhatsApp tab).

## Business accounts
- Created in the dashboard (name, billing email) → invite code `ENT…`.
- Customers join with `joinBusiness({ code })` (also stored on
  `Customers/{uid}.businesses`), leave with `leaveBusiness`.
- A ride with `paymentMethod: "business"` + `businessId` is checked by
  `checkBusinessRide`; non-members fall back to cash. No promo/credit on
  business rides.
- Monthly statement (CSV) in the dashboard (`adminMonthlyReport`).

**Driver app:** when `paymentMethod === "business"`, show "Payé par
{businessName} — ne pas encaisser". **Owner process:** invoice the business
monthly and pay the driver for those rides.

## Support chat
`supportTickets/{id}` (`uid`, `subject`, `status` open/answered/closed) and
`messages` (`text`, `from` user/support, `authorUid`, `at`). The team answers
in the dashboard; a reply pushes a notification to the customer
(`onSupportMessage`).

## Admin dashboard — `public/admin/index.html`
Courses en cours (cancel) · Chauffeurs en attente (valider / refuser) ·
Support · WhatsApp · Codes promo · Entreprises (+ relevé CSV) · Réglages
(feature switches `appConfig/customer` and prices `appConfig/pricing`).
Access = custom claim `admin: true` (rules: `isAdmin()`).
