// Powers index.html: Tonight's Feature hero + 31-day grid (both driven by
// the real CURRENT_LIST data), a live TMDB Discover panel, and a Supabase-
// backed newsletter signup.

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

function renderFeature() {
    const { isOctober, today } = octoberDayInfo();
    const list = window.CURRENT_LIST || [];
    const dayIndex = isOctober ? Math.min(today, list.length) : 1;
    const movie = list[dayIndex - 1];
    if (!movie) return;

    document.getElementById("feature-eyebrow-label").textContent = isOctober ? "Tonight's Feature" : "Preview";
    document.getElementById("feature-eyebrow-sub").textContent = isOctober ? `Day ${pad2(dayIndex)} of ${list.length}` : `This October · Day ${pad2(dayIndex)} preview`;
    document.getElementById("feature-title").textContent = movie.title;
    document.getElementById("feature-poster").src = movie.file;
    document.getElementById("feature-poster").alt = movie.title;
    document.getElementById("feature-day").textContent = `DAY ${pad2(dayIndex)}`;
}

function renderDayGrid() {
    const { isOctober, today } = octoberDayInfo();
    const list = window.CURRENT_LIST || [];
    const grid = document.getElementById("day-grid");
    if (!grid) return;

    grid.innerHTML = list
        .map((movie, i) => {
            const day = i + 1;
            const sealed = isOctober && day > today;
            const isToday = isOctober && day === today;
            return `
                <div class="day-tile${sealed ? " sealed" : ""}${isToday ? " today" : ""}">
                    <div class="tile-art">
                        <img src="${movie.file}" alt="${sealed ? "" : escapeHtml(movie.title)}" loading="lazy">
                        <div class="daynum">${pad2(day)}</div>
                    </div>
                    <div class="tile-title">${sealed ? "———" : escapeHtml(movie.title)}</div>
                </div>
            `;
        })
        .join("");

    const revealedCount = isOctober ? today : list.length;
    const sealedCount = isOctober ? list.length - today : 0;
    document.getElementById("day-grid-status").textContent = isOctober
        ? `${pad2(revealedCount)} REVEALED / ${pad2(sealedCount)} SEALED`
        : `${list.length} FILMS`;
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

document.addEventListener("DOMContentLoaded", () => {
    renderFeature();
    renderDayGrid();
    loadPopularHorror();
    document.getElementById("random-pick-btn")?.addEventListener("click", randomPick);
    document.getElementById("newsletter-form")?.addEventListener("submit", submitNewsletter);
});
