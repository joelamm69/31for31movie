// Shared social layer for every page that shows or writes notes, reviews,
// follows or challenges. Loaded after supabase-client.js, auth.js and tmdb.js.
//
// Tables (supabase/between_octobers.sql): profiles, watch_entries, follows,
// blocks, reports, october_bin, challenges, challenge_members,
// challenge_items. Who can see what is enforced by RLS there; this file
// only decides how things look.

const MOOD_TAGS = [
    "cozy", "dread", "comfort watch", "rewatchable in october", "fun", "gross",
    "slow burn", "jumpy", "bleak", "campy", "beautiful", "unsettling", "weird", "heartfelt",
];

const VISIBILITY = {
    public: { label: "Public", icon: "◉" },
    followers: { label: "Followers", icon: "◐" },
    private: { label: "Only me", icon: "○" },
};

const REPORT_REASONS = {
    spam: "Spam",
    harassment: "Harassment or bullying",
    hate: "Hate speech",
    sexual: "Sexual content",
    spoiler: "Unmarked spoiler",
    other: "Something else",
};

// ------------------------------------------------------------------ helpers

function relativeTime(iso) {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatDate(isoDate) {
    if (!isoDate) return "";
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function localDateString(date = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function episodeLabel(season, episode) {
    if (season == null) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return episode == null ? `Season ${season}` : `S${pad(season)}E${pad(episode)}`;
}

function starsText(rating) {
    return rating ? "★".repeat(rating) + "☆".repeat(5 - rating) : "";
}

function slugifyUsername(name) {
    const base = (name || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 18);
    return base.length >= 3 ? base : `fan_${base}`.slice(0, 18);
}

// ------------------------------------------------------------ content filter
// App Store guideline 1.2 asks for "a method for filtering objectionable
// material". Two layers: (1) on submit, a note or review containing a
// blocked term is refused with a message; (2) on display, strong language
// is masked unless the viewer turned the filter off. This list is short on
// purpose; a production filter should live server-side (e.g. an edge
// function or a check constraint fed by a maintained list) so the app and
// site can't drift apart.

const FILTER_KEY = "31for31-language-filter";
const MASKED_TERMS = ["fuck", "fucking", "shit", "cunt", "bitch", "motherfucker", "asshole"];
const MASK_RE = new RegExp(`\\b(${MASKED_TERMS.join("|")})\\b`, "gi");

function languageFilterOn() {
    try {
        return localStorage.getItem(FILTER_KEY) !== "off";
    } catch {
        return true;
    }
}

function setLanguageFilter(on) {
    try {
        localStorage.setItem(FILTER_KEY, on ? "on" : "off");
    } catch {
        // storage unavailable: filter stays on
    }
}

function maskLanguage(text) {
    if (!languageFilterOn()) return text;
    return text.replace(MASK_RE, (w) => w[0] + "•".repeat(w.length - 1));
}

// Returns an error message, or null if the text is fine to post. Kept to
// abuse patterns (targeted harassment phrasing, spam links) rather than
// swearing, which is masked on display instead of refused.
function moderationProblem(text) {
    if (!text) return null;
    if ((text.match(/https?:\/\//g) || []).length > 2) return "Too many links. Notes can include at most two.";
    if (/(kill|hurt)\s+yourself|\bkys\b/i.test(text)) return "That note looks like it targets someone. Please rephrase it.";
    return null;
}

// ------------------------------------------------------------------- state

const social = {
    user: null,
    profile: null, // this user's profiles row, or null if not set up yet
    following: new Set(), // user ids I follow
    blocked: new Set(), // user ids I blocked
    watchedKeys: new Set(), // "movie:603", "tv:1399", "tv:1399:1:3"
    profileCache: new Map(), // user id -> profile
};

function watchKey(mediaType, tmdbId, season = null, episode = null) {
    let key = `${mediaType}:${tmdbId}`;
    if (season != null) key += `:${season}`;
    if (episode != null) key += `:${episode}`;
    return key;
}

async function initSocial({ requireUser = false } = {}) {
    social.user = requireUser ? await requireAuth() : await currentUser();
    if (!social.user) return null;
    const uid = social.user.id;

    const [profileRes, followRes, blockRes] = await Promise.all([
        window.sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
        window.sb.from("follows").select("followee_id").eq("follower_id", uid),
        window.sb.from("blocks").select("blocked_id").eq("blocker_id", uid),
    ]);
    if (profileRes.error) console.error("Failed to load profile", profileRes.error);
    social.profile = profileRes.data || null;
    if (social.profile) social.profileCache.set(uid, social.profile);
    social.following = new Set((followRes.data || []).map((r) => r.followee_id));
    social.blocked = new Set((blockRes.data || []).map((r) => r.blocked_id));
    return social.user;
}

// What this user has watched, for spoiler unlocking. Pass the titles a page
// cares about to keep it to one small query.
async function loadWatchedKeys(mediaType, tmdbId) {
    if (!social.user) return;
    const { data } = await window.sb
        .from("watch_entries")
        .select("media_type,tmdb_id,season,episode")
        .eq("user_id", social.user.id)
        .eq("media_type", mediaType)
        .eq("tmdb_id", tmdbId);
    (data || []).forEach((e) => {
        social.watchedKeys.add(watchKey(e.media_type, e.tmdb_id));
        if (e.season != null) social.watchedKeys.add(watchKey(e.media_type, e.tmdb_id, e.season));
        if (e.episode != null) social.watchedKeys.add(watchKey(e.media_type, e.tmdb_id, e.season, e.episode));
    });
    if (mediaType === "movie") {
        const { data: lib } = await window.sb.from("user_libraries").select("watched_movie_ids").eq("user_id", social.user.id).maybeSingle();
        if ((lib?.watched_movie_ids || []).includes(tmdbId)) social.watchedKeys.add(watchKey("movie", tmdbId));
    }
}

function viewerHasWatched(entry) {
    if (entry.episode != null) return social.watchedKeys.has(watchKey(entry.media_type, entry.tmdb_id, entry.season, entry.episode));
    if (entry.season != null) return social.watchedKeys.has(watchKey(entry.media_type, entry.tmdb_id, entry.season));
    return social.watchedKeys.has(watchKey(entry.media_type, entry.tmdb_id));
}

async function fetchProfiles(ids) {
    const missing = [...new Set(ids)].filter((id) => id && !social.profileCache.has(id));
    if (missing.length) {
        const { data, error } = await window.sb.from("profiles").select("id,username,display_name,bio").in("id", missing);
        if (error) console.error("Failed to load profiles", error);
        (data || []).forEach((p) => social.profileCache.set(p.id, p));
    }
    return social.profileCache;
}

function profileName(userId) {
    const p = social.profileCache.get(userId);
    const name = p?.display_name?.trim() || p?.username;
    return name && !name.includes("@") ? name : "Anonymous";
}

function profileLink(userId) {
    const p = social.profileCache.get(userId);
    const name = escapeHtml(profileName(userId));
    return p?.username ? `<a href="profile.html?u=${encodeURIComponent(p.username)}">${name}</a>` : name;
}

// --------------------------------------------------------------- modal UI

// Modals stack: the profile-setup prompt can open on top of the composer
// without losing what was typed there.
function openModal(innerHtml) {
    const dialog = document.createElement("dialog");
    dialog.className = "modal";
    dialog.innerHTML = `<div class="modal-body">${innerHtml}</div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", () => dialog.remove());
    dialog.addEventListener("click", (e) => {
        if (e.target === dialog || e.target.closest("[data-modal-close]")) dialog.close();
    });
    dialog.showModal();
    return dialog;
}

// ---------------------------------------------------------- profile + terms

// Anything social (posting a non-private note, following, reporting,
// challenges) needs a public handle and accepted terms. Existing accounts
// get this prompt once, the first time they do one of those things.
async function requireProfile() {
    if (!social.user) {
        location.href = `login.html?next=${encodeURIComponent(location.pathname.split("/").pop() + location.search)}`;
        return null;
    }
    if (social.profile?.terms_accepted_at) return social.profile;

    return new Promise((resolve) => {
        const existing = social.profile;
        const suggested = existing?.username || slugifyUsername(social.user.user_metadata?.display_name || "");
        const dialog = openModal(`
            <h2>Set up your profile</h2>
            <p>Pick a handle so friends can find and follow you. Your email is never shown.</p>
            <form id="profile-setup">
                <div class="field">
                    <label for="ps-username">Handle</label>
                    <input type="text" id="ps-username" required pattern="[a-z0-9_]{3,24}" value="${escapeHtml(suggested)}"
                        title="3 to 24 lowercase letters, numbers or underscores">
                </div>
                <div class="field">
                    <label for="ps-display">Display name</label>
                    <input type="text" id="ps-display" maxlength="40" value="${escapeHtml(existing?.display_name || social.user.user_metadata?.display_name || "")}">
                </div>
                <label class="check-row">
                    <input type="checkbox" id="ps-terms" required>
                    <span>I agree to the <a href="terms.html" target="_blank">Terms of Use</a>, including no tolerance for abusive or objectionable content.</span>
                </label>
                <div id="ps-error"></div>
                <div class="modal-actions">
                    <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
                    <button type="submit" class="btn btn-primary">Save</button>
                </div>
            </form>
        `);
        let saved = false;
        dialog.addEventListener("close", () => resolve(saved ? social.profile : null));
        dialog.querySelector("#profile-setup").addEventListener("submit", async (e) => {
            e.preventDefault();
            const row = {
                id: social.user.id,
                username: dialog.querySelector("#ps-username").value.trim().toLowerCase(),
                display_name: dialog.querySelector("#ps-display").value.trim() || null,
                terms_accepted_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
            };
            const { data, error } = existing
                ? await window.sb.from("profiles").update(row).eq("id", row.id).select().single()
                : await window.sb.from("profiles").insert(row).select().single();
            if (error) {
                const msg = error.code === "23505" ? "That handle is taken. Try another." : error.message;
                dialog.querySelector("#ps-error").innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`;
                return;
            }
            social.profile = data;
            social.profileCache.set(data.id, data);
            saved = true;
            dialog.close();
        });
    });
}

// ------------------------------------------------------- follows / blocks

async function followUser(userId) {
    if (!(await requireProfile())) return false;
    const { error } = await window.sb.from("follows").insert({ follower_id: social.user.id, followee_id: userId });
    if (error && error.code !== "23505") {
        console.error("Follow failed", error);
        alert("Couldn't follow. Try again.");
        return false;
    }
    social.following.add(userId);
    return true;
}

async function unfollowUser(userId) {
    const { error } = await window.sb.from("follows").delete().eq("follower_id", social.user.id).eq("followee_id", userId);
    if (error) {
        console.error("Unfollow failed", error);
        return false;
    }
    social.following.delete(userId);
    return true;
}

async function blockUser(userId) {
    if (!social.user) return requireProfile();
    if (!confirm(`Block ${profileName(userId)}? You won't see each other's notes, reviews or marathons, and any follows between you are removed.`)) return false;
    const { error } = await window.sb.from("blocks").insert({ blocker_id: social.user.id, blocked_id: userId });
    if (error && error.code !== "23505") {
        console.error("Block failed", error);
        alert("Couldn't block. Try again.");
        return false;
    }
    social.blocked.add(userId);
    social.following.delete(userId);
    document.dispatchEvent(new CustomEvent("social:blocked", { detail: { userId } }));
    return true;
}

async function unblockUser(userId) {
    const { error } = await window.sb.from("blocks").delete().eq("blocker_id", social.user.id).eq("blocked_id", userId);
    if (error) return false;
    social.blocked.delete(userId);
    return true;
}

// ------------------------------------------------------------------ reports

async function reportContent(targetType, targetId, targetUserId) {
    if (!(await requireProfile())) return;
    const options = Object.entries(REPORT_REASONS)
        .map(([value, label], i) => `<label class="check-row"><input type="radio" name="reason" value="${value}" ${i === 0 ? "checked" : ""}><span>${label}</span></label>`)
        .join("");
    const dialog = openModal(`
        <h2>Report</h2>
        <p>Reports go to the moderators, who review them within 24 hours. The person you report isn't told who reported them.</p>
        <form id="report-form">
            ${options}
            <div class="field" style="margin-top:0.8rem">
                <label for="report-details">Details (optional)</label>
                <textarea id="report-details" rows="3" maxlength="1000"></textarea>
            </div>
            <label class="check-row"><input type="checkbox" id="report-block"><span>Also block this person</span></label>
            <div id="report-error"></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
                <button type="submit" class="btn btn-primary">Send report</button>
            </div>
        </form>
    `);
    dialog.querySelector("#report-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const reason = dialog.querySelector("input[name=reason]:checked").value;
        const { error } = await window.sb.from("reports").insert({
            reporter_id: social.user.id,
            target_type: targetType,
            target_id: String(targetId),
            target_user_id: targetUserId || null,
            reason,
            details: dialog.querySelector("#report-details").value.trim() || null,
        });
        if (error && error.code !== "23505") {
            dialog.querySelector("#report-error").innerHTML = `<div class="alert alert-error">${escapeHtml(error.message)}</div>`;
            return;
        }
        const alsoBlock = dialog.querySelector("#report-block").checked;
        dialog.close();
        if (alsoBlock && targetUserId) await blockUser(targetUserId);
        alert("Thanks. The report was sent.");
    });
}

// ------------------------------------------------------------ watch entries

// Logs a watch (optionally with a note/review). Also checks it off in any
// challenge this user is in that includes the title and is running today.
async function logWatchEntry(fields) {
    const entry = {
        user_id: social.user.id,
        visibility: "followers",
        watched_on: localDateString(),
        ...fields,
    };
    const problem = moderationProblem(entry.note) || moderationProblem(entry.review);
    if (problem) throw new Error(problem);
    if (entry.visibility !== "private" && (entry.note || entry.review) && !(await requireProfile())) {
        throw new Error("Set up your profile to share notes, or make this note private.");
    }
    const { data, error } = await window.sb.from("watch_entries").insert(entry).select().single();
    if (error) throw error;
    social.watchedKeys.add(watchKey(data.media_type, data.tmdb_id));
    if (data.season != null) social.watchedKeys.add(watchKey(data.media_type, data.tmdb_id, data.season));
    if (data.episode != null) social.watchedKeys.add(watchKey(data.media_type, data.tmdb_id, data.season, data.episode));
    checkOffChallenges(data).catch((err) => console.error("Challenge check-off failed", err));
    return data;
}

async function updateWatchEntry(id, fields) {
    const problem = moderationProblem(fields.note) || moderationProblem(fields.review);
    if (problem) throw new Error(problem);
    const { data, error } = await window.sb.from("watch_entries").update(fields).eq("id", id).select().single();
    if (error) throw error;
    return data;
}

async function deleteWatchEntry(id) {
    const { error } = await window.sb.from("watch_entries").delete().eq("id", id);
    if (error) throw error;
}

async function myChallengeIds() {
    const uid = social.user.id;
    const [owned, joined] = await Promise.all([
        window.sb.from("challenges").select("id,starts_on,ends_on").eq("owner_id", uid),
        window.sb.from("challenge_members").select("challenge_id, challenges(id,starts_on,ends_on)").eq("user_id", uid),
    ]);
    const all = [...(owned.data || []), ...(joined.data || []).map((r) => r.challenges).filter(Boolean)];
    return all;
}

async function checkOffChallenges(entry) {
    const today = entry.watched_on;
    const running = (await myChallengeIds()).filter((c) => c.starts_on <= today && c.ends_on >= today).map((c) => c.id);
    if (!running.length) return;
    const { data: items } = await window.sb
        .from("challenge_items")
        .select("id,completed_by,season,episode")
        .in("challenge_id", running)
        .eq("media_type", entry.media_type)
        .eq("tmdb_id", entry.tmdb_id);
    const uid = social.user.id;
    await Promise.all(
        (items || [])
            .filter((i) => !i.completed_by.includes(uid))
            .filter((i) => i.season == null || (i.season === entry.season && (i.episode == null || i.episode === entry.episode)))
            .map((i) => window.sb.from("challenge_items").update({ completed_by: [...i.completed_by, uid] }).eq("id", i.id))
    );
}

// --------------------------------------------------------- entry rendering

function entryCardHtml(entry, { showTitle = true } = {}) {
    const mine = social.user && entry.user_id === social.user.id;
    const poster = tmdbPosterUrl(entry.poster_path, "w92");
    const vis = VISIBILITY[entry.visibility] || VISIBILITY.followers;
    const ep = episodeLabel(entry.season, entry.episode);
    const hasWords = entry.note || entry.review;
    const veiled = entry.spoiler && hasWords && !mine && !viewerHasWatched(entry);
    const verb = entry.review ? "reviewed" : entry.note ? "noted" : entry.rating ? "rated" : "watched";

    const titleBit = showTitle
        ? ` ${verb} <a href="title.html?type=${entry.media_type}&id=${entry.tmdb_id}">${escapeHtml(entry.title)}</a>${ep ? ` <span class="ep">${ep}</span>` : ""}`
        : `${ep ? ` <span class="ep">${ep}</span>` : ""}`;

    const body = hasWords
        ? `
        <div class="entry-words${veiled ? " veiled" : ""}">
            ${entry.note ? `<p class="entry-note"><span class="label">Note</span> ${escapeHtml(maskLanguage(entry.note))}</p>` : ""}
            ${entry.review ? `<div class="entry-review"><span class="label">Review</span>${escapeHtml(maskLanguage(entry.review)).replace(/\n/g, "<br>")}</div>` : ""}
        </div>
        ${veiled ? `<button class="spoiler-veil" data-social-action="reveal">Spoilers${ep ? ` for ${ep}` : ""}. Tap to reveal.</button>` : ""}`
        : "";

    const tags = (entry.mood_tags || []).map((t) => `<span class="mood-tag">${escapeHtml(t)}</span>`).join("");

    const actions = mine
        ? `<button class="link-btn" data-social-action="edit">Edit</button>
           <button class="link-btn" data-social-action="delete">Delete</button>`
        : social.user
          ? `<button class="link-btn" data-social-action="report">Report</button>
             <button class="link-btn" data-social-action="block">Block</button>`
          : "";

    return `
        <article class="entry" data-entry-id="${entry.id}" data-user-id="${entry.user_id}" data-title-url="title.html?type=${entry.media_type}&id=${entry.tmdb_id}">
            ${showTitle ? (poster ? `<img class="entry-poster" src="${poster}" alt="">` : `<div class="entry-poster blank"></div>`) : ""}
            <div class="entry-main">
                <div class="entry-head">
                    <span class="entry-who">${profileLink(entry.user_id)}${titleBit}</span>
                    ${entry.rating ? `<span class="entry-stars" title="${entry.rating}/5">${starsText(entry.rating)}</span>` : ""}
                </div>
                ${body}
                ${tags ? `<div class="mood-tags">${tags}</div>` : ""}
                <div class="entry-foot">
                    <span>${formatDate(entry.watched_on)}${entry.in_october ? ` · <span class="oct-badge">October</span>` : ""}</span>
                    ${mine ? `<span title="Who can see this">${vis.icon} ${vis.label}</span>` : ""}
                    ${entry.hidden_by_moderator && mine ? `<span class="danger-text">Hidden by a moderator</span>` : ""}
                    <span class="entry-actions">${actions}</span>
                </div>
            </div>
        </article>
    `;
}

// One delegated handler for every page that renders entry cards.
// Pages listen for "social:entry-edit" to open their own editor.
document.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-social-action]");
    if (!btn) return;
    const card = btn.closest(".entry");
    const action = btn.dataset.socialAction;
    if (action === "reveal") {
        card?.querySelector(".entry-words")?.classList.remove("veiled");
        btn.remove();
    } else if (action === "report" && card) {
        reportContent("entry", card.dataset.entryId, card.dataset.userId);
    } else if (action === "block" && card) {
        if (await blockUser(card.dataset.userId)) {
            document.querySelectorAll(`.entry[data-user-id="${card.dataset.userId}"]`).forEach((el) => el.remove());
        }
    } else if (action === "delete" && card) {
        if (!confirm("Delete this entry?")) return;
        try {
            await deleteWatchEntry(card.dataset.entryId);
            card.remove();
            document.dispatchEvent(new CustomEvent("social:entry-deleted", { detail: { id: card.dataset.entryId } }));
        } catch (err) {
            alert(`Couldn't delete: ${err.message}`);
        }
    } else if (action === "edit" && card) {
        // The title page edits in place; elsewhere, go there to edit.
        if (window.handlesEntryEdit) document.dispatchEvent(new CustomEvent("social:entry-edit", { detail: { id: card.dataset.entryId } }));
        else location.href = `${card.dataset.titleUrl}&edit=${card.dataset.entryId}`;
    }
});

// -------------------------------------------------------- note composer
// Used by the title page (and anywhere else you log a watch). `title` is a
// normalized TMDB title; `existing` is an entry to edit.

function composerHtml(title, { seasons = [], existing = null } = {}) {
    const e = existing || {};
    const isTv = title.media_type === "tv";
    const seasonOptions = seasons
        .filter((s) => s.season_number > 0)
        .map((s) => `<option value="${s.season_number}" ${e.season === s.season_number ? "selected" : ""}>Season ${s.season_number}</option>`)
        .join("");
    const moods = MOOD_TAGS.map(
        (t) => `<label class="mood-choice"><input type="checkbox" name="mood" value="${t}" ${(e.mood_tags || []).includes(t) ? "checked" : ""}><span>${t}</span></label>`
    ).join("");
    const vis = e.visibility || "followers";
    return `
        <form class="composer" id="composer">
            ${isTv ? `
            <div class="composer-row">
                <div class="field"><label>What you watched</label>
                    <select id="c-season"><option value="">The whole show</option>${seasonOptions}</select></div>
                <div class="field"><label>Episode</label>
                    <select id="c-episode" ${e.season ? "" : "disabled"}><option value="">Whole season</option></select></div>
            </div>` : ""}
            <div class="composer-row">
                <div class="field"><label>Watched on</label><input type="date" id="c-date" value="${e.watched_on || localDateString()}" max="${localDateString()}"></div>
                <div class="field"><label>Rating</label>
                    <div class="rating-stars composer-stars" data-value="${e.rating || 0}">
                        ${[1, 2, 3, 4, 5].map((n) => `<span class="star${n <= (e.rating || 0) ? " filled" : ""}" data-value="${n}">&#9733;</span>`).join("")}
                    </div></div>
            </div>
            <div class="field"><label for="c-note">Quick note <span class="hint">during or right after: informal</span></label>
                <textarea id="c-note" rows="2" maxlength="2000" placeholder="First thoughts...">${escapeHtml(e.note || "")}</textarea></div>
            <details ${e.review ? "open" : ""}>
                <summary class="label">Add a review (optional)</summary>
                <div class="field" style="margin-top:0.6rem"><textarea id="c-review" rows="6" maxlength="10000" placeholder="A considered take...">${escapeHtml(e.review || "")}</textarea></div>
            </details>
            <div class="field"><label>Vibe</label><div class="mood-choices">${moods}</div></div>
            <div class="composer-row">
                <label class="check-row"><input type="checkbox" id="c-spoiler" ${e.spoiler ? "checked" : ""}><span>Contains spoilers</span></label>
                <div class="field"><label for="c-vis">Who can see it</label>
                    <select id="c-vis">${Object.entries(VISIBILITY).map(([v, o]) => `<option value="${v}" ${v === vis ? "selected" : ""}>${o.label}</option>`).join("")}</select></div>
            </div>
            <div id="c-error"></div>
            <div class="modal-actions">
                <button type="button" class="btn btn-ghost" data-modal-close>Cancel</button>
                <button type="submit" class="btn btn-primary">${existing ? "Save" : "Log it"}</button>
            </div>
        </form>
    `;
}

// Opens the composer in a modal and resolves with the saved entry (or null).
function openComposer(title, { seasons = [], existing = null, preset = {} } = {}) {
    return new Promise((resolve) => {
        const dialog = openModal(`<h2>${escapeHtml(title.title)}</h2>${composerHtml(title, { seasons, existing: existing || preset })}`);
        let result = null;
        dialog.addEventListener("close", () => resolve(result));

        const stars = dialog.querySelector(".composer-stars");
        stars.addEventListener("click", (e) => {
            const star = e.target.closest(".star");
            if (!star) return;
            const value = Number(star.dataset.value) === Number(stars.dataset.value) ? 0 : Number(star.dataset.value);
            stars.dataset.value = value;
            stars.querySelectorAll(".star").forEach((s) => s.classList.toggle("filled", Number(s.dataset.value) <= value));
        });

        const seasonSel = dialog.querySelector("#c-season");
        const episodeSel = dialog.querySelector("#c-episode");
        async function loadEpisodes(selected) {
            episodeSel.innerHTML = `<option value="">Whole season</option>`;
            episodeSel.disabled = !seasonSel.value;
            if (!seasonSel.value) return;
            try {
                const season = await tmdbFetchSeason(title.id, seasonSel.value);
                episodeSel.innerHTML += (season.episodes || [])
                    .map((ep) => `<option value="${ep.episode_number}" ${selected === ep.episode_number ? "selected" : ""}>${ep.episode_number}. ${escapeHtml(ep.name || "")}</option>`)
                    .join("");
            } catch (err) {
                console.error(err);
            }
        }
        if (seasonSel) {
            seasonSel.addEventListener("change", () => loadEpisodes(null));
            const presetData = existing || preset;
            if (presetData.season) loadEpisodes(presetData.episode);
        }

        dialog.querySelector("#composer").addEventListener("submit", async (e) => {
            e.preventDefault();
            const fields = {
                watched_on: dialog.querySelector("#c-date").value || localDateString(),
                rating: Number(stars.dataset.value) || null,
                note: dialog.querySelector("#c-note").value.trim() || null,
                review: dialog.querySelector("#c-review").value.trim() || null,
                spoiler: dialog.querySelector("#c-spoiler").checked,
                visibility: dialog.querySelector("#c-vis").value,
                mood_tags: [...dialog.querySelectorAll("input[name=mood]:checked")].map((i) => i.value),
            };
            if (seasonSel) {
                fields.season = seasonSel.value ? Number(seasonSel.value) : null;
                fields.episode = fields.season && episodeSel.value ? Number(episodeSel.value) : null;
            }
            const submit = dialog.querySelector("button[type=submit]");
            submit.disabled = true;
            try {
                result = existing
                    ? await updateWatchEntry(existing.id, fields)
                    : await logWatchEntry({
                          media_type: mediaTypeOf(title),
                          tmdb_id: title.id,
                          title: title.title,
                          poster_path: title.poster_path,
                          ...fields,
                      });
                dialog.close();
            } catch (err) {
                dialog.querySelector("#c-error").innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
                submit.disabled = false;
            }
        });
    });
}

// ------------------------------------------------------------ October bin

async function loadOctoberBinKeys() {
    if (!social.user) return new Set();
    const { data } = await window.sb.from("october_bin").select("media_type,tmdb_id").eq("user_id", social.user.id);
    return new Set((data || []).map((r) => watchKey(r.media_type, r.tmdb_id)));
}

async function saveForOctober(title, reason = null) {
    const { error } = await window.sb.from("october_bin").upsert(
        {
            user_id: social.user.id,
            media_type: mediaTypeOf(title),
            tmdb_id: title.id,
            title: title.title,
            poster_path: title.poster_path,
            release_date: title.release_date || null,
            reason,
        },
        { onConflict: "user_id,media_type,tmdb_id" }
    );
    if (error) throw error;
}

async function removeFromOctober(mediaType, tmdbId) {
    const { error } = await window.sb.from("october_bin").delete().eq("user_id", social.user.id).eq("media_type", mediaType).eq("tmdb_id", tmdbId);
    if (error) throw error;
}

// --------------------------------------------------------------- challenges

const CHALLENGE_KINDS = {
    marathon: "Marathon",
    monthly: "One a month",
    series: "Finish a series",
    custom: "Custom",
};

// Progress for each challenge, for one member (default: the owner).
// Marathon/monthly/custom: items that member checked off. Series: distinct
// episodes of the show that member logged inside the challenge window.
async function loadChallengeProgress(challenges, memberId = null) {
    const progress = new Map();
    if (!challenges.length) return progress;
    const ids = challenges.map((c) => c.id);
    const { data: items, error } = await window.sb.from("challenge_items").select("*").in("challenge_id", ids);
    if (error) console.error("Failed to load challenge items", error);

    await Promise.all(
        challenges.map(async (c) => {
            const who = memberId || c.owner_id;
            const mine = (items || []).filter((i) => i.challenge_id === c.id);
            let done = mine.filter((i) => i.completed_by.includes(who)).length;
            if (c.kind === "series" && c.series_tmdb_id) {
                const { data: eps } = await window.sb
                    .from("watch_entries")
                    .select("season,episode")
                    .eq("user_id", who)
                    .eq("media_type", "tv")
                    .eq("tmdb_id", c.series_tmdb_id)
                    .not("episode", "is", null)
                    .gte("watched_on", c.starts_on)
                    .lte("watched_on", c.ends_on);
                done = new Set((eps || []).map((e) => `${e.season}:${e.episode}`)).size;
            }
            progress.set(c.id, { done: Math.min(done, c.target_count), target: c.target_count, items: mine });
        })
    );
    return progress;
}

function challengeStatusText(c, p, name = null) {
    const who = name ? `${name} is` : "You're";
    const today = localDateString();
    if (p.done >= p.target) return `${name || "You"} finished ${escapeHtml(c.title)}`;
    if (today < c.starts_on) return `${escapeHtml(c.title)} starts ${formatDate(c.starts_on)}`;
    if (today > c.ends_on) return `${escapeHtml(c.title)} ended at ${p.done} of ${p.target}`;
    if (c.kind === "marathon") return p.done ? `${who} on night ${p.done} of ${p.target}` : `${who} about to start night 1 of ${p.target}`;
    if (c.kind === "series") return `${who} ${p.done} of ${p.target} episodes in`;
    return `${who} at ${p.done} of ${p.target}`;
}

function progressBarHtml(p) {
    const pct = p.target ? Math.round((p.done / p.target) * 100) : 0;
    return `<div class="progress"><span style="width:${pct}%"></span></div>`;
}
