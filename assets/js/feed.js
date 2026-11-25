// Powers feed.html.
//
//   Following  notes, reviews and watches from people you follow, plus their
//              running marathons and challenges ("Sam is on night 14 of 31"),
//              live via Realtime
//   Everyone   public notes and reviews from everybody
//   ?mood=x    browse by feeling: titles people tagged with that vibe
//
// Also: find people to follow, and an invite link for cold start.

const FEED_LIMIT = 60;
const urlMood = new URLSearchParams(location.search).get("mood");
let tab = urlMood ? "mood" : "following";
let feedEntries = [];
let runningChallenges = [];
let challengeProgress = new Map();

async function loadFollowing() {
    const ids = [...social.following];
    if (!ids.length) {
        feedEntries = [];
        runningChallenges = [];
        return;
    }
    const today = localDateString();
    const [entriesRes, challengesRes] = await Promise.all([
        window.sb.from("watch_entries").select("*").in("user_id", ids).order("created_at", { ascending: false }).limit(FEED_LIMIT),
        window.sb.from("challenges").select("*").in("owner_id", ids).lte("starts_on", today).gte("ends_on", today),
    ]);
    if (entriesRes.error) console.error(entriesRes.error);
    feedEntries = entriesRes.data || [];
    runningChallenges = challengesRes.data || [];
    challengeProgress = await loadChallengeProgress(runningChallenges);
    await fetchProfiles([...feedEntries.map((e) => e.user_id), ...runningChallenges.map((c) => c.owner_id)]);
}

async function loadEveryone() {
    const { data, error } = await window.sb
        .from("watch_entries")
        .select("*")
        .eq("visibility", "public")
        .or("note.not.is.null,review.not.is.null")
        .order("created_at", { ascending: false })
        .limit(FEED_LIMIT);
    if (error) console.error(error);
    feedEntries = (data || []).filter((e) => !social.blocked.has(e.user_id));
    await fetchProfiles(feedEntries.map((e) => e.user_id));
}

async function loadMood(mood) {
    const { data, error } = await window.sb
        .from("watch_entries")
        .select("*")
        .contains("mood_tags", [mood])
        .order("created_at", { ascending: false })
        .limit(200);
    if (error) console.error(error);
    feedEntries = (data || []).filter((e) => !social.blocked.has(e.user_id));
    await fetchProfiles(feedEntries.map((e) => e.user_id));
}

function challengeStripHtml() {
    if (!runningChallenges.length) return "";
    return `
        <div class="marathon-strip">
            ${runningChallenges
                .map((c) => {
                    const p = challengeProgress.get(c.id);
                    const owner = social.profileCache.get(c.owner_id);
                    return `
                    <a class="marathon-card" href="challenges.html?id=${c.id}">
                        <span class="label">${CHALLENGE_KINDS[c.kind]}</span>
                        <strong>${challengeStatusText(c, p, escapeHtml(profileName(c.owner_id)))}</strong>
                        <span class="dim">${escapeHtml(c.title)}${owner ? ` · @${escapeHtml(owner.username)}` : ""}</span>
                        ${progressBarHtml(p)}
                    </a>`;
                })
                .join("")}
        </div>`;
}

function moodHtml(mood) {
    // Group by title: "titles that feel <mood>".
    const byTitle = new Map();
    feedEntries.forEach((e) => {
        const key = watchKey(e.media_type, e.tmdb_id);
        if (!byTitle.has(key)) byTitle.set(key, { ...e, count: 0 });
        byTitle.get(key).count += 1;
    });
    const titles = [...byTitle.values()].sort((a, b) => b.count - a.count);
    if (!titles.length) return `<div class="empty-state">Nobody has tagged anything "${escapeHtml(mood)}" yet. Log something and add the vibe.</div>`;
    return `<div class="result-grid">${titles
        .map((t) => {
            const poster = tmdbPosterUrl(t.poster_path, "w342");
            return `<div class="result-card"><a href="title.html?type=${t.media_type}&id=${t.tmdb_id}">
                ${poster ? `<img src="${poster}" alt="" loading="lazy">` : `<div class="poster-placeholder"><span class="ppt">${escapeHtml(t.title)}</span></div>`}</a>
                <div class="result-meta"><a class="result-title" href="title.html?type=${t.media_type}&id=${t.tmdb_id}">${escapeHtml(t.title)}</a>
                <span class="label">${t.count} ${t.count === 1 ? "person" : "people"}</span></div></div>`;
        })
        .join("")}</div>`;
}

function render() {
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("btn-primary", b.dataset.tab === tab));
    const out = document.getElementById("feed");
    const moodBar = document.getElementById("mood-bar");
    moodBar.innerHTML = MOOD_TAGS.map((t) => `<a class="mood-tag${t === urlMood ? " active" : ""}" href="feed.html?mood=${encodeURIComponent(t)}">${escapeHtml(t)}</a>`).join("");

    if (tab === "mood") {
        out.innerHTML = `<h2>Feels ${escapeHtml(urlMood)}</h2>${moodHtml(urlMood)}`;
        return;
    }
    if (tab === "following" && !social.following.size) {
        out.innerHTML = `
            <div class="empty-state">
                <p><strong>Your feed is quiet.</strong> Follow a few people and their notes, reviews and marathon progress show up here.</p>
                <p>Find friends below, or send them your invite link.</p>
            </div>`;
        return;
    }
    const entriesHtml = feedEntries.length
        ? `<div class="entries">${feedEntries.map((e) => entryCardHtml(e)).join("")}</div>`
        : `<div class="empty-state">Nothing here yet.</div>`;
    out.innerHTML = (tab === "following" ? challengeStripHtml() : "") + entriesHtml;
}

async function loadTab() {
    document.getElementById("feed").innerHTML = `<p>Loading...</p>`;
    if (tab === "following") await loadFollowing();
    else if (tab === "everyone") await loadEveryone();
    else await loadMood(urlMood);
    render();
}

// ------------------------------------------------------------- people

function personRowHtml(p) {
    const following = social.following.has(p.id);
    return `
        <div class="person-row">
            <a href="profile.html?u=${encodeURIComponent(p.username)}"><strong>${escapeHtml(p.display_name || p.username)}</strong> <span class="dim">@${escapeHtml(p.username)}</span></a>
            ${p.id === social.user.id ? `<span class="label">You</span>` : `<button class="btn btn-sm ${following ? "" : "btn-primary"}" data-follow="${p.id}">${following ? "Following" : "Follow"}</button>`}
        </div>`;
}

async function searchPeople(q) {
    const out = document.getElementById("people-results");
    const term = q.trim().replace(/[%,()]/g, "");
    if (!term) {
        out.innerHTML = "";
        return;
    }
    const { data } = await window.sb
        .from("profiles")
        .select("id,username,display_name")
        .or(`username.ilike.%${term}%,display_name.ilike.%${term}%`)
        .limit(12);
    const people = (data || []).filter((p) => !social.blocked.has(p.id));
    people.forEach((p) => social.profileCache.set(p.id, p));
    out.innerHTML = people.length ? people.map(personRowHtml).join("") : `<p class="dim">No one by that name yet. Invite them!</p>`;
}

function inviteUrl() {
    const base = location.href.replace(/feed\.html.*$/, "");
    return social.profile ? `${base}profile.html?u=${encodeURIComponent(social.profile.username)}&invite=1` : `${base}login.html`;
}

function subscribeRealtime() {
    window.sb
        .channel("follow-feed")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "watch_entries" }, async (payload) => {
            const entry = payload.new;
            if (tab !== "following" || !social.following.has(entry.user_id)) return;
            if (feedEntries.some((e) => e.id === entry.id)) return;
            await fetchProfiles([entry.user_id]);
            feedEntries = [entry, ...feedEntries].slice(0, FEED_LIMIT);
            render();
        })
        .subscribe();
}

document.addEventListener("DOMContentLoaded", async () => {
    const user = await initSocial({ requireUser: true });
    if (!user) return;

    document.querySelectorAll("[data-tab]").forEach((b) =>
        b.addEventListener("click", () => {
            tab = b.dataset.tab;
            if (urlMood) history.replaceState(null, "", "feed.html");
            loadTab();
        })
    );

    let peopleDebounce = null;
    document.getElementById("people-q").addEventListener("input", (e) => {
        clearTimeout(peopleDebounce);
        peopleDebounce = setTimeout(() => searchPeople(e.target.value), 300);
    });
    document.getElementById("people-results").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-follow]");
        if (!btn) return;
        const id = btn.dataset.follow;
        btn.disabled = true;
        if (social.following.has(id)) await unfollowUser(id);
        else await followUser(id);
        btn.closest(".person-row").outerHTML = personRowHtml(social.profileCache.get(id));
        if (tab === "following") loadTab();
    });

    document.getElementById("invite-btn").addEventListener("click", async () => {
        if (!(await requireProfile())) return;
        const url = inviteUrl();
        try {
            if (navigator.share) await navigator.share({ title: "Follow me on 31 for 31", url });
            else {
                await navigator.clipboard.writeText(url);
                document.getElementById("invite-btn").textContent = "Link copied";
            }
        } catch {
            prompt("Copy your invite link:", url);
        }
    });

    await loadTab();
    subscribeRealtime();
});
