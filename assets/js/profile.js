// Powers profile.html?u=<handle> (no handle: your own profile).
// Shows a person's notes/reviews and challenges, as far as RLS lets you see
// them, with follow / block / report. Your own profile adds settings:
// handle, bio, language filter, blocked accounts. ?invite=1 is what invite
// links add, to greet people arriving from a friend's link.

const handle = (new URLSearchParams(location.search).get("u") || "").toLowerCase();
const invited = new URLSearchParams(location.search).has("invite");
let person = null;

async function counts(userId) {
    const [followers, following] = await Promise.all([
        window.sb.from("follows").select("*", { count: "exact", head: true }).eq("followee_id", userId),
        window.sb.from("follows").select("*", { count: "exact", head: true }).eq("follower_id", userId),
    ]);
    return { followers: followers.count || 0, following: following.count || 0 };
}

function headerHtml(c) {
    const mine = social.user?.id === person.id;
    const following = social.following.has(person.id);
    const blocked = social.blocked.has(person.id);
    const actions = mine
        ? `<button class="btn" id="edit-profile">Edit profile</button><a class="btn" href="recap.html">My recaps</a>`
        : social.user
          ? `${blocked ? "" : `<button class="btn ${following ? "" : "btn-primary"}" id="follow-btn">${following ? "Following" : "Follow"}</button>`}
             <a class="btn" href="recap.html?u=${encodeURIComponent(person.username)}">Their recap</a>
             <button class="btn btn-ghost" id="report-btn">Report</button>
             <button class="btn btn-ghost" id="block-btn">${blocked ? "Unblock" : "Block"}</button>`
          : `<a class="btn btn-primary" href="login.html?next=${encodeURIComponent(`profile.html?u=${person.username}`)}">Log in to follow</a>`;
    return `
        ${invited && !mine ? `<div class="alert alert-info">${escapeHtml(person.display_name || person.username)} invited you. Follow them to see their notes and October marathon.</div>` : ""}
        <div class="profile-head">
            <div class="avatar">${escapeHtml((person.display_name || person.username)[0].toUpperCase())}</div>
            <div>
                <h1>${escapeHtml(person.display_name || person.username)}</h1>
                <div class="label">@${escapeHtml(person.username)} · ${c.followers} follower${c.followers === 1 ? "" : "s"} · ${c.following} following</div>
                ${person.bio ? `<p>${escapeHtml(maskLanguage(person.bio))}</p>` : ""}
                <div class="feature-actions">${actions}</div>
            </div>
        </div>`;
}

async function renderChallenges() {
    const { data } = await window.sb.from("challenges").select("*").eq("owner_id", person.id).order("starts_on", { ascending: false }).limit(12);
    const list = data || [];
    const el = document.getElementById("profile-challenges");
    if (!list.length) {
        el.innerHTML = "";
        return;
    }
    const progress = await loadChallengeProgress(list);
    const name = social.user?.id === person.id ? null : escapeHtml(person.display_name || person.username);
    el.innerHTML = `<h3 class="list-heading">Challenges</h3><div class="marathon-strip">${list
        .map((c) => {
            const p = progress.get(c.id);
            return `<a class="marathon-card" href="challenges.html?id=${c.id}"><span class="label">${CHALLENGE_KINDS[c.kind]}</span>
                <strong>${challengeStatusText(c, p, name)}</strong><span class="dim">${escapeHtml(c.title)}</span>${progressBarHtml(p)}</a>`;
        })
        .join("")}</div>`;
}

async function renderEntries() {
    const { data, error } = await window.sb.from("watch_entries").select("*").eq("user_id", person.id).order("watched_on", { ascending: false }).limit(60);
    if (error) console.error(error);
    const el = document.getElementById("profile-entries");
    const list = data || [];
    el.innerHTML = `<h3 class="list-heading">Diary</h3>${
        list.length
            ? `<div class="entries">${list.map((e) => entryCardHtml(e)).join("")}</div>`
            : `<div class="empty-state">${social.user?.id === person.id ? "Nothing logged yet. Find something in <a href='search.html'>Search</a>." : "Nothing you can see yet."}</div>`
    }`;
}

async function render() {
    document.getElementById("profile-header").innerHTML = headerHtml(await counts(person.id));
    if (social.blocked.has(person.id)) {
        document.getElementById("profile-entries").innerHTML = `<div class="empty-state">You blocked this account.</div>`;
        document.getElementById("profile-challenges").innerHTML = "";
        return;
    }
    await Promise.all([renderEntries(), renderChallenges()]);
}

async function openSettings() {
    const { data: blocks } = await window.sb.from("blocks").select("blocked_id").eq("blocker_id", social.user.id);
    const blockedIds = (blocks || []).map((b) => b.blocked_id);
    await fetchProfiles(blockedIds);
    const dialog = openModal(`
        <h2>Edit profile</h2>
        <form id="settings">
            <div class="field"><label>Handle</label><input type="text" id="s-username" pattern="[a-z0-9_]{3,24}" required value="${escapeHtml(person.username)}"></div>
            <div class="field"><label>Display name</label><input type="text" id="s-display" maxlength="40" value="${escapeHtml(person.display_name || "")}"></div>
            <div class="field"><label>Bio</label><textarea id="s-bio" rows="3" maxlength="280">${escapeHtml(person.bio || "")}</textarea></div>
            <label class="check-row"><input type="checkbox" id="s-filter" ${languageFilterOn() ? "checked" : ""}><span>Mask strong language in notes and reviews</span></label>
            <h3 style="margin-top:1rem">Blocked accounts</h3>
            ${blockedIds.length ? blockedIds.map((id) => `<div class="person-row"><span>${escapeHtml(profileName(id))}</span><button type="button" class="btn btn-sm" data-unblock="${id}">Unblock</button></div>`).join("") : `<p class="dim">None.</p>`}
            <div id="s-error"></div>
            <div class="modal-actions"><button type="button" class="btn btn-ghost" data-modal-close>Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>
        </form>`);
    dialog.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-unblock]");
        if (!btn) return;
        if (await unblockUser(btn.dataset.unblock)) btn.closest(".person-row").remove();
    });
    dialog.querySelector("#settings").addEventListener("submit", async (e) => {
        e.preventDefault();
        setLanguageFilter(dialog.querySelector("#s-filter").checked);
        const fields = {
            username: dialog.querySelector("#s-username").value.trim().toLowerCase(),
            display_name: dialog.querySelector("#s-display").value.trim() || null,
            bio: dialog.querySelector("#s-bio").value.trim() || null,
            updated_at: new Date().toISOString(),
        };
        const problem = moderationProblem(fields.bio);
        if (problem) {
            dialog.querySelector("#s-error").innerHTML = `<div class="alert alert-error">${escapeHtml(problem)}</div>`;
            return;
        }
        const { data, error } = await window.sb.from("profiles").update(fields).eq("id", social.user.id).select().single();
        if (error) {
            dialog.querySelector("#s-error").innerHTML = `<div class="alert alert-error">${escapeHtml(error.code === "23505" ? "That handle is taken." : error.message)}</div>`;
            return;
        }
        person = data;
        social.profile = data;
        dialog.close();
        history.replaceState(null, "", `profile.html?u=${encodeURIComponent(data.username)}`);
        render();
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await initSocial();
    const header = document.getElementById("profile-header");

    if (!handle) {
        if (!social.user) return requireAuth();
        if (!(await requireProfile())) {
            header.innerHTML = `<div class="empty-state">Set up a profile to get a page friends can follow. <button class="btn btn-primary" onclick="location.reload()">Set up</button></div>`;
            return;
        }
        person = social.profile;
    } else {
        const { data } = await window.sb.from("profiles").select("*").eq("username", handle).maybeSingle();
        person = data;
    }
    if (!person) {
        header.innerHTML = `<div class="empty-state">No one goes by @${escapeHtml(handle)}.</div>`;
        return;
    }
    social.profileCache.set(person.id, person);
    document.title = `${person.display_name || person.username} — 31 for 31`;
    await render();

    header.addEventListener("click", async (e) => {
        if (e.target.closest("#edit-profile")) openSettings();
        else if (e.target.closest("#follow-btn")) {
            if (social.following.has(person.id)) await unfollowUser(person.id);
            else await followUser(person.id);
            render();
        } else if (e.target.closest("#report-btn")) reportContent("profile", person.id, person.id);
        else if (e.target.closest("#block-btn")) {
            if (social.blocked.has(person.id)) await unblockUser(person.id);
            else await blockUser(person.id);
            render();
        }
    });
});
