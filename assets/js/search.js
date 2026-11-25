// Powers search.html: find any movie or show, then open its title page.
// October (Marathon Mode) defaults to horror-only; the Off-Season searches
// every genre and TV. Either way the toggle is one click away.

let horrorOnly = window.isMarathonMode();
let includeTv = true;
let binKeys = new Set();
let debounce = null;

function resultHtml(t) {
    const poster = tmdbPosterUrl(t.poster_path, "w342");
    const key = watchKey(mediaTypeOf(t), t.id);
    const saved = binKeys.has(key);
    return `
        <div class="result-card">
            <a href="${titleUrl(t)}">
                ${poster ? `<img src="${poster}" alt="" loading="lazy">` : `<div class="poster-placeholder"><span class="ppt">${escapeHtml(t.title)}</span></div>`}
            </a>
            <div class="result-meta">
                <a href="${titleUrl(t)}" class="result-title">${escapeHtml(t.title)}</a>
                <span class="label">${mediaTypeOf(t) === "tv" ? "TV" : "Film"} · ${(t.release_date || "").slice(0, 4) || "N/A"}</span>
                ${social.user ? `<button class="btn btn-sm ${saved ? "btn-cream" : "btn-ghost"}" data-oct='${JSON.stringify(t).replace(/'/g, "&#39;")}'>${saved ? "✓ October" : "🎃 Save for Oct"}</button>` : ""}
            </div>
        </div>
    `;
}

async function runSearch() {
    const query = document.getElementById("q").value;
    const out = document.getElementById("results");
    if (!query.trim()) {
        out.innerHTML = "";
        return;
    }
    out.innerHTML = `<p>Searching...</p>`;
    try {
        const results = await tmdbSearchTitles(query, { horrorOnly, includeTv });
        out.innerHTML = results.length ? `<div class="result-grid">${results.slice(0, 24).map(resultHtml).join("")}</div>` : `<p>No matches${horrorOnly ? ". Try turning off Horror only." : "."}</p>`;
    } catch (err) {
        out.innerHTML = `<div class="alert alert-error">Search failed: ${escapeHtml(err.message)}</div>`;
    }
}

function moodChips() {
    return MOOD_TAGS.map((t) => `<a class="mood-tag" href="feed.html?mood=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
    await initSocial();
    binKeys = await loadOctoberBinKeys();

    document.getElementById("vibes").innerHTML = moodChips();
    const horrorToggle = document.getElementById("horror-only");
    const tvToggle = document.getElementById("include-tv");
    horrorToggle.checked = horrorOnly;
    tvToggle.checked = includeTv;
    horrorToggle.addEventListener("change", () => {
        horrorOnly = horrorToggle.checked;
        runSearch();
    });
    tvToggle.addEventListener("change", () => {
        includeTv = tvToggle.checked;
        runSearch();
    });

    if (!tmdbConfigured()) {
        document.getElementById("results").innerHTML = `<div class="alert alert-error">Search needs a TMDB API key (assets/js/tmdb-config.js).</div>`;
        return;
    }

    const q = document.getElementById("q");
    q.value = new URLSearchParams(location.search).get("q") || "";
    q.addEventListener("input", () => {
        clearTimeout(debounce);
        debounce = setTimeout(runSearch, 350);
    });
    if (q.value) runSearch();

    document.getElementById("results").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-oct]");
        if (!btn) return;
        const t = JSON.parse(btn.dataset.oct);
        const key = watchKey(mediaTypeOf(t), t.id);
        btn.disabled = true;
        try {
            if (binKeys.has(key)) {
                await removeFromOctober(mediaTypeOf(t), t.id);
                binKeys.delete(key);
            } else {
                await saveForOctober(t);
                binKeys.add(key);
            }
            btn.outerHTML = resultHtml(t).match(/<button[\s\S]*?<\/button>/)[0];
        } catch (err) {
            alert(err.message);
            btn.disabled = false;
        }
    });
});
