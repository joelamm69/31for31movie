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

## Deploying to Hostinger (VPS/Cloud)

This is a static site — no build step, no Node process required to serve
it. On your Hostinger VPS:

1. Point your domain's DNS A record at the VPS IP.
2. Install nginx and certbot: `apt install nginx certbot python3-certbot-nginx`.
3. Copy this repo to e.g. `/var/www/31for31` on the VPS.
4. Create `assets/js/tmdb-config.js` on the server (see above) — it's
   gitignored, so it won't come over with a `git pull`.
5. nginx server block:

   ```nginx
   server {
       listen 80;
       server_name yourdomain.com www.yourdomain.com;
       root /var/www/31for31;
       index index.html;

       location / {
           try_files $uri $uri/ =404;
       }
   }
   ```

6. `certbot --nginx -d yourdomain.com -d www.yourdomain.com` for HTTPS.
7. To deploy updates: `git pull` in `/var/www/31for31` (nginx serves the
   files directly, no restart needed).

## Adding a blog post

Copy `blog/posts/why-31-horror-movies.html`, edit the title/date/body, and
add a `<article class="blog-list-item">` entry linking to it from
`blog/index.html`.
