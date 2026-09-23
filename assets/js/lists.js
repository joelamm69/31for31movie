// Powers lists.html: create/rename/delete lists, search TMDB and add/remove
// movies, toggle watched, edit notes — all persisted to the same
// `user_libraries` row (lists/watched_movie_ids/movie_notes as jsonb) that
// the iPad app reads and writes, so data stays in sync across both.

let currentUserId = null;
let currentUserName = null;
let library = { lists: [], watchedMovieIds: new Set(), movieNotes: {} };
let openListId = null;
let saveTimer = null;
let movieRatings = new Map(); // movie_id -> 1-5, this user's own ratings from movie_ratings

function newList(name) {
    return { id: crypto.randomUUID(), name, movies: [] };
}

async function loadLibrary() {
    const { data, error } = await window.sb
        .from("user_libraries")
        .select("*")
        .eq("user_id", currentUserId)
        .maybeSingle();

    if (error) {
        console.error("Failed to load library", error);
    }

    if (data) {
        library.lists = data.lists || [];
        library.watchedMovieIds = new Set(data.watched_movie_ids || []);
        library.movieNotes = data.movie_notes || {};
    }

    if (library.lists.length === 0) {
        library.lists = [newList("My October List")];
        await saveLibrary();
    }
}

async function loadRatings() {
    const { data, error } = await window.sb.from("movie_ratings").select("movie_id,rating").eq("user_id", currentUserId);
    if (error) {
        console.error("Failed to load ratings", error);
        return;
    }
    movieRatings = new Map((data || []).map((r) => [r.movie_id, r.rating]));
}

async function saveLibrary() {
    const payload = {
        user_id: currentUserId,
        lists: library.lists,
        watched_movie_ids: Array.from(library.watchedMovieIds),
        movie_notes: library.movieNotes,
        updated_at: new Date().toISOString(),
    };
    const { error } = await window.sb.from("user_libraries").upsert(payload, { onConflict: "user_id" });
    if (error) console.error("Failed to save library", error);
}

// Coalesce rapid edits (e.g. typing a note) into one write, same as the app.
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLibrary, 800);
}

function findList(listId) {
    return library.lists.find((l) => l.id === listId);
}

function createListAction(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    library.lists.push(newList(trimmed));
    saveLibrary();
    render();
}

function renameListAction(listId, name) {
    const trimmed = name.trim();
    const list = findList(listId);
    if (!trimmed || !list) return;
    list.name = trimmed;
    saveLibrary();
    render();
}

function deleteListAction(listId) {
    library.lists = library.lists.filter((l) => l.id !== listId);
    if (openListId === listId) openListId = null;
    saveLibrary();
    render();
}

function addMovieAction(listId, movie) {
    const list = findList(listId);
    if (!list) return;
    if (list.movies.length >= 31) return alert("This list already has 31 movies — the max for a 31-for-31 list.");
    if (list.movies.some((m) => m.id === movie.id)) return;
    list.movies.push(movie);
    saveLibrary();
    render();
}

function removeMovieAction(listId, movieId) {
    const list = findList(listId);
    if (!list) return;
    list.movies = list.movies.filter((m) => m.id !== movieId);
    saveLibrary();
    render();
}

function toggleWatchedAction(movieId) {
    if (library.watchedMovieIds.has(movieId)) {
        library.watchedMovieIds.delete(movieId);
    } else {
        library.watchedMovieIds.add(movieId);
        logWatchActivity(movieId);
    }
    saveLibrary();
    render();
}

// Fire-and-forget: logs a public "watched" event for the live activity
// feed (activity.html). Never blocks the UI — a failure here shouldn't
// stop the user from marking a movie watched.
async function logWatchActivity(movieId) {
    const { error } = await window.sb.from("watch_activity").insert({
        user_id: currentUserId,
        user_name: currentUserName,
        movie_id: movieId,
    });
    if (error) console.error("Failed to log watch activity", error);
}

function setNoteAction(movieId, note) {
    library.movieNotes[movieId] = note;
    scheduleSave();
}

// Writes to the shared movie_ratings table (same one the app's rating
// feature uses, and what the Live Feed reads), not the private per-list
// notes — so a rating given here shows up for everyone, live.
async function rateMovieAction(movieId, rating) {
    const previous = movieRatings.get(movieId);
    movieRatings.set(movieId, rating);
    render();

    const { error } = await window.sb
        .from("movie_ratings")
        .upsert({ movie_id: movieId, user_id: currentUserId, user_name: currentUserName, rating }, { onConflict: "movie_id,user_id" });

    if (error) {
        console.error("Failed to save rating", error);
        if (previous === undefined) movieRatings.delete(movieId);
        else movieRatings.set(movieId, previous);
        render();
    }
}

async function publishListAction(listId) {
    const list = findList(listId);
    if (!list || list.movies.length === 0) return alert("Add at least one movie before publishing.");
    const { data: sessionData } = await window.sb.auth.getSession();
    const accessToken = sessionData.session?.access_token;
    const { error } = await window.sb.from("movie_lists").insert({
        user_id: currentUserId,
        list_name: list.name,
        movie_ids: list.movies.map((m) => m.id),
    });
    if (error) {
        console.error(error);
        alert("Failed to publish list.");
    } else {
        alert(`"${list.name}" published to Community!`);
    }
}

function starsHtml(movieId) {
    const rating = movieRatings.get(movieId) || 0;
    const stars = [1, 2, 3, 4, 5]
        .map(
            (n) => `<span class="star${n <= rating ? " filled" : ""}" data-action="rate" data-movie-id="${movieId}" data-value="${n}">&#9733;</span>`
        )
        .join("");
    return `<div class="rating-stars" data-movie-id="${movieId}">${stars}${rating ? `<span class="label" style="margin-left:6px">${rating}/5 · public</span>` : ""}</div>`;
}

function movieRowHtml(listId, movie) {
    const poster = tmdbPosterUrl(movie.poster_path);
    const watched = library.watchedMovieIds.has(movie.id);
    const note = library.movieNotes[movie.id] || "";
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "N/A";
    return `
        <div class="movie-row" data-movie-id="${movie.id}">
            ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;border-radius:0;background:var(--bg-raised);flex-shrink:0"></div>`}
            <div class="movie-meta">
                <div class="title">${escapeHtml(movie.title)}</div>
                <div class="year">${year}${watched ? " · Watched" : ""}</div>
                ${starsHtml(movie.id)}
                <input type="text" class="note-input" data-action="note" data-list-id="${listId}" data-movie-id="${movie.id}"
                    placeholder="Notes..." value="${escapeHtml(note)}" style="margin-top:4px;width:100%;font-size:0.8rem;padding:0.3rem 0.5rem;">
            </div>
            <div class="movie-actions">
                <button class="btn btn-sm ${watched ? "btn-primary" : "btn-ghost"}" data-action="watched" data-movie-id="${movie.id}">${watched ? "✓ Watched" : "Mark Watched"}</button>
                <button class="btn btn-sm btn-danger" data-action="remove-movie" data-list-id="${listId}" data-movie-id="${movie.id}">Remove</button>
            </div>
        </div>
    `;
}

function listCardHtml(list) {
    const isOpen = list.id === openListId;
    return `
        <div class="list-card" data-list-id="${list.id}">
            <div class="section-heading" style="margin-bottom:0">
                <h3>${escapeHtml(list.name)}</h3>
                <span class="count">${list.movies.length}/31</span>
            </div>
            <div class="list-actions">
                <button class="btn btn-sm" data-action="toggle" data-list-id="${list.id}">${isOpen ? "Close" : "Manage"}</button>
                <button class="btn btn-sm btn-ghost" data-action="rename" data-list-id="${list.id}">Rename</button>
                <button class="btn btn-sm btn-ghost" data-action="publish" data-list-id="${list.id}">Publish to Community</button>
                <button class="btn btn-sm btn-danger" data-action="delete" data-list-id="${list.id}">Delete</button>
            </div>
            ${isOpen ? listDetailHtml(list) : ""}
        </div>
    `;
}

function listDetailHtml(list) {
    const tmdbNote = tmdbConfigured()
        ? ""
        : `<p style="font-size:0.82rem">Movie search needs a TMDB API key — copy <code>assets/js/tmdb-config.example.js</code> to <code>tmdb-config.js</code> and add yours.</p>`;
    return `
        <div class="list-detail" style="margin-top:0.9rem;border-top:1px solid var(--border);padding-top:0.9rem">
            <div class="field">
                <label>Search TMDB to add a horror movie</label>
                <input type="search" class="movie-search-input" data-list-id="${list.id}" placeholder="e.g. Hereditary" ${tmdbConfigured() ? "" : "disabled"}>
                ${tmdbNote}
                <div class="search-results" data-list-id="${list.id}"></div>
            </div>
            <div class="movie-rows">
                ${list.movies.length ? list.movies.map((m) => movieRowHtml(list.id, m)).join("") : `<p style="font-size:0.85rem">No movies yet — search above to add some.</p>`}
            </div>
        </div>
    `;
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function render() {
    const container = document.getElementById("lists-container");
    if (!container) return;
    container.innerHTML = library.lists.length
        ? library.lists.map(listCardHtml).join("")
        : `<div class="empty-state">No lists yet. Create your first one above.</div>`;
}

let searchDebounce = null;

document.addEventListener("DOMContentLoaded", async () => {
    const user = await requireAuth();
    if (!user) return;
    currentUserId = user.id;
    currentUserName = displayNameFor(user);

    await Promise.all([loadLibrary(), loadRatings()]);
    render();

    document.getElementById("new-list-btn")?.addEventListener("click", () => {
        const name = prompt("Name your new list:", "My List");
        if (name) createListAction(name);
    });

    const container = document.getElementById("lists-container");

    container.addEventListener("click", async (e) => {
        const star = e.target.closest("[data-action='rate']");
        if (star) {
            rateMovieAction(Number(star.dataset.movieId), Number(star.dataset.value));
            return;
        }

        const btn = e.target.closest("button[data-action]");
        if (btn) {
            const { action, listId, movieId } = btn.dataset;
            if (action === "toggle") {
                openListId = openListId === listId ? null : listId;
                render();
            } else if (action === "rename") {
                const list = findList(listId);
                const name = prompt("Rename list:", list?.name || "");
                if (name) renameListAction(listId, name);
            } else if (action === "delete") {
                if (confirm("Delete this list? This can't be undone.")) deleteListAction(listId);
            } else if (action === "publish") {
                btn.disabled = true;
                await publishListAction(listId);
                btn.disabled = false;
            } else if (action === "remove-movie") {
                removeMovieAction(listId, Number(movieId));
            } else if (action === "watched") {
                toggleWatchedAction(Number(movieId));
            }
            return;
        }

        const result = e.target.closest("[data-action='add-movie']");
        if (result) {
            const { listId, movie } = result.dataset;
            addMovieAction(listId, JSON.parse(movie));
        }
    });

    container.addEventListener("input", (e) => {
        if (e.target.matches(".note-input")) {
            const { listId, movieId } = e.target.dataset;
            setNoteAction(Number(movieId), e.target.value);
        }

        if (e.target.matches(".movie-search-input")) {
            const input = e.target;
            const listId = input.dataset.listId;
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(async () => {
                const query = input.value;
                const resultsEl = container.querySelector(`.search-results[data-list-id="${listId}"]`);
                if (!resultsEl) return;
                if (!query.trim()) {
                    resultsEl.innerHTML = "";
                    return;
                }
                resultsEl.innerHTML = `<p style="font-size:0.82rem">Searching...</p>`;
                let movies;
                try {
                    movies = await tmdbSearchHorrorMovies(query);
                } catch (err) {
                    resultsEl.innerHTML = `<div class="alert alert-error" style="margin:0">TMDB search failed: ${escapeHtml(err.message)}. Double check assets/js/tmdb-config.js has a valid TMDB API key (v3 auth), not the Read Access Token.</div>`;
                    return;
                }
                resultsEl.innerHTML = movies.length
                    ? movies
                          .slice(0, 8)
                          .map((m) => {
                              const poster = tmdbPosterUrl(m.poster_path);
                              return `
                                <div class="movie-row" data-action="add-movie" data-list-id="${listId}" data-movie='${JSON.stringify(m).replace(/'/g, "&#39;")}' style="cursor:pointer">
                                    ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;border-radius:0;background:var(--bg-raised);flex-shrink:0"></div>`}
                                    <div class="movie-meta">
                                        <div class="title">${escapeHtml(m.title)}</div>
                                        <div class="year">${m.release_date ? m.release_date.slice(0, 4) : "N/A"}</div>
                                    </div>
                                    <div class="movie-actions"><span class="btn btn-sm btn-primary">+ Add</span></div>
                                </div>
                            `;
                          })
                          .join("")
                    : `<p style="font-size:0.82rem">No matches.</p>`;
            }, 400);
        }
    });
});
