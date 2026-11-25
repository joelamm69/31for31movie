-- "Between Octobers": the social + year-round layer.
--
-- Adds, on top of the existing tables (user_libraries, movie_ratings,
-- movie_lists, watch_activity, site_settings):
--
--   profiles (extended)  public handle + display name + terms acceptance
--   watch_entries        the diary: one row per watch of a movie, a TV
--                        show, or a single TV episode, with an optional
--                        quick note, an optional considered review, a
--                        rating, mood tags, a spoiler flag and per-entry
--                        visibility. Recaps, the October/other-months split,
--                        spoiler unlocking and the follow feed all read it.
--   follows / blocks     the social graph
--   reports              App Store UGC requirement: report anything
--   october_bin          "Save for October": titles flagged during the year
--   challenges           time-boxed commitments (31 for 31, 12 for 12,
--   challenge_items      finish-a-series-by, 10 from the 80s, ...), with
--   challenge_members    co-owners for shared marathons
--
-- Titles are identified everywhere by (media_type, tmdb_id), because TMDB
-- movie ids and TV ids overlap: movie 1399 and TV show 1399 are different
-- things. Episodes add (season, episode).
--
-- Visibility rules (enforced here by RLS, not by the web/app UI):
--   public     anyone, except accounts the author blocked or who blocked them
--   followers  only accounts that follow the author (and aren't blocked)
--   private    only the author
-- Entries a site admin hid after a report are visible only to their author.
--
-- Safe to re-run.

------------------------------------------------------------------------------
-- Profiles
------------------------------------------------------------------------------
-- profiles already exists (id, username unique, created_at) with a public
-- select policy and an insert-own policy. Add what the social features need.

alter table profiles add column if not exists display_name text;
alter table profiles add column if not exists bio text;
alter table profiles add column if not exists terms_accepted_at timestamptz;
alter table profiles add column if not exists updated_at timestamptz not null default now();

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'profiles_username_format') then
        alter table profiles add constraint profiles_username_format
            check (username ~ '^[a-z0-9_]{3,24}$');
    end if;
end $$;

drop policy if exists "Users can update their own profile" on profiles;
create policy "Users can update their own profile"
    on profiles for update
    using (auth.uid() = id)
    with check (auth.uid() = id);

------------------------------------------------------------------------------
-- Social graph
------------------------------------------------------------------------------
create table if not exists follows (
    follower_id uuid not null references auth.users(id) on delete cascade,
    followee_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (follower_id, followee_id),
    check (follower_id <> followee_id)
);
create index if not exists follows_followee_idx on follows (followee_id);

create table if not exists blocks (
    blocker_id uuid not null references auth.users(id) on delete cascade,
    blocked_id uuid not null references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked_idx on blocks (blocked_id);

alter table follows enable row level security;
alter table blocks enable row level security;

-- security definer so policies on other tables can consult blocks/follows
-- without the caller being able to read other people's block lists.
create or replace function is_blocked_between(a uuid, b uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.blocks
         where (blocker_id = a and blocked_id = b)
            or (blocker_id = b and blocked_id = a)
    );
$$;

create or replace function is_following(follower uuid, followee uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (
        select 1 from public.follows where follower_id = follower and followee_id = followee
    );
$$;

-- Can the current user see something `author` posted with `visibility`?
create or replace function can_view(author uuid, visibility text)
returns boolean
language sql stable security definer set search_path = public
as $$
    select case
        when auth.uid() = author then true
        when public.is_blocked_between(auth.uid(), author) then false
        when visibility = 'public' then true
        when visibility = 'followers' then auth.uid() is not null and public.is_following(auth.uid(), author)
        else false
    end;
$$;

-- Follow lists are public (follower counts, "who follows whom"), except
-- across a block.
drop policy if exists "Follows are viewable" on follows;
create policy "Follows are viewable"
    on follows for select
    using (
        auth.uid() in (follower_id, followee_id)
        or not (is_blocked_between(auth.uid(), follower_id) or is_blocked_between(auth.uid(), followee_id))
    );

drop policy if exists "Users can follow" on follows;
create policy "Users can follow"
    on follows for insert
    with check (auth.uid() = follower_id and not is_blocked_between(follower_id, followee_id));

drop policy if exists "Users can unfollow" on follows;
create policy "Users can unfollow"
    on follows for delete
    using (auth.uid() = follower_id or auth.uid() = followee_id); -- followee can remove a follower

-- Block lists are private to the blocker.
drop policy if exists "Users see their own blocks" on blocks;
create policy "Users see their own blocks"
    on blocks for select using (auth.uid() = blocker_id);

drop policy if exists "Users can block" on blocks;
create policy "Users can block"
    on blocks for insert with check (auth.uid() = blocker_id);

drop policy if exists "Users can unblock" on blocks;
create policy "Users can unblock"
    on blocks for delete using (auth.uid() = blocker_id);

-- Blocking someone removes follows in both directions.
create or replace function drop_follows_on_block()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    delete from public.follows
     where (follower_id = new.blocker_id and followee_id = new.blocked_id)
        or (follower_id = new.blocked_id and followee_id = new.blocker_id);
    return new;
end;
$$;

drop trigger if exists blocks_drop_follows on blocks;
create trigger blocks_drop_follows
    after insert on blocks
    for each row execute function drop_follows_on_block();

------------------------------------------------------------------------------
-- Diary: watches, notes, reviews
------------------------------------------------------------------------------
create table if not exists watch_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    media_type text not null check (media_type in ('movie', 'tv')),
    tmdb_id integer not null,
    season integer,                 -- TV only; null = the show as a whole
    episode integer,                -- TV only; requires season
    title text not null,            -- denormalized so feeds need no TMDB call
    poster_path text,
    watched_on date not null default current_date,
    in_october boolean generated always as (extract(month from watched_on) = 10) stored,
    rating smallint check (rating between 1 and 5),
    note text check (char_length(note) <= 2000),     -- quick, informal, during/after
    review text check (char_length(review) <= 10000), -- optional considered take
    spoiler boolean not null default false,
    mood_tags text[] not null default '{}',
    visibility text not null default 'followers' check (visibility in ('public', 'followers', 'private')),
    hidden_by_moderator boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    check (media_type = 'tv' or (season is null and episode is null)),
    check (episode is null or season is not null),
    check (cardinality(mood_tags) <= 8)
);
create index if not exists watch_entries_title_idx on watch_entries (media_type, tmdb_id, season, episode);
create index if not exists watch_entries_user_idx on watch_entries (user_id, watched_on desc);
create index if not exists watch_entries_created_idx on watch_entries (created_at desc);
create index if not exists watch_entries_moods_idx on watch_entries using gin (mood_tags);

alter table watch_entries enable row level security;

drop policy if exists "Entries are visible per their visibility" on watch_entries;
create policy "Entries are visible per their visibility"
    on watch_entries for select
    using (
        auth.uid() = user_id
        or (not hidden_by_moderator and can_view(user_id, visibility))
        or is_site_admin()
    );

drop policy if exists "Users can log their own entries" on watch_entries;
create policy "Users can log their own entries"
    on watch_entries for insert
    with check (auth.uid() = user_id and hidden_by_moderator = false);

drop policy if exists "Users can edit their own entries" on watch_entries;
create policy "Users can edit their own entries"
    on watch_entries for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

drop policy if exists "Admins can moderate entries" on watch_entries;
create policy "Admins can moderate entries"
    on watch_entries for update
    using (is_site_admin())
    with check (is_site_admin());

drop policy if exists "Users can delete their own entries" on watch_entries;
create policy "Users can delete their own entries"
    on watch_entries for delete
    using (auth.uid() = user_id or is_site_admin());

-- Authors can't un-hide their own moderated entry by updating it.
create or replace function keep_moderation_flag()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
    if not public.is_site_admin() then
        new.hidden_by_moderator := old.hidden_by_moderator;
    end if;
    new.updated_at := now();
    return new;
end;
$$;

drop trigger if exists watch_entries_moderation on watch_entries;
create trigger watch_entries_moderation
    before update on watch_entries
    for each row execute function keep_moderation_flag();

------------------------------------------------------------------------------
-- Reports (App Store guideline 1.2: users must be able to flag content)
------------------------------------------------------------------------------
create table if not exists reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references auth.users(id) on delete cascade,
    target_type text not null check (target_type in ('entry', 'profile', 'list', 'challenge')),
    target_id text not null,
    target_user_id uuid references auth.users(id) on delete cascade,
    reason text not null check (reason in ('spam', 'harassment', 'hate', 'sexual', 'spoiler', 'other')),
    details text check (char_length(details) <= 1000),
    status text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    unique (reporter_id, target_type, target_id)
);

alter table reports enable row level security;

drop policy if exists "Users can file reports" on reports;
create policy "Users can file reports"
    on reports for insert with check (auth.uid() = reporter_id and status = 'open');

drop policy if exists "Reporters and admins can read reports" on reports;
create policy "Reporters and admins can read reports"
    on reports for select using (auth.uid() = reporter_id or is_site_admin());

drop policy if exists "Admins can resolve reports" on reports;
create policy "Admins can resolve reports"
    on reports for update using (is_site_admin()) with check (is_site_admin());

------------------------------------------------------------------------------
-- Save for October
------------------------------------------------------------------------------
create table if not exists october_bin (
    user_id uuid not null references auth.users(id) on delete cascade,
    media_type text not null check (media_type in ('movie', 'tv')),
    tmdb_id integer not null,
    title text not null,
    poster_path text,
    release_date text,
    reason text check (char_length(reason) <= 280), -- "why it's perfect for October"
    created_at timestamptz not null default now(),
    primary key (user_id, media_type, tmdb_id)
);

alter table october_bin enable row level security;

drop policy if exists "Users manage their own October bin" on october_bin;
create policy "Users manage their own October bin"
    on october_bin for all
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

------------------------------------------------------------------------------
-- Challenges
------------------------------------------------------------------------------
create table if not exists challenges (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references auth.users(id) on delete cascade,
    kind text not null check (kind in ('marathon', 'monthly', 'series', 'custom')),
    title text not null check (char_length(title) between 1 and 80),
    description text check (char_length(description) <= 500),
    target_count integer not null check (target_count between 1 and 366),
    starts_on date not null,
    ends_on date not null,
    -- For a marathon backed by one of the owner's lists in user_libraries.
    list_id text,
    -- For kind 'series': the show to finish.
    series_tmdb_id integer,
    visibility text not null default 'followers' check (visibility in ('public', 'followers', 'private')),
    created_at timestamptz not null default now(),
    check (ends_on >= starts_on)
);
create index if not exists challenges_owner_idx on challenges (owner_id);

create table if not exists challenge_members (
    challenge_id uuid not null references challenges(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    joined_at timestamptz not null default now(),
    primary key (challenge_id, user_id)
);

create table if not exists challenge_items (
    id uuid primary key default gen_random_uuid(),
    challenge_id uuid not null references challenges(id) on delete cascade,
    added_by uuid not null references auth.users(id) on delete cascade,
    media_type text not null check (media_type in ('movie', 'tv')),
    tmdb_id integer not null,
    season integer,
    episode integer,
    title text not null,
    poster_path text,
    slot integer,                -- night number in a marathon (1..31)
    completed_by uuid[] not null default '{}', -- members who checked it off
    created_at timestamptz not null default now()
);
create index if not exists challenge_items_challenge_idx on challenge_items (challenge_id);

alter table challenges enable row level security;
alter table challenge_members enable row level security;
alter table challenge_items enable row level security;

create or replace function is_challenge_member(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select exists (select 1 from public.challenges where id = cid and owner_id = auth.uid())
        or exists (select 1 from public.challenge_members where challenge_id = cid and user_id = auth.uid());
$$;

create or replace function can_view_challenge(cid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
    select public.is_challenge_member(cid)
        or exists (select 1 from public.challenges c where c.id = cid and public.can_view(c.owner_id, c.visibility));
$$;

drop policy if exists "Challenges are visible per their visibility" on challenges;
create policy "Challenges are visible per their visibility"
    on challenges for select using (can_view_challenge(id));

drop policy if exists "Users create their own challenges" on challenges;
create policy "Users create their own challenges"
    on challenges for insert with check (auth.uid() = owner_id);

drop policy if exists "Owners edit their challenges" on challenges;
create policy "Owners edit their challenges"
    on challenges for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owners delete their challenges" on challenges;
create policy "Owners delete their challenges"
    on challenges for delete using (auth.uid() = owner_id);

drop policy if exists "Members are visible with the challenge" on challenge_members;
create policy "Members are visible with the challenge"
    on challenge_members for select using (can_view_challenge(challenge_id));

-- Shared marathons: the owner adds friends (only people who follow each
-- other, so nobody can be dropped into a stranger's marathon); a member can
-- leave.
drop policy if exists "Owners add mutual follows as members" on challenge_members;
create policy "Owners add mutual follows as members"
    on challenge_members for insert
    with check (
        exists (select 1 from challenges c where c.id = challenge_id and c.owner_id = auth.uid())
        and is_following(auth.uid(), user_id)
        and is_following(user_id, auth.uid())
    );

drop policy if exists "Owners remove members, members leave" on challenge_members;
create policy "Owners remove members, members leave"
    on challenge_members for delete
    using (
        auth.uid() = user_id
        or exists (select 1 from challenges c where c.id = challenge_id and c.owner_id = auth.uid())
    );

drop policy if exists "Items are visible with the challenge" on challenge_items;
create policy "Items are visible with the challenge"
    on challenge_items for select using (can_view_challenge(challenge_id));

drop policy if exists "Members add items" on challenge_items;
create policy "Members add items"
    on challenge_items for insert
    with check (auth.uid() = added_by and is_challenge_member(challenge_id));

drop policy if exists "Members update items" on challenge_items;
create policy "Members update items"
    on challenge_items for update
    using (is_challenge_member(challenge_id))
    with check (is_challenge_member(challenge_id));

drop policy if exists "Members remove items" on challenge_items;
create policy "Members remove items"
    on challenge_items for delete using (is_challenge_member(challenge_id));

------------------------------------------------------------------------------
-- Realtime for the follow feed
------------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'watch_entries'
    ) then
        alter publication supabase_realtime add table watch_entries;
    end if;
end $$;
