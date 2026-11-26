-- Simple demo mode.
--
-- Two shared demo logins (the "Essayer la démo" button in each app signs in
-- with them; the password is public on purpose — demo accounts only ever
-- see demo rides):
--   customer  demo-client@caval.tech     d0000000-0000-4000-a000-00000000c001
--   driver    demo-chauffeur@caval.tech  d0000000-0000-4000-a000-00000000d001
-- Two robot drivers (car, moto) and one robot customer that can't sign in:
--   robot car  d0000000-0000-4000-a000-00000000d0b1
--   robot moto d0000000-0000-4000-a000-00000000d0b2
--   robot customer d0000000-0000-4000-a000-00000000c0b0
--
-- Customer alone: a demo ride with no demo driver online goes to a robot,
-- which drives to the pickup on the map, arrives, picks up and finishes in
-- about two minutes (demo_robot_tick, every 5 seconds).
-- Driver alone: demo_request_ride() sends the driver a ride from the robot
-- customer. Two phones in demo still match each other first.

-- ---------------------------------------------------------------- accounts
do $$
declare
  u record;
  pw text := extensions.crypt('CavalDemo2026', extensions.gen_salt('bf'));
begin
  for u in select * from (values
    ('d0000000-0000-4000-a000-00000000c001'::uuid, 'demo-client@caval.tech', true),
    ('d0000000-0000-4000-a000-00000000d001'::uuid, 'demo-chauffeur@caval.tech', true),
    ('d0000000-0000-4000-a000-00000000d0b1'::uuid, 'robot-voiture@caval.tech', false),
    ('d0000000-0000-4000-a000-00000000d0b2'::uuid, 'robot-moto@caval.tech', false),
    ('d0000000-0000-4000-a000-00000000c0b0'::uuid, 'robot-client@caval.tech', false)) v(id, email, can_login)
  loop
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current,
      reauthentication_token, phone_change, phone_change_token)
    values ('00000000-0000-0000-0000-000000000000', u.id, 'authenticated', 'authenticated', u.email,
      case when u.can_login then pw end, now(),
      '{"provider":"email","providers":["email"]}', '{"demo":true}', now(), now(),
      '', '', '', '', '', '', '', '')
    on conflict (id) do nothing;
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), u.id, u.id::text,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true), 'email', now(), now(), now())
    on conflict do nothing;
  end loop;
end $$;

insert into customers (id, first_name, last_name, email, phone) values
  ('d0000000-0000-4000-a000-00000000c001', 'Client', 'Démo', 'demo-client@caval.tech', '+25377000001'),
  ('d0000000-0000-4000-a000-00000000c0b0', 'Amina', '(robot)', 'robot-client@caval.tech', '+25377000009')
on conflict (id) do nothing;

insert into drivers (id, first_name, last_name, driver_type, car_make, car_model, car_color, plate, demo,
                     approval_status, approved_at, documents_verified, is_online, is_available) values
  ('d0000000-0000-4000-a000-00000000d001', 'Chauffeur', 'Démo', 'Caval Privé', 'Toyota', 'Corolla', 'Blanche', 'DEMO 001', true,
   'approved', now() - interval '365 days', true, false, false),
  ('d0000000-0000-4000-a000-00000000d0b1', 'Ahmed', '(robot)', 'Caval Privé', 'Toyota', 'Yaris', 'Grise', 'ROBOT 1', true,
   'approved', now() - interval '365 days', true, false, false),
  ('d0000000-0000-4000-a000-00000000d0b2', 'Moussa', '(robot)', 'Caval moto', 'Yamaha', 'Crypton', 'Rouge', 'ROBOT 2', true,
   'approved', now() - interval '365 days', true, false, false)
on conflict (id) do nothing;
insert into driver_private (driver_id, email, phone) values
  ('d0000000-0000-4000-a000-00000000d001', 'demo-chauffeur@caval.tech', '+25377000002'),
  ('d0000000-0000-4000-a000-00000000d0b1', 'robot-voiture@caval.tech', '+25377000003'),
  ('d0000000-0000-4000-a000-00000000d0b2', 'robot-moto@caval.tech', '+25377000004')
on conflict (driver_id) do nothing;

-- Demo = these two logins. (Replaces the old hand-edited testers list.)
insert into app_config (key, value) values ('demo', '{}') on conflict (key) do nothing;
update app_config set value = jsonb_build_object(
  'testers', jsonb_build_array('d0000000-0000-4000-a000-00000000c001', 'd0000000-0000-4000-a000-00000000d001')) where key = 'demo';

create or replace function public.demo_robot_ids() returns uuid[]
language sql immutable as $$
  select array['d0000000-0000-4000-a000-00000000d0b1', 'd0000000-0000-4000-a000-00000000d0b2']::uuid[];
$$;

-- ---------------------------------------------------------------- robot driver
-- Timeline after the robot accepts (seconds): drive to pickup 0–40, arrived
-- at 40, on board at 55, then drive to the destination and finish.
create or replace function public.demo_robot_trip_seconds(r rides) returns integer
language sql immutable as $$
  select case when r.service_type = 'hourly' or r.destination_lat is null then 60
              else greatest(40, least(90, (coalesce(r.distance_km, 3) * 12)::int)) end;
$$;

-- Where the robot is now, worked out from the ride's times (no GPS).
create or replace function public.demo_robot_point(r rides) returns jsonb
language plpgsql stable as $$
declare
  t float8 := extract(epoch from now() - coalesce(r.accepted_at, now()));
  s_lat float8 := r.pickup_lat + 0.0085; s_lng float8 := r.pickup_lng + 0.0060;   -- ~1.1 km away
  d_lat float8 := coalesce(r.destination_lat, r.pickup_lat); d_lng float8 := coalesce(r.destination_lng, r.pickup_lng);
  f float8; lat float8; lng float8; trip int := demo_robot_trip_seconds(r);
begin
  if r.status = 'assigned' then
    f := least(1, greatest(0, t / 40.0)); lat := s_lat + (r.pickup_lat - s_lat) * f; lng := s_lng + (r.pickup_lng - s_lng) * f;
  elsif r.status = 'picked_up' then
    f := least(1, greatest(0, (t - 55) / trip)); lat := r.pickup_lat + (d_lat - r.pickup_lat) * f; lng := r.pickup_lng + (d_lng - r.pickup_lng) * f;
  elsif r.status = 'completed' then
    lat := d_lat; lng := d_lng;
  else
    lat := r.pickup_lat; lng := r.pickup_lng;
  end if;
  return jsonb_build_object('latitude', lat, 'longitude', lng, 'heading', null, 'updatedAt', now());
end $$;

create or replace function public.demo_robot_take(p_ride_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r rides; robot drivers;
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or not r.demo or r.status not in ('waiting', 'driver_selected', 'no_drivers_available') then return; end if;
  select * into robot from drivers
    where id = case when (ride_driver_types(r))[1] = 'Caval moto' then (demo_robot_ids())[2] else (demo_robot_ids())[1] end;
  update rides set status = 'assigned', driver_id = robot.id, selected_driver_id = null, offer_expires_at = null,
    driver_name = trim(robot.first_name || ' ' || robot.last_name), driver_photo = robot.photo_url,
    driver_phone = (select phone from driver_private where driver_id = robot.id),
    pickup_pin_verified = true, accepted_at = now()
  where id = r.id;
end $$;

create or replace function public.demo_robot_tick() returns integer
language plpgsql security definer set search_path = public as $$
declare r rides; t float8; n int := 0;
begin
  for r in select * from rides
           where demo and driver_id = any(demo_robot_ids()) and status in ('assigned', 'driver_arrived', 'picked_up')
           for update skip locked loop
    t := extract(epoch from now() - r.accepted_at);
    if r.status = 'assigned' and t >= 40 then
      update rides set status = 'driver_arrived', arrived_at = now() where id = r.id; n := n + 1;
    elsif r.status = 'driver_arrived' and t >= 55 then
      update rides set status = 'picked_up', picked_up_at = now() where id = r.id; n := n + 1;
    elsif r.status = 'picked_up' and t >= 55 + demo_robot_trip_seconds(r) then
      update rides set status = 'completed', completed_at = now(),
        delivery_verified = (service_type = 'delivery') where id = r.id; n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Customers see the robot moving; real drivers keep their GPS position.
create or replace function public.driver_position(p_driver_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare r rides; l driver_locations;
begin
  select * into r from rides
    where driver_id = p_driver_id and customer_id = auth.uid() and status in ('assigned', 'driver_arrived', 'picked_up')
    order by accepted_at desc limit 1;
  if r.id is null then return null; end if;
  if p_driver_id = any(demo_robot_ids()) then return demo_robot_point(r); end if;
  select * into l from driver_locations where driver_id = p_driver_id;
  if l.driver_id is null then return null; end if;
  return jsonb_build_object('latitude', st_y(l.position::geometry), 'longitude', st_x(l.position::geometry),
                            'heading', l.heading, 'updatedAt', l.updated_at);
end $$;

-- Dispatch: same as before, except a demo ride nobody takes goes to the robot.
create or replace function public.dispatch_ride(p_ride_id uuid) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  r rides; cfg jsonb := dispatch_settings(); pick uuid; pickup geography; types text[];
begin
  select * into r from rides where id = p_ride_id for update;
  if r.id is null or r.status not in ('waiting', 'driver_selected') then return null; end if;
  if r.reassignment_attempts >= (cfg->>'maxOffers')::int then
    if r.demo then perform demo_robot_take(r.id); return null; end if;
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
    and not exists (select 1 from rides o where o.status = 'driver_selected' and o.selected_driver_id = d.id and o.id <> r.id)
  order by array_position(types, d.driver_type),
           st_distance(l.position, pickup) / 1000.0
             - case when d.id = any(r.favorite_driver_ids) and st_dwithin(l.position, pickup, 3000) then 4 else 0 end
             - case when r.prefer_female_driver and d.gender = 'female' then 5 else 0 end,
           d.rating_avg desc nulls last
  limit 1
  for update of d skip locked;

  if pick is null then
    if r.demo then perform demo_robot_take(r.id); return null; end if;
    update rides set status = 'no_drivers_available', selected_driver_id = null, offer_expires_at = null where id = r.id;
    return null;
  end if;
  update rides set status = 'driver_selected', selected_driver_id = pick,
    offer_expires_at = now() + make_interval(secs => (cfg->>'offerSeconds')::int),
    reassignment_attempts = reassignment_attempts + 1
  where id = r.id;
  return pick;
end $$;

-- ---------------------------------------------------------------- robot customer
-- Demo driver: "Recevoir une course test". A ride from the robot customer,
-- starting ~800 m from the driver, offered to this driver only.
create or replace function public.demo_request_ride(p_service text default 'ride') returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  me uuid := auth.uid(); d drivers; lat float8 := 11.5946; lng float8 := 43.1475; new_id uuid; robot uuid := 'd0000000-0000-4000-a000-00000000c0b0';
begin
  select * into d from drivers where id = me;
  if d.id is null or not d.demo or not is_demo_tester() then raise exception 'demo driver only' using errcode = '42501'; end if;
  if not d.is_online then raise exception 'Passez en ligne d''abord.' using errcode = '55000'; end if;
  if d.current_ride_id is not null or exists (select 1 from rides where selected_driver_id = me and status = 'driver_selected') then
    raise exception 'Terminez d''abord la course en cours.' using errcode = '55000';
  end if;
  select st_y(position::geometry), st_x(position::geometry) into lat, lng from driver_locations where driver_id = me;
  lat := coalesce(lat, 11.5946); lng := coalesce(lng, 43.1475);
  insert into rides (customer_id, service_type, ride_type, pickup_lat, pickup_lng, pickup_address,
                     destination_lat, destination_lng, destination_address, distance_km, duration_min, demo, status, scheduled_for, package)
  values (robot, case when p_service = 'delivery' then 'delivery' else 'ride' end, d.driver_type,
          lat + 0.006, lng + 0.004, 'Point de départ (démo)',
          lat + 0.006 + 0.022, lng + 0.004 - 0.010, 'Destination (démo)', 3.2, 9, true, 'scheduled', now() + interval '1 hour',
          case when p_service = 'delivery' then '{"size":"petit","recipientName":"Destinataire démo","recipientPhone":"77000008"}'::jsonb end)
  returning id into new_id;
  -- 'scheduled' above skips automatic dispatch; offer it to this driver now.
  update rides set status = 'driver_selected', selected_driver_id = me, scheduled_for = null,
    offer_expires_at = now() + make_interval(secs => greatest(30, (dispatch_settings()->>'offerSeconds')::int)),
    reassignment_attempts = 1, pickup_pin_verified = true
  where id = new_id;
  return new_id;
end $$;

-- The robot customer can't say the delivery code: show it to the demo driver.
create or replace function public.demo_delivery_code(p_ride_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select s.delivery_code from ride_secrets s join rides r on r.id = s.ride_id
  where r.id = p_ride_id and r.demo and r.driver_id = auth.uid()
    and r.customer_id = 'd0000000-0000-4000-a000-00000000c0b0';
$$;


-- No WhatsApp to the made-up recipient of a robot customer's package.
create or replace function public.rides_notify_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_sender text; v_name text; v_link text;
begin
  if new.service_type <> 'delivery' or new.retry_of is not null then return null; end if;
  if new.customer_id = 'd0000000-0000-4000-a000-00000000c0b0' then return null; end if;
  if whatsapp_number(new.package->>'recipientPhone') is null then return null; end if;
  select delivery_code into v_code from ride_secrets where ride_id = new.id;
  select coalesce(nullif(first_name, ''), 'Un client Caval') into v_sender from customers where id = new.customer_id;
  v_name := nullif(trim(new.package->>'recipientName'), '');
  v_link := make_share_link(new.id, new.customer_id, 'recipient');
  perform send_whatsapp(new.package->>'recipientPhone',
    E'📦 *Caval — un colis pour vous*\n\nBonjour' || coalesce(' ' || v_name, '') || ', ' || coalesce(v_sender, 'Un client Caval') ||
    E' vous envoie un colis avec Caval.\n\n🔑 *Code de livraison : ' || v_code ||
    E'*\n\nDonnez ce code au livreur seulement quand vous avez reçu le colis.\n\n📍 Suivre la livraison : ' || v_link,
    new.id || '_delivery_code', new.id, 'delivery_code');
  return null;
end $$;
revoke execute on function public.rides_notify_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------- cleanup
-- Shared demo accounts: keep two days of demo rides.
create or replace function public.demo_cleanup() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update rides set retry_of = null where retry_of in (select id from rides where demo and created_at < now() - interval '2 days');
  delete from rides where demo and created_at < now() - interval '2 days'
    and status not in ('assigned', 'driver_arrived', 'picked_up');
  get diagnostics n = row_count;
  update drivers set current_ride_id = null, is_available = is_online
    where demo and current_ride_id is not null and not exists (select 1 from rides where id = drivers.current_ride_id);
  return n;
end $$;

revoke execute on function public.demo_robot_take(uuid), public.demo_robot_tick(), public.demo_cleanup(),
  public.demo_robot_point(rides), public.demo_robot_trip_seconds(rides), public.demo_robot_ids()
  from public, anon, authenticated;
revoke execute on function public.demo_request_ride(text), public.demo_delivery_code(uuid), public.driver_position(uuid) from public, anon;
grant execute on function public.demo_request_ride(text), public.demo_delivery_code(uuid), public.driver_position(uuid) to authenticated;

select cron.schedule('demo-robot', '5 seconds', 'select public.demo_robot_tick()');
select cron.schedule('demo-cleanup', '17 3 * * *', 'select public.demo_cleanup()');
