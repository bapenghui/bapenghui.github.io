create schema if not exists private;
revoke all on schema private from public;

create table public.photo_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default timezone('utc', now())
);

create function private.photo_tags_are_valid(input_tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select cardinality(input_tags) <= 12
    and not exists (
      select 1
      from unnest(input_tags) as tag
      where btrim(tag) = '' or char_length(tag) > 30
    );
$$;

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  summary text not null default '' check (char_length(summary) <= 600),
  alt_text text not null check (char_length(btrim(alt_text)) between 1 and 240),
  category text not null default '未分类' check (char_length(btrim(category)) between 1 and 40),
  tags text[] not null default '{}'::text[] check (private.photo_tags_are_valid(tags)),
  storage_path text not null unique check (storage_path like 'published/%'),
  source_type text not null check (source_type in ('local', 'web', 'migrated')),
  source_page_url text,
  source_image_url text,
  orientation text not null default 'landscape' check (orientation in ('landscape', 'portrait', 'square')),
  is_featured boolean not null default false,
  is_reserved boolean not null default false,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  published_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index photos_public_order_idx
  on public.photos (is_published, sort_order desc, published_at desc, created_at desc);
create index photos_eviction_idx
  on public.photos (is_reserved, created_at, id);
create index photos_owner_idx
  on public.photos (owner_id);

create function private.is_photo_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1
    from public.photo_admins
    where user_id = (select auth.uid())
  );
$$;

create function public.current_user_is_photo_admin()
returns boolean
language sql
security invoker
stable
set search_path = ''
as $$
  select private.is_photo_admin();
$$;

create function private.set_photo_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create trigger photos_set_updated_at
before update on public.photos
for each row execute function private.set_photo_updated_at();

create function private.enforce_photo_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('public.photos.capacity', 0));

  if (select count(*) from public.photos) >= 100 then
    raise exception using errcode = 'P0001', message = 'PHOTO_CAPACITY_REACHED';
  end if;

  return new;
end;
$$;

create trigger photos_enforce_capacity
before insert on public.photos
for each row execute function private.enforce_photo_capacity();

create function public.insert_photo_with_retention(
  p_owner_id uuid,
  p_title text,
  p_summary text,
  p_alt_text text,
  p_category text,
  p_tags text[],
  p_storage_path text,
  p_source_type text,
  p_source_page_url text default null,
  p_source_image_url text default null,
  p_orientation text default 'landscape',
  p_is_featured boolean default false,
  p_is_reserved boolean default false,
  p_is_published boolean default true,
  p_sort_order integer default 0,
  p_published_at timestamptz default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted_photo public.photos%rowtype;
  evicted_photo_id uuid;
  evicted_storage_path text;
begin
  if not exists (
    select 1 from public.photo_admins where user_id = p_owner_id
  ) then
    raise exception using errcode = 'P0001', message = 'PHOTO_OWNER_NOT_ADMIN';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('public.photos.capacity', 0));

  if (select count(*) from public.photos) >= 100 then
    select id, storage_path
      into evicted_photo_id, evicted_storage_path
    from public.photos
    where is_reserved = false
    order by created_at asc, id asc
    limit 1
    for update;

    if evicted_photo_id is null then
      raise exception using errcode = 'P0001', message = 'PHOTO_CAPACITY_RESERVED';
    end if;

    delete from public.photos where id = evicted_photo_id;
  end if;

  insert into public.photos (
    owner_id,
    title,
    summary,
    alt_text,
    category,
    tags,
    storage_path,
    source_type,
    source_page_url,
    source_image_url,
    orientation,
    is_featured,
    is_reserved,
    is_published,
    sort_order,
    published_at
  ) values (
    p_owner_id,
    btrim(p_title),
    btrim(p_summary),
    btrim(p_alt_text),
    btrim(p_category),
    p_tags,
    p_storage_path,
    p_source_type,
    p_source_page_url,
    p_source_image_url,
    p_orientation,
    p_is_featured,
    p_is_reserved,
    p_is_published,
    p_sort_order,
    case
      when p_is_published then coalesce(p_published_at, timezone('utc', now()))
      else p_published_at
    end
  ) returning * into inserted_photo;

  return jsonb_build_object(
    'photo', to_jsonb(inserted_photo),
    'evictedStoragePath', evicted_storage_path
  );
end;
$$;

alter table public.photo_admins enable row level security;
alter table public.photos enable row level security;

revoke all on table public.photo_admins from anon, authenticated;
revoke all on table public.photos from anon, authenticated;
grant select on table public.photos to anon, authenticated;
grant update (
  title,
  summary,
  alt_text,
  category,
  tags,
  orientation,
  is_featured,
  is_reserved,
  is_published,
  sort_order,
  published_at
) on table public.photos to authenticated;
grant delete on table public.photos to authenticated;

grant usage on schema private to authenticated, service_role;
revoke all on function private.photo_tags_are_valid(text[]) from public;
grant execute on function private.photo_tags_are_valid(text[]) to authenticated, service_role;
revoke all on function private.is_photo_admin() from public;
grant execute on function private.is_photo_admin() to authenticated;
revoke all on function public.current_user_is_photo_admin() from public, anon;
grant execute on function public.current_user_is_photo_admin() to authenticated;

revoke all on function public.insert_photo_with_retention(
  uuid, text, text, text, text, text[], text, text, text, text, text,
  boolean, boolean, boolean, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.insert_photo_with_retention(
  uuid, text, text, text, text, text[], text, text, text, text, text,
  boolean, boolean, boolean, integer, timestamptz
) to service_role;

create policy photos_select_public
on public.photos for select
to anon
using (is_published = true);

create policy photos_select_authenticated
on public.photos for select
to authenticated
using (is_published = true or (select private.is_photo_admin()));

create policy photos_update_admin
on public.photos for update
to authenticated
using ((select private.is_photo_admin()))
with check ((select private.is_photo_admin()));

create policy photos_delete_admin
on public.photos for delete
to authenticated
using ((select private.is_photo_admin()));

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'photos',
  'photos',
  true,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy photo_admin_staging_select
on storage.objects for select
to authenticated
using (
  bucket_id = 'photos'
  and (select private.is_photo_admin())
  and (storage.foldername(name))[1] = 'staging'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy photo_admin_staging_insert
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'photos'
  and (select private.is_photo_admin())
  and (storage.foldername(name))[1] = 'staging'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy photo_admin_staging_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'photos'
  and (select private.is_photo_admin())
  and (storage.foldername(name))[1] = 'staging'
  and (storage.foldername(name))[2] = (select auth.uid())::text
);

create policy photo_admin_published_delete
on storage.objects for delete
to authenticated
using (
  bucket_id = 'photos'
  and (select private.is_photo_admin())
  and (storage.foldername(name))[1] = 'published'
);
