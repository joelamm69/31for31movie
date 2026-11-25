// Powers admin.html: lets the site owner choose what the home page shows.
// Writes the single site_settings row (key = 'home') that home.js reads.
//
// Who counts as the owner is decided in the database, not here: the
// is_site_admin() function checks the site_admins table, and site_settings'
// Row Level Security only accepts writes from those accounts. Hiding this
// page from everyone else is just a courtesy; the database is the lock.

let adminUser = null;
let myLists = [];
let settings = null;
let selectedMovie = null; // for mode 'movie'
let searchTimer = null;

function movieSnapshot(m) {
    return {
        id: m.id,
        title: m.title,
        overview: m.overview || "",
        poster_path: m.poster_path || null,
        release_date: m.release_date || "",
        genre_ids: m.genre_ids || (m.genres || []).map((g) => g.id),
    };
}

function yearOf(m) {
    return (m?.release_date || "").slice(0, 4);
}

function msg(html) {
    document.getElementById("admin-msg").innerHTML = html;
}

async function loadData() {
    const [libRes, setRes] = await Promise.all([
        window.sb.from("user_libraries").select("lists").eq("user_id", adminUser.id).maybeSingle(),
        window.sb.from("site_settings").select("*").eq("key", "home").maybeSingle(),
    ]);
    if (libRes.error) console.error("Failed to load your lists", libRes.error);
    if (setRes.error) console.error("Failed to load home settings", setRes.error);
    myLists = libRes.data?.lists || [];
    settings = setRes.data || { mode: "list", countdown: true };
    selectedMovie = settings.featured_movie || null;
}

function modeCard(value, title, desc) {
    const checked = settings.mode === value ? "checked" : "";
    return `
        <label class="card" style="display:flex;gap:0.8rem;align-items:flex-start;cursor:pointer;margin:0">
            <input type="radio" name="home-mode" value="${value}" ${checked} style="margin-top:0.3rem">
            <span>
                <strong style="font-family:var(--font-mono);text-transform:uppercase;font-size:0.85rem;color:var(--text)">${title}</strong>
                <span style="display:block;font-size:0.88rem;color:var(--text-dim);margin-top:0.25rem">${desc}</span>
            </span>
        </label>`;
}

function selectedMovieHtml() {
    if (!selectedMovie) return `<p style="font-size:0.88rem">No movie picked yet — search above.</p>`;
    const poster = tmdbPosterUrl(selectedMovie.poster_path);
    return `
        <div class="movie-row">
            ${poster ? `<img src="${poster}" alt="">` : ""}
            <div class="movie-meta">
                <div class="title">${escapeHtml(selectedMovie.title)}</div>
                <div class="year">${yearOf(selectedMovie)}</div>
            </div>
            <span class="badge">Selected</span>
        </div>`;
}

function render() {
    const listOptions = myLists
        .map((l) => `<option value="${escapeHtml(l.id)}" ${String(l.id).toUpperCase() === String(settings.list_id || "").toUpperCase() ? "selected" : ""}>${escapeHtml(l.name)} (${(l.movies || []).length})</option>`)
        .join("");

    document.getElementById("admin-root").innerHTML = `
        <p>Pick what visitors see at the top of the home page. Changes go live as soon as you save.</p>
        <form id="admin-form" style="max-width:720px">
            <div style="display:grid;gap:0.75rem;margin:1.2rem 0 1.6rem">
                ${modeCard("list", "One of my lists", "Feature a list as the hero and poster grid, e.g. this year's 31 for 31.")}
                ${modeCard("movie", "A single movie", "Promote one movie, with the community's ratings for it underneath.")}
                ${modeCard("discover", "Discover", "Show the movies people rated most recently, newest first. Updates by itself.")}
            </div>

            <div data-mode="list" class="card">
                <div class="field">
                    <label for="list-select">List</label>
                    <select id="list-select">${listOptions || `<option value="">You have no lists yet</option>`}</select>
                </div>
                <label style="display:flex;gap:0.5rem;align-items:center;font-size:0.9rem;color:var(--text-dim)">
                    <input type="checkbox" id="countdown" ${settings.countdown !== false ? "checked" : ""}>
                    October countdown — one movie per day, later days stay sealed until they arrive
                </label>
                <p style="font-size:0.82rem;margin:0.8rem 0 0">The home page keeps up with this list: add, remove or reorder movies in My Lists or the app and it updates.</p>
            </div>

            <div data-mode="movie" class="card">
                <div class="field">
                    <label for="movie-search">Find a movie</label>
                    <input type="search" id="movie-search" placeholder="Search your lists${tmdbConfigured() ? " and TMDB" : ""}..." autocomplete="off">
                </div>
                <div id="movie-results" class="search-results"></div>
                <div id="movie-selected" style="margin-top:0.8rem">${selectedMovieHtml()}</div>
            </div>

            <div data-mode="discover" class="card">
                <p style="margin:0;font-size:0.9rem">Nothing to set: the hero shows the most recently rated movie and the grid shows the latest ${24} rated films with their average score.</p>
            </div>

            <div class="card" style="margin-top:1rem">
                <div class="field">
                    <label for="headline">Badge text (optional)</label>
                    <input type="text" id="headline" maxlength="40" value="${escapeHtml(settings.headline || "")}" placeholder="e.g. Tonight's Feature, Staff Pick, Now Streaming">
                </div>
                <div class="field" style="margin-bottom:0">
                    <label for="blurb">Line under the title (optional)</label>
                    <textarea id="blurb" rows="3" maxlength="400" placeholder="Leave empty to use the default for this mode">${escapeHtml(settings.blurb || "")}</textarea>
                </div>
            </div>

            <div style="display:flex;gap:0.75rem;align-items:center;margin-top:1.2rem;flex-wrap:wrap">
                <button class="btn btn-primary" type="submit" id="save-btn">Save Home Page</button>
                <span class="label" id="last-saved">${settings.updated_at ? `Last saved ${new Date(settings.updated_at).toLocaleString()}` : ""}</span>
            </div>
            <div id="admin-msg" style="margin-top:0.8rem"></div>
        </form>`;

    document.querySelectorAll('input[name="home-mode"]').forEach((r) => r.addEventListener("change", syncModePanels));
    document.getElementById("movie-search").addEventListener("input", (e) => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => searchMovies(e.target.value), 350);
    });
    document.getElementById("admin-form").addEventListener("submit", save);
    syncModePanels();
}

function currentMode() {
    return document.querySelector('input[name="home-mode"]:checked')?.value || "list";
}

function syncModePanels() {
    const mode = currentMode();
    document.querySelectorAll("[data-mode]").forEach((el) => { el.hidden = el.dataset.mode !== mode; });
}

// Your own lists first (works without TMDB), then TMDB's horror results.
async function searchMovies(query) {
    const resultsEl = document.getElementById("movie-results");
    const q = query.trim().toLowerCase();
    if (!q) { resultsEl.innerHTML = ""; return; }

    const seen = new Set();
    const results = [];
    for (const list of myLists) {
        for (const m of list.movies || []) {
            if (!seen.has(m.id) && (m.title || "").toLowerCase().includes(q)) {
                seen.add(m.id);
                results.push(m);
            }
        }
    }
    try {
        (await tmdbSearchHorrorMovies(query)).forEach((m) => {
            if (!seen.has(m.id)) { seen.add(m.id); results.push(m); }
        });
    } catch (err) {
        console.error("TMDB search failed", err);
    }

    resultsEl.innerHTML = results.length
        ? results.slice(0, 12).map((m, i) => {
            const poster = tmdbPosterUrl(m.poster_path);
            return `
                <div class="movie-row">
                    ${poster ? `<img src="${poster}" alt="">` : ""}
                    <div class="movie-meta">
                        <div class="title">${escapeHtml(m.title)}</div>
                        <div class="year">${yearOf(m)}</div>
                    </div>
                    <div class="movie-actions"><button class="btn btn-sm" type="button" data-pick="${i}">Pick</button></div>
                </div>`;
        }).join("")
        : `<div class="empty-state">No matches.</div>`;

    resultsEl.querySelectorAll("[data-pick]").forEach((btn) =>
        btn.addEventListener("click", () => {
            selectedMovie = movieSnapshot(results[Number(btn.dataset.pick)]);
            document.getElementById("movie-selected").innerHTML = selectedMovieHtml();
            resultsEl.innerHTML = "";
            document.getElementById("movie-search").value = "";
        })
    );
}

async function save(e) {
    e.preventDefault();
    const mode = currentMode();
    const row = {
        key: "home",
        mode,
        countdown: document.getElementById("countdown").checked,
        headline: document.getElementById("headline").value.trim() || null,
        blurb: document.getElementById("blurb").value.trim() || null,
        updated_by: adminUser.id,
        updated_at: new Date().toISOString(),
    };

    if (mode === "list") {
        const listId = document.getElementById("list-select").value;
        const list = myLists.find((l) => String(l.id) === listId);
        if (!list) return msg(`<div class="alert alert-error">Pick a list first.</div>`);
        if (!(list.movies || []).length) return msg(`<div class="alert alert-error">"${escapeHtml(list.name)}" has no movies yet — add some in My Lists first.</div>`);
        Object.assign(row, { list_id: list.id, list_name: list.name, movies: list.movies });
    } else if (mode === "movie") {
        if (!selectedMovie) return msg(`<div class="alert alert-error">Search for and pick a movie first.</div>`);
        row.featured_movie = selectedMovie;
    }

    const btn = document.getElementById("save-btn");
    btn.disabled = true;
    const { data, error } = await window.sb.from("site_settings").upsert(row, { onConflict: "key" }).select().maybeSingle();
    btn.disabled = false;

    if (error || !data) {
        console.error("Failed to save home page", error);
        return msg(`<div class="alert alert-error">Couldn't save — ${escapeHtml(error?.message || "permission denied")}.</div>`);
    }
    settings = data;
    document.getElementById("last-saved").textContent = `Last saved ${new Date(data.updated_at).toLocaleString()}`;
    msg(`<div class="alert alert-info">Saved. <a href="index.html" target="_blank" rel="noopener">See the home page</a>.</div>`);
}

document.addEventListener("DOMContentLoaded", async () => {
    adminUser = await requireAuth();
    if (!adminUser) return;

    if (!(await isSiteAdmin())) {
        document.getElementById("admin-root").innerHTML = `<div class="empty-state">Only the site owner can change the home page.</div>`;
        return;
    }
    await loadData();
    render();
});
