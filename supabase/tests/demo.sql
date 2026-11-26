-- Simple demo mode (migration 0016). Prints results via RAISE and rolls back.
-- Customer alone → robot driver; driver alone → robot customer.
do $$
declare
  c uuid := 'd0000000-0000-4000-a000-00000000c001'; dd uuid := 'd0000000-0000-4000-a000-00000000d001';
  r1 uuid; r2 uuid; x rides; out text := ''; j jsonb; dlat float8 := 11.5946 + 5/1.3/111.0;
begin
  perform set_config('request.jwt.claims', json_build_object('sub',c,'role','authenticated')::text, true);
  set local role authenticated;
  out := out || format(E'client is demo tester: %s\n', is_demo_tester());
  insert into rides (customer_id, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare, demo)
    values (c, 11.5946, 43.1475, dlat, 43.1475, 5, 800, true) returning id into r1;
  reset role;
  select * into x from rides where id = r1;
  out := out || format(E'1 robot took it: status=%s driver=%s pin_ok=%s\n', x.status, x.driver_name, x.pickup_pin_verified);
  update rides set accepted_at = now() - interval '20 seconds' where id = r1;
  set local role authenticated; j := driver_position(x.driver_id); reset role;
  out := out || format(E'1 robot position t=20 (halfway): %s\n', round((j->>'latitude')::numeric,4));
  update rides set accepted_at = now() - interval '41 seconds' where id = r1; perform demo_robot_tick();
  out := out || format(E'1 t=41: %s\n', (select status from rides where id=r1));
  update rides set accepted_at = now() - interval '56 seconds' where id = r1; perform demo_robot_tick();
  out := out || format(E'1 t=56: %s\n', (select status from rides where id=r1));
  update rides set accepted_at = now() - interval '200 seconds' where id = r1; perform demo_robot_tick();
  out := out || format(E'1 t=200: %s\n', (select status from rides where id=r1));

  set local role authenticated;
  insert into rides (customer_id, service_type, ride_type, pickup_lat, pickup_lng, destination_lat, destination_lng, distance_km, fare, demo, package)
    values (c, 'delivery', 'Caval moto', 11.5946, 43.1475, dlat, 43.1475, 5, 400, true, '{"size":"petit","recipientName":"X","recipientPhone":"77 12 34 56"}') returning id into r2;
  reset role;
  out := out || format(E'2 delivery robot: %s %s\n', (select status from rides where id=r2), (select driver_name from rides where id=r2));

  perform set_config('request.jwt.claims', json_build_object('sub',dd,'role','authenticated')::text, true);
  set local role authenticated;
  begin perform demo_request_ride('ride'); out := out || E'3 offline request: ALLOWED (bad)\n';
  exception when others then out := out || format(E'3 offline request: refused (%s)\n', sqlerrm); end;
  update drivers set is_online = true, is_available = true where id = dd;
  insert into driver_locations (driver_id, position) values (dd, extensions.st_makepoint(43.1475, 11.5946)::extensions.geography)
    on conflict (driver_id) do update set position = excluded.position, updated_at = now();
  r1 := demo_request_ride('ride');
  select * into x from rides where id = r1;
  out := out || format(E'3 offer: status=%s to_me=%s fare=%s\n', x.status, x.selected_driver_id = dd, x.fare);
  perform accept_ride(r1); perform driver_arrived(r1); perform start_ride(r1, null); perform complete_ride(r1);
  out := out || format(E'3 completed: %s\n', (select status from rides where id=r1));
  r2 := demo_request_ride('delivery');
  perform accept_ride(r2); perform driver_arrived(r2); perform start_ride(r2, 'https://x/p.jpg');
  out := out || format(E'3 delivery with demo code: %s\n', confirm_delivery(r2, demo_delivery_code(r2)));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub',gen_random_uuid(),'role','authenticated')::text, true);
  set local role authenticated;
  begin perform demo_request_ride('ride'); out := out || E'4 stranger: ALLOWED (bad)\n';
  exception when others then out := out || format(E'4 stranger refused: %s\n', sqlerrm); end;
  reset role;
  raise exception E'RESULTS (rolled back)\n%', out;
end $$;
