-- Run this once in the Supabase SQL editor for this project.
-- Backs the homepage newsletter signup form (assets/js/home.js). This only
-- captures emails — it does not send anything; wiring up actual sends
-- needs a separate mail service (out of scope here).

create table if not exists newsletter_subscribers (
    id uuid primary key default gen_random_uuid(),
    email text not null unique,
    created_at timestamptz not null default now()
);

alter table newsletter_subscribers enable row level security;

-- Anyone (including signed-out visitors) can sign up. No select policy is
-- defined, so the table is write-only from the client — only visible via
-- the Supabase dashboard or a service-role key.
create policy "Anyone can subscribe"
    on newsletter_subscribers for insert
    with check (true);
