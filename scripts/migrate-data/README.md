# Copy the Caval data from Firebase to Supabase

Run **after** `scripts/migrate-auth` (only people with a Supabase login are copied).
Runs on your PC: the data goes straight from Firebase to Supabase.

| From Firebase | To Supabase | Notes |
|---|---|---|
| Customers | customers | photo copied to the `avatars` bucket |
| Drivers + private/profile | drivers, driver_private | photo → `avatars`, carte grise → `driver-documents`; everyone starts offline |
| rideRequests | rides, ride_contacts | default: **completed, non-demo rides only** |
| completed rides | earnings | commission 0, cash kept by the driver, so the balance is 0 (already settled) |
| driverRatings | ratings | driver averages recalculated |
| completed rides | customer_rewards | ride count and points; credit starts at 0 |

**Not copied:**
- Old offers (SelectedDriver, DriverSelection, OnlineDriver), push-token logs, metrics, `test`.
- Old chats: they were per-ride and are no longer needed.
- Demo rides, and rides still searching or abandoned.

New ids are computed from the Firebase ids (`ids.js`, the same file as in migrate-auth),
so re-running never duplicates anything.

## Steps (PowerShell, in this folder)

1. `npm install`
2. Firebase Console → ⚙ Project settings → Service accounts → **Generate new private key**.
   Save it here as `serviceAccount.json`. It's a secret: never paste it in chat or commit it.
3. Copy `.env.example` to `.env` and paste the Supabase **service_role** key.
4. `node migrate-data.js --check`: counts only, changes nothing
5. `node migrate-data.js --run`
6. Delete `serviceAccount.json` afterwards (or revoke the key in the console).

Options:
- `--rides finished`: also copy cancelled and "no driver" rides
- `--rides none`: profiles and drivers only
- `--no-files`: don't copy photos

`report.json` lists what was skipped and why.
