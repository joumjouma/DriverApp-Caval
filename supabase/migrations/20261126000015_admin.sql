-- Admin dashboard (public/admin): driver approval, cash settlement, support,
-- WhatsApp leads. Everything here checks is_admin(); admins are rows in
-- public.admins (see supabase/README.md → "Admins").

-- ---------------------------------------------------------------- settlements
-- A driver's balance = sum(earnings.balance) + sum(settlements.amount).
-- Negative balance: the driver owes Caval (cash collected > what he earned).
-- amount > 0: the driver paid Caval. amount < 0: Caval paid the driver.
create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers on delete cascade,
  amount integer not null check (amount <> 0),
  method text not null default 'cash' check (method in ('cash', 'waafi', 'dmoney', 'cacpay', 'saba', 'other')),
  note text check (char_length(note) <= 200),
  recorded_by uuid references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create index settlements_driver_idx on settlements (driver_id, created_at desc);
alter table public.settlements enable row level security;
create policy settlements_read on settlements for select to authenticated using (driver_id = auth.uid() or is_admin());
-- No insert/update policy: only admin_settle_driver() writes here.

create or replace view public.driver_balances with (security_invoker = true) as
  select d.id as driver_id,
         (coalesce(e.balance, 0) + coalesce(s.paid, 0))::integer as balance,
         coalesce(e.earned, 0)::integer as earned,
         coalesce(e.commission, 0)::integer as commission,
         coalesce(s.paid, 0)::integer as settled,
         s.last_at as last_settled_at
  from drivers d
  left join (select driver_id, sum(balance) balance, sum(amount) earned, sum(commission) commission
             from earnings where not demo group by driver_id) e on e.driver_id = d.id
  left join (select driver_id, sum(amount) paid, max(created_at) last_at from settlements group by driver_id) s on s.driver_id = d.id
  where e.driver_id is not null or s.driver_id is not null;

create or replace function public.driver_balance(p_driver_id uuid) returns integer
language sql stable security definer set search_path = public as $$
  select (coalesce((select sum(balance) from earnings where driver_id = p_driver_id and not demo), 0)
        + coalesce((select sum(amount) from settlements where driver_id = p_driver_id), 0))::integer;
$$;
revoke execute on function public.driver_balance(uuid) from public, anon, authenticated;

-- Account deletion now counts settlements too.
create or replace function public.delete_driver_account() returns jsonb
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid(); ghost uuid := '00000000-0000-0000-0000-0000000dead2'; bal integer; r record;
begin
  if me is null or me = ghost or not exists (select 1 from drivers where id = me) then
    raise exception 'driver account required' using errcode = '42501';
  end if;
  if exists (select 1 from rides where driver_id = me and status in ('assigned', 'driver_arrived', 'picked_up')) then
    raise exception 'Terminez votre course en cours d''abord.' using errcode = '55000';
  end if;
  bal := driver_balance(me);
  if bal <> 0 then
    raise exception 'Réglez d''abord votre solde avec Caval (% Fdj).', bal using errcode = '55000';
  end if;
  update rides set driver_id = ghost, driver_phone = null, driver_photo = null,
    driver_name = split_part(coalesce(driver_name, ''), ' ', 1)
    where driver_id = me;
  for r in select id from rides where selected_driver_id = me loop
    update rides set selected_driver_id = null, offer_expires_at = null,
      status = case when status = 'driver_selected' then 'waiting' else status end
      where id = r.id;
    perform dispatch_ride(r.id);
  end loop;
  update rides set declined_driver_ids = array_remove(declined_driver_ids, me) where me = any(declined_driver_ids);
  update earnings set driver_id = ghost where driver_id = me;
  update settlements set driver_id = ghost where driver_id = me;   -- kept for Caval's books
  update ratings set driver_id = ghost where driver_id = me;
  -- Photo and documents: the app deletes them through the Storage API first.
  delete from auth.users where id = me;   -- cascades: driver, private info, location, chats, tickets
  return jsonb_build_object('deleted', true);
end $$;

create or replace function public.admin_settle_driver(p_driver_id uuid, p_amount integer, p_method text default 'cash', p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_amount is null or p_amount = 0 then raise exception 'amount required' using errcode = '22023'; end if;
  insert into settlements (driver_id, amount, method, note, recorded_by)
    values (p_driver_id, p_amount, coalesce(p_method, 'cash'), nullif(trim(p_note), ''), auth.uid()) returning id into v_id;
  return jsonb_build_object('id', v_id, 'balance', driver_balance(p_driver_id));
end $$;

-- ---------------------------------------------------------------- drivers
-- One row per driver with contact details, documents, balance and activity.
create or replace function public.admin_drivers(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare free_days int := coalesce((pricing()->'commission'->>'newDriverFreeDays')::int, 0);
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
    select d.id, d.first_name, d.last_name, d.driver_type, d.car_make, d.car_model, d.car_color, d.plate, d.gender,
           d.approval_status, d.documents_verified, d.is_online, d.current_ride_id, d.rating_avg, d.rating_count,
           d.created_at, d.approved_at, d.demo, d.photo_url,
           p.email, p.phone, p.registration_card_url, p.payout,
           case when free_days > 0 and d.approval_status = 'approved'
                then coalesce(d.approved_at, d.created_at) + make_interval(days => free_days) end as commission_free_until,
           driver_balance(d.id) as balance,
           (select max(created_at) from settlements s where s.driver_id = d.id) as last_settled_at,
           (select count(*) from rides r where r.driver_id = d.id and r.status = 'completed' and not r.demo) as rides,
           (select count(*) from rides r where r.driver_id = d.id and r.status = 'completed' and not r.demo
              and r.completed_at > now() - interval '7 days') as rides_7d,
           (select coalesce(sum(e.cash_collected), 0) from earnings e where e.driver_id = d.id and not e.demo
              and e.created_at > now() - interval '7 days') as cash_7d,
           (select coalesce(sum(e.commission), 0) from earnings e where e.driver_id = d.id and not e.demo
              and e.created_at > now() - interval '7 days') as commission_7d
    from drivers d left join driver_private p on p.driver_id = d.id
    where d.id <> '00000000-0000-0000-0000-0000000dead2'
      and (p_status is null
           or (p_status = 'review' and (d.approval_status = 'pending' or (d.approval_status = 'approved' and not d.documents_verified)))
           or d.approval_status = p_status)
  ) x), '[]'::jsonb);
end $$;

-- Approve / reject / re-check. Approving also marks the documents as checked.
create or replace function public.admin_set_driver_status(p_driver_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  if p_status not in ('pending', 'approved', 'rejected') then raise exception 'bad status' using errcode = '22023'; end if;
  update drivers set approval_status = p_status,
    documents_verified = (p_status = 'approved'),
    approved_at = case when p_status = 'approved' then coalesce(approved_at, now()) else approved_at end,
    approved_by = case when p_status = 'approved' then auth.uid() else approved_by end,
    is_online = case when p_status = 'approved' then is_online else false end,
    is_available = case when p_status = 'approved' then is_available else false end
    where id = p_driver_id;
  if not found then raise exception 'driver not found' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------- rides
create or replace function public.admin_cancel_ride(p_ride_id uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  update rides set status = case when driver_id is null then 'declined' else 'cancelled' end,
    cancelled_by = 'admin', cancelled_at = now(), cancellation_reason = left(coalesce(p_reason, 'admin'), 60),
    selected_driver_id = null, offer_expires_at = null
    where id = p_ride_id and status in ('scheduled', 'waiting', 'driver_selected', 'assigned', 'driver_arrived', 'picked_up', 'no_drivers_available');
  if not found then raise exception 'ride not active' using errcode = '55000'; end if;
end $$;

-- ---------------------------------------------------------------- support
alter table public.support_tickets add column unread_by_support boolean not null default true;

create or replace function public.support_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare t support_tickets; tok text;
begin
  select * into t from support_tickets where id = new.ticket_id;
  if new.sender = 'support' then
    update support_tickets set status = 'answered', unread_by_user = true, unread_by_support = false, updated_at = now() where id = t.id;
    select coalesce(c.push_token, d.push_token) into tok
      from (select t.user_id id) u left join customers c on c.id = u.id left join driver_private d on d.driver_id = u.id;
    perform send_push(tok, 'Support Caval', left(new.body, 120), jsonb_build_object('type', 'support', 'ticketId', t.id));
  else
    update support_tickets set status = 'open', unread_by_support = true, updated_at = now() where id = t.id;
  end if;
  return null;
end $$;

-- Tickets with who opened them (customer or driver) and the last message.
create or replace function public.admin_tickets(p_include_closed boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(x) order by x.updated_at desc) from (
    select t.id, t.subject, t.status, t.ride_id, t.unread_by_support, t.created_at, t.updated_at, t.user_id,
           case when d.id is not null then 'driver' else 'customer' end as role,
           trim(coalesce(c.first_name, d.first_name, '') || ' ' || coalesce(c.last_name, d.last_name, '')) as name,
           coalesce(c.phone, p.phone) as phone,
           (select m.body from support_messages m where m.ticket_id = t.id order by m.created_at desc limit 1) as last_message
    from support_tickets t
    left join customers c on c.id = t.user_id
    left join drivers d on d.id = t.user_id
    left join driver_private p on p.driver_id = t.user_id
    where p_include_closed or t.status <> 'closed'
    order by t.updated_at desc limit 200
  ) x), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- WhatsApp leads
alter table public.whatsapp_leads
  add column handled_by uuid references auth.users on delete set null,
  add column handled_at timestamptz;

-- ---------------------------------------------------------------- overview numbers
create or replace function public.admin_overview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare today date := (now() at time zone 'Africa/Djibouti')::date; v_from timestamptz;
begin
  if not is_admin() then raise exception 'admins only' using errcode = '42501'; end if;
  v_from := today::timestamp at time zone 'Africa/Djibouti';
  return jsonb_build_object(
    'activeRides', (select count(*) from rides where not demo and status in ('waiting', 'driver_selected', 'assigned', 'driver_arrived', 'picked_up')),
    'scheduled', (select count(*) from rides where not demo and status = 'scheduled'),
    'onlineDrivers', (select count(*) from drivers where is_online and not demo and approval_status = 'approved'),
    'toReview', (select count(*) from drivers where approval_status = 'pending' or (approval_status = 'approved' and not documents_verified)),
    'openTickets', (select count(*) from support_tickets where status = 'open'),
    'newLeads', (select count(*) from whatsapp_leads where not handled),
    'todayRides', (select count(*) from rides where not demo and status = 'completed' and completed_at >= v_from),
    'todayRevenue', (select coalesce(sum(fare), 0) from rides where not demo and status = 'completed' and completed_at >= v_from),
    'todayCommission', (select coalesce(sum(commission), 0) from earnings where not demo and day = today),
    'todayNoDriver', (select count(*) from rides where not demo and status = 'no_drivers_available' and created_at >= v_from),
    'owedByDrivers', (select coalesce(-sum(b), 0) from (select driver_balance(id) b from drivers) x where b < 0),
    'owedToDrivers', (select coalesce(sum(b), 0) from (select driver_balance(id) b from drivers) x where b > 0));
end $$;

-- ---------------------------------------------------------------- permissions + realtime
revoke execute on function public.admin_settle_driver(uuid, integer, text, text), public.admin_drivers(text),
  public.admin_set_driver_status(uuid, text), public.admin_cancel_ride(uuid, text), public.admin_tickets(boolean),
  public.admin_overview() from public, anon;
grant execute on function public.admin_settle_driver(uuid, integer, text, text), public.admin_drivers(text),
  public.admin_set_driver_status(uuid, text), public.admin_cancel_ride(uuid, text), public.admin_tickets(boolean),
  public.admin_overview() to authenticated;
revoke execute on function public.support_notify() from public, anon, authenticated;

alter publication supabase_realtime add table public.whatsapp_leads, public.settlements;
