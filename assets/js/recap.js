// Powers recap.html?year=2026[&u=<handle>]: two recaps from the diary
// (watch_entries).
//
//   October recap   the marathon: nights logged, how the 31 went, the best
//                   and worst of the month, the vibe
//   Year in review  everything: films vs. TV, month by month, top rated,
//                   moods, the genre spread beyond horror
//
// Someone else's recap only includes entries you're allowed to see (RLS).

const rq = new URLSearchParams(location.search);
const recapYear = Number(rq.get("year")) || (new Date().getMonth() < 9 ? new Date().getFullYear() - 1 : new Date().getFullYear());
const recapHandle = (rq.get("u") || "").toLowerCase();

function topBy(list, n, key) {
    return [...list].sort((a, b) => (key(b) || 0) - (key(a) || 0)).slice(0, n);
}

function tally(values) {
    const m = new Map();
    values.forEach((v) => m.set(v, (m.get(v) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function posterStrip(list) {
    return `<div class="recap-posters">${list
        .map((e) => {
            const p = tmdbPosterUrl(e.poster_path, "w185");
            return `<a href="title.html?type=${e.media_type}&id=${e.tmdb_id}" title="${escapeHtml(e.title)}">${p ? `<img src="${p}" alt="${escapeHtml(e.title)}">` : `<div class="poster-placeholder"><span class="ppt">${escapeHtml(e.title)}</span></div>`}${e.rating ? `<span class="entry-stars">${starsText(e.rating)}</span>` : ""}</a>`;
        })
        .join("")}</div>`;
}

function stat(value, label) {
    return `<div><div class="big-stat">${value}</div><div class="label">${label}</div></div>`;
}

function octoberHtml(entries, marathon, progress, whose) {
    const oct = entries.filter((e) => e.in_october);
    const titles = oct.filter((e) => e.episode == null);
    const nights = new Set(oct.map((e) => e.watched_on)).size;
    const rated = titles.filter((e) => e.rating);
    const avgRating = rated.length ? (rated.reduce((s, e) => s + e.rating, 0) / rated.length).toFixed(1) : "–";
    const moods = tally(oct.flatMap((e) => e.mood_tags || [])).slice(0, 5);
    const p = marathon ? progress.get(marathon.id) : null;
    if (!oct.length && !marathon) {
        return `<section class="recap october-recap"><span class="label">October ${recapYear}</span><h2>The Marathon</h2>
            <p>No October entries${whose ? "" : " yet"}. ${recapYear === new Date().getFullYear() && new Date().getMonth() < 9 ? "It's coming." : ""}</p></section>`;
    }
    return `
        <section class="recap october-recap">
            <span class="label">October ${recapYear}</span>
            <h2>The Marathon</h2>
            <div class="split-stats">
                ${p ? stat(`${p.done}/${p.target}`, marathon.title) : ""}
                ${stat(nights, "Nights with a watch")}
                ${stat(titles.length, "Titles")}
                ${stat(avgRating, "Average rating")}
            </div>
            ${p ? progressBarHtml(p) : ""}
            ${rated.length ? `<h3 class="list-heading">Best of the month</h3>${posterStrip(topBy(rated, 5, (e) => e.rating))}` : ""}
            ${rated.length > 5 ? `<h3 class="list-heading">Didn't land</h3>${posterStrip(topBy(rated, 3, (e) => -e.rating))}` : ""}
            ${moods.length ? `<h3 class="list-heading">The vibe</h3><div class="mood-tags">${moods.map(([t, n]) => `<span class="mood-tag">${escapeHtml(t)} · ${n}</span>`).join("")}</div>` : ""}
        </section>`;
}

function yearHtml(entries) {
    const titles = entries.filter((e) => e.episode == null);
    const films = titles.filter((e) => e.media_type === "movie");
    const shows = new Set(entries.filter((e) => e.media_type === "tv").map((e) => e.tmdb_id));
    const episodes = entries.filter((e) => e.episode != null);
    const notes = entries.filter((e) => e.note || e.review).length;
    const byMonth = Array.from({ length: 12 }, (_, i) => entries.filter((e) => Number(e.watched_on.slice(5, 7)) === i + 1).length);
    const max = Math.max(1, ...byMonth);
    const monthNames = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
    const offSeason = entries.filter((e) => !e.in_october);
    const moods = tally(entries.flatMap((e) => e.mood_tags || [])).slice(0, 8);
    const rated = titles.filter((e) => e.rating);
    const rewatched = tally(titles.map((e) => `${e.media_type}:${e.tmdb_id}`)).filter(([, n]) => n > 1).length;

    if (!entries.length) return `<section class="recap"><span class="label">${recapYear}</span><h2>Year in Review</h2><p>Nothing logged in ${recapYear}.</p></section>`;
    return `
        <section class="recap">
            <span class="label">${recapYear}</span>
            <h2>Year in Review</h2>
            <div class="split-stats">
                ${stat(films.length, "Films")}
                ${stat(shows.size, "Shows")}
                ${stat(episodes.length, "Episodes")}
                ${stat(notes, "Notes & reviews")}
                ${stat(rewatched, "Rewatched")}
            </div>
            <h3 class="list-heading">Month by month</h3>
            <div class="month-bars">${byMonth
                .map((n, i) => `<div class="month-bar${i === 9 ? " oct" : ""}" title="${n}"><span style="height:${Math.round((n / max) * 100)}%"></span><em>${monthNames[i]}</em></div>`)
                .join("")}</div>
            <p class="dim">${offSeason.length} of ${entries.length} entries were between Octobers.</p>
            ${rated.length ? `<h3 class="list-heading">Top rated</h3>${posterStrip(topBy(rated, 10, (e) => e.rating))}` : ""}
            ${moods.length ? `<h3 class="list-heading">How the year felt</h3><div class="mood-tags">${moods.map(([t, n]) => `<a class="mood-tag" href="feed.html?mood=${encodeURIComponent(t)}">${escapeHtml(t)} · ${n}</a>`).join("")}</div>` : ""}
        </section>`;
}

document.addEventListener("DOMContentLoaded", async () => {
    await initSocial();
    const root = document.getElementById("recap-root");
    let userId = social.user?.id;
    let whose = null;
    if (recapHandle) {
        const { data } = await window.sb.from("profiles").select("*").eq("username", recapHandle).maybeSingle();
        if (!data) {
            root.innerHTML = `<div class="empty-state">No one goes by @${escapeHtml(recapHandle)}.</div>`;
            return;
        }
        userId = data.id;
        whose = data.display_name || data.username;
    } else if (!social.user) {
        return requireAuth();
    }

    const years = [recapYear - 1, recapYear, recapYear + 1].filter((y) => y <= new Date().getFullYear());
    document.getElementById("recap-title").textContent = whose ? `${whose}'s ${recapYear}` : `Your ${recapYear}`;
    document.getElementById("recap-years").innerHTML = years
        .map((y) => `<a class="btn btn-sm ${y === recapYear ? "btn-primary" : ""}" href="recap.html?year=${y}${recapHandle ? `&u=${encodeURIComponent(recapHandle)}` : ""}">${y}</a>`)
        .join("");

    const [entriesRes, marathonRes] = await Promise.all([
        window.sb.from("watch_entries").select("*").eq("user_id", userId).gte("watched_on", `${recapYear}-01-01`).lte("watched_on", `${recapYear}-12-31`).limit(2000),
        window.sb.from("challenges").select("*").eq("owner_id", userId).eq("kind", "marathon").gte("starts_on", `${recapYear}-01-01`).lte("starts_on", `${recapYear}-12-31`).limit(1),
    ]);
    const entries = entriesRes.data || [];
    const marathon = (marathonRes.data || [])[0] || null;
    const progress = marathon ? await loadChallengeProgress([marathon], userId) : new Map();
    root.innerHTML = octoberHtml(entries, marathon, progress, whose) + yearHtml(entries);
});
