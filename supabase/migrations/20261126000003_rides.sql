-- Rides: pricing, creation, dispatch, every step a driver or customer takes,
-- and what happens on completion / cancellation.
-- Same rules as the Firebase Cloud Functions (functions/index.js) they replace.
--
-- The apps call these with supabase.rpc('name', {...}). Every function checks
-- auth.uid(); the apps have no direct UPDATE on rides.

-- ---------------------------------------------------------------- money columns
-- How money moves (see supabase/README.md, "Pricing and driver pay"):
--   Customer pays `fare` (trip price − promo − credit + any unpaid cancellation fee).
--   Driver earns trip price − commission. Promos and credit are paid by Caval.
--   Most rides are cash, so the driver holds the cash: balance = earned − cash
--   (positive: Caval owes the driver; negative: the driver owes Caval).
alter table public.earnings
  add column kind text not null default 'ride' check (kind in ('ride', 'cancellation_fee')),
  add column gross integer not null default 0,              -- trip price before any discount
  add column platform_discount integer not null default 0,  -- promo + credit, paid by Caval
  add column commission integer not null default 0,
  add column cash_collected integer not null default 0,     -- cash the driver took from the customer
  add column balance integer not null default 0;            -- amount − cash_collected
comment on column public.earnings.amount is 'What the driver earned: gross − commission';

alter table public.rides
  add column cancellation_fee integer not null default 0,   -- charged on this ride being cancelled late
  add column previous_fee integer not null default 0;       -- unpaid fee from an earlier ride, added to this fare

alter table public.customer_rewards
  add column fee_due integer not null default 0;            -- late-cancel fees not paid yet

create or replace view public.driver_daily_earnings with (security_invoker = true) as
  select driver_id, day, sum(amount)::integer as total, count(*) filter (where kind = 'ride')::integer as trips,
         sum(cash_collected)::integer as cash, sum(commission)::integer as commission, sum(balance)::integer as balance
  from earnings group by driver_id, day;

-- What each driver owes Caval or is owed, all time (settled weekly by the team).
create view public.driver_balances with (security_invoker = true) as
  select driver_id, sum(balance)::integer as balance, sum(amount)::integer as earned, sum(commission)::integer as commission
  from earnings where not demo group by driver_id;

-- ---------------------------------------------------------------- settings
-- Defaults, overridable from app_config: 'pricing' and 'dispatch'.
-- Numbers and the reasons for them: supabase/README.md.
create or replace function public.pricing() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fares', '{"Caval Privé":{"base":500,"includedKm":3,"perKm":130},"Caval moto":{"base":250,"includedKm":3,"perKm":80}}'::jsonb
             || coalesce(c.value->'fares', '{}'),
    'deliverySurcharge', '{"petit":0,"moyen":100,"grand":300}'::jsonb || coalesce(c.value->'deliverySurcharge', '{}'),
    'intercity', '{"minKm":25,"Caval Privé":{"base":1000,"perKm":110},"Caval moto":{"base":500,"perKm":70}}'::jsonb
                 || coalesce(c.value->'intercity', '{}'),
    'hourly', '{"Caval Privé":{"perHour":3000},"Caval moto":{"perHour":1500},"maxHours":8}'::jsonb || coalesce(c.value->'hourly', '{}'),
    'rewards', '{"ridesPerReward":10,"rewardCredit":500,"referralCredit":500}'::jsonb || coalesce(c.value->'rewards', '{}'),
    'commission', '{"percent":12,"waivedUntil":null}'::jsonb || coalesce(c.value->'commission', '{}'),
    'cancellation', '{"freeMinutes":2,"noShowWaitMinutes":5,"Caval Privé":200,"Caval moto":100}'::jsonb
                    || coalesce(c.value->'cancellation', '{}'))
  from (select 1) one left join app_config c on c.key = 'pricing';
$$;

create or replace function public.dispatch_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select '{"offerSeconds":15,"maxKm":10,"locationFreshMinutes":3,"maxOffers":10}'::jsonb
         || coalesce((select value from app_config where key = 'dispatch'), '{}');
$$;

-- Commission % right now (0 while a launch waiver runs).
create or replace function public.commission_percent() returns numeric
language sql stable security definer set search_path = public as $$
  select case when (c->>'waivedUntil') is not null and (c->>'waivedUntil')::timestamptz > now() then 0
              else coalesce((c->>'percent')::numeric, 0) end
  from (select pricing()->'commission' c) x;
$$;

-- One earnings row per ride (a completed ride, or a paid late cancellation).
create or replace function public.record_earning(r rides, p_kind text, p_gross integer, p_discount integer, p_cash integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_comm integer := round(p_gross * commission_percent() / 100.0)::int;
begin
  insert into earnings (ride_id, driver_id, kind, gross, platform_discount, commission, amount, cash_collected, balance, day, demo)
  values (r.id, r.driver_id, p_kind, p_gross, p_discount, v_comm, p_gross - v_comm, p_cash,
          (p_gross - v_comm) - p_cash, (now() at time zone 'Africa/Djibouti')::date, r.demo)
  on conflict (ride_id) do nothing;
end $$;

create or replace function public.feature_on(flag text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>flag)::boolean from app_config where key = 'customer'), false);
$$;

-- Package size → driver types (in order of preference) and fare table.
create or replace function public.ride_driver_types(r rides) returns text[]
language sql immutable as $$
  select case
    when r.service_type = 'delivery' then
      case r.package->>'size' when 'grand' then array['Caval Privé'] else array['Caval moto', 'Caval Privé'] end
    else array[r.ride_type] end;
$$;

create or replace function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable set search_path = public, extensions as $$
  select extensions.st_distance(extensions.st_makepoint(lng1, lat1)::extensions.geography,
                                extensions.st_makepoint(lng2, lat2)::extensions.geography) / 1000.0;
$$;

-- ---------------------------------------------------------------- pricing
-- Same formula as the customer app. The app's route distance is trusted only
-- between the straight line and 2.5x it; otherwise straight line x1.3.
create or replace function public.compute_fare(r rides, out fare integer, out km numeric, out intercity boolean)
language plpgsql stable security definer set search_path = public as $$
declare
  p jsonb := pricing();
  tbl jsonb; ic jsonb; ic_rate jsonb;
  surcharge numeric := 0;
  straight double precision := 0;
  prev_lat double precision := r.pickup_lat; prev_lng double precision := r.pickup_lng;
  s jsonb; dist double precision; raw numeric;
begin
  intercity := false;
  if r.service_type = 'hourly' then
    if r.hours is null or r.hours < 1 or r.hours > coalesce((p->'hourly'->>'maxHours')::int, 8)
       or p->'hourly'->r.ride_type is null then
      raise exception 'invalid hourly booking' using errcode = '22023';
    end if;
    fare := round((p->'hourly'->r.ride_type->>'perHour')::numeric * r.hours / 50) * 50;
    km := 0;
    return;
  end if;

  if r.service_type = 'delivery' then
    if r.package->>'size' not in ('petit', 'moyen', 'grand') then
      raise exception 'invalid package size' using errcode = '22023';
    end if;
    tbl := p->'fares'->(case r.package->>'size' when 'grand' then 'Caval Privé' else 'Caval moto' end);
    ic_rate := p->'intercity'->(case r.package->>'size' when 'grand' then 'Caval Privé' else 'Caval moto' end);
    surcharge := coalesce((p->'deliverySurcharge'->>(r.package->>'size'))::numeric, 0);
  else
    tbl := p->'fares'->r.ride_type;
    ic_rate := p->'intercity'->r.ride_type;
  end if;
  if tbl is null then raise exception 'unknown ride type %', r.ride_type using errcode = '22023'; end if;

  for s in select * from jsonb_array_elements(r.stops) loop
    straight := straight + km_between(prev_lat, prev_lng, (s->>'latitude')::float8, (s->>'longitude')::float8);
    prev_lat := (s->>'latitude')::float8; prev_lng := (s->>'longitude')::float8;
  end loop;
  straight := straight + km_between(prev_lat, prev_lng, r.destination_lat, r.destination_lng);

  dist := r.distance_km;
  if dist is null or dist < straight or dist > greatest(straight * 2.5, straight + 2) then
    dist := straight * 1.3;
  end if;

  ic := p->'intercity';
  if ic_rate is not null and dist >= coalesce((ic->>'minKm')::numeric, 25) then
    raw := (ic_rate->>'base')::numeric + dist * (ic_rate->>'perKm')::numeric + surcharge;
    intercity := true;
  else
    raw := (tbl->>'base')::numeric + greatest(0, dist - (tbl->>'includedKm')::numeric) * (tbl->>'perKm')::numeric + surcharge;
  end if;
  fare := round(raw / 50) * 50;
  km := round(dist::numeric, 2);
end $$;

-- ---------------------------------------------------------------- creation
-- Before insert: validate, price, apply promo / credit, business check.
-- Whatever the app sent for server columns is overwritten here.
create or replace function public.rides_before_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f record; rw customer_rewards; promo promo_codes; v_used smallint;
  v_promo integer := 0; v_credit integer := 0; v_code text;
begin
  -- server columns: never from the app
  new.client_fare := new.fare;
  new.selected_driver_id := null; new.offer_expires_at := null; new.declined_driver_ids := '{}';
  new.reassignment_attempts := 0; new.driver_id := null; new.driver_name := null; new.driver_photo := null;
  new.driver_phone := null; new.pickup_photo_url := null; new.pickup_pin_verified := false;
  new.delivery_verified := false; new.accepted_at := null; new.arrived_at := null; new.picked_up_at := null;
  new.completed_at := null; new.cancelled_at := null; new.cancelled_by := null; new.earnings_recorded_at := null;
  new.points_awarded_at := null; new.discount_refunded_at := null; new.promo_applied := null;
  new.discount := 0; new.credit_used := 0; new.fare_before_discount := null; new.business_name := null;
  new.cancellation_fee := 0; new.previous_fee := 0;
  new.created_at := now();

  if new.service_type = 'delivery' then
    if coalesce(char_length(new.package->>'recipientName'), 0) not between 1 and 80
       or coalesce(char_length(regexp_replace(new.package->>'recipientPhone', '\D', '', 'g')), 0) < 8
       or coalesce(char_length(new.package->>'description'), 0) > 200
       or coalesce(char_length(new.package->>'note'), 0) > 200
       or coalesce(new.package->>'payer', 'sender') not in ('sender', 'recipient') then
      raise exception 'invalid package' using errcode = '22023';
    end if;
  end if;
  if new.service_type = 'hourly' then
    new.destination_lat := null; new.destination_lng := null; new.stops := '[]';
  end if;

  f := compute_fare(new);
  new.fare := f.fare; new.billed_distance_km := f.km; new.intercity := f.intercity;

  -- Business rides: member of an active business, invoiced at full price
  if new.payment_method = 'business' then
    select b.name into new.business_name from businesses b
      join business_members m on m.business_id = b.id and m.user_id = new.customer_id
      where b.id = new.business_id and b.active;
    if new.business_name is null then
      new.payment_method := 'cash'; new.business_id := null;
    end if;
    return new;
  end if;
  new.business_id := null;

  -- Promo code, then Caval credit
  insert into customer_rewards (customer_id) values (new.customer_id) on conflict do nothing;
  select * into rw from customer_rewards where customer_id = new.customer_id for update;
  v_code := upper(regexp_replace(coalesce(new.promo_code, ''), '[^A-Za-z0-9]', '', 'g'));
  new.promo_code := nullif(v_code, '');
  if v_code <> '' then
    select * into promo from promo_codes pc where pc.code = v_code for update;
    select r.count into v_used from promo_redemptions r where r.code = v_code and r.customer_id = new.customer_id;
    if promo.code is not null and promo.active and (promo.expires_at is null or promo.expires_at > now())
       and (promo.max_uses is null or promo.used_count < promo.max_uses)
       and coalesce(v_used, 0) < promo.per_user
       and (not promo.first_ride_only or rw.completed_rides = 0) then
      v_promo := case when promo.kind = 'percent' then (new.fare * promo.value / 100.0)::int else promo.value end;
      if promo.kind = 'percent' and promo.max_discount is not null then v_promo := least(v_promo, promo.max_discount); end if;
      v_promo := greatest(0, least(new.fare, (round(v_promo / 50.0) * 50)::int));
    end if;
    if v_promo > 0 then
      update promo_codes pc set used_count = pc.used_count + 1 where pc.code = v_code;
      insert into promo_redemptions as pr (code, customer_id, count) values (v_code, new.customer_id, 1)
        on conflict (code, customer_id) do update set count = pr.count + 1, at = now();
      new.promo_applied := jsonb_build_object('code', v_code, 'amount', v_promo);
    else
      new.promo_applied := jsonb_build_object('code', v_code, 'amount', 0, 'rejected', true);
    end if;
  end if;
  v_credit := greatest(0, least(new.fare - v_promo, (rw.credit / 50) * 50));
  if v_credit > 0 then
    update customer_rewards cr set credit = cr.credit - v_credit, updated_at = now() where cr.customer_id = new.customer_id;
  end if;
  if v_promo + v_credit > 0 then
    new.fare_before_discount := new.fare;
    new.discount := v_promo + v_credit;
    new.credit_used := v_credit;
    new.fare := new.fare - v_promo - v_credit;
  end if;
  -- An unpaid late-cancel fee is collected on the next ride
  if rw.fee_due > 0 and not new.demo then
    new.previous_fee := rw.fee_due;
    new.fare := new.fare + rw.fee_due;
    update customer_rewards cr set fee_due = 0, updated_at = now() where cr.customer_id = new.customer_id;
  end if;
  return new;
end $$;
create trigger rides_before_insert before insert on rides for each row execute function rides_before_insert();

-- After insert: contact card for the driver, PIN / delivery code, dispatch.
create or replace function public.rides_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  select * into c from customers where id = new.customer_id;
  insert into ride_contacts (ride_id, first_name, phone, photo_url, booked_by) values (
    new.id,
    coalesce(new.passenger->>'name', c.first_name),
    coalesce(new.passenger->>'phone', c.phone),
    case when new.passenger is null then c.photo_url end,
    case when new.passenger is not null then c.first_name end);
  insert into ride_secrets (ride_id, pickup_pin, delivery_code) values (
    new.id,
    case when new.service_type <> 'delivery' then lpad((floor(random() * 10000))::int::text, 4, '0') end,
    case when new.service_type = 'delivery' then lpad((floor(random() * 10000))::int::text, 4, '0') end);
  if new.status = 'waiting' then perform dispatch_ride(new.id); end if;
  return null;
end $$;
create trigger rides_after_insert after insert on rides for each row execute function rides_after_insert();

-- ---------------------------------------------------------------- dispatch
-- Offers the ride to the best available driver, or marks it
-- no_drivers_available. Best = allowed vehicle type (in order), then distance,
-- minus bonuses for a favourite driver nearby (−4 km) or a requested female
-- driver (−5 km), then rating.
create or replace function public.dispatch_ride(p_ride_id uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  r rides; cfg jsonb := dispatch_settings(); pick uuid; pickup geography; types text[];
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or r.status not in ('waiting', 'driver_selected') then return null; end if;
  if r.reassignment_attempts >= (cfg->>'maxOffers')::int then
    update rides set status = 'no_drivers_available', selected_driver_id = null, offer_expires_at = null where id = r.id;
    return null;
  end if;
  pickup := st_makepoint(r.pickup_lng, r.pickup_lat)::geography;
  types := ride_driver_types(r);

  select d.id into pick
  from drivers d
  join driver_locations l on l.driver_id = d.id
  where d.is_online and d.is_available and d.approval_status = 'approved'
    and d.current_ride_id is null
    and d.demo = r.demo
    and d.driver_type = any(types)
    and not d.id = any(r.declined_driver_ids)
    and l.updated_at > now() - make_interval(mins => (cfg->>'locationFreshMinutes')::int)
    and st_dwithin(l.position, pickup, (cfg->>'maxKm')::float8 * 1000)
    -- not already holding another offer
    and not exists (select 1 from rides o where o.status = 'driver_selected' and o.selected_driver_id = d.id and o.id <> r.id)
  order by array_position(types, d.driver_type),
           st_distance(l.position, pickup) / 1000.0
             - case when d.id = any(r.favorite_driver_ids) and st_dwithin(l.position, pickup, 3000) then 4 else 0 end
             - case when r.prefer_female_driver and d.gender = 'female' then 5 else 0 end,
           d.rating_avg desc nulls last
  limit 1
  for update of d skip locked;

  if pick is null then
    update rides set status = 'no_drivers_available', selected_driver_id = null, offer_expires_at = null where id = r.id;
    return null;
  end if;
  update rides set status = 'driver_selected', selected_driver_id = pick,
    offer_expires_at = now() + make_interval(secs => (cfg->>'offerSeconds')::int),
    reassignment_attempts = reassignment_attempts + 1
  where id = r.id;
  return pick;
end $$;

-- Offers that ran out: count as a decline and try the next driver.
create or replace function public.expire_offers() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id, selected_driver_id from rides
           where status = 'driver_selected' and offer_expires_at < now() - interval '2 seconds'
           for update skip locked loop
    update rides set status = 'waiting', declined_driver_ids = array_append(declined_driver_ids, r.selected_driver_id),
      selected_driver_id = null, offer_expires_at = null where id = r.id;
    perform dispatch_ride(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Scheduled rides: start looking for a driver 15 minutes before.
create or replace function public.dispatch_scheduled() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  for r in select id from rides where status = 'scheduled' and scheduled_for <= now() + interval '15 minutes'
           for update skip locked loop
    update rides set status = 'waiting' where id = r.id;
    perform dispatch_ride(r.id);
    n := n + 1;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------- driver steps
create or replace function public.my_ride_as_driver(p_ride_id uuid, allowed text[]) returns rides
language plpgsql security definer set search_path = public as $$
declare r rides;
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or r.driver_id is distinct from auth.uid() then
    raise exception 'not your ride' using errcode = '42501';
  end if;
  if not r.status = any(allowed) then
    raise exception 'ride is %', r.status using errcode = '55000';
  end if;
  return r;
end $$;

create or replace function public.accept_ride(p_ride_id uuid) returns rides
language plpgsql security definer set search_path = public as $$
declare r rides; d drivers; phone text;
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or r.status <> 'driver_selected' or r.selected_driver_id is distinct from auth.uid()
     or r.offer_expires_at < now() - interval '2 seconds' then
    raise exception 'ride no longer available' using errcode = '55000';
  end if;
  select * into d from drivers where id = auth.uid() for update;
  select dp.phone into phone from driver_private dp where dp.driver_id = d.id;
  update drivers set is_available = false, current_ride_id = r.id where id = d.id;
  update rides set status = 'assigned', driver_id = d.id, selected_driver_id = null, offer_expires_at = null,
    driver_name = trim(d.first_name || ' ' || d.last_name), driver_photo = d.photo_url, driver_phone = phone,
    accepted_at = now()
  where id = r.id returning * into r;
  return r;
end $$;

create or replace function public.decline_ride(p_ride_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rides;
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or r.status <> 'driver_selected' or r.selected_driver_id is distinct from auth.uid() then
    raise exception 'this ride is not offered to you' using errcode = '55000';
  end if;
  update rides set status = 'waiting', declined_driver_ids = array_append(declined_driver_ids, auth.uid()),
    selected_driver_id = null, offer_expires_at = null where id = r.id;
  perform dispatch_ride(r.id);
end $$;

create or replace function public.driver_arrived(p_ride_id uuid) returns rides
language plpgsql security definer set search_path = public as $$
declare r rides;
begin
  r := my_ride_as_driver(p_ride_id, array['assigned']);
  update rides set status = 'driver_arrived', arrived_at = now() where id = r.id returning * into r;
  return r;
end $$;

-- → {ok, attemptsLeft}. 5 tries, then the support team has to help.
create or replace function public.verify_pickup_pin(p_ride_id uuid, p_pin text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rides; s ride_secrets;
begin
  r := my_ride_as_driver(p_ride_id, array['assigned', 'driver_arrived']);
  select * into s from ride_secrets where ride_id = r.id for update;
  if s.pickup_pin is null then
    update rides set pickup_pin_verified = true where id = r.id;
    return jsonb_build_object('ok', true, 'noPin', true);
  end if;
  if s.pin_attempts >= 5 then raise exception 'too many attempts' using errcode = '54000'; end if;
  if s.pickup_pin = p_pin then
    update rides set pickup_pin_verified = true where id = r.id;
    return jsonb_build_object('ok', true);
  end if;
  update ride_secrets set pin_attempts = pin_attempts + 1 where ride_id = r.id;
  return jsonb_build_object('ok', false, 'attemptsLeft', 5 - s.pin_attempts - 1);
end $$;

-- Passenger on board / package picked up. Packages need the pickup photo;
-- rides need the PIN when pickup PINs are on (always in demo mode).
create or replace function public.start_ride(p_ride_id uuid, p_pickup_photo_url text default null) returns rides
language plpgsql security definer set search_path = public as $$
declare r rides;
begin
  r := my_ride_as_driver(p_ride_id, array['driver_arrived']);
  if r.service_type = 'delivery' then
    if coalesce(p_pickup_photo_url, r.pickup_photo_url) is null then
      raise exception 'package photo required' using errcode = '22023';
    end if;
  elsif (r.demo or feature_on('pickupPinEnabled')) and not r.pickup_pin_verified then
    raise exception 'pickup PIN required' using errcode = '22023';
  end if;
  update rides set status = 'picked_up', picked_up_at = now(),
    pickup_photo_url = coalesce(p_pickup_photo_url, pickup_photo_url)
  where id = r.id returning * into r;
  return r;
end $$;

-- Rides and hourly hire. Packages are completed by confirm_delivery.
create or replace function public.complete_ride(p_ride_id uuid) returns rides
language plpgsql security definer set search_path = public as $$
declare r rides;
begin
  r := my_ride_as_driver(p_ride_id, array['picked_up']);
  if r.service_type = 'delivery' then raise exception 'use confirm_delivery' using errcode = '22023'; end if;
  update rides set status = 'completed', completed_at = now() where id = r.id returning * into r;
  return r;
end $$;

-- → {delivered, attemptsLeft}
create or replace function public.confirm_delivery(p_ride_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rides; s ride_secrets;
begin
  r := my_ride_as_driver(p_ride_id, array['picked_up']);
  if r.service_type <> 'delivery' then raise exception 'not a delivery' using errcode = '22023'; end if;
  select * into s from ride_secrets where ride_id = r.id for update;
  if s.code_attempts >= 5 then raise exception 'too many attempts' using errcode = '54000'; end if;
  if s.delivery_code = p_code then
    update rides set status = 'completed', completed_at = now(), delivery_verified = true where id = r.id;
    return jsonb_build_object('delivered', true);
  end if;
  update ride_secrets set code_attempts = code_attempts + 1 where ride_id = r.id;
  return jsonb_build_object('delivered', false, 'attemptsLeft', 5 - s.code_attempts - 1);
end $$;

create or replace function public.driver_cancel_ride(p_ride_id uuid, p_reason text default 'other') returns rides
language plpgsql security definer set search_path = public as $$
declare r rides; fee integer := 0;
begin
  r := my_ride_as_driver(p_ride_id, array['assigned', 'driver_arrived']);
  -- Passenger didn't come after the driver waited long enough: late-cancel fee
  if p_reason = 'no_show' and r.status = 'driver_arrived' and r.service_type <> 'hourly'
     and r.arrived_at <= now() - make_interval(mins => (pricing()->'cancellation'->>'noShowWaitMinutes')::int) then
    fee := coalesce((pricing()->'cancellation'->>(ride_driver_types(r))[1])::int, 0);
  end if;
  update rides set status = 'cancelled_by_driver', cancelled_by = 'driver', cancelled_at = now(),
    cancellation_reason = left(p_reason, 60), cancellation_fee = fee
  where id = r.id returning * into r;
  return r;
end $$;

-- ---------------------------------------------------------------- customer steps
-- While searching → 'declined'; once a driver accepted → 'cancelled'.
create or replace function public.customer_cancel_ride(p_ride_id uuid, p_reason text default null) returns rides
language plpgsql security definer set search_path = public as $$
declare r rides; fee integer := 0;
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or r.customer_id is distinct from auth.uid() then raise exception 'not your ride' using errcode = '42501'; end if;
  if r.status in ('scheduled', 'waiting', 'driver_selected', 'no_drivers_available') then
    update rides set status = 'declined', cancelled_by = 'customer', cancelled_at = now(), cancellation_reason = left(p_reason, 60),
      selected_driver_id = null, offer_expires_at = null where id = r.id returning * into r;
  elsif r.status in ('assigned', 'driver_arrived') then
    -- Free for the first minutes after a driver accepted, then a small fee for the driver's trip
    if r.accepted_at <= now() - make_interval(mins => (pricing()->'cancellation'->>'freeMinutes')::int) then
      fee := coalesce((pricing()->'cancellation'->>(ride_driver_types(r))[1])::int, 0);
    end if;
    update rides set status = 'cancelled', cancelled_by = 'customer', cancelled_at = now(), cancellation_reason = left(p_reason, 60),
      cancellation_fee = fee
      where id = r.id returning * into r;
  else
    raise exception 'ride is %', r.status using errcode = '55000';
  end if;
  return r;
end $$;

-- Search again after "no drivers" or a driver cancel: a new ride with the same trip.
create or replace function public.retry_ride(p_ride_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r rides; new_id uuid;
begin
  select * into r from rides where id = p_ride_id;
  if r.id is null or r.customer_id is distinct from auth.uid() then raise exception 'not your ride' using errcode = '42501'; end if;
  if r.status not in ('no_drivers_available', 'cancelled_by_driver') or r.cancellation_reason = 'no_show' then raise exception 'ride is %', r.status using errcode = '55000'; end if;
  insert into rides (customer_id, service_type, ride_type, pickup_lat, pickup_lng, pickup_address,
    destination_lat, destination_lng, destination_address, stops, distance_km, duration_min, hours,
    pickup_note, passenger, package, payment_method, business_id, promo_code, prefer_female_driver,
    favorite_driver_ids, demo, fare, retry_of)
  values (r.customer_id, r.service_type, r.ride_type, r.pickup_lat, r.pickup_lng, r.pickup_address,
    r.destination_lat, r.destination_lng, r.destination_address, r.stops, r.distance_km, r.duration_min, r.hours,
    r.pickup_note, r.passenger, r.package, r.payment_method, r.business_id,
    (r.promo_applied->>'code'), r.prefer_female_driver, r.favorite_driver_ids, r.demo, r.client_fare, r.id)
  returning id into new_id;
  -- Same delivery code, so the recipient's WhatsApp code still works
  if r.service_type = 'delivery' then
    update ride_secrets set delivery_code = (select delivery_code from ride_secrets where ride_id = r.id) where ride_id = new_id;
  end if;
  return new_id;
end $$;

create or replace function public.rate_driver(p_ride_id uuid, p_stars smallint, p_comment text default null, p_tip integer default 0)
returns void language plpgsql security definer set search_path = public as $$
declare r rides;
begin
  select * into r from rides where id = p_ride_id;
  if r.id is null or r.customer_id is distinct from auth.uid() or r.status <> 'completed' or r.driver_id is null then
    raise exception 'only a completed ride can be rated' using errcode = '55000';
  end if;
  insert into ratings (ride_id, driver_id, customer_id, stars, comment, tip)
    values (r.id, r.driver_id, r.customer_id, p_stars, nullif(trim(p_comment), ''), greatest(0, coalesce(p_tip, 0)));
  update drivers d set rating_count = s.n, rating_avg = s.avg
    from (select count(*) n, round(avg(stars), 2) avg from ratings where driver_id = r.driver_id) s
    where d.id = r.driver_id;
end $$;

-- ---------------------------------------------------------------- status side effects
-- Frees the driver, records earnings, gives loyalty points, refunds discounts.
create or replace function public.rides_after_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare p jsonb; rw customer_rewards; v_credit integer := 0;
begin
  if new.status is not distinct from old.status then return null; end if;

  -- Driver free again
  if new.status in ('completed', 'cancelled', 'cancelled_by_driver', 'declined') and new.driver_id is not null then
    update drivers set is_available = is_online, current_ride_id = null where id = new.driver_id and current_ride_id = new.id;
  end if;

  if new.status = 'completed' then
    -- Earnings: driver is paid on the full trip price (promos are Caval's cost),
    -- minus commission. Cash in hand counts against what Caval owes them.
    if new.driver_id is not null and new.earnings_recorded_at is null then
      perform record_earning(new, 'ride',
        coalesce(new.fare, 0) + new.discount - new.previous_fee,
        new.discount,
        case when new.payment_method = 'cash' then coalesce(new.fare, 0) else 0 end);
      update rides set earnings_recorded_at = now() where id = new.id;
    end if;
    -- Loyalty: 1 point per ride, credit every N rides, referral bonus on the first ride
    if not new.demo and new.points_awarded_at is null then
      p := pricing()->'rewards';
      insert into customer_rewards (customer_id) values (new.customer_id) on conflict do nothing;
      update customer_rewards set completed_rides = completed_rides + 1, points = points + 1, updated_at = now()
        where customer_id = new.customer_id returning * into rw;
      if (p->>'ridesPerReward')::int > 0 and rw.completed_rides % (p->>'ridesPerReward')::int = 0 then
        v_credit := v_credit + (p->>'rewardCredit')::int;
      end if;
      if rw.completed_rides = 1 and rw.referred_by is not null then
        v_credit := v_credit + (p->>'referralCredit')::int;
        update customer_rewards cr set credit = cr.credit + (p->>'referralCredit')::int where cr.customer_id = rw.referred_by;
      end if;
      if v_credit > 0 then update customer_rewards cr set credit = cr.credit + v_credit where cr.customer_id = new.customer_id; end if;
      update rides set points_awarded_at = now() where id = new.id;
    end if;
  end if;

  -- Late cancellation: driver is paid the fee, customer pays it on the next ride
  if new.status in ('cancelled', 'cancelled_by_driver') and new.cancellation_fee > 0 and not new.demo
     and new.driver_id is not null and new.earnings_recorded_at is null then
    perform record_earning(new, 'cancellation_fee', new.cancellation_fee, 0, 0);
    insert into customer_rewards (customer_id) values (new.customer_id) on conflict do nothing;
    update customer_rewards cr set fee_due = cr.fee_due + new.cancellation_fee, updated_at = now()
      where cr.customer_id = new.customer_id;
    update rides set earnings_recorded_at = now() where id = new.id;
  end if;

  -- Ride never happened: give back an earlier fee carried on it
  if new.status in ('declined', 'cancelled', 'cancelled_by_driver', 'no_drivers_available') and new.previous_fee > 0
     and new.discount_refunded_at is null then
    update customer_rewards cr set fee_due = cr.fee_due + new.previous_fee where cr.customer_id = new.customer_id;
  end if;

  -- Ride never happened: give back promo and credit
  if new.status in ('declined', 'cancelled', 'cancelled_by_driver', 'no_drivers_available')
     and new.discount_refunded_at is null
     and (new.credit_used > 0 or new.previous_fee > 0 or coalesce((new.promo_applied->>'amount')::int, 0) > 0) then
    if new.credit_used > 0 then
      update customer_rewards cr set credit = cr.credit + new.credit_used where cr.customer_id = new.customer_id;
    end if;
    if coalesce((new.promo_applied->>'amount')::int, 0) > 0 then
      update promo_codes set used_count = greatest(0, used_count - 1) where code = new.promo_applied->>'code';
      update promo_redemptions set count = greatest(0, count - 1) where code = new.promo_applied->>'code' and customer_id = new.customer_id;
    end if;
    update rides set discount_refunded_at = now() where id = new.id;
  end if;
  return null;
end $$;
create trigger rides_after_status after update of status on rides for each row execute function rides_after_status();

-- ---------------------------------------------------------------- permissions
-- Internal helpers: not callable from the apps.
revoke execute on function public.dispatch_ride(uuid), public.expire_offers(), public.dispatch_scheduled(),
  public.my_ride_as_driver(uuid, text[]), public.compute_fare(rides), public.rides_before_insert(),
  public.rides_after_insert(), public.rides_after_status(), public.pricing(), public.dispatch_settings(),
  public.feature_on(text), public.commission_percent(), public.record_earning(rides, text, integer, integer, integer)
  from public, anon, authenticated;
-- App functions: signed-in users only (each checks who is calling).
revoke execute on function public.accept_ride(uuid), public.decline_ride(uuid), public.driver_arrived(uuid),
  public.verify_pickup_pin(uuid, text), public.start_ride(uuid, text), public.complete_ride(uuid),
  public.confirm_delivery(uuid, text), public.driver_cancel_ride(uuid, text), public.customer_cancel_ride(uuid, text),
  public.retry_ride(uuid), public.rate_driver(uuid, smallint, text, integer)
  from public, anon;
grant execute on function public.accept_ride(uuid), public.decline_ride(uuid), public.driver_arrived(uuid),
  public.verify_pickup_pin(uuid, text), public.start_ride(uuid, text), public.complete_ride(uuid),
  public.confirm_delivery(uuid, text), public.driver_cancel_ride(uuid, text), public.customer_cancel_ride(uuid, text),
  public.retry_ride(uuid), public.rate_driver(uuid, smallint, text, integer)
  to authenticated;

-- ---------------------------------------------------------------- schedules
select cron.schedule('expire-offers', '3 seconds', 'select public.expire_offers()');
select cron.schedule('dispatch-scheduled', '* * * * *', 'select public.dispatch_scheduled()');
