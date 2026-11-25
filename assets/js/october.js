// Powers october.html: the "Save for October" bin.
//
// All year, titles get flagged from Search, a title page or My Lists. Here
// you see them, say why each one's perfect for October, and (loudest in
// September) turn them into a draft 31-list: a regular list in
// user_libraries, so it shows up in My Lists and the app like any other,
// and can be turned into a marathon challenge from there.

let bin = [];
let selected = new Set();

async function loadBin() {
    const { data, error } = await window.sb.from("october_bin").select("*").eq("user_id", social.user.id).order("created_at", { ascending: true });
    if (error) console.error(error);
    bin = data || [];
    selected = new Set(bin.slice(0, 31).map((b) => watchKey(b.media_type, b.tmdb_id)));
}

function bannerHtml() {
    const year = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    if (window.isMarathonMode()) {
        return `<div class="alert alert-info">It's October. Anything you save now waits for next year's marathon.</div>`;
    }
    if (window.isDraftSeason()) {
        return `<div class="draft-callout"><span class="label">September</span><h2>Time to draft your ${year} 31</h2>
            <p>You saved ${bin.length} title${bin.length === 1 ? "" : "s"} this year. Pick up to 31 and they become your draft list.</p></div>`;
    }
    return `<p>${window.daysUntilOctober()} days until October. Flag anything that would be perfect for the marathon; in September this bin becomes your draft 31.</p>`;
}

function itemHtml(b) {
    const key = watchKey(b.media_type, b.tmdb_id);
    const poster = tmdbPosterUrl(b.poster_path);
    return `
        <div class="movie-row" data-key="${key}">
            <input type="checkbox" class="pick" ${selected.has(key) ? "checked" : ""} aria-label="Include in draft">
            ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;background:var(--bg-raised);flex-shrink:0"></div>`}
            <div class="movie-meta">
                <div class="title"><a href="title.html?type=${b.media_type}&id=${b.tmdb_id}">${escapeHtml(b.title)}</a></div>
                <div class="year">${b.media_type === "tv" ? "TV · " : ""}${(b.release_date || "").slice(0, 4) || "N/A"} · saved ${formatDate(b.created_at.slice(0, 10))}</div>
                <input type="text" class="reason-input" maxlength="280" placeholder="Why it's perfect for October..." value="${escapeHtml(b.reason || "")}">
            </div>
            <div class="movie-actions"><button class="btn btn-sm btn-danger" data-remove>Remove</button></div>
        </div>`;
}

function render() {
    document.getElementById("october-banner").innerHTML = bannerHtml();
    const count = selected.size;
    document.getElementById("draft-bar").innerHTML = bin.length
        ? `<span class="label">${count} of 31 picked</span>
           <button class="btn btn-primary" id="draft-btn" ${count ? "" : "disabled"}>Make my draft 31</button>`
        : "";
    document.getElementById("bin").innerHTML = bin.length
        ? bin.map(itemHtml).join("")
        : `<div class="empty-state">Your bin is empty. Use <strong>🎃 Save for October</strong> in <a href="search.html">Search</a> or on any title page.</div>`;
}

function findByKey(key) {
    return bin.find((b) => watchKey(b.media_type, b.tmdb_id) === key);
}

// Creates the draft as a list in user_libraries, same shape lists.js and
// the app write: { id, name, movies: Movie[] }. TV items keep media_type.
async function makeDraft() {
    const picks = bin.filter((b) => selected.has(watchKey(b.media_type, b.tmdb_id))).slice(0, 31);
    const year = new Date().getMonth() >= 9 ? new Date().getFullYear() + 1 : new Date().getFullYear();
    const name = prompt("Name your draft list:", `October ${year} Draft`);
    if (!name) return;

    const { data, error } = await window.sb.from("user_libraries").select("*").eq("user_id", social.user.id).maybeSingle();
    if (error) return alert(`Couldn't load your lists: ${error.message}`);
    const list = {
        id: crypto.randomUUID(),
        name: name.trim(),
        movies: picks.map((b) => {
            const m = { id: b.tmdb_id, title: b.title, overview: "", poster_path: b.poster_path, release_date: b.release_date || "", genre_ids: [], genres: [] };
            if (b.media_type === "tv") m.media_type = "tv";
            return m;
        }),
    };
    const row = {
        user_id: social.user.id,
        lists: [...(data?.lists || []), list],
        watched_movie_ids: data?.watched_movie_ids || [],
        movie_notes: data?.movie_notes || {},
        updated_at: new Date().toISOString(),
    };
    const { error: saveError } = await window.sb.from("user_libraries").upsert(row, { onConflict: "user_id" });
    if (saveError) return alert(`Couldn't save the draft: ${saveError.message}`);
    if (confirm(`"${list.name}" is in My Lists with ${list.movies.length} titles. Start an October marathon from it now?`)) {
        location.href = `challenges.html?new=marathon&list=${list.id}`;
    } else {
        location.href = "lists.html";
    }
}

let reasonTimers = {};

document.addEventListener("DOMContentLoaded", async () => {
    const user = await initSocial({ requireUser: true });
    if (!user) return;
    await loadBin();
    render();

    const binEl = document.getElementById("bin");
    binEl.addEventListener("change", (e) => {
        if (!e.target.matches(".pick")) return;
        const key = e.target.closest("[data-key]").dataset.key;
        if (e.target.checked) {
            if (selected.size >= 31) {
                e.target.checked = false;
                return alert("A marathon is 31 nights. Unpick one first.");
            }
            selected.add(key);
        } else selected.delete(key);
        render();
    });
    binEl.addEventListener("input", (e) => {
        if (!e.target.matches(".reason-input")) return;
        const key = e.target.closest("[data-key]").dataset.key;
        const item = findByKey(key);
        item.reason = e.target.value;
        clearTimeout(reasonTimers[key]);
        reasonTimers[key] = setTimeout(() => {
            window.sb.from("october_bin").update({ reason: item.reason.trim() || null })
                .eq("user_id", social.user.id).eq("media_type", item.media_type).eq("tmdb_id", item.tmdb_id)
                .then(({ error }) => error && console.error(error));
        }, 700);
    });
    binEl.addEventListener("click", async (e) => {
        if (!e.target.closest("[data-remove]")) return;
        const key = e.target.closest("[data-key]").dataset.key;
        const item = findByKey(key);
        await removeFromOctober(item.media_type, item.tmdb_id);
        bin = bin.filter((b) => b !== item);
        selected.delete(key);
        render();
    });
    document.getElementById("draft-bar").addEventListener("click", (e) => {
        if (e.target.closest("#draft-btn")) makeDraft();
    });
});
