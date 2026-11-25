// Powers lists.html: create/rename/delete lists, search TMDB and add/remove
// movies, toggle watched, edit notes — all persisted to the same
// `user_libraries` row (lists/watched_movie_ids/movie_notes as jsonb) that
// the iPad app reads and writes, so data stays in sync across both.
//
// Lists can hold TV shows too (items with media_type: "tv"). TMDB movie and
// TV ids overlap, so TV is kept out of watched_movie_ids and movie_ratings
// (both movie-only, shared with the app): a show's watched state lives in
// watch_entries, and its note is stored under "tv:<id>" in movie_notes.
// Every watch is also logged to watch_entries, the diary that feeds notes,
// the follow feed, challenges and recaps.

let currentUserId = null;
let currentUserName = null;
let library = { lists: [], watchedMovieIds: new Set(), movieNotes: {} };
let openListId = null;
let saveTimer = null;
let movieRatings = new Map(); // movie_id -> 1-5, this user's own ratings from movie_ratings
let publishedListIds = new Set(); // list.id values currently published to movie_lists
let watchedTvIds = new Set(); // TV shows marked watched (from watch_entries)
let octoberKeys = new Set(); // "movie:603" / "tv:1399" in the October bin
let horrorOnly = window.isMarathonMode();

const isTv = (m) => m.media_type === "tv";
const noteKey = (m) => (isTv(m) ? `tv:${m.id}` : m.id);
const sameTitle = (a, b) => a.id === b.id && isTv(a) === isTv(b);

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

// Which of this user's lists are currently published to Community — drives
// both the "already published" button state and which lists get synced on
// every save.
async function loadPublishedLists() {
    const { data, error } = await window.sb.from("movie_lists").select("list_id").eq("user_id", currentUserId);
    if (error) {
        console.error("Failed to load published lists", error);
        return;
    }
    publishedListIds = new Set((data || []).map((r) => r.list_id).filter(Boolean));
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
    if (error) {
        console.error("Failed to save library", error);
        return;
    }
    await syncPublishedLists();
}

// Keeps every published list's Community copy live: whatever you publish
// stays pointed at the real list, so edits here (add/remove a movie,
// rename) show up on Community without re-publishing.
async function syncPublishedLists() {
    const published = library.lists.filter((l) => publishedListIds.has(l.id));
    if (!published.length) return;
    const results = await Promise.all(
        published.map((list) =>
            window.sb.from("movie_lists").upsert(
                { user_id: currentUserId, list_id: list.id, list_name: list.name, movie_ids: list.movies.map((m) => m.id) },
                { onConflict: "user_id,list_id" }
            )
        )
    );
    results.forEach(({ error }) => { if (error) console.error("Failed to sync published list", error); });
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

    // If this list was published, remove its Community copy too — best
    // effort, doesn't block the local delete.
    if (publishedListIds.has(listId)) {
        publishedListIds.delete(listId);
        window.sb
            .from("movie_lists")
            .delete()
            .eq("user_id", currentUserId)
            .eq("list_id", listId)
            .then(({ error }) => {
                if (error) console.error("Failed to remove published copy", error);
            });
    }

    saveLibrary();
    render();
}

function addMovieAction(listId, movie) {
    const list = findList(listId);
    if (!list) return;
    if (list.movies.length >= 31) return alert("This list already has 31 titles — the max for a 31-for-31 list.");
    if (list.movies.some((m) => sameTitle(m, movie))) return;
    list.movies.push(movie);
    saveLibrary();
    render();
}

function removeMovieAction(listId, movieId, mediaType = "movie") {
    const list = findList(listId);
    if (!list) return;
    list.movies = list.movies.filter((m) => !(m.id === movieId && mediaTypeOf(m) === mediaType));
    saveLibrary();
    render();
}

function isWatched(m) {
    return isTv(m) ? watchedTvIds.has(m.id) : library.watchedMovieIds.has(m.id);
}

function toggleWatchedAction(movie) {
    const wasWatched = isWatched(movie);
    if (isTv(movie)) {
        if (wasWatched) watchedTvIds.delete(movie.id);
        else watchedTvIds.add(movie.id);
    } else if (wasWatched) {
        library.watchedMovieIds.delete(movie.id);
    } else {
        library.watchedMovieIds.add(movie.id);
        logWatchActivity(movie.id);
    }
    if (wasWatched) unlogBareWatch(movie);
    else logWatchEntry({ media_type: mediaTypeOf(movie), tmdb_id: movie.id, title: movie.title, poster_path: movie.poster_path })
        .catch((err) => console.error("Failed to log diary entry", err));
    if (!isTv(movie)) saveLibrary();
    render();
}

// Un-marking removes today's (or the latest) plain "watched" diary entry,
// never one with a note, review or rating on it.
async function unlogBareWatch(movie) {
    const { data } = await window.sb
        .from("watch_entries")
        .select("id")
        .eq("user_id", currentUserId)
        .eq("media_type", mediaTypeOf(movie))
        .eq("tmdb_id", movie.id)
        .is("note", null).is("review", null).is("rating", null).is("season", null)
        .order("created_at", { ascending: false })
        .limit(1);
    if (data?.[0]) await window.sb.from("watch_entries").delete().eq("id", data[0].id);
}

async function loadWatchedTv() {
    const { data, error } = await window.sb.from("watch_entries").select("tmdb_id").eq("user_id", currentUserId).eq("media_type", "tv").is("season", null);
    if (error) return console.error("Failed to load TV watches", error);
    watchedTvIds = new Set((data || []).map((r) => r.tmdb_id));
}

async function toggleOctoberAction(movie) {
    const key = watchKey(mediaTypeOf(movie), movie.id);
    try {
        if (octoberKeys.has(key)) {
            await removeFromOctober(mediaTypeOf(movie), movie.id);
            octoberKeys.delete(key);
        } else {
            await saveForOctober(movie);
            octoberKeys.add(key);
        }
        render();
    } catch (err) {
        alert(`Couldn't update your October bin: ${err.message}`);
    }
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

function setNoteAction(key, note) {
    library.movieNotes[key] = note;
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

// Publishes (or re-syncs) a list to Community. Upserts on (user_id,
// list_id) so clicking this on an already-published list updates it in
// place instead of creating a duplicate — though in normal use you won't
// need to click it again, since saveLibrary() keeps published lists synced
// automatically on every edit.
async function publishListAction(listId) {
    const list = findList(listId);
    if (!list || list.movies.length === 0) return alert("Add at least one movie before publishing.");

    const alreadyPublished = publishedListIds.has(listId);
    const { error } = await window.sb.from("movie_lists").upsert(
        { user_id: currentUserId, list_id: listId, list_name: list.name, movie_ids: list.movies.map((m) => m.id) },
        { onConflict: "user_id,list_id" }
    );

    if (error) {
        console.error(error);
        alert("Failed to publish list.");
        return;
    }

    publishedListIds.add(listId);
    render();
    alert(
        alreadyPublished
            ? `"${list.name}" updated on Community!`
            : `"${list.name}" published to Community! It'll stay in sync automatically as you edit it.`
    );
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
    const watched = isWatched(movie);
    const note = library.movieNotes[noteKey(movie)] || "";
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "N/A";
    const type = mediaTypeOf(movie);
    const saved = octoberKeys.has(watchKey(type, movie.id));
    const ids = `data-list-id="${listId}" data-movie-id="${movie.id}" data-media-type="${type}"`;
    return `
        <div class="movie-row" data-movie-id="${movie.id}" data-media-type="${type}">
            ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;border-radius:0;background:var(--bg-raised);flex-shrink:0"></div>`}
            <div class="movie-meta">
                <div class="title"><a href="${titleUrl(movie)}">${escapeHtml(movie.title)}</a></div>
                <div class="year">${isTv(movie) ? "TV · " : ""}${year}${watched ? " · Watched" : ""}</div>
                ${isTv(movie) ? "" : starsHtml(movie.id)}
                <input type="text" class="note-input" data-action="note" ${ids}
                    placeholder="Private notes..." value="${escapeHtml(note)}" style="margin-top:4px;width:100%;font-size:0.8rem;padding:0.3rem 0.5rem;">
            </div>
            <div class="movie-actions">
                <button class="btn btn-sm ${watched ? "btn-primary" : "btn-ghost"}" data-action="watched" ${ids}>${watched ? "✓ Watched" : "Mark Watched"}</button>
                <a class="btn btn-sm btn-ghost" href="${titleUrl(movie)}">Note / Review</a>
                <button class="btn btn-sm ${saved ? "btn-cream" : "btn-ghost"}" data-action="october" ${ids} title="Save for October">${saved ? "✓ Oct" : "🎃"}</button>
                <button class="btn btn-sm btn-danger" data-action="remove-movie" ${ids}>Remove</button>
            </div>
        </div>
    `;
}

function listCardHtml(list) {
    const isOpen = list.id === openListId;
    const isPublished = publishedListIds.has(list.id);
    return `
        <div class="list-card" data-list-id="${list.id}">
            <div class="section-heading" style="margin-bottom:0">
                <h3>${escapeHtml(list.name)}</h3>
                <span class="count">${list.movies.length}/31</span>
            </div>
            <div class="list-actions">
                <button class="btn btn-sm" data-action="toggle" data-list-id="${list.id}">${isOpen ? "Close" : "Manage"}</button>
                <button class="btn btn-sm btn-ghost" data-action="rename" data-list-id="${list.id}">Rename</button>
                <button class="btn btn-sm ${isPublished ? "btn-primary" : "btn-ghost"}" data-action="publish" data-list-id="${list.id}">${isPublished ? "✓ On Community" : "Publish to Community"}</button>
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
                <label>Search TMDB to add a movie or show</label>
                <input type="search" class="movie-search-input" data-list-id="${list.id}" placeholder="e.g. Hereditary" ${tmdbConfigured() ? "" : "disabled"}>
                <label class="check-row"><input type="checkbox" class="horror-only-toggle" ${horrorOnly ? "checked" : ""}><span>Horror only</span></label>
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
    currentUserName = publicNameFor(user);

    await initSocial();
    const [, , , , binKeys] = await Promise.all([loadLibrary(), loadRatings(), loadPublishedLists(), loadWatchedTv(), loadOctoberBinKeys()]);
    octoberKeys = binKeys;
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
            const { action, listId, movieId, mediaType } = btn.dataset;
            const movie = findList(listId)?.movies.find((m) => m.id === Number(movieId) && mediaTypeOf(m) === mediaType);
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
                removeMovieAction(listId, Number(movieId), mediaType);
            } else if (action === "watched" && movie) {
                toggleWatchedAction(movie);
            } else if (action === "october" && movie) {
                toggleOctoberAction(movie);
            }
            return;
        }

        const result = e.target.closest("[data-action='add-movie']");
        if (result) {
            const { listId, movie } = result.dataset;
            addMovieAction(listId, JSON.parse(movie));
        }
    });

    container.addEventListener("change", (e) => {
        if (!e.target.matches(".horror-only-toggle")) return;
        horrorOnly = e.target.checked;
        const input = e.target.closest(".field").querySelector(".movie-search-input");
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    container.addEventListener("input", (e) => {
        if (e.target.matches(".note-input")) {
            const { movieId, mediaType } = e.target.dataset;
            setNoteAction(mediaType === "tv" ? `tv:${movieId}` : Number(movieId), e.target.value);
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
                    movies = await tmdbSearchTitles(query, { horrorOnly, includeTv: true });
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
                                        <div class="year">${m.media_type === "tv" ? "TV · " : ""}${m.release_date ? m.release_date.slice(0, 4) : "N/A"}</div>
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
