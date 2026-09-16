// Thin TMDB client mirroring TMDBService.swift's search behavior: horror
// (and horror-adjacent) results only, same genre allowlist as the app.
const TMDB_BASE = "https://api.themoviedb.org/3";
const ALLOWED_GENRE_IDS = new Set([27, 53, 9648]); // Horror, Thriller, Mystery

function tmdbConfigured() {
    return typeof window.TMDB_API_KEY === "string" && window.TMDB_API_KEY && window.TMDB_API_KEY !== "YOUR_TMDB_API_KEY";
}

function movieMatchesAllowedGenres(movie) {
    const ids = movie.genre_ids || (movie.genres || []).map((g) => g.id) || [];
    return ids.some((id) => ALLOWED_GENRE_IDS.has(id));
}

// Throws on a bad response instead of swallowing it, so callers can show the
// caller why zero results came back (bad key, rate limit, etc.) rather than
// a silent "No matches" that looks identical to a genuinely empty search.
async function tmdbSearchHorrorMovies(query) {
    if (!tmdbConfigured() || !query.trim()) return [];
    const url = `${TMDB_BASE}/search/movie?api_key=${window.TMDB_API_KEY}&query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body?.status_message) detail = body.status_message;
        } catch {
            // response wasn't JSON — stick with the HTTP status
        }
        console.error("TMDB search failed:", detail);
        throw new Error(detail);
    }
    const json = await res.json();
    return (json.results || []).filter(movieMatchesAllowedGenres);
}

async function tmdbFetchMovies(ids) {
    if (!tmdbConfigured() || !ids.length) return [];
    const results = await Promise.all(
        ids.map(async (id) => {
            try {
                const res = await fetch(`${TMDB_BASE}/movie/${id}?api_key=${window.TMDB_API_KEY}`);
                if (!res.ok) return null;
                return await res.json();
            } catch {
                return null;
            }
        })
    );
    return results.filter(Boolean);
}

function tmdbPosterUrl(posterPath) {
    return posterPath ? `https://image.tmdb.org/t/p/w200${posterPath}` : null;
}
