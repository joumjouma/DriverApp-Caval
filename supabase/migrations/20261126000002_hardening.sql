-- Fixes from the Supabase advisors after the first schema.

-- Trigger functions: fixed search_path.
alter function public.drivers_guard() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- Helper functions: signed-in users only (the RLS policies call them).
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_demo_tester() from public, anon;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_demo_tester() to authenticated;
-- Created by the "Enable RLS on new tables" project option; not for app users.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace) then
    revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
  end if;
end $$;

-- RLS: evaluate auth.uid() once per query instead of once per row.
do $$
declare p record; q text; c text;
begin
  for p in select schemaname, tablename, policyname, qual, with_check from pg_policies where schemaname = 'public' loop
    q := replace(p.qual, 'auth.uid()', '(select auth.uid())');
    c := replace(p.with_check, 'auth.uid()', '(select auth.uid())');
    if q is distinct from p.qual then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, q);
    end if;
    if c is distinct from p.with_check then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, c);
    end if;
  end loop;
end $$;

-- Indexes on foreign keys.
create index if not exists business_members_user_idx on business_members (user_id);
create index if not exists conversations_driver_idx on conversations (driver_id);
create index if not exists customer_rewards_referred_by_idx on customer_rewards (referred_by);
create index if not exists messages_sender_idx on messages (sender_id);
create index if not exists promo_redemptions_customer_idx on promo_redemptions (customer_id);
create index if not exists promo_redemptions_ride_idx on promo_redemptions (last_ride_id);
create index if not exists ratings_customer_idx on ratings (customer_id);
create index if not exists rides_business_idx on rides (business_id) where business_id is not null;
create index if not exists rides_retry_of_idx on rides (retry_of) where retry_of is not null;
create index if not exists share_links_created_by_idx on share_links (created_by);
create index if not exists share_links_ride_idx on share_links (ride_id);
create index if not exists support_messages_author_idx on support_messages (author_id);
create index if not exists support_messages_ticket_idx on support_messages (ticket_id, created_at);
create index if not exists support_tickets_ride_idx on support_tickets (ride_id);
create index if not exists support_tickets_user_idx on support_tickets (user_id, created_at desc);
create index if not exists whatsapp_log_ride_idx on whatsapp_log (ride_id);
