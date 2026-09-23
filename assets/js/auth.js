// Shared auth glue: renders the nav's login/account state on every page and
// exposes helpers the per-page scripts (login, lists, community) call into.

function displayNameFor(user) {
    const name = user?.user_metadata?.display_name?.trim();
    if (name) return name;
    return user?.email || "Anonymous";
}

// Like displayNameFor, but NEVER falls back to email — use this for
// anything that gets written to a public-readable table (movie_ratings,
// watch_activity). displayNameFor's email fallback is fine for the nav
// badge (you're the only one who sees your own nav), but writing an
// unset display name into a public row would leak it to everyone.
function publicNameFor(user) {
    return user?.user_metadata?.display_name?.trim() || "Anonymous";
}

async function currentUser() {
    const { data } = await window.sb.auth.getSession();
    return data.session?.user ?? null;
}

// Call at the top of any page that requires a signed-in user. Redirects to
// login.html (preserving where the user was headed) if there's no session.
async function requireAuth() {
    const user = await currentUser();
    if (!user) {
        const next = encodeURIComponent(location.pathname.split("/").pop());
        location.href = `login.html?next=${next}`;
        return null;
    }
    return user;
}

function renderNavAuth(user) {
    const el = document.getElementById("nav-auth");
    if (!el) return;

    if (user) {
        el.innerHTML = `
            <span class="badge">${escapeHtml(displayNameFor(user))}</span>
            <button class="btn btn-sm btn-ghost" id="nav-sign-out">Sign Out</button>
        `;
        document.getElementById("nav-sign-out")?.addEventListener("click", async () => {
            await window.sb.auth.signOut();
            location.href = "index.html";
        });
    } else {
        el.innerHTML = `<a class="btn btn-sm btn-primary" href="login.html">Log In</a>`;
    }
}

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

// Keep the nav in sync on load and whenever auth state changes (sign in/out,
// token refresh) without needing a page reload.
document.addEventListener("DOMContentLoaded", async () => {
    renderNavAuth(await currentUser());
    window.sb.auth.onAuthStateChange((_event, session) => {
        renderNavAuth(session?.user ?? null);
    });

    const path = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".site-nav a").forEach((a) => {
        if (a.getAttribute("href") === path) a.classList.add("active");
    });
});
