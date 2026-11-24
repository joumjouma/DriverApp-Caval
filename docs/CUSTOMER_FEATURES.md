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
