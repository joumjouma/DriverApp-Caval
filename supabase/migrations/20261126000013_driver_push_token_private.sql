-- Push tokens are secret (anyone holding one can send that phone notifications),
-- but driver profiles are readable by every signed-in user (customers see the
-- car, photo and rating). So the driver's token moves to driver_private, which
-- only the driver and admins can read.
alter table public.driver_private add column push_token text;
update public.driver_private p set push_token = d.push_token from public.drivers d
  where d.id = p.driver_id and d.push_token is not null;
insert into public.driver_private (driver_id, push_token)
  select id, push_token from public.drivers d where push_token is not null
    and not exists (select 1 from public.driver_private p where p.driver_id = d.id);
alter table public.drivers drop column push_token;

create or replace function public.rides_notify_status() returns trigger
language plpgsql security definer set search_path = public as $$
declare msg text[]; tok text; d record;
begin
  if new.status is not distinct from old.status then return null; end if;

  -- New offer → the selected driver
  if new.status = 'driver_selected' and new.selected_driver_id is not null then
    select dp.push_token, dr.first_name, dp.phone into d
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

create or replace function public.drivers_notify_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.approval_status = 'approved' and old.approval_status is distinct from 'approved' then
    perform send_push((select push_token from driver_private where driver_id = new.id), '✅ Compte approuvé !',
      'Félicitations ! Votre compte chauffeur est approuvé. Vous pouvez commencer à travailler.',
      jsonb_build_object('type', 'driver_approval'));
  end if;
  return null;
end $$;

create or replace function public.support_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t support_tickets; tok text;
begin
  select * into t from support_tickets where id = new.ticket_id;
  if new.sender = 'support' then
    update support_tickets set status = 'answered', unread_by_user = true, updated_at = now() where id = t.id;
    select coalesce(c.push_token, d.push_token) into tok
      from (select t.user_id id) u left join customers c on c.id = u.id left join driver_private d on d.driver_id = u.id;
    perform send_push(tok, 'Support Caval', left(new.body, 120), jsonb_build_object('type', 'support', 'ticketId', t.id));
  else
    update support_tickets set status = 'open', updated_at = now() where id = t.id;
  end if;
  return null;
end $$;

create or replace function public.messages_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare cv conversations; tok text; who text;
begin
  select * into cv from conversations where id = new.conversation_id;
  update conversations set last_message = left(new.body, 200), updated_at = now() where id = cv.id;
  if new.sender_id = cv.customer_id then
    select push_token into tok from driver_private where driver_id = cv.driver_id;
    select first_name into who from customers where id = cv.customer_id;
  else
    select push_token into tok from customers where id = cv.customer_id;
    select first_name into who from drivers where id = cv.driver_id;
  end if;
  perform send_push(tok, coalesce(who, 'Caval'), left(new.body, 120), jsonb_build_object('type', 'chat', 'conversationId', cv.id));
  return null;
end $$;
