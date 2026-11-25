# Customer app features that the driver app should show

A running list of what the customer app now writes on a ride and what the
driver app should do with it. Packages have their own doc: `PACKAGES.md`.

## Landmark for the pickup: `pickupNote`

`rideRequests/{id}.pickupNote` (string ≤ 140, may be missing or null), e.g.
"portail bleu, en face de la pharmacie". Addresses in Djibouti are
informal, so this saves a call.

**Driver app:** show it under the pickup address on the offer and on the
"going to pickup" screen, with a flag icon.

## Ride booked for someone else: `passenger`

`rideRequests/{id}.passenger = { name, phone }` (phone as +253…), or null.

Nothing is required in the driver app: the contact card
(`rideRequestsDriver`) already carries the **passenger's** name and number,
so "Appeler" calls the passenger. The card also has `bookedBy` (the
customer's first name).

**Nice to have:** a small "Réservé par {bookedBy}" line on the ride screen.

## Partner links

Hotels and shops can show a QR code that opens the customer app with the
pickup or destination filled in: `caval://commander?plat=…&plng=…&pnom=…`
(pickup) or `dlat`/`dlng`/`dnom` (destination). Nothing to do in the driver
app.

---

# Wave 2 (backend on `claude/wave2-backend`, not deployed)

## Multiple stops: `stops`
`stops: [{ latitude, longitude, address }]`, at most 2, in order, between pickup
and destination. The fare covers the whole route.

**Driver app:** show the stops in order on the offer and the ride screen, and
navigate pickup → stop 1 → stop 2 → destination. A "Arrêt suivant" button is
enough (no extra status).

## Pickup PIN
Every ride gets a 4-digit PIN (`rideRequests/{id}/private/pickup`, readable
by the customer only). The customer shows it to the driver.

**Driver app:** before setting `picked_up`, ask for the PIN and call
`verifyPickupPin({ rideId, pin })` → `{ ok: true }` or
`{ ok: false, attemptsLeft }` (error `resource-exhausted` after 5). It isn't
enforced by the rules yet, so older driver builds keep working; once every
driver has the update we can require `pickupPinVerified` for `picked_up`.

## Scheduled rides
The customer books with `status: "scheduled"` and `scheduledFor`. 15 minutes
before, `dispatchScheduledRides` creates a normal ride (`status: "waiting"`,
`scheduledRideId`, `scheduledFor`) and offers it like any other.

**Driver app:** nothing required. Nice to have: a "Programmée pour 7:30"
label when `scheduledFor` is set.

## Hourly hire: `serviceType: "hourly"`
`hours` (1–12), `rideType` (car or moto), pickup = destination. Price =
hours × hourly rate. The driver stays with the customer for that time.

**Driver app:** show "Mise à disposition · {hours} h" instead of a
destination, and a timer from pickup. Completing works as for a ride.
The customer option is hidden until `appConfig/customer.hourlyEnabled`.

## Women-preferred drivers
Customers can tick "Conductrice si possible" (`preferFemaleDriver: true`).
Matching gives female drivers a strong bonus; it's a preference, not a filter.

**Driver app:** add `gender: "female" | "male"` to the driver profile
(registration and settings). The online summary copies it. The customer
option is hidden until `appConfig/customer.femaleDriversEnabled`.

## Favourite drivers
Customers can mark a driver as favourite after a ride. Rides carry
`favoriteDriverIds`; a favourite within 3 km gets a bonus. Nothing to do in
the driver app.

## Packages: recipient pays
`package.payer` can now be `"recipient"`.

**Driver app:** when `payer === "recipient"`, collect `fare` at drop-off
(before or with the delivery code), and show "Encaisser auprès du
destinataire".

## Discounts (promo codes, credit, loyalty, referral)
The server may lower `fare` and sets `fareBeforeDiscount`, `discount`,
`promo`, `creditUsed`. **The driver collects `fare` (after discount)** in cash.

**Owner decision:** who pays for the discount? If Caval does, driver
earnings should use `fareBeforeDiscount` and Caval owes the driver the
difference. Today the earnings function uses `fare`.

## Intercity
Trips of 25 km or more use the intercity rate and get `intercity: true`.
Nice to have: an "Interurbain" label in the driver app.

## Prices in the Console
`appConfig/pricing` overrides the defaults in `functions/index.js`
(`DEFAULT_PRICING`): `fares`, `deliverySurcharge`, `intercity`, `hourly`,
`rewards`. Changes apply within a minute, no deploy needed. Keep the
customer app's estimates in mind: it reads the same doc.
