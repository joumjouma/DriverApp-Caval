# Move logins from Firebase to Supabase (passwords kept)

Everyone keeps their email and password, and phone accounts keep their number. Run
this on your PC; the password data never leaves it. Tested on 2026-11-26 with a test
account: Supabase accepted the Firebase password format and refused a wrong password.

**When:** right before the switch-over (cutover), so accounts made in the meantime are
included. You can run it any time before as a rehearsal: re-running skips users
already copied. Passwords changed in Firebase after a run aren't updated, so do a
final run at the switch-over.

## Steps (PowerShell, in this folder)

1. `npm install`
2. Export the users (you're already logged in to the Firebase CLI):
   `firebase auth:export users.json --format=json --project eco-share-92ef1`
3. Copy `.env.example` to `.env` and fill it in:
   - Supabase → Project Settings → API Keys → **service_role** key (secret: never paste it in chat or commit it)
   - Firebase Console → Authentication → Users → ⋮ → **Password hash parameters**:
     copy `base64_signer_key`, `base64_salt_separator`, `rounds`, `mem_cost`
4. `node migrate-users.js --check`: counts only, changes nothing
5. `node migrate-users.js --only taha.habib.bendahmane@gmail.com`: just you. Then
   tell Claude; it will check your account and test your login from the database.
6. `node migrate-users.js --all`

Afterwards, delete `users.json` (it contains password hashes).

## Notes

- New Supabase ids come from the Firebase uid (UUID v5, `ids.js`), so the data
  migration links every ride and profile to the right person without a lookup table.
  The Firebase uid is also kept in `user_metadata.firebase_uid`.
- **Phone accounts** (15 today) log in with an SMS code. For that, Supabase needs an
  SMS provider (Twilio, MessageBird, Vonage or Textlocal), set under Authentication →
  Providers → Phone. Pick one before the switch-over.
