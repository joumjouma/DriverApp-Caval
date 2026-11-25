# Packages (Colis): what the driver app needs to do

Customers can now send a package instead of booking a ride. A package is a
normal `rideRequests` document with `serviceType: "delivery"`, so it goes
through the same offer → accept → arrive → pick up → complete flow the driver
app already handles. This document lists the few things that are different.

The customer app hides the package option behind a switch
(`appConfig/customer.packagesEnabled`, set in the Firebase Console). Leave it
off until this driver work and the backend (branch `claude/packages-backend`)
are both live.

---

## 1. The ride document

Same fields as a ride, plus:

```js
serviceType: "delivery",            // rides have no serviceType, or "ride"
package: {
  size: "petit" | "moyen" | "grand",
  description: "Clés et documents",  // up to 200 chars, may be empty
  recipientName: "Amina",
  recipientPhone: "+25377123456",
  note: "Sonner au 2e étage",        // for the driver, up to 200 chars, may be empty
  payer: "sender",                   // only "sender" for now
}
// Set by the server, read-only for the driver app:
deliveryVerified: true, deliveredAt, deliveryCodeAttempts
```

`rideType` is still set (`"Caval moto"` or `"Caval Privé"`) and matching
still uses `driverType`:

| Size | Offered to |
|---|---|
| `petit`, `moyen` | Moto drivers first; car drivers if no moto is available |
| `grand` | Car drivers only |

So a car driver can receive a small package. The app must not assume
"package = moto".

The type is in `types/firestore.d.ts` (`RideRequest.serviceType`, `RidePackage`).

## 2. What to show the driver

When `serviceType === "delivery"`:

- **Offer / incoming request:** a clear "📦 Colis" label and the size
  (Petit, Moyen, Grand), not "Course".
- **Going to pickup:** the pickup address is the **sender's** place. Show the
  sender's name (from `rideRequestsDriver`, same as rides) and `package.note`.
- **After pickup:** show the recipient's name and phone (`package.recipientName`,
  `package.recipientPhone`) with Call / WhatsApp buttons. The destination is the
  recipient's address.
- **Payment:** the **sender pays in cash at pickup**. Show "Encaisser
  {fare} Fdj à la récupération" at the pickup step, not at the end.

## 3. Pickup: photo of the package

At pickup, before setting the ride to `picked_up`:

1. Take a photo of the package (camera, quality ~0.5).
2. Upload it to Storage at `deliveries/{rideId}/pickup.jpg`. Only the assigned
   driver may upload there; the sender can view it.
3. Write the download URL on the ride: `pickupPhotoUrl`.
4. Then set `status: "picked_up"` as for a ride.

Make the photo required, with a "Réessayer" option if the upload fails. It
protects the driver if the sender later says the package was damaged.

## 4. Drop-off: delivery code (the important change)

When a delivery is created, the server generates a 4-digit code and sends it
to the **recipient** on WhatsApp. The driver app **cannot read the code** and
**cannot set a delivery to `completed`** (Firestore rules block it).

At drop-off:

1. Ask the recipient for the code. Show a 4-digit input and a
   "Confirmer la livraison" button.
2. Call the callable:

   ```js
   import { getFunctions, httpsCallable } from "firebase/functions";
   const confirmDelivery = httpsCallable(getFunctions(), "confirmDelivery");
   const { data } = await confirmDelivery({ rideId, code: "1234" });
   ```

3. Handle the result:

   | Result | Meaning | Show |
   |---|---|---|
   | `{ delivered: true }` | Code correct. The server set `status: "completed"`. | The normal end-of-ride screen. Then do the usual driver updates (`isAvailable: true`, `rideInProgress: false`, …), **but don't write `status` yourself**. |
   | `{ delivered: false, attemptsLeft: n }` | Wrong code | "Code incorrect, il reste n essais" |
   | error `resource-exhausted` | 5 wrong codes | "Trop d'essais. Contactez le support Caval." |
   | error `failed-precondition` | Package not picked up yet | Should not happen if the flow is followed |

If the recipient didn't get the code, the **sender** can see it in their app
and pass it on. The driver should never be told the code by support either:
the code is the proof of delivery.

The existing `clearRideState` in `RideInProgressScreen` sets `status: "completed"`.
For deliveries, replace that write with the `confirmDelivery` call; otherwise
the write is rejected by the rules.

## 5. Checklist

- [ ] "Colis" label + size on offers and on the ride screen
- [ ] Sender name + note at pickup; recipient name + phone after pickup
- [ ] "Encaisser à la récupération" for deliveries
- [ ] Required pickup photo → `deliveries/{rideId}/pickup.jpg` → `pickupPhotoUrl`
- [ ] Code entry at drop-off → `confirmDelivery`; no direct `status: "completed"` write
- [ ] Error messages for wrong code / too many attempts
- [ ] Tested with a moto driver and a car driver, and a "grand" package

## Backend pieces (branch `claude/packages-backend`, not deployed)

- Pricing: `DELIVERY_SIZES` in `functions/index.js`. **Placeholder prices**
  (moto rate; +100 Fdj for moyen; car rate +200 Fdj for grand); the owner sets
  the real ones. Keep `constants/delivery.js` in the customer app in sync.
- Matching: moto first, then car (`driverTypesFor`, `pickEligibleByType`).
- `onDeliveryCreated`: makes the code, stores it in
  `rideRequests/{id}/private/delivery`, WhatsApps it to the recipient. A retried
  delivery (`retryRide`) keeps the same code.
- `confirmDelivery`: checks the driver and the code, max 5 attempts.
- Rules: package validation on create; drivers can't edit `package` /
  `serviceType` or complete a delivery; the code is readable by the sender only;
  `appConfig` is readable by signed-in users. Tests in `firestore-tests/`.
- Storage: `deliveries/{rideId}/{file}`.

Still for the owner: the list of forbidden items, who is liable for lost or
damaged packages, and the real prices.
