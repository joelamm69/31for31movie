// Powers index.html. What the top of the page shows is chosen by the site
// owner on admin.html and stored in Supabase's site_settings table
// (key = 'home'), in one of three modes:
//   list     -> one of the owner's lists: Tonight's Feature hero + day grid
//               (October countdown optional)
//   movie    -> a single promoted movie, plus what the community rated it
//   discover -> movies the community has rated most recently
// If that row is missing or can't be read, it falls back to the published
// "31for31 2026" list, then to the local CURRENT_LIST.
// Below that: a live TMDB Discover panel and a newsletter signup.

// Fallback list when site_settings has nothing usable.
const HOME_LIST_NAME = "31for31 2026";
const DISCOVER_LIMIT = 24;

function pad2(n) { return String(n).padStart(2, "0"); }

function octoberDayInfo() {
    const now = new Date();
    const isOctober = now.getMonth() === 9; // Date#getMonth is 0-indexed; Oct = 9
    return { isOctober, today: isOctober ? now.getDate() : null };
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

// Defense in depth, same as activity.js: never show an email as a name.
function safeDisplayName(name) {
    return name && !name.includes("@") ? name : "Anonymous";
}

function relativeTime(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
}

function yearOf(movie) {
    return (movie?.release_date || "").slice(0, 4);
}

// TMDB movies use poster_path (needs the TMDB CDN prefix); the legacy
// local CURRENT_LIST fallback uses a direct file path.
function posterSrcFor(movie, size) {
    return movie.file || tmdbPosterUrl(movie.poster_path, size) || "";
}

function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setTags(tags) {
    const el = document.getElementById("feature-tags");
    if (el) el.innerHTML = tags.filter(Boolean).map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("");
}

function setHeroPoster(movie, label) {
    const img = document.getElementById("feature-poster");
    img.src = posterSrcFor(movie, "w500");
    img.alt = movie.title || "";
    setText("feature-meta-label", label);
}

function setGridVisible(visible) {
    const section = document.getElementById("home-grid-section");
    if (section) section.hidden = !visible;
}

async function loadHomeSettings() {
    try {
        const { data, error } = await window.sb.from("site_settings").select("*").eq("key", "home").maybeSingle();
        if (error) throw error;
        return data;
    } catch (err) {
        console.error("Failed to load home page settings", err);
        return null;
    }
}

// Old behaviour: the published "31for31 2026" list, resolved through TMDB.
async function loadFallbackList() {
    try {
        const { data, error } = await window.sb.from("movie_lists").select("*").eq("list_name", HOME_LIST_NAME).maybeSingle();
        if (error) throw error;
        if (!data || !data.movie_ids || !data.movie_ids.length) return null;
        const movies = await tmdbFetchMovies(data.movie_ids);
        return movies.length ? movies : null;
    } catch (err) {
        console.error(`Failed to load "${HOME_LIST_NAME}" from Supabase`, err);
        return null;
    }
}

// --- Mode: list ---

function renderListMode(list, { listName, countdown, headline, blurb }) {
    const { isOctober, today } = octoberDayInfo();
    const counting = countdown && isOctober;
    const dayIndex = counting ? Math.min(today, list.length) : 1;
    const movie = list[dayIndex - 1];
    if (!movie) return;

    const name = listName || "The List";
    const defaultBadge = countdown ? (isOctober ? "Tonight's Feature" : "Preview") : "Featured";
    setText("feature-eyebrow-label", headline || defaultBadge);
    setText(
        "feature-eyebrow-sub",
        countdown
            ? (isOctober ? `Day ${pad2(dayIndex)} of ${list.length}` : `This October · Day ${pad2(dayIndex)} preview`)
            : `${list.length} films`
    );
    setText("feature-title", movie.title);
    setText("feature-sub", blurb || `From the ${name} list.`);
    setTags([name, "Horror"]);
    setHeroPoster(movie, name.toUpperCase());
    setText("feature-day", countdown ? `DAY ${pad2(dayIndex)}` : `#${pad2(dayIndex)}`);

    setText("day-grid-heading", name);
    const grid = document.getElementById("day-grid");
    grid.innerHTML = list
        .map((m, i) => {
            const day = i + 1;
            const sealed = counting && day > today;
            const isToday = counting && day === today;
            return `
                <div class="day-tile${sealed ? " sealed" : ""}${isToday ? " today" : ""}">
                    <div class="tile-art">
                        <img src="${posterSrcFor(m)}" alt="${sealed ? "" : escapeHtml(m.title)}" loading="lazy">
                        <div class="daynum">${pad2(day)}</div>
                    </div>
                    <div class="tile-title">${sealed ? "———" : escapeHtml(m.title)}</div>
                </div>
            `;
        })
        .join("");

    setText(
        "day-grid-status",
        counting ? `${pad2(today)} REVEALED / ${pad2(Math.max(list.length - today, 0))} SEALED` : `${list.length} FILMS`
    );
    setGridVisible(true);
}

// --- Mode: movie ---

async function renderMovieMode(movie, { headline, blurb }) {
    setText("feature-eyebrow-label", headline || "Featured Film");
    setText("feature-eyebrow-sub", yearOf(movie));
    setText("feature-title", movie.title);
    setText("feature-sub", blurb || movie.overview || "");
    setTags([yearOf(movie), "Horror"]);
    setHeroPoster(movie, "FEATURED FILM");
    setText("feature-day", "★ PICK");

    // Under the hero: what the community thought of it, if anyone rated it.
    const { data, error } = await window.sb
        .from("movie_ratings")
        .select("user_name,rating,created_at")
        .eq("movie_id", movie.id)
        .order("created_at", { ascending: false })
        .limit(30);
    if (error) console.error("Failed to load ratings for featured movie", error);
    const ratings = data || [];
    if (!ratings.length) {
        setGridVisible(false);
        return;
    }
    const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;
    setText("feature-eyebrow-sub", [yearOf(movie), `★ ${avg.toFixed(1)} from ${ratings.length} rating${ratings.length === 1 ? "" : "s"}`].filter(Boolean).join(" · "));
    setText("day-grid-heading", "What the Community Thinks");
    setText("day-grid-status", `AVG ${avg.toFixed(1)} / 5`);
    const grid = document.getElementById("day-grid");
    grid.innerHTML = `<div style="grid-column:1/-1">${ratings
        .map(
            (r) => `
            <div class="movie-row">
                <div class="movie-meta">
                    <div class="title">${escapeHtml(safeDisplayName(r.user_name))}</div>
                    <div class="year">${relativeTime(r.created_at)}</div>
                </div>
                <div class="rating-stars">${[1, 2, 3, 4, 5].map((n) => `<span class="star${n <= r.rating ? " filled" : ""}">★</span>`).join("")}</div>
            </div>`
        )
        .join("")}</div>`;
    setGridVisible(true);
}

// --- Mode: discover (recently rated by the community) ---

async function loadRecentlyRated() {
    const { data, error } = await window.sb
        .from("movie_ratings")
        .select("movie_id,rating,user_name,created_at")
        .order("created_at", { ascending: false })
        .limit(300);
    if (error) throw error;

    // Group by movie, newest first.
    const byMovie = new Map();
    for (const r of data || []) {
        if (!byMovie.has(r.movie_id)) {
            if (byMovie.size >= DISCOVER_LIMIT) continue;
            byMovie.set(r.movie_id, { movie_id: r.movie_id, latest: r, total: 0, count: 0 });
        }
        const entry = byMovie.get(r.movie_id);
        entry.total += r.rating;
        entry.count += 1;
    }
    const entries = [...byMovie.values()];
    if (!entries.length) return [];

    // Titles/posters: TMDB if configured, else the app's movie_activity rows
    // (which carry a title and poster_path alongside each movie id).
    const ids = entries.map((e) => e.movie_id);
    const details = new Map();
    (await tmdbFetchMovies(ids)).forEach((m) => details.set(m.id, m));
    const missing = ids.filter((id) => !details.has(id));
    if (missing.length) {
        const { data: act } = await window.sb.from("movie_activity").select("movie_id,movie_title,poster_path").in("movie_id", missing);
        (act || []).forEach((a) => {
            if (!details.has(a.movie_id)) details.set(a.movie_id, { id: a.movie_id, title: a.movie_title, poster_path: a.poster_path });
        });
    }

    return entries
        .filter((e) => details.has(e.movie_id))
        .map((e) => ({ ...e, movie: details.get(e.movie_id), avg: e.total / e.count }));
}

async function renderDiscoverMode({ headline, blurb }) {
    let items = [];
    try {
        items = await loadRecentlyRated();
    } catch (err) {
        console.error("Failed to load recently rated movies", err);
    }
    if (!items.length) return false;

    const top = items[0];
    setText("feature-eyebrow-label", headline || "Just Reviewed");
    setText("feature-eyebrow-sub", `${safeDisplayName(top.latest.user_name)} rated it ${top.latest.rating}/5 · ${relativeTime(top.latest.created_at)}`);
    setText("feature-title", top.movie.title);
    setText("feature-sub", blurb || top.movie.overview || "Fresh from the community's latest ratings.");
    setTags(["Discover", yearOf(top.movie), `★ ${top.avg.toFixed(1)}`]);
    setHeroPoster(top.movie, "COMMUNITY PICKS");
    setText("feature-day", "LATEST");

    setText("day-grid-heading", "Recently Reviewed");
    setText("day-grid-status", `${items.length} FILMS`);
    document.getElementById("day-grid").innerHTML = items
        .map(
            (it) => `
            <div class="day-tile">
                <div class="tile-art">
                    <img src="${posterSrcFor(it.movie)}" alt="${escapeHtml(it.movie.title)}" loading="lazy">
                    <div class="daynum">★${it.avg.toFixed(1)}</div>
                </div>
                <div class="tile-title">${escapeHtml(it.movie.title)}</div>
            </div>`
        )
        .join("");
    setGridVisible(true);
    return true;
}

async function renderHome() {
    const settings = await loadHomeSettings();
    const opts = { headline: settings?.headline?.trim(), blurb: settings?.blurb?.trim() };

    if (settings?.mode === "movie" && settings.featured_movie?.title) {
        await renderMovieMode(settings.featured_movie, opts);
        return;
    }
    if (settings?.mode === "discover" && (await renderDiscoverMode(opts))) {
        return;
    }
    if (settings?.mode === "list" && Array.isArray(settings.movies) && settings.movies.length) {
        renderListMode(settings.movies, { ...opts, listName: settings.list_name, countdown: settings.countdown });
        return;
    }

    const list = (await loadFallbackList()) || window.CURRENT_LIST || [];
    if (list.length) renderListMode(list, { listName: `The ${HOME_LIST_NAME.replace(/^31for31 /, "")} List`, countdown: true });
}

// --- Discover: live TMDB data, no fictional pool ---

async function loadPopularHorror() {
    const el = document.getElementById("discover-popular");
    if (!el) return;
    if (!tmdbConfigured()) {
        el.innerHTML = `<p style="padding:1rem 0;font-size:0.85rem">Needs a TMDB API key to show live picks — see assets/js/tmdb-config.example.js.</p>`;
        return;
    }
    try {
        const res = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${window.TMDB_API_KEY}&with_genres=27&sort_by=popularity.desc&include_adult=false`);
        const json = await res.json();
        const movies = (json.results || []).slice(0, 5);
        el.innerHTML = movies
            .map(
                (m) => `
                <div style="background:var(--bg-card); padding:17px 4px; display:flex; align-items:center; gap:18px">
                    <span style="font-family:var(--font-mono); font-size:0.68rem; color:var(--text-dimmest); letter-spacing:0.1em; width:44px; flex:none">${(m.release_date || "").slice(0, 4) || "—"}</span>
                    <span style="font-family:var(--font-mono); font-weight:700; font-size:0.85rem; text-transform:uppercase; letter-spacing:0.01em; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(m.title)}</span>
                    <span style="font-family:var(--font-mono); font-weight:700; font-size:0.78rem; color:var(--red); width:32px; text-align:right; flex:none">${m.vote_average ? m.vote_average.toFixed(1) : "—"}</span>
                </div>
            `
            )
            .join("");
    } catch (err) {
        console.error("Failed to load popular horror", err);
        el.innerHTML = `<p style="padding:1rem 0;font-size:0.85rem">Couldn't load live picks right now.</p>`;
    }
}

async function randomPick() {
    const btn = document.getElementById("random-pick-btn");
    const resultEl = document.getElementById("discover-result");
    if (!tmdbConfigured()) {
        resultEl.innerHTML = `<div class="alert alert-error">Needs a TMDB API key — see assets/js/tmdb-config.example.js.</div>`;
        return;
    }
    btn.disabled = true;
    resultEl.innerHTML = `<p style="font-size:0.85rem">Rolling the dice...</p>`;
    try {
        const page = Math.floor(Math.random() * 20) + 1;
        const res = await fetch(`https://api.themoviedb.org/3/discover/movie?api_key=${window.TMDB_API_KEY}&with_genres=27&sort_by=popularity.desc&include_adult=false&page=${page}`);
        const json = await res.json();
        const results = json.results || [];
        if (!results.length) throw new Error("No results");
        const movie = results[Math.floor(Math.random() * results.length)];
        const poster = tmdbPosterUrl(movie.poster_path);
        resultEl.innerHTML = `
            <div class="discover-result">
                ${poster ? `<img src="${poster}" alt="">` : ""}
                <div>
                    <div style="font-family:var(--font-mono); font-weight:700; text-transform:uppercase; font-size:0.95rem">${escapeHtml(movie.title)} <span style="color:var(--text-dimmer); font-weight:400">${(movie.release_date || "").slice(0, 4)}</span></div>
                    <p class="overview">${escapeHtml((movie.overview || "").slice(0, 220))}${movie.overview && movie.overview.length > 220 ? "…" : ""}</p>
                    <a class="btn btn-sm" href="lists.html">Add to a list</a>
                </div>
            </div>
        `;
    } catch (err) {
        console.error("Random pick failed", err);
        resultEl.innerHTML = `<div class="alert alert-error">Couldn't fetch a pick right now — try again.</div>`;
    } finally {
        btn.disabled = false;
    }
}

// --- Newsletter: real capture into Supabase, no email sending ---

async function submitNewsletter(e) {
    e.preventDefault();
    const input = document.getElementById("newsletter-email");
    const msgEl = document.getElementById("newsletter-msg");
    const email = input.value.trim();
    if (!email) return;

    const btn = e.target.querySelector("button");
    btn.disabled = true;
    const { error } = await window.sb.from("newsletter_subscribers").insert({ email });
    btn.disabled = false;

    if (error) {
        // Unique-constraint violation just means they're already subscribed.
        if (error.code === "23505") {
            msgEl.innerHTML = `<div class="alert alert-info" style="margin:0.75rem 0 0">You're already on the list.</div>`;
        } else {
            console.error("Newsletter signup failed", error);
            msgEl.innerHTML = `<div class="alert alert-error" style="margin:0.75rem 0 0">Something went wrong — try again.</div>`;
        }
        return;
    }
    input.value = "";
    msgEl.innerHTML = `<div class="alert alert-info" style="margin:0.75rem 0 0">You're in — first reminder goes out October 1st.</div>`;
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("random-pick-btn")?.addEventListener("click", randomPick);
    document.getElementById("newsletter-form")?.addEventListener("submit", submitNewsletter);
    loadPopularHorror();
    await renderHome();
});
