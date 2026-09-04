-- Run this once in the Supabase SQL editor for this project, IF the
-- `movie_lists` table doesn't already exist there (CloudManager.swift in the
-- app repo reads/writes this table but its create script wasn't checked into
-- that repo — this mirrors the columns it actually uses).
--
-- Backs community.html / community.js (browsing) and lists.js (publishing),
-- same as CloudManager.swift / CommunityView.swift in the app.

create table if not exists movie_lists (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    list_name text not null,
    movie_ids integer[] not null default '{}',
    created_at timestamptz not null default now()
);

alter table movie_lists enable row level security;

-- The app fetches this table with just the anon key (no user session), so
-- reads need to be open to everyone.
create policy "Published lists are viewable by everyone"
    on movie_lists for select
    using (true);

create policy "Users can publish their own lists"
    on movie_lists for insert
    with check (auth.uid() = user_id);

create policy "Users can delete their own published lists"
    on movie_lists for delete
    using (auth.uid() = user_id);
