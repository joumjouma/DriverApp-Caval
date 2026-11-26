# Database tests

`ride_flow.sql`: one transaction that creates a test customer and two drivers,
runs five scenarios, prints the results as an error, and rolls everything back,
so nothing is left behind. Paste it into the Supabase SQL editor or run it with
`psql`. Each line shows the actual values next to the expected ones.

1. Ride with a 300 Fdj promo. The customer pays 700; the driver is paid on 1,000
   less 12%, so the balance is +180.
2. Late cancel on a driver approved less than 90 days ago: a 200 fee, 0% commission
   (waiver), and 200 owed by the customer.
3. The next ride carries the fee: the customer pays 1,200, the driver collects it,
   and the balance is −320.
4. Dispatch: nearest driver first, then the next one after a decline, then "no drivers" after a timeout.
5. Access rules: a customer can't edit a fare or finish a ride; a driver can't see
   another driver's earnings, PINs, or someone else's ride.

`notifications.sql` — same idea for messages: approval push, delivery WhatsApp
(code + link), offer push, customer pushes, public tracking (anon), referral, promo
check, support and chat pushes, receipt sent once, rating, account deletion,
auto-offline, WhatsApp bot. Messages are queued then discarded with the rollback,
so nobody gets a real text.

Last run, 2026-11-26: all pass. (Found and fixed one bug: drivers_guard blocked rate_driver.)
