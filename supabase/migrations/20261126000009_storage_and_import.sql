-- File storage for both apps, and the import entry point for the Firebase data
-- migration (scripts/migrate-data).
--
-- Buckets (paths start with the owner's id, so policies check the first folder):
--   avatars           public read     {user_id}/photo.jpg         customers and drivers
--   driver-documents  private         {driver_id}/registration.jpg  driver + admins
--   package-photos    private         {ride_id}/pickup.jpg        assigned driver writes; ride's customer, driver, admins read
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('driver-documents', 'driver-documents', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']),
  ('package-photos', 'package-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy avatars_read on storage.objects for select to anon, authenticated using (bucket_id = 'avatars');
create policy avatars_own_write on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_own_update on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy driver_docs_own on storage.objects for all to authenticated
  using (bucket_id = 'driver-documents' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'driver-documents' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy driver_docs_admin on storage.objects for select to authenticated
  using (bucket_id = 'driver-documents' and (select is_admin()));

create or replace function public.can_see_ride_files(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rides r where r.id::text = p_folder
                 and (r.customer_id = auth.uid() or r.driver_id = auth.uid() or is_admin()));
$$;
create or replace function public.can_add_ride_files(p_folder text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from rides r where r.id::text = p_folder and r.driver_id = auth.uid()
                 and r.status in ('assigned', 'driver_arrived', 'picked_up'));
$$;
revoke execute on function public.can_see_ride_files(text), public.can_add_ride_files(text) from public, anon;
grant execute on function public.can_see_ride_files(text), public.can_add_ride_files(text) to authenticated;

create policy package_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'package-photos' and (select can_see_ride_files((storage.foldername(name))[1])));
create policy package_photos_add on storage.objects for insert to authenticated
  with check (bucket_id = 'package-photos' and (select can_add_ride_files((storage.foldername(name))[1])));

-- ---------------------------------------------------------------- import
-- Service role only. Inserts rows as they are (no triggers: no re-pricing, no
-- dispatch, no notifications, no double earnings). Existing rows are kept,
-- so the import can be re-run.
create or replace function public.import_rows(p_table text, p_rows jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer; cols text;
begin
  if p_table not in ('customers', 'drivers', 'driver_private', 'rides', 'ride_contacts', 'ride_secrets', 'earnings',
                     'customer_rewards', 'ratings', 'conversations', 'messages', 'promo_codes', 'businesses',
                     'business_members', 'admins') then
    raise exception 'table % is not importable', p_table;
  end if;
  -- Only the columns the rows actually carry, so the others keep their defaults.
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = p_table
      and exists (select 1 from jsonb_array_elements(p_rows) r where r ? c.column_name);
  if cols is null then return 0; end if;
  set local session_replication_role = replica;
  execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing',
                 p_table, cols)
    using p_rows;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.import_rows(text, jsonb) from public, anon, authenticated;
grant execute on function public.import_rows(text, jsonb) to service_role;
