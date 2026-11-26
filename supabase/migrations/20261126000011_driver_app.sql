-- What the Supabase driver app needs on top of the ride functions:
--  * live earnings (realtime on earnings)
--  * delete_driver_account(): App Store rule. Rides and earnings stay for the
--    customers' history and the accounts, moved to a "deleted driver"
--    placeholder; name, phone, photo, documents and the login are removed.
--    Refused while a ride is in progress or money is still owed either way.
alter publication supabase_realtime add table public.earnings;

insert into auth.users (id, email, aud, role)
  values ('00000000-0000-0000-0000-0000000dead2', 'deleted-driver@caval.invalid', 'authenticated', 'authenticated')
  on conflict (id) do nothing;
insert into public.drivers (id, first_name, last_name, approval_status)
  values ('00000000-0000-0000-0000-0000000dead2', 'Chauffeur', 'supprimé', 'rejected')
  on conflict (id) do nothing;

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
  select coalesce(sum(balance), 0) into bal from earnings where driver_id = me and not demo;
  if bal <> 0 then
    raise exception 'Réglez d''abord votre solde avec Caval (% Fdj).', bal using errcode = '55000';
  end if;
  update rides set driver_id = ghost, driver_phone = null, driver_photo = null,
    driver_name = split_part(coalesce(driver_name, ''), ' ', 1)
    where driver_id = me;
  -- An offer waiting on this driver goes to the next one
  for r in select id from rides where selected_driver_id = me loop
    update rides set selected_driver_id = null, offer_expires_at = null,
      status = case when status = 'driver_selected' then 'waiting' else status end
      where id = r.id;
    perform dispatch_ride(r.id);
  end loop;
  update rides set declined_driver_ids = array_remove(declined_driver_ids, me) where me = any(declined_driver_ids);
  update earnings set driver_id = ghost where driver_id = me;
  update ratings set driver_id = ghost where driver_id = me;
  -- Photo and documents: the app deletes them through the Storage API first.
  delete from auth.users where id = me;   -- cascades: driver, private info, location, chats, tickets
  return jsonb_build_object('deleted', true);
end $$;
revoke execute on function public.delete_driver_account() from public, anon;
grant execute on function public.delete_driver_account() to authenticated;
