# 31 for 31 — Website

A static horror-themed site (landing page, poster gallery, blog, and a
login + movie-lists experience) that shares its backend with the **31 for 31
iPad app**: both talk to the same Supabase project, so a user's account and
lists are identical on the web and in the app. No custom backend server is
needed — the browser talks to Supabase directly, protected by Row Level
Security policies.

## Why not WordPress

The interesting part of this site is the shared login + shared lists, and
that's a Supabase integration, not a CMS concern. Supabase ships a
JavaScript SDK that runs in any static page, so a plain HTML/CSS/JS site
gets full auth + data sync with a fraction of the effort a WordPress plugin
would take. The blog section here is a couple of hand-written pages — enough
for a personal project; see "Adding a blog post" below.

## Structure

```
index.html         Landing page
gallery.html        Poster gallery (this year's watchlist)
login.html          Sign up / log in
lists.html          My Lists — create lists, search TMDB, add movies,
                     mark watched, take notes, publish to Community
community.html       Browse lists other users have published
admin.html          Edit Home: choose what the home page shows (owner only)
blog/                Blog index + posts/
assets/css/          Shared theme
assets/js/           Supabase client, auth, lists, community, TMDB helpers
supabase/            SQL to (re-)create the Postgres tables this site uses
31for31/             This year's poster images (existing gallery assets)
```

## One-time setup

### 1. Supabase

This site is pre-configured (`assets/js/config.js`) to use the **same
Supabase project the iPad app uses** — same URL, same public/anon key. If
you want a fresh/separate project instead, create one at
[supabase.com](https://supabase.com), swap the two values in
`assets/js/config.js`, and run the SQL files in `supabase/` (SQL Editor →
paste → Run) to create the tables:

- `supabase/user_libraries.sql` — a user's lists, watched movies, notes
- `supabase/movie_ratings.sql` — community movie ratings
- `supabase/movie_lists.sql` — published/shared lists (Community page)
- `supabase/site_settings.sql` — what the home page shows, and who may change it

The anon key in `config.js` is meant to be public — Supabase's security
model relies on the Row Level Security policies in these SQL files, not on
keeping that key secret.

### 2. TMDB (movie search)

`lists.html`'s "search to add a movie" box and the poster previews on
`community.html` need a [TMDB API key](https://www.themoviedb.org/settings/api)
(free). This key is **not** committed to the repo (it's public on GitHub, and
the app's own `Config.swift` explicitly says to keep it out of public repos):

```
cp assets/js/tmdb-config.example.js assets/js/tmdb-config.js
```

Edit `assets/js/tmdb-config.js` and set `window.TMDB_API_KEY` to your key.
Without this file, everything else on the site still works — list creation,
auth, watched/notes — just not the "search TMDB" box.

## Data model (shared with the app)

`user_libraries` stores one row per signed-in user:

| column               | shape                                                          |
|-----------------------|-----------------------------------------------------------------|
| `user_id`             | uuid, matches `auth.users.id`                                  |
| `lists`                | jsonb array of `{ id: uuid, name: string, movies: Movie[] }`    |
| `watched_movie_ids`    | jsonb array of TMDB movie ids (int)                             |
| `movie_notes`          | jsonb object, `{ "<movie id>": "note text" }`                   |

A `Movie` is `{ id, title, overview, poster_path, release_date, genre_ids,
genres }` — the same shape TMDB's API returns, which is also exactly what
`Movie.swift` in the app decodes. `assets/js/lists.js` reads/writes this
table with the identical JSON shape, so a list created on the web shows up
in the app (and vice versa) the next time either syncs.

## Changing the home page

Signed in as the site owner, an **Edit Home** link appears in the nav
(`admin.html`). It offers three modes:

- **One of my lists** — the hero + poster grid from any of your lists, with
  an optional October countdown. It stays in sync with that list as you edit
  it on the web or in the app (a database trigger copies the changes).
- **A single movie** — promote one movie (search your lists or TMDB); the
  community's ratings for it show underneath.
- **Discover** — the movies people rated most recently, updating by itself.

Only accounts in the `site_admins` table can save; that's enforced by Row
Level Security, not by hiding the page. To add another admin, run in the
Supabase SQL editor:
`insert into site_admins (user_id) values ('<their auth user id>');`

## Deploying (Hostinger web hosting + GitHub)

The site is hosted on Hostinger web hosting, linked to this repo through
hPanel → Website → Advanced → Git, with Auto Deployment on (a GitHub webhook).
Every push to `main` goes live on its own; there is no server to manage.

`assets/js/tmdb-config.js` is gitignored, so it lives only on the host: it was
created once in hPanel's File Manager under `public_html/assets/js/`. Git
deploys leave it alone. If the site is ever re-created, add it again.

## Adding a blog post

Posts are Markdown files in `blog/_posts/`. You never edit the HTML by hand.

1. On GitHub, open `blog/_posts/` and click **Add file → Create new file**.
2. Name it with the date and a short name, e.g.
   `2026-12-01-best-christmas-horror.md`.
3. Paste in the top of `_TEMPLATE.md` (the `---` header with `title:` and
   `summary:`), then write the post below it.
4. Click **Commit changes**.

A GitHub Action (`.github/workflows/build-blog.yml`) then builds the page and
the blog index, commits them, and Hostinger publishes them, usually within a
couple of minutes. To change or remove a post, edit or delete its `.md` file
the same way. Images go in `blog/images/`.

To preview locally: `pip install markdown && python3 scripts/build_blog.py`.
