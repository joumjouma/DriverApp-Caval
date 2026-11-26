-- See README.md. Prints results via RAISE and rolls back.
do $$
declare
  c1 uuid := gen_random_uuid(); d1 uuid := gen_random_uuid(); d2 uuid := gen_random_uuid();
  r1 uuid; r2 uuid; r3 uuid; r4 uuid; x rides; e earnings; out text := ''; n int;
  dlat float8 := 11.5946 + 7/1.3/111.0;
begin
  insert into auth.users (id, email, aud, role) values (c1,'t-c1@test.caval','authenticated','authenticated'),
    (d1,'t-d1@test.caval','authenticated','authenticated'),(d2,'t-d2@test.caval','authenticated','authenticated');
  insert into customers (id, first_name, phone) values (c1, 'Test', '+25377000000');
  insert into drivers (id, first_name, last_name, driver_type, approval_status, approved_at, is_online, is_available)
    values (d1,'Old','Driver','Caval Privé','approved', now() - interval '200 days', true, true),
           (d2,'New','Driver','Caval Privé','approved', now(), false, false);
  insert into driver_locations (driver_id, position) values
    (d1, extensions.st_makepoint(43.1480, 11.5950)::extensions.geography),
    (d2, extensions.st_makepoint(43.1500, 11.5960)::extensions.geography);
  insert into promo_codes (code, kind, value, active, per_user) values ('TEST300','amount',300,true,1);

  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare, promo_code)
    values (c1, 11.5946, 43.1475, dlat, 43.1475, 7, 999, 'TEST300') returning id into r1;
  reset role;
  select * into x from rides where id = r1;
  out := out || format(E'1 price: fare=%s before=%s discount=%s status=%s offered_to_d1=%s\n', x.fare, x.fare_before_discount, x.discount, x.status, x.selected_driver_id = d1);
  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated;
  perform accept_ride(r1); perform driver_arrived(r1); perform start_ride(r1, null); perform complete_ride(r1);
  reset role;
  select * into e from earnings where ride_id = r1;
  out := out || format(E'1 earn: gross=%s comm=%s amount=%s cash=%s balance=%s (want 1000/120/880/700/+180)\n', e.gross, e.commission, e.amount, e.cash_collected, e.balance);
  out := out || format(E'1 d1 free again: %s\n', (select is_available and current_ride_id is null from drivers where id=d1));

  update drivers set is_online=false, is_available=false where id=d1;
  update drivers set is_online=true, is_available=true where id=d2;
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare)
    values (c1, 11.5946, 43.1475, dlat, 43.1475, 7, 1000) returning id into r2;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',d2,'role','authenticated')::text, true);
  set local role authenticated; perform accept_ride(r2); reset role;
  update rides set accepted_at = now() - interval '3 minutes' where id = r2;
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated; perform customer_cancel_ride(r2, 'changed mind'); reset role;
  select * into e from earnings where ride_id = r2;
  out := out || format(E'2 fee: kind=%s gross=%s comm=%s balance=%s fee_due=%s (want cancellation_fee/200/0/+200/200)\n',
    e.kind, e.gross, e.commission, e.balance, (select fee_due from customer_rewards where customer_id=c1));

  update drivers set is_online=false, is_available=false where id=d2;
  update drivers set is_online=true, is_available=true where id=d1;
  set local role authenticated;
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare)
    values (c1, 11.5946, 43.1475, dlat, 43.1475, 7, 1000) returning id into r3;
  reset role;
  select * into x from rides where id = r3;
  out := out || format(E'3 price: fare=%s previous_fee=%s fee_due_now=%s (want 1200/200/0)\n', x.fare, x.previous_fee, (select fee_due from customer_rewards where customer_id=c1));
  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated;
  perform accept_ride(r3); perform driver_arrived(r3); perform start_ride(r3, null); perform complete_ride(r3);
  reset role;
  select * into e from earnings where ride_id = r3;
  out := out || format(E'3 earn: gross=%s comm=%s amount=%s cash=%s balance=%s (want 1000/120/880/1200/-320)\n', e.gross, e.commission, e.amount, e.cash_collected, e.balance);
  out := out || format(E'  balances: d1=%s d2=%s (want -140/+200)\n', (select balance from driver_balances where driver_id=d1), (select balance from driver_balances where driver_id=d2));

  update drivers set is_online=true, is_available=true where id=d2;
  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare)
    values (c1, 11.5946, 43.1475, dlat, 43.1475, 7, 1000) returning id into r4;
  reset role;
  out := out || format(E'4 first offer to d1 (closest): %s\n', (select selected_driver_id = d1 from rides where id=r4));
  perform set_config('request.jwt.claims', json_build_object('sub',d1,'role','authenticated')::text, true);
  set local role authenticated; perform decline_ride(r4); reset role;
  out := out || format(E'4 after decline, offered to d2: %s\n', (select selected_driver_id = d2 from rides where id=r4));
  update rides set offer_expires_at = now() - interval '10 seconds' where id = r4;
  perform expire_offers();
  out := out || format(E'4 after timeout: %s (want no_drivers_available)\n', (select status from rides where id=r4));

  perform set_config('request.jwt.claims', json_build_object('sub',c1,'role','authenticated')::text, true);
  set local role authenticated;
  update rides set fare = 1 where id = r3; get diagnostics n = row_count;
  out := out || format(E'5 customer edits fare directly: rows=%s (want 0)\n', n);
  begin perform complete_ride(r4); out := out || E'5 customer completes ride: ALLOWED (bad)\n';
  exception when others then out := out || format(E'5 customer completes ride: refused (%s)\n', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',d2,'role','authenticated')::text, true);
  set local role authenticated;
  select count(*) into n from earnings where driver_id = d1;
  out := out || format(E'5 d2 sees d1 earnings: %s rows (want 0)\n', n);
  select count(*) into n from ride_secrets;
  out := out || format(E'5 d2 sees PINs: %s rows (want 0)\n', n);
  begin perform accept_ride(r1); out := out || E'5 d2 accepts finished ride: ALLOWED (bad)\n';
  exception when others then out := out || format(E'5 d2 accepts finished ride: refused (%s)\n', sqlerrm); end;
  reset role;
  out := out || format(E'6 loyalty: rides=%s points=%s promo_used=%s\n', (select completed_rides from customer_rewards where customer_id=c1), (select points from customer_rewards where customer_id=c1), (select used_count from promo_codes where code='TEST300'));

  raise exception E'TEST RESULTS (rolled back)\n%', out;
end $$;
