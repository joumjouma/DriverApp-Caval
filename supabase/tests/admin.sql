-- Admin dashboard functions. See README.md. Prints results via RAISE and rolls back.
do $$
declare
  a1 uuid := gen_random_uuid(); c1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid();
  r1 uuid; j jsonb; t1 uuid; out text := ''; bal int;
  dlat float8 := 11.5946 + 7/1.3/111.0;
begin
  insert into auth.users (id, email, aud, role) values (a1,'t-a1@test.caval','authenticated','authenticated'),
    (c1,'t-c1@test.caval','authenticated','authenticated'),(d1,'t-d1@test.caval','authenticated','authenticated');
  insert into admins (user_id) values (a1);
  insert into customers (id, first_name, phone) values (c1, 'Test', '+25377000000');
  insert into drivers (id, first_name, last_name, driver_type, approval_status, approved_at, is_online, is_available)
    values (d1,'Old','Driver','Caval Privé','pending', null, false, false);
  insert into driver_private (driver_id, phone, email) values (d1, '+25377111111', 't-d1@test.caval');
  insert into driver_locations (driver_id, position) values (d1, extensions.st_makepoint(43.1480, 11.5950)::extensions.geography);

  -- Non-admin is refused
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform admin_drivers(null); out := out || E'1 non-admin refused: false\n';
  exception when insufficient_privilege then out := out || E'1 non-admin refused: true\n'; end;
  begin perform admin_settle_driver(d1, 100); out := out || E'1 non-admin settle refused: false\n';
  exception when insufficient_privilege then out := out || E'1 non-admin settle refused: true\n'; end;
  reset role;

  -- Review list + approve
  perform set_config('request.jwt.claims', json_build_object('sub',a1,'role','authenticated')::text, true);
  set local role authenticated;
  j := admin_drivers('review');
  out := out || format(E'2 in review list: %s phone=%s\n', j @> jsonb_build_array(jsonb_build_object('id', d1)),
    (select x->>'phone' from jsonb_array_elements(j) x where x->>'id' = d1::text));
  perform admin_set_driver_status(d1, 'approved');
  reset role;
  out := out || format(E'2 approved: %s\n', (select approval_status = 'approved' and documents_verified and approved_by = a1 from drivers where id = d1));

  -- A cash ride (driver approved long ago, so 12% commission) makes the driver owe Caval
  update drivers set approved_at = now() - interval '200 days', is_online = true, is_available = true where id = d1;
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare)
    values (c1, 11.5946, 43.1475, dlat, 43.1475, 7, 1000) returning id into r1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated;
  perform accept_ride(r1); perform driver_arrived(r1); perform start_ride(r1, null); perform complete_ride(r1);
  reset role;
  bal := driver_balance(d1);
  out := out || format(E'3 balance after cash ride: %s (want -120)\n', bal);

  -- Settle: driver pays 120
  perform set_config('request.jwt.claims', json_build_object('sub',a1,'role','authenticated')::text, true);
  set local role authenticated;
  j := admin_settle_driver(d1, -bal, 'waafi', 'semaine 48');
  out := out || format(E'3 settled → balance %s (want 0)\n', j->>'balance');
  out := out || format(E'3 view: %s\n', (select row_to_json(b) from driver_balances b where driver_id = d1));
  reset role;
  -- Driver sees own settlement but can't add one
  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || format(E'4 driver sees settlement: %s\n', (select count(*) from settlements where driver_id = d1));
  begin insert into settlements (driver_id, amount) values (d1, 5000); out := out || E'4 driver insert blocked: false\n';
  exception when insufficient_privilege then out := out || E'4 driver insert blocked: true\n'; end;
  insert into support_tickets (user_id, subject) values (d1, 'Paiement') returning id into t1;
  insert into support_messages (ticket_id, author_id, sender, body) values (t1, d1, 'user', 'Bonjour');
  reset role;

  -- Support: ticket shows as driver, reply clears unread
  perform set_config('request.jwt.claims', json_build_object('sub',a1,'role','authenticated')::text, true);
  set local role authenticated;
  j := admin_tickets(false);
  out := out || format(E'5 ticket: %s\n', (select x - 'id' - 'user_id' - 'created_at' - 'updated_at' from jsonb_array_elements(j) x where x->>'id' = t1::text));
  insert into support_messages (ticket_id, author_id, sender, body) values (t1, a1, 'support', 'Réglé, merci');
  reset role;
  out := out || format(E'5 after reply: %s\n', (select format('status=%s unread_support=%s unread_user=%s', status, unread_by_support, unread_by_user) from support_tickets where id = t1));

  -- Cancel an active ride
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare)
    values (c1, 11.5946, 43.1475, dlat, 43.1475, 7, 1000) returning id into r1;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',a1,'role','authenticated')::text, true);
  set local role authenticated;
  perform admin_cancel_ride(r1, 'test');
  j := admin_overview();
  reset role;
  out := out || format(E'6 admin cancel: %s\n', (select status || '/' || cancelled_by from rides where id = r1));
  out := out || format(E'6 overview: %s\n', j);

  raise exception E'RESULTS (rolled back)\n%', out;
end $$;
