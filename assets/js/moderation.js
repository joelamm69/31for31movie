// Powers moderation.html: the report queue (site admins only; RLS lets
// nobody else read reports). Actions: hide the reported entry (it stays
// visible to its author, marked "Hidden by a moderator"), delete it, or
// dismiss the report. Apple expects reports to be acted on within 24 hours.

let reports = [];

async function loadReports(status) {
    const { data, error } = await window.sb.from("reports").select("*").eq("status", status).order("created_at", { ascending: true }).limit(200);
    if (error) console.error(error);
    reports = data || [];
    const entryIds = reports.filter((r) => r.target_type === "entry").map((r) => r.target_id);
    const entries = new Map();
    if (entryIds.length) {
        const { data: rows } = await window.sb.from("watch_entries").select("*").in("id", entryIds);
        (rows || []).forEach((e) => entries.set(e.id, e));
    }
    await fetchProfiles(reports.flatMap((r) => [r.reporter_id, r.target_user_id]).filter(Boolean));
    return entries;
}

function reportHtml(r, entries) {
    const entry = r.target_type === "entry" ? entries.get(r.target_id) : null;
    const age = (Date.now() - new Date(r.created_at).getTime()) / 3600000;
    let target = "";
    if (entry) target = entryCardHtml(entry);
    else if (r.target_type === "entry") target = `<p class="dim">Entry already deleted.</p>`;
    else if (r.target_type === "profile") target = `<p>Profile: ${profileLink(r.target_id)}</p>`;
    else if (r.target_type === "challenge") target = `<p><a href="challenges.html?id=${r.target_id}">Challenge</a> by ${profileLink(r.target_user_id)}</p>`;
    return `
        <div class="card report" data-report="${r.id}" data-entry="${entry ? entry.id : ""}">
            <div class="section-heading" style="margin-bottom:0.6rem">
                <strong>${REPORT_REASONS[r.reason]}</strong>
                <span class="label ${age > 20 && r.status === "open" ? "danger-text" : ""}">${relativeTime(r.created_at)} · by ${escapeHtml(profileName(r.reporter_id))}</span>
            </div>
            ${r.details ? `<p>"${escapeHtml(r.details)}"</p>` : ""}
            ${target}
            ${r.status === "open" ? `<div class="feature-actions">
                ${entry ? `<button class="btn btn-primary" data-mod="hide">${entry.hidden_by_moderator ? "Already hidden" : "Hide entry"}</button>
                           <button class="btn btn-danger" data-mod="delete">Delete entry</button>` : ""}
                <button class="btn" data-mod="dismiss">Dismiss</button></div>` : `<span class="label">${r.status}</span>`}
        </div>`;
}

async function render() {
    const status = document.getElementById("status-filter").value;
    const entries = await loadReports(status);
    document.getElementById("queue").innerHTML = reports.length ? reports.map((r) => reportHtml(r, entries)).join("") : `<div class="empty-state">Nothing ${status}.</div>`;
}

async function resolve(id, status) {
    await window.sb.from("reports").update({ status, resolved_at: new Date().toISOString() }).eq("id", id);
}

document.addEventListener("DOMContentLoaded", async () => {
    const user = await initSocial({ requireUser: true });
    if (!user) return;
    if (!(await isSiteAdmin())) {
        document.getElementById("queue").innerHTML = `<div class="empty-state">Only moderators can see this page.</div>`;
        return;
    }
    document.getElementById("status-filter").addEventListener("change", render);
    await render();

    document.getElementById("queue").addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-mod]");
        if (!btn) return;
        const card = btn.closest("[data-report]");
        const entryId = card.dataset.entry;
        const action = btn.dataset.mod;
        if (action === "hide") {
            await window.sb.from("watch_entries").update({ hidden_by_moderator: true }).eq("id", entryId);
            await resolve(card.dataset.report, "actioned");
        } else if (action === "delete") {
            if (!confirm("Delete this entry permanently?")) return;
            await window.sb.from("watch_entries").delete().eq("id", entryId);
            await resolve(card.dataset.report, "actioned");
        } else if (action === "dismiss") {
            await resolve(card.dataset.report, "dismissed");
        }
        render();
    });
});
