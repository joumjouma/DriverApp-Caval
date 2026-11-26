# Caval on Supabase

Project: **Caval Official Database** (`ysuoieejgophdyrcotnv`), region `eu-west-3` (Paris),
organization **Caval**.

`migrations/` is the database, in order. Applied so far:

| File | What |
|---|---|
| `20261126000001_schema.sql` | Tables, indexes, row-level security, realtime |
| `20261126000002_hardening.sql` | Advisor fixes: search_path, function grants, per-query `auth.uid()`, foreign-key indexes |
| `20261126000003_rides.sql` | Pricing, ride creation, dispatch, every driver/customer step, earnings, commission, cancellation fees, rewards, cron jobs |
| `20261126000004_rides_search_path.sql` | Linter fix |
| `20261126000005_commission_waiver.sql` | 90-day commission-free period for each new driver |
| `20261126000006_notifications.sql` | Push notifications, WhatsApp, share links, rewards/promo/business, delete account, admin report, auto-offline |
| `20261126000007_drivers_guard_fix.sql` | Fix: the driver-row guard was also blocking server functions (rating, approvals) |
| `20261126000008_whatsapp_bot.sql` | WhatsApp bot replies |
| `20261126000009_storage_and_import.sql` | Storage buckets and their access rules; `import_rows` for the data copy |
| `20261126000010_refresh_driver_ratings.sql` | Recomputes driver ratings after the data copy |
| `20261126000011_driver_app.sql` | Driver app: earnings in realtime, account deletion (`delete_driver_account`) |
| `20261126000012_vehicle_recheck.sql` | A new plate or vehicle type sends the driver back to document check |
| `20261126000013_driver_push_token_private.sql` | Driver push tokens moved out of the public driver card |
| `20261126000014_customer_app.sql` | Customer app: driver position during the ride, support read receipts, realtime, feature switches on |
| `20261126000015_admin.sql` | Admin dashboard: settlements, driver review list, support inbox, overview numbers |
| `20261126000016_demo_simple.sql` | Demo mode: shared demo logins, robot drivers and robot customer |

Edge Function: `functions/whatsapp-webhook` (deployed). Tests: `tests/`.

Logins: `scripts/migrate-auth/` copies Firebase users with their passwords (format tested).

Both apps (branch `claude/supabase-app`) and the admin dashboard (`public/admin`) run on
this project. Still to do on switch-over day: copy users and data from Firebase
(`scripts/migrate-auth`, `scripts/migrate-data`), then merge the app branches.

The apps call ride actions with `supabase.rpc(...)`: `accept_ride`, `decline_ride`,
`driver_arrived`, `verify_pickup_pin`, `start_ride`, `complete_ride`, `confirm_delivery`,
`driver_cancel_ride`, `customer_cancel_ride`, `retry_ride`, `rate_driver`, and
`my_rewards`, `redeem_referral`, `check_promo`, `send_receipt`, `create_share_link`,
`join_business`, `leave_business`, `delete_my_account`, `admin_monthly_report` (admins).
Each checks who is calling. The apps cannot update rides directly.
Admin-only: `admin_overview`, `admin_drivers`, `admin_set_driver_status`, `admin_settle_driver`,
`admin_cancel_ride`, `admin_tickets`. `track_ride(token)`
is public, for the tracking page.

---

## Admins and the dashboard

The dashboard is `public/admin/index.html`, served at `https://eco-share-92ef1.web.app/admin`
(Firebase Hosting, `firebase deploy --only hosting`). Admins sign in with their normal
Caval email and password. An account is an admin when it has a row in `admins`:

```sql
insert into admins (user_id) select id from auth.users where email = 'someone@example.com';
```

| Tab | What |
|---|---|
| Aperçu | Today's rides, revenue, commission, rides with no driver; what needs attention now |
| Courses | Live rides (cancel one), today, no-driver and cancelled rides of the last 7 days |
| Chauffeurs | Review list (new sign-ups, and approved drivers who changed plate or vehicle type), carte grise photo, approve / refuse / suspend |
| Soldes | Each driver's balance; record a payment either way (cash, Waafi, D-Money, CAC Pay, Saba Pay) |
| Support | Tickets from customers and drivers; replies send a push |
| WhatsApp | Messages the bot passed on; mark handled |
| Codes promo, Entreprises | Create codes and companies; monthly CSV statement per company |
| Réglages | Customer app switches, `pricing` and `dispatch` JSON |

**Weekly settlement.** Drivers keep the cash. Each ride adds `earned − cash` to their
balance, so a cash ride makes it go down by the commission, and a promo or business ride
makes it go up. Negative: the driver owes Caval. Positive: Caval owes the driver. Once a
week, collect or pay the amount, then press *Régler* in Soldes: that adds a row to
`settlements` (positive = driver paid Caval, negative = Caval paid the driver) and the
balance moves back to 0. Drivers see the same balance in the app (Paiement). They can't
delete their account while it isn't 0.

## Notifications and WhatsApp

Sent straight from the database (pg_net): nothing to deploy, and a failed send never
blocks a ride.

| When | Who | How |
|---|---|---|
| Ride offered | Driver | Push "Nouvelle course" (+ WhatsApp if `messaging.whatsappDriverOffers` is on; off by default) |
| Driver found / arrived / package picked up / done / no drivers / driver cancelled | Customer | Push |
| Delivery booked | Recipient | WhatsApp with the delivery code and a tracking link |
| Customer taps "receipt" | Customer | WhatsApp receipt (`send_receipt`) |
| Driver approved | Driver | Push |
| Support replies | Customer or driver | Push |
| Chat message | The other person | Push |
| WhatsApp message to the Caval number | Sender | Bot: 1 order (location → lead), 2 track, 3 prices, 4 support |

Each WhatsApp message is sent once (`whatsapp_log`), so retries never spam anyone.
Settings are in `app_config.messaging`: UltraMsg instance, tracking page address, app link.

**To switch WhatsApp on** (whoever has UltraMsg access, once):
1. Supabase → SQL editor:
   `select vault.create_secret('<new UltraMsg token>', 'ultramsg_token');`
   Until then, WhatsApp is skipped and everything else works.
2. Supabase → Edge Functions → Secrets: add `WHATSAPP_WEBHOOK_KEY` = any long random text.
3. UltraMsg → Webhook URL:
   `https://ysuoieejgophdyrcotnv.supabase.co/functions/v1/whatsapp-webhook?key=<that same text>`
   Without the key, the function refuses every call.

**Tracking page** (`public/track.html`, `/t/<token>`): it asks Supabase first and
falls back to the old Firebase function, so links work before and after the switch.
It is still hosted on Firebase Hosting; it can move to caval.tech later (it is one
static file).

**Auto-offline:** every 5 minutes, drivers whose phone sent no position for 10 minutes
go offline (never during a ride).

**Deleting an account** (customers): rides stay for the driver's records and the
accounts. They are moved to a "Compte supprimé" placeholder, and names, phone numbers
and notes are removed. The profile, rewards, chats, ratings and tickets are deleted
with the login. The app deletes the profile photo through Storage first.

---

## Pricing and driver pay

Every number below is stored in `app_config` (keys `pricing` and `dispatch`). Change
it there and it applies to the next ride, with no code change or app update. The
same values are the built-in defaults in `pricing()` / `dispatch_settings()`.

### What the market looks like (Nov 2026)

| | Figure | Source |
|---|---|---|
| Street taxi, flag fall | 500 Fdj | combien-coute.net (Numbeo), gobytaxi.com |
| Street taxi, short trip in town | 500–1,000 Fdj, negotiated, no meter | Culture Trip; cyriljarnias.com |
| Airport → city (≈7 km) | 1,000–1,500 Fdj (up to 1,800, more at night) | appsavvytraveller.com; welcomepickups.com |
| Minibus in town | 100–200 Fdj | cyriljarnias.com |
| Petrol | ≈283–309 Fdj/L | AfroFuel (Mar 2026); combien-coute.net (Jul 2026) |
| Minimum wage | 35,000 Fdj/month (one source says 100,000) | WageIndicator; africarrieres.com |
| Average salary | ≈120,000–150,000 Fdj/month | wage.is; wagecentre.com |
| Local apps | Sahaal Ride (launched 2024; cash or mobile money), X Drive (private chauffeurs), RIDE (mainly Addis) | WeAreTech Africa; App Store |
| Commissions elsewhere in Africa | Uber 25%, Bolt 20–21%, Didi 13%, inDrive ≈9.5%, Yango 15–20% | TechCrunch; BusinessDay; Kolonell |
| Launch offers | Bolt and inDrive have waived commission for the first 6–12 months in new countries | TechCrunch; TechCabal |
| Who pays for promos | The platform: the driver is paid as if the customer paid full price | Uber UK driver statement; Pulse Kenya |
| Cancellation | Free for the first ~2 min after a driver accepts; driver waits 5 min before a no-show; fee goes to the driver | Bolt rider and driver help pages |

Taxis have no meters and prices are negotiated, so Caval's case is a **fixed price
shown before the ride, at or slightly under street-taxi prices**.

### Fares (`pricing.fares`)

| | Base (includes 3 km) | Each extra km | 3 km | 7 km (airport) | 10 km |
|---|---|---|---|---|---|
| **Caval Privé** (car) | 500 | 130 | 500 | 1,000 | 1,400 |
| **Caval moto** | 250 | 80 | 250 | 550 | 800 |

Before: car 400 + 150/km, moto 150 + 150/km.

- **Car base 500** is the street flag fall, so a short trip costs the same as a taxi.
- **130/km** puts the airport run at 1,000, the bottom of the 1,000–1,500 taxi range.
  It beats taxis on price without leaving money on the table.
- **Fuel** is ≈25 Fdj/km for a car (8 L/100 km × ≈300 Fdj/L), so a driver keeps well
  over 100 Fdj per paid km.
- **Moto is about half the car price.** The old moto rate (150/km) cost the same per
  km as a car, which made no sense for a bike that burns a third of the fuel.
- Prices round to the nearest 50 Fdj.

**Intercity** (trips of 25 km or more, `pricing.intercity`): car 1,000 + 110/km over
the whole trip; moto 500 + 70/km. For example, 40 km by car costs 5,400. The higher
base pays for the empty drive back. *I could not find published taxi prices for
Arta, Ali Sabieh or Tadjourah, so check these against what drivers actually charge.*

**Deliveries** (`pricing.deliverySurcharge`): the moto fare (car for large parcels)
plus petit 0, moyen 100, grand 300. Before, grand was 200. A large parcel needs a car,
so 5 km costs 1,050 against 400 for a small one.

**Hourly hire** (`pricing.hourly`): car 3,000/h, moto 1,500/h, 8 h maximum.
Unchanged; this matches the 3,000 Fdj/h waiting rate gobytaxi lists.

### Commission (`pricing.commission`)

**12% of the trip price** (`percent`), with a **launch waiver: each driver pays 0% for
their first 90 days after approval** (`newDriverFreeDays`).

- 12% sits between inDrive (≈9.5%) and Didi (13%), and well under Bolt (20%) and
  Uber (25%). Driver unions in Nigeria are pushing to cut 20% to 10%. Being the cheaper
  app for drivers is how you win them, and a new app needs drivers first.
- The waiver copies how Bolt and inDrive enter new countries (no commission for the
  first months). Counting from each driver's approval means it needs no launch date:
  drivers approved at launch get ~3 months free, and later recruits get the same
  welcome. Set `newDriverFreeDays` to 0 to end it.
- `waivedUntil` (a date) turns commission off for **everyone** until then, for a
  promotion week, for example. It is not set.
- Commission is decided when the ride is completed and stored on the earnings row,
  so a later change never rewrites past rides.

### Promos and Caval credit: Caval pays

The driver is paid on the **full price**; the discount is Caval's marketing cost.
This is how Uber and Bolt do it. Before, the driver's earnings were the fare
*after* discount, which made every promo come out of the driver's pocket.

### Cash, and what drivers owe

Most rides are cash. Each ride writes one row to `earnings`:

| Column | Meaning |
|---|---|
| `gross` | Trip price before any discount |
| `platform_discount` | Promo + credit, paid by Caval |
| `commission` | `gross × percent` |
| `amount` | What the driver earned: `gross − commission` |
| `cash_collected` | Cash the driver took from the customer (0 for business invoices) |
| `balance` | `amount − cash_collected`. Positive: Caval owes the driver. Negative: the driver owes Caval |

Example, a 1,000 Fdj cash ride with a 300 Fdj promo: the customer pays 700. The
driver earns 880 (1,000 − 120) and has 700 in hand. Balance +180: Caval owes the driver 180.

Example, a normal 1,000 Fdj cash ride: the driver earns 880 and has 1,000 in hand.
Balance −120: the driver owes Caval its commission.

- The view `driver_balances` gives each driver's running total.
- The plan is to settle weekly, by mobile money (Waafi / D-Money) or at the office.
- The driver app's earnings screen should show both what the driver earned and
  their balance.

### Cancellation fees (`pricing.cancellation`)

| | Car | Moto |
|---|---|---|
| Customer cancels more than **2 min** after a driver accepted | 200 | 100 |
| Driver cancels as *no-show* after waiting **5 min** at pickup | 200 | 100 |

Earlier cancellations are free, and searching for a driver can always be cancelled.
The fee goes to the driver (less commission), the same as on Bolt.

Because the ride never happened, the customer pays it in cash with **their next
ride**: it is added to the next fare as `previous_fee` and shown on the price. That
driver collects it, and it counts against their balance, so the driver who waited is
the one paid. 200 Fdj is about the cost of the trip to the pickup point, and about
one minibus fare. It is enough to discourage no-shows without scaring off new
customers. Demo and business rides are never charged.

### Loyalty and referrals (`pricing.rewards`)

Unchanged:
- Every completed ride earns 1 point.
- Every **10 rides** earns **500 Fdj** of credit, about 5–6% back at the new fares (an
  average ride is ≈800–1,000 Fdj).
- A **referral** gives **500 Fdj** to both people after the new customer's first
  completed ride.
- Credit pays for future rides; Caval funds it, as with promos.

### Dispatch (`dispatch`)

| Setting | Value | Before | Why |
|---|---|---|---|
| `offerSeconds` | 15 | 15 | Time a driver has to accept, in line with other apps |
| `maxKm` | 10 | 20 | Djibouti city is ≈10 km across. A driver 20 km away is a 30+ minute wait, so it's better to try the next driver |
| `locationFreshMinutes` | 3 | 3 | Ignore drivers whose GPS went quiet |
| `maxOffers` | 10 | 10 | After 10 declines or timeouts: "no drivers available" |

### What the apps must change when they switch

- **Driver app:**
  - Earnings screen: show `amount`, `cash_collected` and `balance` (from `driver_daily_earnings` / `driver_balances`).
  - Cancel sheet: send reason `no_show`.
- **Customer app:**
  - Use the new fare table from `app_config.pricing`.
  - Show `previous_fee` on the price.
  - Warn before a cancel that will cost a fee (after 2 min).
