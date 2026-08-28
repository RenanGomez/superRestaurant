-- Structural fixtures only. These rows do not impersonate Supabase Auth users.
-- Remote Auth users, memberships and critical-write evidence must be created by
-- the pending admin bootstrap described in ../bootstrap/README.md.
insert into adr010_b.restaurants (id, name) values
  ('00000000-0000-4000-8000-0000000000a1', 'Amber'),
  ('00000000-0000-4000-8000-0000000000b1', 'Cobalt')
on conflict do nothing;

insert into adr010_b.branches (id, restaurant_id, name) values
  ('00000000-0000-4000-8000-0000000000a2', '00000000-0000-4000-8000-0000000000a1', 'Amber North'),
  ('00000000-0000-4000-8000-0000000000a3', '00000000-0000-4000-8000-0000000000a1', 'Amber South'),
  ('00000000-0000-4000-8000-0000000000b2', '00000000-0000-4000-8000-0000000000b1', 'Cobalt North'),
  ('00000000-0000-4000-8000-0000000000b3', '00000000-0000-4000-8000-0000000000b1', 'Cobalt South')
on conflict do nothing;
