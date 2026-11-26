-- Linter: pin search_path on the helper added in 000003.
alter function public.ride_driver_types(rides) set search_path = public;
