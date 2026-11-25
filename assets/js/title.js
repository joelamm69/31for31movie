// Powers title.html?type=movie|tv&id=<tmdb id>: one movie or show.
//
//   - TMDB details (works signed out, too)
//   - Log a watch / quick note / review / rating / vibe (composer in social.js)
//   - Save for October, add to a list
//   - How it landed: average rating in October vs. other months, top vibes
//   - TV: how the series played out, episode by episode
//   - Notes and reviews: people you follow first, then everyone else, with
//     spoilers veiled until you've watched that title or episode

const params = new URLSearchParams(location.search);
const mediaType = params.get("type") === "tv" ? "tv" : "movie";
const tmdbId = Number(params.get("id"));

let title = null;
let entries = [];
let inOctoberBin = false;
let episodeFilter = ""; // "" | "s:e" | "s"
window.handlesEntryEdit = true;

function avg(nums) {
    return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function fmtAvg(value) {
    return value == null ? "–" : value.toFixed(1);
}

async function loadEntries() {
    const { data, error } = await window.sb
        .from("watch_entries")
        .select("*")
        .eq("media_type", mediaType)
        .eq("tmdb_id", tmdbId)
        .order("created_at", { ascending: false })
        .limit(300);
    if (error) console.error("Failed to load entries", error);
    entries = (data || []).filter((e) => !social.blocked.has(e.user_id));
    await fetchProfiles(entries.map((e) => e.user_id));
}

function headerHtml() {
    const poster = tmdbPosterUrl(title.poster_path, "w500");
    const year = (title.release_date || "").slice(0, 4);
    const raw = title.raw || {};
    const meta = [
        mediaType === "tv" ? "TV" : "Film",
        year,
        mediaType === "tv" && raw.number_of_seasons ? `${raw.number_of_seasons} season${raw.number_of_seasons === 1 ? "" : "s"}` : null,
        mediaType === "movie" && raw.runtime ? `${raw.runtime} min` : null,
    ].filter(Boolean);
    const genres = (title.genres || []).map((g) => `<span class="tag-pill">${escapeHtml(g.name)}</span>`).join("");
    const signedIn = !!social.user;
    return `
        <div class="title-hero">
            ${poster ? `<img src="${poster}" alt="" class="title-poster">` : `<div class="poster-placeholder title-poster"><span class="ppt">No poster</span></div>`}
            <div>
                <div class="label">${meta.map(escapeHtml).join(" · ")}</div>
                <h1 class="feature-title">${escapeHtml(title.title)}</h1>
                <div class="feature-tags">${genres}</div>
                <p>${escapeHtml(title.overview)}</p>
                <div class="feature-actions">
                    <button class="btn btn-primary" id="log-btn">${signedIn ? "Log / Note" : "Log in to note this"}</button>
                    ${signedIn ? `<button class="btn ${inOctoberBin ? "btn-cream" : ""}" id="october-btn">${inOctoberBin ? "✓ Saved for October" : "🎃 Save for October"}</button>` : ""}
                    ${signedIn ? `<button class="btn" id="add-list-btn">Add to a list</button>` : ""}
                </div>
                <p class="tmdb-credit">Title data from TMDB.</p>
            </div>
        </div>
    `;
}

function landedHtml() {
    const rated = entries.filter((e) => e.rating && e.season == null);
    const oct = rated.filter((e) => e.in_october).map((e) => e.rating);
    const other = rated.filter((e) => !e.in_october).map((e) => e.rating);
    const moodCounts = new Map();
    entries.forEach((e) => (e.mood_tags || []).forEach((t) => moodCounts.set(t, (moodCounts.get(t) || 0) + 1)));
    const topMoods = [...moodCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
    if (!rated.length && !topMoods.length) return "";
    const octAvg = avg(oct);
    const otherAvg = avg(other);
    let verdict = "";
    if (oct.length >= 2 && other.length >= 2 && octAvg != null && otherAvg != null) {
        const diff = octAvg - otherAvg;
        if (diff >= 0.4) verdict = "Plays better in October.";
        else if (diff <= -0.4) verdict = "Lands better outside October.";
        else verdict = "Works any time of year.";
    }
    return `
        <section class="card landed">
            <h3>How it landed</h3>
            <div class="split-stats">
                <div><div class="big-stat">${fmtAvg(octAvg)}</div><div class="label">Watched in October · ${oct.length}</div></div>
                <div><div class="big-stat">${fmtAvg(otherAvg)}</div><div class="label">Other months · ${other.length}</div></div>
            </div>
            ${verdict ? `<p class="verdict">${verdict}</p>` : ""}
            ${topMoods.length ? `<div class="mood-tags">${topMoods.map(([t, n]) => `<a class="mood-tag" href="feed.html?mood=${encodeURIComponent(t)}">${escapeHtml(t)} · ${n}</a>`).join("")}</div>` : ""}
        </section>
    `;
}

// For TV: one bar per episode that has ratings, so you can see how the
// series played out as people watched it.
function episodesHtml() {
    if (mediaType !== "tv") return "";
    const byEp = new Map();
    entries
        .filter((e) => e.episode != null)
        .forEach((e) => {
            const key = `${e.season}:${e.episode}`;
            if (!byEp.has(key)) byEp.set(key, { season: e.season, episode: e.episode, ratings: [], notes: 0 });
            const bucket = byEp.get(key);
            if (e.rating) bucket.ratings.push(e.rating);
            if (e.note || e.review) bucket.notes += 1;
        });
    const eps = [...byEp.values()].sort((a, b) => a.season - b.season || a.episode - b.episode);
    if (!eps.length) return "";
    const bars = eps
        .map((ep) => {
            const a = avg(ep.ratings);
            const h = a ? Math.round((a / 5) * 100) : 6;
            const key = `${ep.season}:${ep.episode}`;
            return `<button class="ep-bar${episodeFilter === key ? " active" : ""}" data-ep="${key}" title="${episodeLabel(ep.season, ep.episode)}: ${a ? a.toFixed(1) + "★" : "no ratings"} · ${ep.notes} note${ep.notes === 1 ? "" : "s"}">
                <span style="height:${h}%"></span><em>${episodeLabel(ep.season, ep.episode)}</em></button>`;
        })
        .join("");
    return `
        <section class="card">
            <div class="section-heading" style="margin-bottom:0.6rem"><h3>How the series played out</h3>
                ${episodeFilter ? `<button class="btn btn-sm btn-ghost" id="clear-ep">Show all episodes</button>` : `<span class="label">Tap an episode to filter notes</span>`}</div>
            <div class="ep-bars">${bars}</div>
        </section>
    `;
}

function matchesEpisodeFilter(e) {
    if (!episodeFilter) return true;
    const [s, ep] = episodeFilter.split(":").map(Number);
    return e.season === s && e.episode === ep;
}

function reviewsHtml() {
    const uid = social.user?.id;
    const withWords = entries.filter((e) => (e.note || e.review) && matchesEpisodeFilter(e));
    const mine = withWords.filter((e) => e.user_id === uid);
    const followed = withWords.filter((e) => e.user_id !== uid && social.following.has(e.user_id));
    const everyone = withWords.filter((e) => e.user_id !== uid && !social.following.has(e.user_id));

    const block = (heading, list) =>
        list.length ? `<h3 class="list-heading">${heading}</h3><div class="entries">${list.map((e) => entryCardHtml(e, { showTitle: false })).join("")}</div>` : "";

    if (!withWords.length) {
        return `
            <div class="empty-state first-note">
                <p><strong>No notes on ${escapeHtml(title.title)}${episodeFilter ? ` ${episodeLabel(...episodeFilter.split(":").map(Number))}` : ""} yet.</strong></p>
                <p>Be the first to note this. Your take helps the next person decide.</p>
                <button class="btn btn-primary" data-first-note>Write the first note</button>
                ${social.user ? `<p style="margin-top:1rem"><a href="feed.html#invite">Invite friends</a> so their notes show up here first.</p>` : ""}
            </div>`;
    }
    return block("Your notes", mine) + block("From people you follow", followed) + block(followed.length || mine.length ? "Everyone else" : "Notes & reviews", everyone);
}

function render() {
    document.getElementById("title-header").innerHTML = headerHtml();
    document.getElementById("title-landed").innerHTML = landedHtml() + episodesHtml();
    document.getElementById("title-reviews").innerHTML = reviewsHtml();
}

async function seasons() {
    return mediaType === "tv" ? title.raw?.seasons || [] : [];
}

async function openLog(existing = null) {
    if (!social.user) {
        location.href = `login.html?next=${encodeURIComponent(`title.html?type=${mediaType}&id=${tmdbId}`)}`;
        return;
    }
    const preset = {};
    if (episodeFilter) [preset.season, preset.episode] = episodeFilter.split(":").map(Number);
    const saved = await openComposer(title, { seasons: await seasons(), existing, preset });
    if (!saved) return;
    entries = [saved, ...entries.filter((e) => e.id !== saved.id)];
    await fetchProfiles([saved.user_id]);
    render();
}

async function toggleOctober() {
    try {
        if (inOctoberBin) {
            await removeFromOctober(mediaType, tmdbId);
            inOctoberBin = false;
        } else {
            await saveForOctober(title);
            inOctoberBin = true;
        }
        render();
    } catch (err) {
        alert(`Couldn't update your October bin: ${err.message}`);
    }
}

// Adds this title to one of the user's lists in user_libraries (the same
// row lists.js and the app use).
async function addToList() {
    const { data } = await window.sb.from("user_libraries").select("*").eq("user_id", social.user.id).maybeSingle();
    const lists = data?.lists || [];
    if (!lists.length) {
        alert("You don't have any lists yet. Make one in My Lists first.");
        return;
    }
    const dialog = openModal(`
        <h2>Add to a list</h2>
        <div class="pick-list">
            ${lists.map((l) => `<button class="btn" data-list-id="${l.id}">${escapeHtml(l.name)} <span class="label">${l.movies.length}</span></button>`).join("")}
        </div>
        <div class="modal-actions"><button class="btn btn-ghost" data-modal-close>Cancel</button></div>
    `);
    dialog.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-list-id]");
        if (!btn) return;
        const list = lists.find((l) => l.id === btn.dataset.listId);
        const item = { ...title };
        delete item.raw;
        if (list.movies.some((m) => m.id === item.id && mediaTypeOf(m) === mediaTypeOf(item))) {
            dialog.close();
            return alert(`Already in "${list.name}".`);
        }
        if (list.movies.length >= 31) return alert("That list already has 31 titles.");
        list.movies.push(item);
        const { error } = await window.sb.from("user_libraries").update({ lists, updated_at: new Date().toISOString() }).eq("user_id", social.user.id);
        dialog.close();
        alert(error ? `Couldn't add: ${error.message}` : `Added to "${list.name}".`);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    const header = document.getElementById("title-header");
    if (!tmdbId) {
        header.innerHTML = `<div class="empty-state">No title picked. Try <a href="search.html">searching</a>.</div>`;
        return;
    }
    if (!tmdbConfigured()) {
        header.innerHTML = `<div class="alert alert-error">Title details need a TMDB API key (assets/js/tmdb-config.js).</div>`;
        return;
    }
    header.innerHTML = `<p>Loading...</p>`;

    await initSocial();
    try {
        title = await tmdbFetchTitle(mediaType, tmdbId);
    } catch (err) {
        header.innerHTML = `<div class="alert alert-error">Couldn't load this title: ${escapeHtml(err.message)}</div>`;
        return;
    }
    document.title = `${title.title} — 31 for 31`;

    const [binKeys] = await Promise.all([loadOctoberBinKeys(), loadEntries(), loadWatchedKeys(mediaType, tmdbId)]);
    inOctoberBin = binKeys.has(watchKey(mediaType, tmdbId));
    render();

    document.querySelector("main").addEventListener("click", (e) => {
        if (e.target.closest("#log-btn") || e.target.closest("[data-first-note]")) openLog();
        else if (e.target.closest("#october-btn")) toggleOctober();
        else if (e.target.closest("#add-list-btn")) addToList();
        else if (e.target.closest("#clear-ep")) {
            episodeFilter = "";
            render();
        } else if (e.target.closest(".ep-bar")) {
            const key = e.target.closest(".ep-bar").dataset.ep;
            episodeFilter = episodeFilter === key ? "" : key;
            render();
        }
    });

    const editId = params.get("edit");
    const toEdit = editId && entries.find((x) => x.id === editId && x.user_id === social.user?.id);
    if (toEdit) openLog(toEdit);

    document.addEventListener("social:entry-edit", (e) => {
        const entry = entries.find((x) => x.id === e.detail.id);
        if (entry) openLog(entry);
    });
    document.addEventListener("social:entry-deleted", (e) => {
        entries = entries.filter((x) => x.id !== e.detail.id);
        render();
    });
});
