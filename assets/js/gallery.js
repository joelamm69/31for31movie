// Powers gallery.html — renders CURRENT_LIST (assets/js/current-list.js) as
// a full day-numbered grid, always fully revealed (this is the look-back
// view; the homepage's day grid is the one with the October lock/reveal).

function escapeHtml(str) {
    const div = document.createElement("div");
    div.textContent = str ?? "";
    return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", () => {
    const grid = document.getElementById("gallery-grid");
    if (!grid || !window.CURRENT_LIST) return;

    grid.innerHTML = window.CURRENT_LIST.map((movie, i) => {
        const day = String(i + 1).padStart(2, "0");
        return `
            <div class="day-tile">
                <div class="tile-art">
                    <img src="${movie.file}" alt="${escapeHtml(movie.title)}" loading="lazy">
                    <div class="daynum">${day}</div>
                </div>
                <div class="tile-title">${escapeHtml(movie.title)}</div>
            </div>
        `;
    }).join("");
});
