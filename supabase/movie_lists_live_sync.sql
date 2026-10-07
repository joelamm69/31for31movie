-- Incremental migration for an EXISTING movie_lists table created before
-- live-sync support was added (i.e. an older copy of movie_lists.sql without
-- the list_id column). Already applied directly to the production project
-- via the Supabase MCP on 2026-10-07 — this file is for anyone else
-- reproducing the setup (e.g. a separate Supabase project) from an older
-- base. Safe to re-run.

alter table movie_lists add column if not exists list_id text;

do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'movie_lists_user_list_unique'
    ) then
        alter table movie_lists add constraint movie_lists_user_list_unique unique (user_id, list_id);
    end if;
end $$;

-- Security fix bundled with this migration: the original movie_lists.sql's
-- insert policy predates this file and may have been created permissively
-- (`with check (true)`, allowing publishing under any user_id). Replace it
-- with the properly scoped version regardless of its current name/state.
drop policy if exists "Anyone can insert movie lists" on movie_lists;
drop policy if exists "Users can publish their own lists" on movie_lists;
create policy "Users can publish their own lists"
    on movie_lists for insert
    with check ((auth.uid())::text = user_id);

do $$
begin
    if not exists (
        select 1 from pg_policies where tablename = 'movie_lists' and policyname = 'Users can update their own lists'
    ) then
        create policy "Users can update their own lists"
            on movie_lists for update
            using ((auth.uid())::text = user_id);
    end if;
end $$;
