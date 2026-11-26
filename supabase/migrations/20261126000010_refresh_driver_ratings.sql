-- Used once by scripts/migrate-data after copying ratings.
create or replace function public.refresh_driver_ratings() returns integer
language sql security definer set search_path = public as $$
  with s as (select driver_id, count(*) n, round(avg(stars), 2) a from ratings group by driver_id),
  u as (update drivers d set rating_count = s.n, rating_avg = s.a from s where d.id = s.driver_id returning 1)
  select count(*)::int from u;
$$;
revoke execute on function public.refresh_driver_ratings() from public, anon, authenticated;
grant execute on function public.refresh_driver_ratings() to service_role;
