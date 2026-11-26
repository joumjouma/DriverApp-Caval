-- drivers_guard only applies to app users editing their own row. Server
-- functions (rate_driver, approvals from the dashboard / SQL editor) run as
-- the table owner and must be able to set ratings and approval.
create or replace function public.drivers_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') or is_admin() then return new; end if;
  if new.approval_status is distinct from old.approval_status or new.approved_at is distinct from old.approved_at
     or new.approved_by is distinct from old.approved_by or new.documents_verified is distinct from old.documents_verified
     or new.rating_avg is distinct from old.rating_avg or new.rating_count is distinct from old.rating_count
     or new.firebase_uid is distinct from old.firebase_uid then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if new.demo and not old.demo and not is_demo_tester() then
    raise exception 'demo mode is for testers only' using errcode = '42501';
  end if;
  return new;
end $$;
