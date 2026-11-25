// Two modes, one site. Loaded in <head> on every page (no dependencies) so
// the right theme is applied before the page paints.
//
//   October          -> Marathon Mode: full horror theme, 31-slot lists,
//                       countdown, nightly pick, horror-only search.
//   Other 11 months  -> Off-Season: calmer dark theme with the same DNA,
//                       every genre and TV.
//
// September is still Off-Season, but pages use isDraftSeason() to push the
// "turn your October bin into a draft 31" prompt.
//
// Preview the other mode with ?season=october or ?season=offseason (kept
// for the browser session, cleared with ?season=auto).

(function () {
    const KEY = "31for31-season-override";

    function readOverride() {
        try {
            const param = new URLSearchParams(location.search).get("season");
            if (param === "auto") sessionStorage.removeItem(KEY);
            else if (param === "october" || param === "offseason") sessionStorage.setItem(KEY, param);
            return sessionStorage.getItem(KEY);
        } catch {
            return null;
        }
    }

    const override = readOverride();
    const month = new Date().getMonth(); // 0-indexed: 9 = October
    const season = override || (month === 9 ? "october" : "offseason");

    window.SEASON = season;
    window.isMarathonMode = () => season === "october";
    window.isDraftSeason = () => !override && month === 8; // September
    window.daysUntilOctober = () => {
        const now = new Date();
        const year = now.getMonth() >= 9 ? now.getFullYear() + 1 : now.getFullYear();
        const target = new Date(year, 9, 1);
        return Math.ceil((target - now) / 86400000);
    };

    document.documentElement.dataset.season = season;

    document.addEventListener("DOMContentLoaded", () => {
        const header = document.querySelector(".site-header");
        if (!header || header.querySelector(".season-badge")) return;
        const badge = document.createElement("span");
        badge.className = "season-badge";
        badge.title = season === "october" ? "Marathon Mode: it's October" : `Off-Season: ${window.daysUntilOctober()} days until October`;
        badge.textContent = season === "october" ? "Marathon Mode" : `Off-Season · ${window.daysUntilOctober()}d`;
        header.querySelector(".brand")?.after(badge);
    });
})();
