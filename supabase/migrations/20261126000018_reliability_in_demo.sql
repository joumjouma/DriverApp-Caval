-- Demo drivers get a reliability score too (from demo rides only), and the
-- auto-offline rule works in demo, so both can be tested with "Course test".
-- Real drivers are still scored on real rides only.
alter table public.offer_events add column demo boolean not null default false;

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
  else return null;
  end if;
  insert into offer_events (driver_id, ride_id, outcome, demo) values (d, new.id, v_outcome, new.demo);

  if v_outcome = 'missed' and limit_missed > 0 then
    select count(*) into streak from (
      select e.outcome from offer_events e where e.driver_id = d and e.demo = new.demo order by e.id desc limit limit_missed) x
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

create or replace function public.driver_reliability_of(p_driver_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  with w as (select coalesce((select demo from drivers where id = p_driver_id), false) demo),
       e as (select outcome from offer_events, w where driver_id = p_driver_id and offer_events.demo = w.demo
               and created_at > now() - interval '30 days'),
       c as (select count(*) filter (where status = 'completed') done,
                    count(*) filter (where status = 'cancelled_by_driver') cancels
             from rides, w where driver_id = p_driver_id and rides.demo = w.demo and created_at > now() - interval '30 days')
  select jsonb_build_object(
    'offers', (select count(*) from e),
    'accepted', (select count(*) from e where outcome = 'accepted'),
    'declined', (select count(*) from e where outcome = 'declined'),
    'missed', (select count(*) from e where outcome = 'missed'),
    'acceptanceRate', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where outcome = 'accepted') / count(*)) end from e),
    'completed', (select done from c),
    'cancels', (select cancels from c));
$$;
