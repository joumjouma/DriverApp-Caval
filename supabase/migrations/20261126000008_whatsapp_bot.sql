-- WhatsApp bot (replaces whatsappWebhook). UltraMsg → Edge Function
-- `whatsapp-webhook` (checks the secret key) → whatsapp_bot(...) here, which
-- logs leads for the team and replies through send_whatsapp.
--   1 Commander  → asks for a location; a location becomes a ride lead
--   2 Suivre     → status of the customer's current ride (matched by phone)
--   3 Prix       → current fares from app_config
--   4 Aide       → support lead
-- Anything else is logged; the menu is sent at most once an hour.

create or replace function public.whatsapp_bot(p_from text, p_msg_id text, p_type text, p_body text,
  p_lat double precision default null, p_lng double precision default null, p_name text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_digits text := whatsapp_number(p_from); v_text text := lower(trim(coalesce(p_body, '')));
  st jsonb; reply text; app text := coalesce(messaging()->>'appLink', 'https://www.caval.tech');
  f jsonb := pricing()->'fares'; r rides; v_cust uuid;
begin
  if v_digits is null then return null; end if;
  select state into st from whatsapp_bot_state where phone = v_digits;
  st := coalesce(st, '{}');

  if p_type = 'location' and p_lat is not null and p_lng is not null then
    insert into whatsapp_leads (phone, kind, name, lat, lng) values ('+' || v_digits, 'ride', p_name, p_lat, p_lng);
    st := st || '{"step":"idle"}';
    reply := E'Merci ! 📍 Position reçue. Un opérateur Caval vous rappelle dans quelques minutes pour confirmer la course.\n\n'
             || 'Plus rapide la prochaine fois : l''application ' || app;
  elsif v_text = '1' or v_text like '%command%' then
    st := st || '{"step":"await_location"}';
    reply := E'Envoyez votre *position* : 📎 → Position → Envoyer ma position actuelle.\n\nOu commandez directement dans l''application : ' || app;
  elsif v_text = '2' or v_text like '%suivre%' then
    select id into v_cust from customers where whatsapp_number(phone) = v_digits limit 1;
    if v_cust is null then
      reply := 'Nous n''avons pas trouvé de compte Caval avec ce numéro. Répondez *4* pour parler à quelqu''un.';
    else
      select * into r from rides where customer_id = v_cust order by created_at desc limit 1;
      if r.id is null or r.status not in ('waiting', 'driver_selected', 'assigned', 'driver_arrived', 'picked_up') then
        reply := 'Vous n''avez pas de course en cours.';
      else
        reply := '🚗 *' || case r.status when 'assigned' then 'Chauffeur en route' when 'driver_arrived' then 'Chauffeur arrivé'
                                         when 'picked_up' then 'En route vers la destination' else 'Recherche d''un chauffeur' end || '*'
                 || coalesce(E'\nChauffeur : ' || r.driver_name, '') || E'\nMontant : ' || coalesce(r.fare::text, '—') || ' Fdj (espèces)';
      end if;
    end if;
  elsif v_text = '3' or v_text like '%prix%' or v_text like '%tarif%' then
    reply := E'💰 *Nos prix*\n• Voiture : ' || (f->'Caval Privé'->>'base') || ' Fdj jusqu''à ' || (f->'Caval Privé'->>'includedKm')
             || ' km, puis ' || (f->'Caval Privé'->>'perKm') || E' Fdj/km\n• Moto : ' || (f->'Caval moto'->>'base') || ' Fdj jusqu''à '
             || (f->'Caval moto'->>'includedKm') || ' km, puis ' || (f->'Caval moto'->>'perKm')
             || E' Fdj/km\n\nLe prix exact s''affiche dans l''application avant de commander.';
  elsif v_text = '4' or v_text like '%aide%' or v_text like '%help%' then
    insert into whatsapp_leads (phone, kind, name, body) values ('+' || v_digits, 'support', p_name, p_body);
    reply := 'D''accord, un membre de l''équipe Caval vous répond ici dès que possible. Décrivez votre demande en un message.';
  else
    insert into whatsapp_leads (phone, kind, name, body) values ('+' || v_digits, 'message', p_name, p_body);
    if coalesce((st->>'lastMenuAt')::timestamptz, '-infinity') < now() - interval '1 hour' then
      st := st || jsonb_build_object('lastMenuAt', now());
      reply := E'Bonjour 👋 Bienvenue chez *Caval*.\n\nRépondez avec un chiffre :\n*1* Commander une course\n*2* Suivre ma course\n*3* Nos prix\n*4* Parler à quelqu''un';
    end if;
  end if;

  insert into whatsapp_bot_state (phone, state, updated_at) values (v_digits, st, now())
    on conflict (phone) do update set state = excluded.state, updated_at = now();
  if reply is not null then
    perform send_whatsapp(v_digits, reply, 'bot_' || v_digits || '_' || coalesce(nullif(p_msg_id, ''), extract(epoch from clock_timestamp())::text), null, 'bot');
  end if;
  return reply;
end $$;
-- Only the Edge Function (service role) may call it.
revoke execute on function public.whatsapp_bot(text, text, text, text, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.whatsapp_bot(text, text, text, text, double precision, double precision, text) to service_role;
