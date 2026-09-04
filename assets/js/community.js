// Powers community.html: browse lists published from lists.html (the
// `movie_lists` table), mirroring CommunityView.swift in the app.

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

async function renderCommunityCard(record) {
    const previewIds = (record.movie_ids || []).slice(0, 4);
    const movies = await tmdbFetchMovies(previewIds);
    const posters = movies
        .map((m) => {
            const url = tmdbPosterUrl(m.poster_path);
            return url ? `<img src="${url}" alt="" style="width:36px;height:54px;object-fit:cover;border-radius:4px;border:1px solid var(--border)">` : "";
        })
        .join("");

    return `
        <div class="card">
            <h3 style="margin-bottom:0.25rem">${escapeHtml(record.list_name)}</h3>
            <div class="count" style="color:var(--accent)">${(record.movie_ids || []).length} Horror Movies · ${relativeTime(record.created_at)}</div>
            ${posters ? `<div style="display:flex;gap:6px;margin-top:0.6rem">${posters}</div>` : ""}
        </div>
    `;
}

document.addEventListener("DOMContentLoaded", async () => {
    const container = document.getElementById("community-container");
    if (!container) return;

    container.innerHTML = `<p>Loading community lists...</p>`;
    const lists = await fetchPublicLists();

    if (lists.length === 0) {
        container.innerHTML = `<div class="empty-state">No shared lists yet. Publish one from <a href="lists.html">My Lists</a> to be the first!</div>`;
        return;
    }

    const cards = await Promise.all(lists.map(renderCommunityCard));
    container.innerHTML = cards.join("");

    const search = document.getElementById("community-search");
    search?.addEventListener("input", () => {
        const q = search.value.trim().toLowerCase();
        const filtered = q ? lists.filter((l) => l.list_name.toLowerCase().includes(q)) : lists;
        if (filtered.length === 0) {
            container.innerHTML = `<div class="empty-state">No lists match "${escapeHtml(search.value)}"</div>`;
            return;
        }
        Promise.all(filtered.map(renderCommunityCard)).then((c) => {
            container.innerHTML = c.join("");
        });
    });
});
