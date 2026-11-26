-- Notifications, WhatsApp, share links, rewards/promo/business RPCs, account
-- deletion, admin report, auto-offline. Replaces these Cloud Functions:
-- customerRideUpdates (push part), sendDriverApprovalNotification,
-- onDeliveryCreated (WhatsApp part), sendReceipt, sendWhatsAppNotification,
-- createShareLink, track, getMyRewards, redeemReferral, checkPromo,
-- joinBusiness, leaveBusiness, deleteMyAccount, onSupportMessage,
-- adminMonthlyReport, autoOfflineDrivers.
--
-- Push goes to Expo, WhatsApp to UltraMsg, both straight from Postgres with
-- pg_net (async; a failed send never blocks a ride). The UltraMsg token lives
-- in Supabase Vault as 'ultramsg_token'. Until it is set, WhatsApp is skipped.

insert into public.app_config (key, value) values ('messaging', jsonb_build_object(
  'ultramsgInstance', 'instance131940',
  'trackBaseUrl', 'https://eco-share-92ef1.web.app/t/',
  'appLink', 'https://www.caval.tech',
  'shareLinkHours', 24,
  'whatsappDriverOffers', false))
on conflict (key) do nothing;

create or replace function public.messaging() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select value from app_config where key = 'messaging'), '{}');
$$;

-- ---------------------------------------------------------------- senders
create or replace function public.send_push(p_token text, p_title text, p_body text, p_data jsonb default '{}')
returns void language plpgsql security definer set search_path = public, extensions as $$
begin
  if p_token is null or p_token not like 'ExponentPushToken%' then return; end if;
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    body := jsonb_build_object('to', p_token, 'title', p_title, 'body', p_body, 'data', coalesce(p_data, '{}'),
                               'sound', 'default', 'priority', 'high', 'channelId', 'rides'),
    headers := '{"Content-Type":"application/json","Accept":"application/json"}'::jsonb);
end $$;

-- Djibouti numbers: 8 digits → +253. Other countries kept if they look complete.
create or replace function public.whatsapp_number(p text) returns text
language sql immutable set search_path = public as $$
  select case
    when d ~ '^[0-9]{8}$' then '253' || d
    when d ~ '^253[0-9]{8}$' then d
    when length(d) between 10 and 15 then d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x;
$$;

-- Sends once per p_key (whatsapp_log), so retries never spam anyone.
-- Returns false when skipped (no token yet, bad number, already sent).
create or replace function public.send_whatsapp(p_phone text, p_body text, p_key text, p_ride uuid default null, p_kind text default null)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare v_to text := whatsapp_number(p_phone); v_token text; v_inst text := messaging()->>'ultramsgInstance';
begin
  if v_to is null or p_body is null then return false; end if;
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'ultramsg_token' limit 1;
  if v_token is null or v_inst is null then
    raise log 'whatsapp skipped (no ultramsg_token in Vault): %', p_key;
    return false;
  end if;
  insert into whatsapp_log (key, ride_id, kind) values (p_key, p_ride, p_kind) on conflict do nothing;
  if not found then return false; end if;
  perform net.http_post(
    url := 'https://api.ultramsg.com/' || v_inst || '/messages/chat',
    body := jsonb_build_object('to', v_to, 'body', p_body, 'token', v_token),
    headers := '{"Content-Type":"application/json"}'::jsonb);
  return true;
end $$;

create or replace function public.make_share_link(p_ride uuid, p_by uuid, p_purpose text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_token text := left(translate(encode(gen_random_bytes(24), 'base64'), '+/=', ''), 22);
begin
  insert into share_links (token, ride_id, created_by, purpose, expires_at)
    values (v_token, p_ride, p_by, p_purpose, now() + make_interval(hours => coalesce((messaging()->>'shareLinkHours')::int, 24)));
  return (messaging()->>'trackBaseUrl') || v_token;
end $$;

-- ---------------------------------------------------------------- ride events
create or replace function public.ride_status_text(r rides) returns text[]
language sql immutable set search_path = public as $$
  select case r.status
    when 'assigned' then array[case when del then 'Livreur trouvé' else 'Chauffeur trouvé' end, drv || ' est en route.']
    when 'driver_arrived' then array[case when del then 'Livreur arrivé' else 'Votre chauffeur est arrivé' end,
                                     case when del then 'Remettez-lui le colis.' else drv || ' vous attend.' end]
    when 'picked_up' then case when del then array['Colis récupéré', 'Votre colis est en route.'] end
    when 'completed' then case when del then array['Colis livré', 'Le destinataire a reçu votre colis.']
                               else array['Course terminée', 'Montant : ' || coalesce(r.fare, 0) || ' Fdj. Merci d''avoir choisi Caval !'] end
    when 'no_drivers_available' then array['Aucun chauffeur disponible', 'Ouvrez l''app pour relancer la recherche.']
    when 'cancelled_by_driver' then array[case when del then 'Le livreur a annulé' else 'Le chauffeur a annulé' end,
                                          'Ouvrez l''app pour chercher quelqu''un d''autre.']
  end
  from (select r.service_type = 'delivery' del,
               coalesce(r.driver_name, case when r.service_type = 'delivery' then 'Votre livreur' else 'Votre chauffeur' end) drv) x;
$$;

create or replace function public.rides_notify_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare msg text[]; tok text; d record;
begin
  if new.status is not distinct from old.status then return null; end if;

  -- New offer → the selected driver
  if new.status = 'driver_selected' and new.selected_driver_id is not null then
    select dr.push_token, dr.first_name, dp.phone into d
      from drivers dr left join driver_private dp on dp.driver_id = dr.id where dr.id = new.selected_driver_id;
    perform send_push(d.push_token, 'Nouvelle course',
      coalesce(new.fare, 0) || ' Fdj · ' || coalesce(new.pickup_address, 'Départ sur la carte'),
      jsonb_build_object('type', 'offer', 'rideId', new.id));
    if coalesce((messaging()->>'whatsappDriverOffers')::boolean, false) and not new.demo then
      perform send_whatsapp(d.phone,
        E'🚗 *Nouvelle course Caval*\n\n' || coalesce(new.fare, 0) || E' Fdj\n\nOuvrez l''application maintenant : l''offre expire dans 15 secondes.',
        new.id || '_offer_' || new.selected_driver_id || '_' || new.reassignment_attempts, new.id, 'offer');
    end if;
  end if;

  -- Customer
  msg := ride_status_text(new);
  if msg is not null then
    select push_token into tok from customers where id = new.customer_id;
    perform send_push(tok, msg[1], msg[2], jsonb_build_object('type', 'ride', 'rideId', new.id, 'status', new.status));
  end if;
  return null;
end $$;
create trigger rides_notify_status after update of status on rides for each row execute function rides_notify_status();

-- New delivery → WhatsApp the code and a tracking link to the recipient.
-- Retries keep the code the recipient already has, so no new message.
-- (Runs after rides_after_insert, which creates the code: triggers fire in name order.)
create or replace function public.rides_notify_insert() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_code text; v_sender text; v_name text; v_link text;
begin
  if new.service_type <> 'delivery' or new.retry_of is not null then return null; end if;
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
create trigger rides_notify_insert after insert on rides for each row execute function rides_notify_insert();

-- ---------------------------------------------------------------- other events
create or replace function public.drivers_notify_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approval_status = 'approved' and old.approval_status is distinct from 'approved' then
    perform send_push(new.push_token, '✅ Compte approuvé !',
      'Félicitations ! Votre compte chauffeur est approuvé. Vous pouvez commencer à travailler.',
      jsonb_build_object('type', 'driver_approval'));
  end if;
  return null;
end $$;
create trigger drivers_notify_approval after update of approval_status on drivers for each row execute function drivers_notify_approval();

create or replace function public.support_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t support_tickets; tok text;
begin
  select * into t from support_tickets where id = new.ticket_id;
  if new.sender = 'support' then
    update support_tickets set status = 'answered', unread_by_user = true, updated_at = now() where id = t.id;
    select coalesce(c.push_token, d.push_token) into tok
      from (select t.user_id id) u left join customers c on c.id = u.id left join drivers d on d.id = u.id;
    perform send_push(tok, 'Support Caval', left(new.body, 120), jsonb_build_object('type', 'support', 'ticketId', t.id));
  else
    update support_tickets set status = 'open', updated_at = now() where id = t.id;
  end if;
  return null;
end $$;
create trigger support_notify after insert on support_messages for each row execute function support_notify();

-- Chat between customer and driver: push the other person.
create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare cv conversations; tok text; who text;
begin
  select * into cv from conversations where id = new.conversation_id;
  update conversations set last_message = left(new.body, 200), updated_at = now() where id = cv.id;
  if new.sender_id = cv.customer_id then
    select push_token into tok from drivers where id = cv.driver_id;
    select first_name into who from customers where id = cv.customer_id;
  else
    select push_token into tok from customers where id = cv.customer_id;
    select first_name into who from drivers where id = cv.driver_id;
  end if;
  perform send_push(tok, coalesce(who, 'Caval'), left(new.body, 120), jsonb_build_object('type', 'chat', 'conversationId', cv.id));
  return null;
end $$;
create trigger messages_notify after insert on messages for each row execute function messages_notify();

-- ---------------------------------------------------------------- app functions
-- Customer: WhatsApp receipt for a completed ride.
create or replace function public.send_receipt(p_ride_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r rides; ph text; body text;
begin
  select * into r from rides where id = p_ride_id;
  if r.id is null or r.customer_id is distinct from auth.uid() then raise exception 'not your ride' using errcode = '42501'; end if;
  if r.status <> 'completed' then raise exception 'ride not completed' using errcode = '55000'; end if;
  select phone into ph from customers where id = r.customer_id;
  if whatsapp_number(ph) is null then raise exception 'Ajoutez votre numéro dans votre profil.' using errcode = '22023'; end if;
  body := concat_ws(E'\n',
    '🧾 *Reçu Caval*', '',
    'Date : ' || to_char(r.completed_at at time zone 'Africa/Djibouti', 'DD/MM/YYYY HH24:MI'),
    'Service : ' || case r.service_type when 'delivery' then 'Colis' when 'hourly' then 'Mise à disposition' else r.ride_type end,
    'De : ' || coalesce(r.pickup_address, '—'),
    case when r.service_type = 'hourly' then 'Durée : ' || r.hours || ' h' else 'À : ' || coalesce(r.destination_address, '—') end,
    case when r.billed_distance_km > 0 then 'Distance : ' || replace(r.billed_distance_km::text, '.', ',') || ' km' end,
    case when r.driver_name is not null then 'Chauffeur : ' || r.driver_name end,
    case when r.discount > 0 then 'Réduction : -' || r.discount || ' Fdj' end,
    case when r.previous_fee > 0 then 'Frais d''annulation précédente : ' || r.previous_fee || ' Fdj' end,
    '*Total : ' || r.fare || ' Fdj* (' || case r.payment_method when 'business' then 'entreprise' else 'espèces' end || ')', '',
    'Réf. ' || upper(left(r.id::text, 8)));
  return jsonb_build_object('sent', send_whatsapp(ph, body, r.id || '_receipt', r.id, 'receipt'));
end $$;

create or replace function public.create_share_link(p_ride_id uuid) returns text
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from rides where id = p_ride_id and customer_id = auth.uid()) then
    raise exception 'not your ride' using errcode = '42501';
  end if;
  return make_share_link(p_ride_id, auth.uid(), 'share');
end $$;

-- Public (anon): what someone following a shared trip may see. Follows retries
-- to the live ride. Driver position only while the trip is active.
create or replace function public.track_ride(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare l share_links; r rides; d drivers; pos geography; nxt uuid; i int := 0;
begin
  select * into l from share_links where token = left(regexp_replace(coalesce(p_token, ''), '[^A-Za-z0-9]', '', 'g'), 40);
  if l.token is null or l.expires_at < now() then return jsonb_build_object('error', 'expired'); end if;
  select * into r from rides where id = l.ride_id;
  loop
    select id into nxt from rides where retry_of = r.id order by created_at desc limit 1;
    exit when nxt is null or i >= 3;
    select * into r from rides where id = nxt; i := i + 1;
  end loop;
  if r.id is null then return jsonb_build_object('error', 'not_found'); end if;
  if r.driver_id is not null then
    select * into d from drivers where id = r.driver_id;
    if r.status in ('assigned', 'driver_arrived', 'picked_up') then
      select position into pos from driver_locations where driver_id = r.driver_id;
    end if;
  end if;
  return jsonb_build_object(
    'status', r.status, 'serviceType', r.service_type,
    'pickup', jsonb_build_object('lat', r.pickup_lat, 'lng', r.pickup_lng, 'address', r.pickup_address),
    'destination', jsonb_build_object('lat', r.destination_lat, 'lng', r.destination_lng, 'address', r.destination_address),
    'stops', coalesce((select jsonb_agg(jsonb_build_object('lat', s->'latitude', 'lng', s->'longitude')) from jsonb_array_elements(r.stops) s), '[]'),
    'recipientName', case when l.purpose = 'recipient' then r.package->>'recipientName' end,
    'driver', case when d.id is not null then jsonb_build_object(
      'firstName', split_part(coalesce(r.driver_name, d.first_name), ' ', 1),
      'car', nullif(concat_ws(' ', d.car_make, d.car_model), ''), 'color', d.car_color, 'plate', d.plate, 'photo', d.photo_url,
      'position', case when pos is not null then jsonb_build_object('lat', st_y(pos::geometry), 'lng', st_x(pos::geometry)) end) end,
    'updatedAt', extract(epoch from now()) * 1000);
end $$;

create or replace function public.my_rewards() returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare rw customer_rewards; p jsonb := pricing()->'rewards'; v_code text; tries int := 0;
begin
  if not exists (select 1 from customers where id = auth.uid()) then raise exception 'customers only' using errcode = '42501'; end if;
  insert into customer_rewards (customer_id) values (auth.uid()) on conflict do nothing;
  select * into rw from customer_rewards where customer_id = auth.uid() for update;
  while rw.referral_code is null and tries < 5 loop
    v_code := 'CAV' || (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 32), 1), '')
                        from (select gen_random_bytes(5) b) x, generate_series(0, 4) i);
    begin
      update customer_rewards set referral_code = v_code where customer_id = auth.uid();
      rw.referral_code := v_code;
    exception when unique_violation then tries := tries + 1;
    end;
  end loop;
  return jsonb_build_object('points', rw.points, 'credit', rw.credit, 'completedRides', rw.completed_rides,
    'referralCode', rw.referral_code, 'referredBy', rw.referred_by is not null, 'feeDue', rw.fee_due,
    'ridesPerReward', p->'ridesPerReward', 'rewardCredit', p->'rewardCredit', 'referralCredit', p->'referralCredit',
    'ridesToNextReward', case when (p->>'ridesPerReward')::int > 0
      then (p->>'ridesPerReward')::int - rw.completed_rides % (p->>'ridesPerReward')::int end);
end $$;

create or replace function public.redeem_referral(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare owner uuid; rw customer_rewards;
begin
  select customer_id into owner from customer_rewards where referral_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if owner is null then raise exception 'Code inconnu.' using errcode = 'P0002'; end if;
  if owner = auth.uid() then raise exception 'C''est votre propre code.' using errcode = '22023'; end if;
  insert into customer_rewards (customer_id) values (auth.uid()) on conflict do nothing;
  select * into rw from customer_rewards where customer_id = auth.uid() for update;
  if rw.referred_by is not null then raise exception 'Vous avez déjà utilisé un code.' using errcode = '23505'; end if;
  if rw.completed_rides > 0 then raise exception 'Réservé aux nouveaux clients.' using errcode = '22023'; end if;
  update customer_rewards set referred_by = owner, updated_at = now() where customer_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Preview only; the real check happens when the ride is created.
create or replace function public.check_promo(p_code text, p_fare integer default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  pc promo_codes; used int; done int; amt int;
begin
  if v_code = '' then return jsonb_build_object('valid', false, 'reason', 'empty'); end if;
  select * into pc from promo_codes where code = v_code;
  if pc.code is null then return jsonb_build_object('valid', false, 'reason', 'unknown'); end if;
  if not pc.active or (pc.expires_at is not null and pc.expires_at < now())
     or (pc.max_uses is not null and pc.used_count >= pc.max_uses) then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  select count into used from promo_redemptions where code = v_code and customer_id = auth.uid();
  if coalesce(used, 0) >= pc.per_user then return jsonb_build_object('valid', false, 'reason', 'used'); end if;
  select completed_rides into done from customer_rewards where customer_id = auth.uid();
  if pc.first_ride_only and coalesce(done, 0) > 0 then return jsonb_build_object('valid', false, 'reason', 'first_ride_only'); end if;
  amt := case when pc.kind = 'percent' then (coalesce(p_fare, 0) * pc.value / 100.0)::int else pc.value end;
  if pc.kind = 'percent' and pc.max_discount is not null then amt := least(amt, pc.max_discount); end if;
  if coalesce(p_fare, 0) > 0 then amt := least(amt, p_fare); end if;
  return jsonb_build_object('valid', true, 'code', v_code, 'amount', (round(amt / 50.0) * 50)::int, 'kind', pc.kind, 'value', pc.value);
end $$;

create or replace function public.join_business(p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b businesses;
begin
  select * into b from businesses where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) and active;
  if b.id is null then raise exception 'Code entreprise inconnu.' using errcode = 'P0002'; end if;
  insert into business_members (business_id, user_id) values (b.id, auth.uid()) on conflict do nothing;
  return jsonb_build_object('businessId', b.id, 'name', b.name);
end $$;

create or replace function public.leave_business(p_business_id uuid) returns void
language sql security definer set search_path = public as $$
  delete from business_members where business_id = p_business_id and user_id = auth.uid();
$$;

-- Customer deletes their account. Rides stay for the driver's records and the
-- accounts, moved to the "deleted account" placeholder, with personal data removed.
insert into auth.users (id, email, aud, role)
  values ('00000000-0000-0000-0000-00000000dead', 'deleted-account@caval.invalid', 'authenticated', 'authenticated')
  on conflict (id) do nothing;
insert into public.customers (id, first_name) values ('00000000-0000-0000-0000-00000000dead', 'Compte supprimé')
  on conflict (id) do nothing;

create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); ghost uuid := '00000000-0000-0000-0000-00000000dead';
begin
  if me is null or me = ghost then raise exception 'sign in required' using errcode = '42501'; end if;
  if exists (select 1 from drivers where id = me) then
    raise exception 'Les comptes chauffeur se suppriment depuis l''application chauffeur.' using errcode = '22023';
  end if;
  if exists (select 1 from rides where customer_id = me and status in ('waiting', 'driver_selected', 'assigned', 'driver_arrived', 'picked_up')) then
    raise exception 'Terminez ou annulez votre course en cours d''abord.' using errcode = '55000';
  end if;
  delete from ride_contacts where ride_id in (select id from rides where customer_id = me);
  update rides set customer_id = ghost, passenger = null, pickup_note = null,
    package = case when package is null then null else package - 'recipientPhone' - 'recipientName' end
    where customer_id = me;
  update customer_rewards set referred_by = null where referred_by = me;
  -- Profile photo: the app deletes it through the Storage API first (SQL can't delete storage files).
  delete from auth.users where id = me;   -- cascades: customer, rewards, chats, ratings, tickets
  return jsonb_build_object('deleted', true);
end $$;

-- Admin: completed rides for a month (optionally one business) → invoice rows.
create or replace function public.admin_monthly_report(p_month text, p_business_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz; v_rows jsonb;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'month YYYY-MM required' using errcode = '22023'; end if;
  v_from := (p_month || '-01')::date::timestamp at time zone 'Africa/Djibouti';
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'date', completed_at, 'service', service_type,
           'passenger', passenger->>'name', 'from', pickup_address, 'to', destination_address, 'km', billed_distance_km,
           'fare', fare, 'discount', discount, 'driver', driver_name, 'business', business_name) order by completed_at), '[]')
    into v_rows
    from rides where status = 'completed' and not demo and completed_at >= v_from and completed_at < v_from + interval '1 month'
      and (p_business_id is null or business_id = p_business_id);
  return jsonb_build_object('count', jsonb_array_length(v_rows),
    'total', (select coalesce(sum((x->>'fare')::int), 0) from jsonb_array_elements(v_rows) x), 'rows', v_rows);
end $$;

-- Drivers whose phone stopped sending positions go offline (not mid-ride).
create or replace function public.auto_offline_drivers() returns integer
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update drivers d set is_online = false, is_available = false
    where d.is_online and d.current_ride_id is null
      and not exists (select 1 from driver_locations l where l.driver_id = d.id and l.updated_at > now() - interval '10 minutes');
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- permissions
revoke execute on function public.messaging(), public.send_push(text, text, text, jsonb), public.whatsapp_number(text),
  public.send_whatsapp(text, text, text, uuid, text), public.make_share_link(uuid, uuid, text), public.ride_status_text(rides),
  public.rides_notify_status(), public.rides_notify_insert(), public.drivers_notify_approval(), public.support_notify(),
  public.messages_notify(), public.auto_offline_drivers()
  from public, anon, authenticated;
revoke execute on function public.send_receipt(uuid), public.create_share_link(uuid), public.my_rewards(),
  public.redeem_referral(text), public.check_promo(text, integer), public.join_business(text), public.leave_business(uuid),
  public.delete_my_account(), public.admin_monthly_report(text, uuid), public.track_ride(text)
  from public, anon;
grant execute on function public.send_receipt(uuid), public.create_share_link(uuid), public.my_rewards(),
  public.redeem_referral(text), public.check_promo(text, integer), public.join_business(text), public.leave_business(uuid),
  public.delete_my_account(), public.admin_monthly_report(text, uuid)
  to authenticated;
grant execute on function public.track_ride(text) to anon, authenticated;

select cron.schedule('auto-offline-drivers', '*/5 * * * *', 'select public.auto_offline_drivers()');
