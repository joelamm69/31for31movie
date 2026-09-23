// Powers activity.html: a live feed combining watch_activity (logged from
// lists.js whenever someone marks a movie watched) and movie_ratings
// (written by the app's rating feature) — both public, both keyed by
// display name, never email. Realtime subscriptions push new rows in as
// they happen, no polling/refresh needed.

const FEED_LIMIT = 30;
let feedItems = [];
const movieCache = new Map(); // movie_id -> TMDB movie details

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

// Defense in depth: the app has historically fallen back to email when a
// user has no display name set, so some existing rows may carry one even
// though this site's own code now never writes an email into these
// tables (see publicNameFor in auth.js). Never render one on this public
// page regardless of source.
function safeDisplayName(name) {
    return name && !name.includes("@") ? name : "Anonymous";
}

function relativeTime(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

async function fetchInitialFeed() {
    const [watchedRes, ratedRes] = await Promise.all([
        window.sb.from("watch_activity").select("*").order("created_at", { ascending: false }).limit(FEED_LIMIT),
        window.sb.from("movie_ratings").select("*").order("created_at", { ascending: false }).limit(FEED_LIMIT),
    ]);
    if (watchedRes.error) console.error("Failed to load watch_activity", watchedRes.error);
    if (ratedRes.error) console.error("Failed to load movie_ratings", ratedRes.error);

    const items = [
        ...(watchedRes.data || []).map((r) => ({ type: "watched", user_name: r.user_name, movie_id: r.movie_id, created_at: r.created_at, key: `w-${r.id}` })),
        ...(ratedRes.data || []).map((r) => ({ type: "rated", user_name: r.user_name, movie_id: r.movie_id, rating: r.rating, created_at: r.created_at, key: `r-${r.id}` })),
    ];
    items.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return items.slice(0, FEED_LIMIT);
}

async function resolveMovies(items) {
    const ids = [...new Set(items.map((i) => i.movie_id))].filter((id) => !movieCache.has(id));
    if (!ids.length) return;
    const movies = await tmdbFetchMovies(ids);
    movies.forEach((m) => movieCache.set(m.id, m));
}

function feedItemHtml(item) {
    const movie = movieCache.get(item.movie_id);
    const title = movie ? movie.title : `Movie #${item.movie_id}`;
    const poster = movie ? tmdbPosterUrl(movie.poster_path) : null;
    const action = item.type === "watched" ? "watched" : `rated ${item.rating}/5 &mdash;`;
    return `
        <div class="movie-row">
            ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;background:var(--bg-raised);flex-shrink:0"></div>`}
            <div class="movie-meta">
                <div class="title">${escapeHtml(safeDisplayName(item.user_name))} ${action} ${escapeHtml(title)}</div>
                <div class="year">${relativeTime(item.created_at)}</div>
            </div>
        </div>
    `;
}

function render() {
    const container = document.getElementById("activity-feed");
    if (!container) return;
    container.innerHTML = feedItems.length
        ? feedItems.map(feedItemHtml).join("")
        : `<div class="empty-state">No activity yet. Mark a movie watched in <a href="lists.html">My Lists</a> to be the first!</div>`;
}

async function handleNewRow(item) {
    await resolveMovies([item]);
    // Realtime can occasionally redeliver — skip anything already shown.
    if (feedItems.some((existing) => existing.key === item.key)) return;
    feedItems = [item, ...feedItems].slice(0, FEED_LIMIT);
    render();
}

function subscribeRealtime() {
    window.sb
        .channel("activity-feed")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "watch_activity" }, (payload) => {
            const r = payload.new;
            handleNewRow({ type: "watched", user_name: r.user_name, movie_id: r.movie_id, created_at: r.created_at, key: `w-${r.id}` });
        })
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "movie_ratings" }, (payload) => {
            const r = payload.new;
            handleNewRow({ type: "rated", user_name: r.user_name, movie_id: r.movie_id, rating: r.rating, created_at: r.created_at, key: `r-${r.id}` });
        })
        .subscribe();
}

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("activity-feed");
    if (!container) return;

    container.innerHTML = `<p>Loading activity...</p>`;
    feedItems = await fetchInitialFeed();
    await resolveMovies(feedItems);
    render();
    subscribeRealtime();
});
