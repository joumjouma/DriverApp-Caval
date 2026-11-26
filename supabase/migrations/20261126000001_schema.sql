-- Caval on Supabase — schema (tables, indexes, row-level security).
-- Replaces the Firestore collections listed next to each table.
--
-- Conventions
--   * Every user is an auth.users row. A person can be a customer, a driver,
--     or both (one row in each table, same id).
--   * Money is whole Djibouti francs (integer).
--   * "server" columns are written only by database functions / Edge
--     Functions (security definer or service role), never by the apps.
--     Column-level grants and the guard triggers enforce this.
--   * Times are timestamptz; "Djibouti day" = (time at time zone 'Africa/Djibouti')::date.

create extension if not exists postgis with schema extensions;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- ---------------------------------------------------------------- helpers
create table public.admins (
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create table public.app_config (                 -- appConfig/{customer,pricing,demo}
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
create policy app_config_read on app_config for select to authenticated using (true);
create policy app_config_admin on app_config for all to authenticated using (is_admin()) with check (is_admin());

create or replace function public.is_demo_tester() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select value->'testers' ? auth.uid()::text from app_config where key = 'demo'), false);
$$;

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

-- ---------------------------------------------------------------- customers
create table public.customers (                  -- Customers/{uid}
  id uuid primary key references auth.users on delete cascade,
  first_name text not null default '',
  last_name text,
  email text,
  phone text,
  photo_url text,
  push_token text,
  saved_places jsonb not null default '[]'::jsonb,
  favorite_driver_ids uuid[] not null default '{}',
  prefer_female_driver boolean not null default false,
  firebase_uid text unique,                       -- migration only
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger customers_touch before update on customers for each row execute function touch_updated_at();
alter table public.customers enable row level security;
create policy customers_own on customers for all to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy customers_admin_read on customers for select to authenticated using (is_admin());

-- ---------------------------------------------------------------- drivers
create table public.drivers (                    -- Drivers/{uid}
  id uuid primary key references auth.users on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  driver_type text not null default 'Caval Privé' check (driver_type in ('Caval Privé', 'Caval moto')),
  car_make text, car_model text, car_color text, plate text,
  city text, country text,
  photo_url text,
  gender text check (gender in ('female', 'male')),
  push_token text,
  demo boolean not null default false,
  -- status (driver)
  is_online boolean not null default false,
  is_available boolean not null default false,
  online_since timestamptz,
  current_ride_id uuid,
  -- admin / server
  approval_status text not null default 'pending' check (approval_status in ('pending', 'approved', 'rejected')),
  approved_at timestamptz,
  approved_by uuid,
  documents_verified boolean not null default false,
  rating_avg numeric(3,2),
  rating_count integer not null default 0,
  firebase_uid text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger drivers_touch before update on drivers for each row execute function touch_updated_at();
create index drivers_online_idx on drivers (driver_type, demo) where is_online and is_available and approval_status = 'approved';
alter table public.drivers enable row level security;
-- Public card (name, photo, car, rating — no email or phone) is readable by any signed-in user.
create policy drivers_read on drivers for select to authenticated using (true);
create policy drivers_insert_self on drivers for insert to authenticated
  with check (id = auth.uid() and approval_status = 'pending' and not documents_verified
              and rating_count = 0 and (not demo or is_demo_tester()));
create policy drivers_update_self on drivers for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy drivers_admin on drivers for all to authenticated using (is_admin()) with check (is_admin());

-- Drivers may not change their approval, rating or demo flag themselves.
create or replace function public.drivers_guard() returns trigger language plpgsql as $$
begin
  if current_setting('role', true) = 'service_role' or is_admin() then return new; end if;
  if new.approval_status is distinct from old.approval_status or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by or new.documents_verified is distinct from old.documents_verified
     or new.rating_avg is distinct from old.rating_avg or new.rating_count is distinct from old.rating_count
     or new.firebase_uid is distinct from old.firebase_uid then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new.demo and not old.demo and not is_demo_tester() then
    raise exception 'demo mode is for testers only' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger drivers_guard before update on drivers for each row execute function drivers_guard();

create table public.driver_private (             -- Drivers/{uid}/private/profile
  driver_id uuid primary key references drivers on delete cascade,
  email text,
  phone text,                                     -- copied onto a ride when the driver accepts it
  registration_card_url text,                     -- carte grise
  payout jsonb,
  updated_at timestamptz not null default now()
);
alter table public.driver_private enable row level security;
create policy driver_private_own on driver_private for all to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());
create policy driver_private_admin on driver_private for select to authenticated using (is_admin());

-- Position: its own table so 10-second updates don't rewrite the driver row
-- or wake every subscriber of drivers.
create table public.driver_locations (
  driver_id uuid primary key references drivers on delete cascade,
  position extensions.geography(point, 4326) not null,
  heading real,
  updated_at timestamptz not null default now()
);
create index driver_locations_gist on driver_locations using gist (position);
alter table public.driver_locations enable row level security;
create policy driver_locations_own on driver_locations for all to authenticated using (driver_id = auth.uid()) with check (driver_id = auth.uid());
-- A customer sees their driver's car from acceptance to drop-off.
create policy driver_locations_customer on driver_locations for select to authenticated using (exists (
  select 1 from rides r where r.driver_id = driver_locations.driver_id and r.customer_id = auth.uid()
    and r.status in ('assigned', 'driver_arrived', 'picked_up')));
create policy driver_locations_admin on driver_locations for select to authenticated using (is_admin());

-- ---------------------------------------------------------------- businesses
create table public.businesses (                 -- businesses/{id}
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique,
  active boolean not null default true,
  billing_email text,
  created_at timestamptz not null default now()
);
create table public.business_members (           -- businesses.memberUids / adminUids
  business_id uuid references businesses on delete cascade,
  user_id uuid references auth.users on delete cascade,
  role text not null default 'member' check (role in ('member', 'admin')),
  joined_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
create policy businesses_member_read on businesses for select to authenticated
  using (is_admin() or exists (select 1 from business_members m where m.business_id = businesses.id and m.user_id = auth.uid()));
create policy businesses_admin on businesses for all to authenticated using (is_admin()) with check (is_admin());
create policy business_members_own on business_members for select to authenticated using (user_id = auth.uid() or is_admin());
create policy business_members_admin on business_members for all to authenticated using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------- rides
create table public.rides (                      -- rideRequests/{id} + SelectedDriver/{id}
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers on delete restrict,
  service_type text not null default 'ride' check (service_type in ('ride', 'delivery', 'hourly')),
  ride_type text not null default 'Caval Privé',
  status text not null default 'waiting' check (status in (
    'scheduled', 'waiting', 'driver_selected', 'assigned', 'driver_arrived', 'picked_up',
    'completed', 'declined', 'cancelled', 'cancelled_by_driver', 'no_drivers_available')),
  pickup_lat double precision not null, pickup_lng double precision not null, pickup_address text,
  destination_lat double precision, destination_lng double precision, destination_address text,
  stops jsonb not null default '[]'::jsonb check (jsonb_array_length(stops) <= 2),
  distance_km numeric(7,2),
  duration_min numeric(7,1),
  hours smallint check (hours between 1 and 12),
  scheduled_for timestamptz,
  pickup_note text check (char_length(pickup_note) <= 140),
  passenger jsonb,                                -- {name, phone} when booked for someone else
  package jsonb,                                  -- {size, description, recipientName, recipientPhone, note, payer}
  payment_method text not null default 'cash' check (payment_method in ('cash', 'business')),
  business_id uuid references businesses,
  promo_code text check (char_length(promo_code) <= 20),
  prefer_female_driver boolean not null default false,
  favorite_driver_ids uuid[] not null default '{}',
  demo boolean not null default false,
  -- price (server)
  client_fare integer,                            -- what the app showed
  fare integer,                                   -- what the customer pays
  fare_before_discount integer,
  discount integer not null default 0,
  promo_applied jsonb,                            -- {code, amount, rejected?}
  credit_used integer not null default 0,
  billed_distance_km numeric(7,2),
  intercity boolean not null default false,
  business_name text,
  -- dispatch (server)
  selected_driver_id uuid references drivers,
  offer_expires_at timestamptz,
  declined_driver_ids uuid[] not null default '{}',
  reassignment_attempts integer not null default 0,
  -- driver
  driver_id uuid references drivers,
  driver_name text, driver_photo text, driver_phone text,
  pickup_photo_url text,
  pickup_pin_verified boolean not null default false,
  delivery_verified boolean not null default false,
  -- times
  created_at timestamptz not null default now(),
  accepted_at timestamptz, arrived_at timestamptz, picked_up_at timestamptz,
  completed_at timestamptz, cancelled_at timestamptz,
  cancelled_by text check (cancelled_by in ('customer', 'driver', 'admin', 'system')),
  cancellation_reason text,
  -- bookkeeping (server)
  retry_of uuid references rides,
  earnings_recorded_at timestamptz,
  points_awarded_at timestamptz,
  discount_refunded_at timestamptz,
  firebase_id text unique,
  updated_at timestamptz not null default now(),
  check (service_type = 'hourly' or destination_lat is not null),
  check (service_type <> 'delivery' or package is not null),
  check (status <> 'scheduled' or scheduled_for is not null)
);
create trigger rides_touch before update on rides for each row execute function touch_updated_at();
create index rides_customer_idx on rides (customer_id, created_at desc);
create index rides_driver_idx on rides (driver_id, created_at desc) where driver_id is not null;
create index rides_offer_idx on rides (selected_driver_id) where status = 'driver_selected';
create index rides_open_idx on rides (status, created_at) where status in ('waiting', 'driver_selected', 'scheduled');
alter table public.rides enable row level security;

create policy rides_customer_read on rides for select to authenticated using (customer_id = auth.uid());
create policy rides_driver_read on rides for select to authenticated
  using (driver_id = auth.uid() or selected_driver_id = auth.uid());
create policy rides_admin on rides for all to authenticated using (is_admin()) with check (is_admin());
create policy rides_customer_insert on rides for insert to authenticated with check (
  customer_id = auth.uid()
  and status in ('waiting', 'scheduled')
  and driver_id is null and selected_driver_id is null
  and (not demo or is_demo_tester())
  and (status <> 'scheduled' or scheduled_for between now() + interval '20 minutes' and now() + interval '7 days')
  and (payment_method <> 'business' or business_id is not null)
);
-- Updates go through functions (accept_ride, driver_arrived, cancel_ride, …),
-- so the apps get no direct UPDATE on rides.

-- Who to call: copied from the customer profile when the ride is created
-- (rideRequestsDriver). Readable by the offered / assigned driver.
create table public.ride_contacts (
  ride_id uuid primary key references rides on delete cascade,
  first_name text, phone text, photo_url text,
  booked_by text                                   -- customer name when the passenger is someone else
);
alter table public.ride_contacts enable row level security;
create policy ride_contacts_read on ride_contacts for select to authenticated using (exists (
  select 1 from rides r where r.id = ride_id
    and (r.customer_id = auth.uid() or r.driver_id = auth.uid() or r.selected_driver_id = auth.uid() or is_admin())));

-- Pickup PIN and delivery code: the customer reads them, nobody else.
create table public.ride_secrets (               -- rideRequests/{id}/private/*
  ride_id uuid primary key references rides on delete cascade,
  pickup_pin text,
  delivery_code text,
  pin_attempts smallint not null default 0,
  code_attempts smallint not null default 0,
  code_sent_at timestamptz
);
alter table public.ride_secrets enable row level security;
create policy ride_secrets_customer on ride_secrets for select to authenticated
  using (exists (select 1 from rides r where r.id = ride_id and r.customer_id = auth.uid()));

-- ---------------------------------------------------------------- money
create table public.earnings (                   -- moneyByRider + Earnings
  ride_id uuid primary key references rides on delete cascade,
  driver_id uuid not null references drivers on delete cascade,
  amount integer not null,
  day date not null,                              -- Djibouti date
  demo boolean not null default false,
  created_at timestamptz not null default now()
);
create index earnings_driver_day_idx on earnings (driver_id, day);
alter table public.earnings enable row level security;
create policy earnings_own on earnings for select to authenticated using (driver_id = auth.uid() or is_admin());

create view public.driver_daily_earnings with (security_invoker = true) as
  select driver_id, day, sum(amount)::integer as total, count(*)::integer as trips
  from earnings group by driver_id, day;

create table public.customer_rewards (           -- customerRewards/{uid}
  customer_id uuid primary key references customers on delete cascade,
  points integer not null default 0,
  credit integer not null default 0,
  completed_rides integer not null default 0,
  referral_code text unique,                      -- referralCodes/{code}
  referred_by uuid references customers,
  updated_at timestamptz not null default now()
);
alter table public.customer_rewards enable row level security;
create policy customer_rewards_own on customer_rewards for select to authenticated using (customer_id = auth.uid() or is_admin());

create table public.promo_codes (                -- promoCodes/{CODE}
  code text primary key check (code ~ '^[A-Z0-9]{1,20}$'),
  active boolean not null default true,
  kind text not null check (kind in ('percent', 'amount')),
  value integer not null check (value > 0),
  max_discount integer,
  max_uses integer,
  used_count integer not null default 0,
  per_user smallint not null default 1,
  first_ride_only boolean not null default false,
  expires_at timestamptz,
  label text,
  created_at timestamptz not null default now()
);
create table public.promo_redemptions (          -- promoRedemptions/{code}_{uid}
  code text references promo_codes on delete cascade,
  customer_id uuid references customers on delete cascade,
  count smallint not null default 1,
  last_ride_id uuid references rides on delete set null,
  at timestamptz not null default now(),
  primary key (code, customer_id)
);
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
create policy promo_codes_admin on promo_codes for all to authenticated using (is_admin()) with check (is_admin());
create policy promo_redemptions_admin on promo_redemptions for select to authenticated using (is_admin());

-- ---------------------------------------------------------------- ratings
create table public.ratings (                    -- driverRatings/{rideId}_{uid}
  ride_id uuid primary key references rides on delete cascade,
  driver_id uuid not null references drivers on delete cascade,
  customer_id uuid not null references customers on delete cascade,
  stars smallint not null check (stars between 1 and 5),
  comment text check (char_length(comment) <= 500),
  tip integer not null default 0,
  created_at timestamptz not null default now()
);
create index ratings_driver_idx on ratings (driver_id);
alter table public.ratings enable row level security;
create policy ratings_read on ratings for select to authenticated using (customer_id = auth.uid() or driver_id = auth.uid() or is_admin());

-- ---------------------------------------------------------------- chat
create table public.conversations (              -- conversations/{driverId_customerId}
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers on delete cascade,
  driver_id uuid not null references drivers on delete cascade,
  last_message text,
  updated_at timestamptz not null default now(),
  unique (customer_id, driver_id)
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations on delete cascade,
  sender_id uuid not null references auth.users on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index messages_conv_idx on messages (conversation_id, created_at);
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
create policy conversations_member on conversations for select to authenticated using (auth.uid() in (customer_id, driver_id));
-- Only a driver and a customer who share a ride can start a conversation.
create policy conversations_start on conversations for insert to authenticated with check (
  auth.uid() in (customer_id, driver_id)
  and exists (select 1 from rides r where r.customer_id = conversations.customer_id and r.driver_id = conversations.driver_id));
create policy messages_member_read on messages for select to authenticated using (exists (
  select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.customer_id, c.driver_id)));
create policy messages_member_send on messages for insert to authenticated with check (
  sender_id = auth.uid() and exists (
    select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.customer_id, c.driver_id)));
create policy messages_mark_read on messages for update to authenticated using (exists (
  select 1 from conversations c where c.id = conversation_id and auth.uid() in (c.customer_id, c.driver_id)));

-- ---------------------------------------------------------------- support
create table public.support_tickets (            -- supportTickets/{id}
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  subject text not null check (char_length(subject) <= 120),
  ride_id uuid references rides on delete set null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  unread_by_user boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references support_tickets on delete cascade,
  author_id uuid references auth.users on delete set null,
  sender text not null check (sender in ('user', 'support')),
  body text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy tickets_own on support_tickets for select to authenticated using (user_id = auth.uid() or is_admin());
create policy tickets_open on support_tickets for insert to authenticated with check (user_id = auth.uid() and status = 'open');
create policy tickets_admin on support_tickets for update to authenticated using (is_admin());
create policy support_msgs_read on support_messages for select to authenticated using (
  is_admin() or exists (select 1 from support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
create policy support_msgs_user on support_messages for insert to authenticated with check (
  sender = 'user' and author_id = auth.uid()
  and exists (select 1 from support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
create policy support_msgs_team on support_messages for insert to authenticated with check (sender = 'support' and is_admin());

-- ---------------------------------------------------------------- share links, WhatsApp (server only)
create table public.share_links (                -- shareLinks/{token}
  token text primary key,
  ride_id uuid not null references rides on delete cascade,
  created_by uuid references auth.users on delete set null,
  purpose text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create table public.whatsapp_leads (             -- whatsappLeads
  id uuid primary key default gen_random_uuid(),
  phone text not null, kind text not null, name text, body text,
  lat double precision, lng double precision,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
create table public.whatsapp_log (               -- whatsappLog (dedupe of sent messages)
  key text primary key,
  ride_id uuid references rides on delete cascade,
  kind text not null,
  sent_at timestamptz not null default now()
);
create table public.whatsapp_bot_state (         -- whatsappBot/{phone}
  phone text primary key,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.share_links enable row level security;
alter table public.whatsapp_leads enable row level security;
alter table public.whatsapp_log enable row level security;
alter table public.whatsapp_bot_state enable row level security;
create policy whatsapp_leads_admin on whatsapp_leads for all to authenticated using (is_admin()) with check (is_admin());
-- share_links, whatsapp_log, whatsapp_bot_state: no policies = service role only.

-- ---------------------------------------------------------------- realtime
-- Apps subscribe to: their rides (status changes, offers), driver_locations of
-- the driver on their ride, messages, support messages.
alter publication supabase_realtime add table rides, driver_locations, messages, support_messages, drivers;
