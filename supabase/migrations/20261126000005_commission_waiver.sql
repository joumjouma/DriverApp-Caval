-- Launch waiver: each driver pays no commission for their first N days after
-- approval (default 90). Drivers approved at launch get ~3 months free, and so
-- does every driver who joins later. Set newDriverFreeDays to 0 to stop it.
-- waivedUntil (a date) still turns commission off for everyone until then.
update public.app_config
  set value = jsonb_set(value, '{commission}', (value->'commission') || '{"newDriverFreeDays":90}')
  where key = 'pricing';

create or replace function public.commission_percent(p_driver_id uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select case
    when (c->>'waivedUntil') is not null and (c->>'waivedUntil')::timestamptz > now() then 0
    when coalesce((c->>'newDriverFreeDays')::int, 0) > 0 and exists (
      select 1 from drivers d where d.id = p_driver_id
        and coalesce(d.approved_at, d.created_at) > now() - make_interval(days => (c->>'newDriverFreeDays')::int)) then 0
    else coalesce((c->>'percent')::numeric, 0) end
  from (select pricing()->'commission' c) x;
$$;
revoke execute on function public.commission_percent(uuid) from public, anon, authenticated;

create or replace function public.record_earning(r rides, p_kind text, p_gross integer, p_discount integer, p_cash integer)
returns void language plpgsql security definer set search_path = public as $$
declare v_comm integer := round(p_gross * commission_percent(r.driver_id) / 100.0)::int;
begin
  insert into earnings (ride_id, driver_id, kind, gross, platform_discount, commission, amount, cash_collected, balance, day, demo)
  values (r.id, r.driver_id, p_kind, p_gross, p_discount, v_comm, p_gross - v_comm, p_cash,
          (p_gross - v_comm) - p_cash, (now() at time zone 'Africa/Djibouti')::date, r.demo)
  on conflict (ride_id) do nothing;
end $$;

drop function public.commission_percent();

-- Built-in default too
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
    'commission', '{"percent":12,"waivedUntil":null,"newDriverFreeDays":90}'::jsonb || coalesce(c.value->'commission', '{}'),
    'cancellation', '{"freeMinutes":2,"noShowWaitMinutes":5,"Caval Privé":200,"Caval moto":100}'::jsonb
                    || coalesce(c.value->'cancellation', '{}'))
  from (select 1) one left join app_config c on c.key = 'pricing';
$$;
