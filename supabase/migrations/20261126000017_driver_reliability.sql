-- Driver reliability: every offer is logged (accepted / declined / missed),
-- drivers who ignore offers are taken offline, and admins + drivers see a
-- 30-day score. Settings in app_config.dispatch:
--   missedOffersOffline (default 2): consecutive missed offers before going offline.

create table public.offer_events (
  id bigint generated always as identity primary key,
  driver_id uuid not null references drivers on delete cascade,
  ride_id uuid references rides on delete set null,
  outcome text not null check (outcome in ('accepted', 'declined', 'missed')),
  created_at timestamptz not null default now()
);
create index offer_events_driver_idx on offer_events (driver_id, created_at desc);
alter table public.offer_events enable row level security;
create policy offer_events_read on offer_events for select to authenticated using (driver_id = auth.uid() or is_admin());

-- One trigger sees every offer end: accept_ride, decline_ride and expire_offers
-- all clear selected_driver_id.
create or replace function public.rides_log_offer() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  d uuid := old.selected_driver_id; v_outcome text; streak int;
  limit_missed int := coalesce((dispatch_settings()->>'missedOffersOffline')::int, 2);
begin
  if d is null or new.selected_driver_id is not distinct from d or old.status <> 'driver_selected' then return null; end if;
  if new.driver_id = d then v_outcome := 'accepted';
  elsif d = any(new.declined_driver_ids) then
    v_outcome := case when old.offer_expires_at is not null and old.offer_expires_at <= now() then 'missed' else 'declined' end;
  else return null;  -- cancelled by the customer or an admin while offered: not the driver's doing
  end if;
  if new.demo then return null; end if;
  insert into offer_events (driver_id, ride_id, outcome) values (d, new.id, v_outcome);

  if v_outcome = 'missed' and limit_missed > 0 then
    select count(*) into streak from (
      select e.outcome from offer_events e where e.driver_id = d order by e.id desc limit limit_missed) x
      where x.outcome = 'missed';
    if streak >= limit_missed then
      update drivers set is_online = false, is_available = false where id = d and is_online;
      if found then
        perform send_push((select push_token from driver_private where driver_id = d),
          'Vous êtes hors ligne',
          format('%s courses sans réponse. Repassez en ligne quand vous êtes prêt à rouler.', limit_missed),
          jsonb_build_object('type', 'auto_offline'));
      end if;
    end if;
  end if;
  return null;
end $$;
revoke execute on function public.rides_log_offer() from public, anon, authenticated;
create trigger rides_log_offer after update of selected_driver_id on rides
  for each row execute function rides_log_offer();

-- 30-day score for one driver.
create or replace function public.driver_reliability_of(p_driver_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (select outcome from offer_events where driver_id = p_driver_id and created_at > now() - interval '30 days'),
       c as (select count(*) filter (where status = 'completed') done,
                    count(*) filter (where status = 'cancelled_by_driver') cancels
             from rides where driver_id = p_driver_id and not demo and created_at > now() - interval '30 days')
  select jsonb_build_object(
    'offers', (select count(*) from e),
    'accepted', (select count(*) from e where outcome = 'accepted'),
    'declined', (select count(*) from e where outcome = 'declined'),
    'missed', (select count(*) from e where outcome = 'missed'),
    'acceptanceRate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where outcome = 'accepted') / count(*)) end from e),
    'completed', (select done from c),
    'cancels', (select cancels from c));
$$;
revoke execute on function public.driver_reliability_of(uuid) from public, anon, authenticated;

create or replace function public.my_reliability() returns jsonb
language sql stable security definer set search_path = public as $$
  select driver_reliability_of(auth.uid()) where exists (select 1 from drivers where id = auth.uid());
$$;
revoke execute on function public.my_reliability() from public, anon;
grant execute on function public.my_reliability() to authenticated;

-- Admin list: same as 0015 plus the score.
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
              and e.created_at > now() - interval '7 days') as commission_7d,
           driver_reliability_of(d.id) as reliability
    from drivers d left join driver_private p on p.driver_id = d.id
    where d.id <> '00000000-0000-0000-0000-0000000dead2' and not d.id = any(demo_robot_ids())
      and (p_status is null
           or (p_status = 'review' and (d.approval_status = 'pending' or (d.approval_status = 'approved' and not d.documents_verified)))
           or d.approval_status = p_status)
  ) x), '[]'::jsonb);
end $$;
