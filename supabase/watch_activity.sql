-- Run this once in the Supabase SQL editor for this project.
-- Backs the live activity feed (activity.html / assets/js/activity.js):
-- logs one row every time a signed-in user marks a movie watched in My
-- Lists. Stores user_name (display name) directly, same privacy-conscious
-- pattern movie_ratings.sql already uses — never the user's email.

create table if not exists watch_activity (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    user_name text not null,
    movie_id integer not null,
    created_at timestamptz not null default now()
);

alter table watch_activity enable row level security;

create policy "Watch activity is viewable by everyone"
    on watch_activity for select
    using (true);

create policy "Users can log their own watch activity"
    on watch_activity for insert
    with check (auth.uid() = user_id);

-- Enable Realtime so activity.html updates instantly on new rows instead
-- of polling. Guarded so it's safe to re-run even if movie_ratings (or
-- this table, on a re-run) is already published.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watch_activity'
    ) then
        alter publication supabase_realtime add table watch_activity;
    end if;

    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'movie_ratings'
    ) then
        alter publication supabase_realtime add table movie_ratings;
    end if;
end $$;
