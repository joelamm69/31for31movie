// Powers challenges.html.
//
//   (no params)            your challenges + "start one" templates
//   ?id=<uuid>             one challenge: progress per member, items to
//                          check off, add titles, invite friends (shared
//                          marathons), leave/delete
//   ?new=<template>[&list=<list id>]   open the create form, e.g. from the
//                          October bin's "start a marathon from this draft"
//
// Logging a watch anywhere (title page, My Lists) checks matching items off
// automatically while the challenge is running (social.js checkOffChallenges).

const qs = new URLSearchParams(location.search);

function nextOctober() {
    const now = new Date();
    const year = now.getMonth() > 9 ? now.getFullYear() + 1 : now.getFullYear();
    return { start: `${year}-10-01`, end: `${year}-10-31`, year };
}

function yearBounds() {
    const now = new Date();
    const year = now.getMonth() === 11 ? now.getFullYear() + 1 : now.getFullYear();
    return { start: now.getMonth() === 11 ? `${year}-01-01` : localDateString(), end: `${year}-12-31`, year };
}

const TEMPLATES = {
    marathon: () => {
        const o = nextOctober();
        return { kind: "marathon", title: `31 for 31 · ${o.year}`, description: "One horror pick a night, all October.", target_count: 31, starts_on: o.start, ends_on: o.end };
    },
    monthly: () => {
        const y = yearBounds();
        return { kind: "monthly", title: `12 for 12 · ${y.year}`, description: "One a month, all year.", target_count: 12, starts_on: `${y.year}-01-01`, ends_on: y.end };
    },
    series: () => {
        const y = yearBounds();
        return { kind: "series", title: "Finish a series", description: "", target_count: 10, starts_on: localDateString(), ends_on: y.end };
    },
    eighties: () => {
        const y = yearBounds();
        return { kind: "custom", title: "10 from the 80s", description: "Ten films released 1980 to 1989.", target_count: 10, starts_on: localDateString(), ends_on: y.end };
    },
    custom: () => {
        const y = yearBounds();
        return { kind: "custom", title: "", description: "", target_count: 10, starts_on: localDateString(), ends_on: y.end };
    },
};

const TEMPLATE_BLURBS = {
    marathon: ["31 for 31", "The October marathon: a horror pick every night."],
    monthly: ["12 for 12", "One a month, all year. Keeps the habit alive between Octobers."],
    series: ["Finish a series", "Pick a show and a deadline. Every episode you log counts."],
    eighties: ["10 from the 80s", "Ten films from one decade. Swap in any theme."],
    custom: ["Your own", "Any number, any dates, any rule."],
};

// ---------------------------------------------------------------- list view

async function renderIndex() {
    const uid = social.user.id;
    const [owned, joined] = await Promise.all([
        window.sb.from("challenges").select("*").eq("owner_id", uid).order("starts_on", { ascending: false }),
        window.sb.from("challenge_members").select("challenges(*)").eq("user_id", uid),
    ]);
    const all = [...(owned.data || []), ...(joined.data || []).map((r) => r.challenges).filter(Boolean)];
    const progress = await loadChallengeProgress(all, uid);
    const today = localDateString();
    const active = all.filter((c) => c.ends_on >= today);
    const past = all.filter((c) => c.ends_on < today);
    const card = (c) => {
        const p = progress.get(c.id);
        return `<a class="marathon-card" href="challenges.html?id=${c.id}"><span class="label">${CHALLENGE_KINDS[c.kind]}${c.owner_id !== uid ? " · shared" : ""}</span>
            <strong>${escapeHtml(c.title)}</strong><span class="dim">${challengeStatusText(c, p)} · ${formatDate(c.starts_on)} to ${formatDate(c.ends_on)}</span>${progressBarHtml(p)}</a>`;
    };
    document.getElementById("challenges-root").innerHTML = `
        <h3 class="list-heading">Start one</h3>
        <div class="template-grid">${Object.entries(TEMPLATE_BLURBS)
            .map(([key, [name, blurb]]) => `<button class="template-card" data-template="${key}"><strong>${name}</strong><span>${blurb}</span></button>`)
            .join("")}</div>
        <h3 class="list-heading">Active</h3>
        ${active.length ? `<div class="marathon-strip">${active.map(card).join("")}</div>` : `<p class="dim">Nothing running. Pick a template above.</p>`}
        ${past.length ? `<h3 class="list-heading">Finished</h3><div class="marathon-strip">${past.map(card).join("")}</div>` : ""}
    `;
}

// ------------------------------------------------------------- create form

async function openCreate(templateKey, listId = null) {
    if (!(await requireProfile())) return;
    const t = TEMPLATES[templateKey]();
    const { data: lib } = await window.sb.from("user_libraries").select("lists").eq("user_id", social.user.id).maybeSingle();
    const lists = lib?.lists || [];
    const dialog = openModal(`
        <h2>${TEMPLATE_BLURBS[templateKey][0]}</h2>
        <form id="create">
            ${t.kind === "series" ? `
            <div class="field"><label>Show</label><input type="search" id="n-show" placeholder="Search TV..." autocomplete="off"><div id="n-show-results" class="search-results"></div>
                <input type="hidden" id="n-series-id"></div>` : ""}
            <div class="field"><label>Name</label><input type="text" id="n-title" required maxlength="80" value="${escapeHtml(t.title)}"></div>
            <div class="field"><label>The rule</label><input type="text" id="n-desc" maxlength="500" value="${escapeHtml(t.description)}"></div>
            <div class="composer-row">
                <div class="field"><label>${t.kind === "series" ? "Episodes" : "How many"}</label><input type="number" id="n-target" min="1" max="366" value="${t.target_count}" required></div>
                <div class="field"><label>Starts</label><input type="date" id="n-start" value="${t.starts_on}" required></div>
                <div class="field"><label>Ends</label><input type="date" id="n-end" value="${t.ends_on}" required></div>
            </div>
            ${t.kind === "marathon" && lists.length ? `
            <div class="field"><label>Fill nights from a list</label><select id="n-list"><option value="">Start empty</option>
                ${lists.map((l) => `<option value="${l.id}" ${l.id === listId ? "selected" : ""}>${escapeHtml(l.name)} (${l.movies.length})</option>`).join("")}</select></div>` : ""}
            <div class="field"><label>Who can see it</label><select id="n-vis">${Object.entries(VISIBILITY).map(([v, o]) => `<option value="${v}" ${v === "followers" ? "selected" : ""}>${o.label}</option>`).join("")}</select></div>
            <div id="n-error"></div>
            <div class="modal-actions"><button type="button" class="btn btn-ghost" data-modal-close>Cancel</button><button class="btn btn-primary" type="submit">Start</button></div>
        </form>`);

    if (t.kind === "series") {
        let debounce = null;
        const input = dialog.querySelector("#n-show");
        const results = dialog.querySelector("#n-show-results");
        input.addEventListener("input", () => {
            clearTimeout(debounce);
            debounce = setTimeout(async () => {
                const shows = (await tmdbSearchTitles(input.value)).filter((r) => r.media_type === "tv").slice(0, 6);
                results.innerHTML = shows.map((s) => `<button type="button" class="btn btn-sm" data-show="${s.id}">${escapeHtml(s.title)} ${(s.release_date || "").slice(0, 4)}</button>`).join(" ");
            }, 350);
        });
        results.addEventListener("click", async (e) => {
            const btn = e.target.closest("[data-show]");
            if (!btn) return;
            const show = await tmdbFetchTitle("tv", Number(btn.dataset.show));
            dialog.querySelector("#n-series-id").value = show.id;
            dialog.querySelector("#n-title").value = `Finish ${show.title}`;
            dialog.querySelector("#n-target").value = show.raw.number_of_episodes || 10;
            input.value = show.title;
            results.innerHTML = "";
        });
    }

    dialog.querySelector("#create").addEventListener("submit", async (e) => {
        e.preventDefault();
        const err = (msg) => (dialog.querySelector("#n-error").innerHTML = `<div class="alert alert-error">${escapeHtml(msg)}</div>`);
        const row = {
            owner_id: social.user.id,
            kind: t.kind,
            title: dialog.querySelector("#n-title").value.trim(),
            description: dialog.querySelector("#n-desc").value.trim() || null,
            target_count: Number(dialog.querySelector("#n-target").value),
            starts_on: dialog.querySelector("#n-start").value,
            ends_on: dialog.querySelector("#n-end").value,
            visibility: dialog.querySelector("#n-vis").value,
        };
        if (t.kind === "series") {
            row.series_tmdb_id = Number(dialog.querySelector("#n-series-id").value) || null;
            if (!row.series_tmdb_id) return err("Pick a show first.");
        }
        const listSel = dialog.querySelector("#n-list");
        const sourceList = listSel?.value ? lists.find((l) => l.id === listSel.value) : null;
        if (sourceList) row.list_id = sourceList.id;
        const problem = moderationProblem(row.title) || moderationProblem(row.description);
        if (problem) return err(problem);

        const { data, error } = await window.sb.from("challenges").insert(row).select().single();
        if (error) return err(error.message);
        if (sourceList?.movies.length) {
            const items = sourceList.movies.slice(0, row.target_count).map((m, i) => ({
                challenge_id: data.id,
                added_by: social.user.id,
                media_type: mediaTypeOf(m),
                tmdb_id: m.id,
                title: m.title,
                poster_path: m.poster_path,
                slot: i + 1,
            }));
            const { error: itemError } = await window.sb.from("challenge_items").insert(items);
            if (itemError) console.error(itemError);
        }
        location.href = `challenges.html?id=${data.id}`;
    });
}

// ------------------------------------------------------------- detail view

let challenge = null;
let members = []; // user ids, owner first

async function renderDetail(id) {
    const root = document.getElementById("challenges-root");
    const { data, error } = await window.sb.from("challenges").select("*").eq("id", id).maybeSingle();
    if (error || !data) {
        root.innerHTML = `<div class="empty-state">This challenge doesn't exist or isn't shared with you.</div>`;
        return;
    }
    challenge = data;
    const { data: mem } = await window.sb.from("challenge_members").select("user_id").eq("challenge_id", id);
    members = [challenge.owner_id, ...(mem || []).map((m) => m.user_id)];
    await fetchProfiles(members);
    const uid = social.user.id;
    const isOwner = challenge.owner_id === uid;
    const isMember = members.includes(uid);
    const perMember = await Promise.all(members.map(async (m) => [m, (await loadChallengeProgress([challenge], m)).get(challenge.id)]));
    const items = perMember[0][1].items.sort((a, b) => (a.slot ?? 999) - (b.slot ?? 999) || a.created_at.localeCompare(b.created_at));
    document.title = `${challenge.title} — 31 for 31`;

    const memberRows = perMember
        .map(([m, p]) => `<div class="member-row"><span>${profileLink(m)}${m === challenge.owner_id ? ` <span class="label">owner</span>` : ""}</span>
            <span class="dim">${p.done}/${p.target}</span>${progressBarHtml(p)}</div>`)
        .join("");

    const itemRows = items
        .map((i) => {
            const poster = tmdbPosterUrl(i.poster_path);
            const doneByMe = i.completed_by.includes(uid);
            const others = i.completed_by.filter((u) => u !== uid).map((u) => escapeHtml(profileName(u)));
            return `<div class="movie-row" data-item="${i.id}">
                ${challenge.kind === "marathon" && i.slot ? `<span class="slot">${String(i.slot).padStart(2, "0")}</span>` : ""}
                ${poster ? `<img src="${poster}" alt="">` : `<div style="width:46px;height:69px;background:var(--bg-raised);flex-shrink:0"></div>`}
                <div class="movie-meta"><div class="title"><a href="title.html?type=${i.media_type}&id=${i.tmdb_id}">${escapeHtml(i.title)}</a></div>
                    <div class="year">${others.length ? `✓ ${others.join(", ")}` : ""}</div></div>
                ${isMember ? `<div class="movie-actions">
                    <button class="btn btn-sm ${doneByMe ? "btn-primary" : "btn-ghost"}" data-check>${doneByMe ? (challenge.kind === "marathon" ? "✓ Watched" : "✓ Done") : "Mark done"}</button>
                    <button class="btn btn-sm btn-ghost" data-remove-item>Remove</button></div>` : ""}
            </div>`;
        })
        .join("");

    root.innerHTML = `
        <div class="section-heading"><div><span class="label">${CHALLENGE_KINDS[challenge.kind]} · ${formatDate(challenge.starts_on)} to ${formatDate(challenge.ends_on)}</span>
            <h1>${escapeHtml(challenge.title)}</h1></div>
            <span class="label">${VISIBILITY[challenge.visibility].icon} ${VISIBILITY[challenge.visibility].label}</span></div>
        ${challenge.description ? `<p>${escapeHtml(challenge.description)}</p>` : ""}
        <div class="card">${memberRows}
            ${isOwner ? `<form id="add-member" class="inline-form"><input type="text" id="member-handle" placeholder="Add a friend by @handle (you must follow each other)"><button class="btn btn-sm">Add</button></form>` : ""}
        </div>
        ${challenge.kind === "series"
            ? `<div class="card"><p>Log episodes on the <a href="title.html?type=tv&id=${challenge.series_tmdb_id}">show's page</a>. Every episode you log between the start and end dates counts.</p></div>`
            : `${isMember ? `<div class="field"><label>Add a title</label><input type="search" id="add-item" placeholder="Search..." autocomplete="off"><div id="add-results" class="search-results"></div></div>` : ""}
               <div class="card">${itemRows || `<p class="dim">No titles yet.${isMember ? " Search above to add some." : ""}</p>`}</div>`}
        <div class="feature-actions">
            ${isOwner ? `<button class="btn btn-danger" id="delete-challenge">Delete challenge</button>` : ""}
            ${isMember && !isOwner ? `<button class="btn" id="leave-challenge">Leave</button>` : ""}
            ${!isMember ? `<button class="btn btn-ghost" id="report-challenge">Report</button>` : ""}
        </div>`;
}

async function detailClick(e) {
    const uid = social.user.id;
    const row = e.target.closest("[data-item]");
    if (e.target.closest("[data-check]") && row) {
        const { data: item } = await window.sb.from("challenge_items").select("completed_by").eq("id", row.dataset.item).single();
        const done = item.completed_by.includes(uid);
        const completed_by = done ? item.completed_by.filter((u) => u !== uid) : [...item.completed_by, uid];
        await window.sb.from("challenge_items").update({ completed_by }).eq("id", row.dataset.item);
        renderDetail(challenge.id);
    } else if (e.target.closest("[data-remove-item]") && row) {
        if (!confirm("Remove this title from the challenge?")) return;
        await window.sb.from("challenge_items").delete().eq("id", row.dataset.item);
        renderDetail(challenge.id);
    } else if (e.target.closest("[data-add]")) {
        const t = JSON.parse(e.target.closest("[data-add]").dataset.add);
        const { data: existing } = await window.sb.from("challenge_items").select("slot").eq("challenge_id", challenge.id);
        const nextSlot = Math.max(0, ...(existing || []).map((x) => x.slot || 0)) + 1;
        const { error } = await window.sb.from("challenge_items").insert({
            challenge_id: challenge.id, added_by: uid, media_type: mediaTypeOf(t), tmdb_id: t.id, title: t.title, poster_path: t.poster_path,
            slot: challenge.kind === "marathon" ? nextSlot : null,
        });
        if (error) alert(error.message);
        renderDetail(challenge.id);
    } else if (e.target.closest("#delete-challenge")) {
        if (!confirm("Delete this challenge for everyone in it?")) return;
        await window.sb.from("challenges").delete().eq("id", challenge.id);
        location.href = "challenges.html";
    } else if (e.target.closest("#leave-challenge")) {
        await window.sb.from("challenge_members").delete().eq("challenge_id", challenge.id).eq("user_id", uid);
        location.href = "challenges.html";
    } else if (e.target.closest("#report-challenge")) {
        reportContent("challenge", challenge.id, challenge.owner_id);
    }
}

async function addMember(e) {
    e.preventDefault();
    const handle = document.getElementById("member-handle").value.trim().replace(/^@/, "").toLowerCase();
    const { data: p } = await window.sb.from("profiles").select("id").eq("username", handle).maybeSingle();
    if (!p) return alert(`No one goes by @${handle}.`);
    const { error } = await window.sb.from("challenge_members").insert({ challenge_id: challenge.id, user_id: p.id });
    if (error) return alert(error.code === "42501" ? "You can only add people you follow who follow you back." : error.message);
    renderDetail(challenge.id);
}

let addDebounce = null;

document.addEventListener("DOMContentLoaded", async () => {
    const user = await initSocial({ requireUser: true });
    if (!user) return;
    const root = document.getElementById("challenges-root");

    if (qs.get("id")) {
        await renderDetail(qs.get("id"));
        root.addEventListener("click", detailClick);
        root.addEventListener("submit", (e) => e.target.id === "add-member" && addMember(e));
        root.addEventListener("input", (e) => {
            if (e.target.id !== "add-item") return;
            clearTimeout(addDebounce);
            addDebounce = setTimeout(async () => {
                const out = document.getElementById("add-results");
                try {
                    const found = await tmdbSearchTitles(e.target.value, { horrorOnly: challenge.kind === "marathon" });
                    out.innerHTML = found.slice(0, 8).map((t) =>
                        `<div class="movie-row" data-add='${JSON.stringify(t).replace(/'/g, "&#39;")}' style="cursor:pointer">
                            <div class="movie-meta"><div class="title">${escapeHtml(t.title)}</div><div class="year">${t.media_type === "tv" ? "TV · " : ""}${(t.release_date || "").slice(0, 4)}</div></div>
                            <div class="movie-actions"><span class="btn btn-sm btn-primary">+ Add</span></div></div>`).join("");
                } catch (err) {
                    out.innerHTML = `<div class="alert alert-error">${escapeHtml(err.message)}</div>`;
                }
            }, 350);
        });
        return;
    }

    await renderIndex();
    root.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-template]");
        if (btn) openCreate(btn.dataset.template);
    });
    if (qs.get("new") && TEMPLATES[qs.get("new")]) openCreate(qs.get("new"), qs.get("list"));
});
