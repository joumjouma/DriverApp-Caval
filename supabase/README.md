# Caval on Supabase

Project: **Caval Official Database** (`ysuoieejgophdyrcotnv`), region `eu-west-3` (Paris),
organization **Caval**.

`migrations/` is the database, in order. Applied so far:

| File | What |
|---|---|
| `20261126000001_schema.sql` | Tables, indexes, row-level security, realtime |
| `20261126000002_hardening.sql` | Advisor fixes: search_path, function grants, per-query `auth.uid()`, foreign-key indexes |

Still to come: ride functions (accept, arrive, PIN, delivery code, finish, cancel),
dispatch (nearest driver, 15 s offers, reassignment), pricing, earnings, rewards and
promos, WhatsApp (Edge Functions), data migration from Firebase.
