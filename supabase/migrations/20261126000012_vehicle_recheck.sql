-- A driver who changes plate or vehicle type keeps working, but their
-- documents need checking again (documents_verified → false, shown in the
-- admin dashboard). Runs after drivers_guard (triggers fire in name order).
create or replace function public.drivers_vehicle_recheck() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') and not is_admin()
     and (new.plate is distinct from old.plate or new.driver_type is distinct from old.driver_type) then
    new.documents_verified := false;
  end if;
  return new;
end $$;
create trigger drivers_vehicle_recheck before update on public.drivers
  for each row execute function public.drivers_vehicle_recheck();
