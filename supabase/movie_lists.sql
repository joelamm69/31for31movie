-- Run this once in the Supabase SQL editor for this project, IF the
-- `movie_lists` table doesn't already exist there (CloudManager.swift in the
-- app repo reads/writes this table but its create script wasn't checked into
-- that repo — this mirrors the columns it actually uses, including the live
-- project's actual types: user_id is text, not uuid).
--
-- Backs community.html / community.js (browsing, deleting your own shared
-- lists) and lists.js (publishing), same as CloudManager.swift /
-- CommunityListDetailView.swift in the app.
--
-- A published row is a live-synced pointer to the source list in
-- user_libraries.lists, keyed by list_id — not a frozen snapshot. See
-- movie_lists_live_sync.sql if you already have an older copy of this table
-- without that column.

create table if not exists movie_lists (
    id uuid primary key default gen_random_uuid(),
    user_id text not null,
    list_id text,
    list_name text not null,
    movie_ids integer[] not null default '{}',
    created_at timestamptz not null default now(),
    unique (user_id, list_id)
);

alter table movie_lists enable row level security;

create policy "Movie lists are viewable by everyone"
    on movie_lists for select
    using (true);

create policy "Users can publish their own lists"
    on movie_lists for insert
    with check ((auth.uid())::text = user_id);

create policy "Users can update their own lists"
    on movie_lists for update
    using ((auth.uid())::text = user_id);

create policy "Users can delete their own lists"
    on movie_lists for delete
    using ((auth.uid())::text = user_id);
