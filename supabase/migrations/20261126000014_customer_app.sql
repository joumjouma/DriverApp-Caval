-- What the Supabase customer app needs:
--  * driver_position(): the driver's position as map coordinates, only for the
--    customer whose ride that driver is doing right now
--  * mark_ticket_read(): the customer opened a support reply
--  * live updates for settings (prices, feature switches) and the profile
--  * feature switches: everything the backend now supports is on, except the
--    pickup PIN (off before too) and WhatsApp receipts (until UltraMsg is set up)
create or replace function public.driver_position(p_driver_id uuid) returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select jsonb_build_object('latitude', st_y(l.position::geometry), 'longitude', st_x(l.position::geometry),
                            'heading', l.heading, 'updatedAt', l.updated_at)
  from driver_locations l
  where l.driver_id = p_driver_id
    and exists (select 1 from rides r where r.driver_id = p_driver_id and r.customer_id = auth.uid()
                and r.status in ('assigned', 'driver_arrived', 'picked_up'));
$$;

create or replace function public.mark_ticket_read(p_ticket_id uuid) returns void
language sql security definer set search_path = public as $$
  update support_tickets set unread_by_user = false where id = p_ticket_id and user_id = auth.uid();
$$;

revoke execute on function public.driver_position(uuid), public.mark_ticket_read(uuid) from public, anon;
grant execute on function public.driver_position(uuid), public.mark_ticket_read(uuid) to authenticated;

alter publication supabase_realtime add table public.app_config, public.customers, public.support_tickets;

update public.app_config set value = value || '{
  "packagesEnabled": true, "schedulingEnabled": true, "stopsEnabled": true, "promoEnabled": true,
  "rewardsEnabled": true, "femaleDriversEnabled": true, "hourlyEnabled": true, "pickupPinEnabled": false,
  "receiptsEnabled": false, "businessEnabled": true, "supportChatEnabled": true, "shareLinkEnabled": true
}'::jsonb where key = 'customer';
