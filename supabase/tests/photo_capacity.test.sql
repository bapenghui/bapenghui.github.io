begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(8);

insert into auth.users (
  id,
  instance_id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  created_at,
  updated_at
) values (
  '11111111-1111-4111-8111-111111111111',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'photo-admin@example.test',
  '',
  now(),
  now(),
  now()
) on conflict (id) do nothing;

insert into public.photo_admins (user_id)
values ('11111111-1111-4111-8111-111111111111')
on conflict (user_id) do nothing;

insert into public.photos (
  id,
  owner_id,
  title,
  alt_text,
  storage_path,
  source_type,
  is_reserved,
  created_at
)
select
  ('00000000-0000-4000-8000-' || lpad(item::text, 12, '0'))::uuid,
  '11111111-1111-4111-8111-111111111111'::uuid,
  'Photo ' || item,
  'Photo ' || item,
  'published/' || item || '.jpg',
  'local',
  item = 1,
  '2026-01-01 00:00:00+00'::timestamptz + make_interval(secs => item)
from generate_series(1, 100) as item;

select is((select count(*) from public.photos), 100::bigint, 'table reaches exactly 100 photos');
select throws_ok(
  $$insert into public.photos (
      owner_id, title, alt_text, storage_path, source_type
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'Direct insert',
      'Direct insert',
      'published/direct.jpg',
      'local'
    )$$,
  'P0001',
  'PHOTO_CAPACITY_REACHED',
  'direct insert cannot exceed the hard limit'
);

create temporary table retention_result as
select public.insert_photo_with_retention(
  '11111111-1111-4111-8111-111111111111',
  'Newest photo',
  '',
  'Newest photo',
  '项目',
  array['new'],
  'published/newest.jpg',
  'local',
  null,
  null,
  'landscape',
  false,
  false,
  true,
  0,
  now()
) as payload;

select is((select count(*) from public.photos), 100::bigint, 'retention RPC keeps the table at 100');
select ok(
  exists(select 1 from public.photos where storage_path = 'published/1.jpg' and is_reserved),
  'oldest reserved photo survives replacement'
);
select ok(
  not exists(select 1 from public.photos where storage_path = 'published/2.jpg'),
  'oldest non-reserved photo is evicted'
);
select ok(
  exists(select 1 from public.photos where storage_path = 'published/newest.jpg'),
  'new photo is inserted'
);
select is(
  (select payload ->> 'evictedStoragePath' from retention_result),
  'published/2.jpg',
  'RPC returns the evicted storage path'
);

truncate table public.photos;

insert into public.photos (
  owner_id,
  title,
  alt_text,
  storage_path,
  source_type,
  is_reserved
)
select
  '11111111-1111-4111-8111-111111111111'::uuid,
  'Reserved ' || item,
  'Reserved ' || item,
  'published/reserved-' || item || '.jpg',
  'local',
  true
from generate_series(1, 100) as item;

select throws_ok(
  $$select public.insert_photo_with_retention(
      '11111111-1111-4111-8111-111111111111',
      'Blocked photo',
      '',
      'Blocked photo',
      '项目',
      array[]::text[],
      'published/blocked.jpg',
      'local',
      null,
      null,
      'landscape',
      false,
      false,
      true,
      0,
      now()
    )$$,
  'P0001',
  'PHOTO_CAPACITY_RESERVED',
  'all-reserved capacity rejects a new photo'
);

select * from finish();
rollback;
