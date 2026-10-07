// Powers community.html: browse lists published from lists.html (the
// `movie_lists` table), mirroring CommunityView.swift / CommunityListDetailView.swift
// in the app — including clicking into a list to see every movie on it.

let allLists = [];
let openRecordId = null;
let currentUserId = null;
const movieCache = new Map(); // record id -> full Movie[] (fetched on first expand)

async function fetchPublicLists() {
    const { data, error } = await window.sb
        .from("movie_lists")
        .select("*")
        .order("created_at", { ascending: false });
    if (error) {
        console.error("Failed to load community lists", error);
        return [];
    }
    return data || [];
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

function relativeTime(iso) {
    const diffMs = Date.now() - new Date(iso).getTime();
    const mins = Math.round(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
}

function posterPreviewsHtml(movies) {
    return movies
        .slice(0, 4)
        .map((m) => {
            const url = tmdbPosterUrl(m.poster_path);
            return url ? `<img src="${url}" alt="" style="width:36px;height:54px;object-fit:cover;border-radius:0;border:1px solid var(--border)">` : "";
        })
        .join("");
}

function movieDetailRowHtml(movie) {
    const poster = tmdbPosterUrl(movie.poster_path);
    const year = movie.release_date ? movie.release_date.slice(0, 4) : "N/A";
    return `
        <div class="movie-row">
            ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;border-radius:0;background:var(--bg-raised);flex-shrink:0"></div>`}
            <div class="movie-meta">
                <div class="title">${escapeHtml(movie.title)}</div>
                <div class="year">${year}</div>
            </div>
        </div>
    `;
}

function communityCardHtml(record, previewMovies) {
    const isOpen = record.id === openRecordId;
    const cached = movieCache.get(record.id);
    const isMine = currentUserId && record.user_id === currentUserId;

    let detailHtml = "";
    if (isOpen) {
        if (!cached) {
            detailHtml = `<div class="movie-rows" style="margin-top:0.9rem;border-top:1px solid var(--border);padding-top:0.9rem"><p style="font-size:0.85rem">Loading movies...</p></div>`;
        } else if (cached.length === 0) {
            detailHtml = `<div class="movie-rows" style="margin-top:0.9rem;border-top:1px solid var(--border);padding-top:0.9rem"><p style="font-size:0.85rem">${tmdbConfigured() ? "Couldn't load movies for this list." : "Movie details need a TMDB API key — see assets/js/tmdb-config.example.js."}</p></div>`;
        } else {
            detailHtml = `<div class="movie-rows" style="margin-top:0.9rem;border-top:1px solid var(--border);padding-top:0.9rem">${cached.map(movieDetailRowHtml).join("")}</div>`;
        }
    }

    return `
        <div class="card" data-list-id="${record.id}">
            <div style="cursor:pointer" data-action="toggle-community" data-list-id="${record.id}">
                <h3 style="margin-bottom:0.25rem">${escapeHtml(record.list_name)}</h3>
                <div class="count" style="color:var(--red)">${(record.movie_ids || []).length} Horror Movies · ${relativeTime(record.created_at)}</div>
                ${!isOpen && previewMovies.length ? `<div style="display:flex;gap:6px;margin-top:0.6rem">${posterPreviewsHtml(previewMovies)}</div>` : ""}
            </div>
            <div class="list-actions" style="margin-top:0.6rem">
                <button class="btn btn-sm btn-ghost" data-action="toggle-community" data-list-id="${record.id}">${isOpen ? "Hide Movies" : "View Movies"}</button>
                ${isMine ? `<button class="btn btn-sm btn-danger" data-action="delete-community" data-list-id="${record.id}">Delete</button>` : ""}
            </div>
            ${detailHtml}
        </div>
    `;
}

async function renderAll(container, lists) {
    // Fetch just enough (first 4) for the collapsed-state poster previews.
    const previews = await Promise.all(lists.map((r) => tmdbFetchMovies((r.movie_ids || []).slice(0, 4))));
    container.innerHTML = lists.map((r, i) => communityCardHtml(r, previews[i])).join("");
}

async function toggleRecord(container, lists, recordId) {
    openRecordId = openRecordId === recordId ? null : recordId;
    await renderAll(container, lists);

    if (openRecordId && !movieCache.has(openRecordId)) {
        const record = lists.find((r) => r.id === openRecordId);
        const movies = await tmdbFetchMovies(record?.movie_ids || []);
        movieCache.set(openRecordId, movies);
        if (openRecordId === record?.id) await renderAll(container, lists);
    }
}

// Removes just the public Community listing (movie_lists row) — the
// user's actual list in My Lists is untouched.
async function deleteListAction(recordId) {
    const { error } = await window.sb.from("movie_lists").delete().eq("id", recordId);
    if (error) {
        console.error("Failed to delete shared list", error);
        alert("Couldn't delete this list — try again.");
        return false;
    }
    return true;
}

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("community-container");
    if (!container) return;

    const user = await currentUser();
    currentUserId = user?.id ?? null;

    container.innerHTML = `<p>Loading community lists...</p>`;
    allLists = await fetchPublicLists();

    if (allLists.length === 0) {
        container.innerHTML = `<div class="empty-state">No shared lists yet. Publish one from <a href="lists.html">My Lists</a> to be the first!</div>`;
        return;
    }

    let visibleLists = allLists;
    await renderAll(container, visibleLists);

    container.addEventListener("click", async (e) => {
        const deleteBtn = e.target.closest("[data-action='delete-community']");
        if (deleteBtn) {
            if (!confirm("Remove this list from Community? Your list in My Lists won't be affected.")) return;
            const recordId = deleteBtn.dataset.listId;
            deleteBtn.disabled = true;
            const ok = await deleteListAction(recordId);
            if (ok) {
                allLists = allLists.filter((r) => r.id !== recordId);
                visibleLists = visibleLists.filter((r) => r.id !== recordId);
                if (openRecordId === recordId) openRecordId = null;
                if (visibleLists.length === 0) {
                    container.innerHTML = `<div class="empty-state">No shared lists yet. Publish one from <a href="lists.html">My Lists</a> to be the first!</div>`;
                } else {
                    await renderAll(container, visibleLists);
                }
            } else {
                deleteBtn.disabled = false;
            }
            return;
        }

        const btn = e.target.closest("[data-action='toggle-community']");
        if (!btn) return;
        toggleRecord(container, visibleLists, btn.dataset.listId);
    });

    const search = document.getElementById("community-search");
    search?.addEventListener("input", async () => {
        const q = search.value.trim().toLowerCase();
        visibleLists = q ? allLists.filter((l) => l.list_name.toLowerCase().includes(q)) : allLists;
        openRecordId = null;
        if (visibleLists.length === 0) {
            container.innerHTML = `<div class="empty-state">No lists match "${escapeHtml(search.value)}"</div>`;
            return;
        }
        await renderAll(container, visibleLists);
    });
});
