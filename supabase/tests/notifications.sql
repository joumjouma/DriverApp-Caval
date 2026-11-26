-- See README.md. Uses a fake UltraMsg token inside the transaction; every
-- queued push/WhatsApp is discarded by the rollback.
do $$
declare
  c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
  r1 uuid; q0 bigint; out text := ''; j jsonb; v_url text; tok text; cv uuid; t uuid; n int; v_code text;
  dlat float8 := 11.5946 + 5/1.3/111.0;
begin
  create temp view q as select id, url u, convert_from(body, 'UTF8')::jsonb b from net.http_request_queue;
  perform vault.create_secret('test-token-not-real', 'ultramsg_token');
  select coalesce(max(id), 0) into q0 from net.http_request_queue;
  insert into auth.users (id, email, aud, role) values (c1,'t-c1@test.caval','authenticated','authenticated'),
    (c2,'t-c2@test.caval','authenticated','authenticated'), (d1,'t-d1@test.caval','authenticated','authenticated');
  insert into customers (id, first_name, phone, push_token) values (c1,'Amina','77001122','ExponentPushToken[cust]'), (c2,'Omar',null,null);
  insert into drivers (id, first_name, last_name, driver_type, approval_status, approved_at, is_online, is_available, push_token)
    values (d1,'Ali','Hassan','Caval moto','pending', null, false, false, 'ExponentPushToken[drv]');
  insert into driver_private (driver_id, phone) values (d1, '77998877');
  insert into driver_locations (driver_id, position) values (d1, extensions.st_makepoint(43.1480, 11.5950)::extensions.geography);

  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated;
  begin update drivers set approval_status='approved' where id=d1; out := out || E'driver self-approve: ALLOWED (bad)\n';
  exception when others then out := out || format(E'driver self-approve: refused (%s)\n', sqlerrm); end;
  reset role;
  update drivers set approval_status='approved', approved_at=now(), is_online=true, is_available=true where id=d1;
  out := out || format(E'approval by team: %s; push: %s\n', (select approval_status from drivers where id=d1),
    (select count(*) from q where id > q0 and b->>'title' like '%Compte approuv%' and b->>'to' like '%drv%'));

  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into rides (customer_id, service_type, ride_type, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare, package)
    values (c1, 'delivery', 'Caval moto', 11.5946, 43.1475, dlat, 43.1475, 5, 400,
      '{"size":"petit","recipientName":"Fatouma","recipientPhone":"77 55 44 33"}') returning id into r1;
  reset role;
  select delivery_code into v_code from ride_secrets where ride_id = r1;
  out := out || format(E'delivery WhatsApp: %s, to=%s, has code+link: %s\n',
    (select count(*) from q where id > q0 and u like '%ultramsg%'),
    (select b->>'to' from q where id > q0 and u like '%ultramsg%' limit 1),
    (select b->>'body' like '%' || v_code || '%/t/%' from q where id > q0 and u like '%ultramsg%' limit 1));
  out := out || format(E'offer push to driver: %s\n', (select count(*) from q where id > q0 and b->>'title' = 'Nouvelle course' and b->>'to' like '%drv%'));
  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated; perform accept_ride(r1); reset role;
  out := out || format(E'customer push: %s\n', (select b->>'title' || ' / ' || (b->>'body') from q where id > q0 and b->>'to' like '%cust%' limit 1));

  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated; v_url := create_share_link(r1); reset role;
  tok := split_part(v_url, '/t/', 2);
  set local role anon; j := track_ride(tok); reset role;
  out := out || format(E'track (anon): status=%s driver=%s pos=%s\n', j->>'status', j->'driver'->>'firstName', (j->'driver'->'position') is not null);
  set local role anon; j := track_ride('nope'); reset role;
  out := out || format(E'track bad token: %s\n', j->>'error');
  set local role anon;
  begin perform my_rewards(); out := out || E'anon my_rewards: ALLOWED (bad)\n'; exception when others then out := out || E'anon my_rewards: refused\n'; end;
  reset role;

  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated; j := my_rewards(); reset role;
  out := out || format(E'referral code: %s\n', j->>'referralCode');
  perform set_config('request.jwt.claims', json_build_object('sub',c2,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || format(E'c2 redeems c1 code: %s\n', redeem_referral(lower(j->>'referralCode'))::text);
  begin perform redeem_referral(j->>'referralCode'); out := out || E'second redeem: ALLOWED (bad)\n';
  exception when others then out := out || format(E'second redeem: refused (%s)\n', sqlerrm); end;
  reset role;
  insert into promo_codes (code, kind, value, active, per_user, max_discount) values ('BIENVENUE','percent',50,true,1,300);
  set local role authenticated;
  out := out || format(E'check_promo 50%% on 1000 (cap 300): %s | unknown: %s\n', check_promo('bienvenue', 1000)->>'amount', check_promo('XXX', 1000)->>'reason');
  reset role;

  insert into support_tickets (id, user_id, subject, status) values (gen_random_uuid(), c1, 'Test', 'open') returning id into t;
  insert into support_messages (ticket_id, sender, body) values (t, 'support', 'Bonjour, comment pouvons-nous aider ?');
  out := out || format(E'support reply push: %s, ticket=%s\n', (select count(*) from q where id > q0 and b->>'title' = 'Support Caval'), (select status from support_tickets where id=t));
  insert into conversations (customer_id, driver_id) values (c1, d1) returning id into cv;
  insert into messages (conversation_id, sender_id, body) values (cv, c1, 'Je suis devant la pharmacie');
  out := out || format(E'chat push to driver: %s\n', (select b->>'title' from q where id > q0 and b->>'body' like '%pharmacie%' and b->>'to' like '%drv%'));

  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated; perform driver_arrived(r1); perform start_ride(r1, 'https://x/p.jpg');
  j := confirm_delivery(r1, v_code); reset role;
  out := out || format(E'delivery confirmed: %s\n', j);
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || format(E'receipt: %s, again: %s\n', send_receipt(r1)->>'sent', send_receipt(r1)->>'sent');
  perform rate_driver(r1, 5::smallint, 'Rapide', 0);
  reset role;
  out := out || format(E'rating saved: avg=%s count=%s\n', (select rating_avg from drivers where id=d1), (select rating_count from drivers where id=d1));

  set local role authenticated; j := delete_my_account(); reset role;
  out := out || format(E'delete: %s; ride kept under placeholder: %s; contact card gone: %s; auth user gone: %s; driver earnings kept: %s\n', j->>'deleted',
    (select customer_id = '00000000-0000-0000-0000-00000000dead' from rides where id=r1),
    not exists (select 1 from ride_contacts where ride_id=r1), not exists (select 1 from auth.users where id=c1),
    exists (select 1 from earnings where ride_id=r1));

  update driver_locations set updated_at = now() - interval '20 minutes' where driver_id=d1;
  n := auto_offline_drivers();
  out := out || format(E'auto-offline stale driver: %s (online now %s)\n', n, (select is_online from drivers where id=d1));

  set local role service_role;
  out := out || format(E'bot menu: %s\n', whatsapp_bot('25377112233@c.us','m1','chat','Salam') is not null);
  out := out || format(E'bot menu again within the hour: %s\n', coalesce(whatsapp_bot('25377112233','m2','chat','?'), 'silent'));
  out := out || format(E'bot prices: %s\n', whatsapp_bot('25377112233','m3','chat','3') like '%500 Fdj%');
  out := out || format(E'bot location → lead: %s\n', whatsapp_bot('25377112233','m4','location','',11.59,43.14,'Hodan') like 'Merci%');
  reset role;
  out := out || format(E'outgoing calls queued (then discarded): %s\n', (select count(*) from q where id > q0));
  raise exception E'TEST RESULTS (rolled back)\n%', out;
end $$;
