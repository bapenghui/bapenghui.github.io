begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(21);

select has_table('public', 'photos', 'photos table exists');
select has_table('public', 'photo_admins', 'photo_admins table exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.photos'::regclass),
  'photos has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.photo_admins'::regclass),
  'photo_admins has RLS enabled'
);
select ok(has_table_privilege('anon', 'public.photos', 'select'), 'anon can select photos');
select ok(not has_table_privilege('anon', 'public.photos', 'insert'), 'anon cannot insert photos');
select ok(not has_table_privilege('anon', 'public.photos', 'update'), 'anon cannot update photos');
select ok(not has_table_privilege('anon', 'public.photos', 'delete'), 'anon cannot delete photos');
select ok(not has_table_privilege('authenticated', 'public.photos', 'insert'), 'authenticated cannot bypass retention with insert');
select ok(not has_table_privilege('authenticated', 'public.photo_admins', 'select'), 'authenticated cannot enumerate admins');
select ok(
  has_function_privilege('service_role', 'public.insert_photo_with_retention(uuid,text,text,text,text,text[],text,text,text,text,text,boolean,boolean,boolean,integer,timestamptz)', 'execute'),
  'service role can execute retention RPC'
);
select ok(
  not has_function_privilege('authenticated', 'public.insert_photo_with_retention(uuid,text,text,text,text,text[],text,text,text,text,text,boolean,boolean,boolean,integer,timestamptz)', 'execute'),
  'authenticated users cannot call retention RPC directly'
);
select has_function(
  'public',
  'current_user_is_photo_admin',
  array[]::text[],
  'admin status RPC exists'
);
select ok(
  not has_function_privilege('anon', 'public.current_user_is_photo_admin()', 'execute'),
  'anonymous users cannot call admin status RPC'
);
select ok(
  has_function_privilege('authenticated', 'public.current_user_is_photo_admin()', 'execute'),
  'authenticated users can check only their own admin status'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at
) values
  (
    '11111111-1111-4111-8111-111111111111',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'admin@example.test', '', now(), now(), now()
  ),
  (
    '22222222-2222-4222-8222-222222222222',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'reader@example.test', '', now(), now(), now()
  )
on conflict (id) do nothing;

insert into public.photo_admins (user_id)
values ('11111111-1111-4111-8111-111111111111')
on conflict (user_id) do nothing;

insert into public.photos (
  owner_id, title, alt_text, storage_path, source_type, is_published
) values
  (
    '11111111-1111-4111-8111-111111111111',
    'Published', 'Published', 'published/rls-public.jpg', 'local', true
  ),
  (
    '11111111-1111-4111-8111-111111111111',
    'Draft', 'Draft', 'published/rls-draft.jpg', 'local', false
  );

set local role anon;
select results_eq(
  'select count(*) from public.photos',
  array[1::bigint],
  'anonymous users see only published photos'
);
reset role;

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select is(
  public.current_user_is_photo_admin(),
  true,
  'configured admin receives a positive admin status'
);
select results_eq(
  'select count(*) from public.photos',
  array[2::bigint],
  'configured admin sees published photos and drafts'
);
select lives_ok(
  $$update public.photos set is_reserved = true where title = 'Draft'$$,
  'configured admin can update photo metadata'
);
reset role;

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
set local role authenticated;
select is(
  public.current_user_is_photo_admin(),
  false,
  'non-admin receives a negative admin status'
);
select results_eq(
  $$update public.photos set is_reserved = true where title = 'Published' returning 1$$,
  $$select 1 where false$$,
  'non-admin authenticated user cannot update photos'
);
reset role;

select * from finish();
rollback;
