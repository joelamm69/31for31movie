-- Home page control (index.html / assets/js/home.js, edited from admin.html).
--
-- site_admins:   which accounts may change the home page. Rows are added by
--                hand here in SQL only. There is no insert policy, so nobody
--                can make themselves an admin from the browser.
-- site_settings: one row (key = 'home') saying what the home page shows:
--                  mode 'list'     -> one of the admin's lists (31-day grid)
--                  mode 'movie'    -> a single promoted movie
--                  mode 'discover' -> movies the community rated recently
--                Everyone can read it (the home page is public); only admins
--                can write it.
--
-- For mode 'list' the movies are copied into site_settings.movies, so the
-- public page can show them without reading the admin's private
-- user_libraries row. The trigger at the bottom keeps that copy in step
-- whenever the admin edits the chosen list (web or app).
--
-- Applied to the production project via the Supabase MCP on 2026-11-25.
-- Safe to re-run.

create table if not exists site_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

alter table site_admins enable row level security;

drop policy if exists "Admins can see their own admin row" on site_admins;
create policy "Admins can see their own admin row"
    on site_admins for select
    using (auth.uid() = user_id);

create or replace function is_site_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (select 1 from public.site_admins where user_id = auth.uid());
$$;

create table if not exists site_settings (
    key text primary key,
    mode text not null default 'list' check (mode in ('list', 'movie', 'discover')),
    list_id text,
    list_name text,
    movies jsonb not null default '[]'::jsonb,
    countdown boolean not null default true,
    featured_movie jsonb,
    headline text,
    blurb text,
    updated_by uuid references auth.users(id) on delete set null,
    updated_at timestamptz not null default now()
);

alter table site_settings enable row level security;

drop policy if exists "Site settings are viewable by everyone" on site_settings;
create policy "Site settings are viewable by everyone"
    on site_settings for select
    using (true);

drop policy if exists "Admins can create site settings" on site_settings;
create policy "Admins can create site settings"
    on site_settings for insert
    with check (is_site_admin());

drop policy if exists "Admins can update site settings" on site_settings;
create policy "Admins can update site settings"
    on site_settings for update
    using (is_site_admin())
    with check (is_site_admin());

-- Keep a 'list' mode home page live: when the admin who picked the list
-- saves their library, refresh the copied movies and name. If the list was
-- deleted, the last copy stays up rather than blanking the home page.
create or replace function sync_home_list_from_library()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.site_settings s
       set movies = coalesce(l.value -> 'movies', '[]'::jsonb),
           list_name = l.value ->> 'name'
      from jsonb_array_elements(coalesce(new.lists, '[]'::jsonb)) as l(value)
     where s.mode = 'list'
       and s.updated_by = new.user_id
       and upper(l.value ->> 'id') = upper(s.list_id);
    return new;
end;
$$;

drop trigger if exists sync_home_list on user_libraries;
create trigger sync_home_list
    after insert or update of lists on user_libraries
    for each row execute function sync_home_list_from_library();
