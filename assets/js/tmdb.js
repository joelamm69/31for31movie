// Thin TMDB client. tmdbSearchHorrorMovies mirrors TMDBService.swift's
// search (horror and horror-adjacent movies only). tmdbSearchTitles is the
// year-round search: every genre, movies and TV, used in the Off-Season.
//
// TV results are normalized into the same shape as a movie (title,
// release_date, poster_path, ...) plus media_type: "tv", so they fit in
// user_libraries lists next to movies. Entries with no media_type are
// movies: that's every list item written before TV support.
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

function tmdbPosterUrl(posterPath, size = "w200") {
    return posterPath ? `https://image.tmdb.org/t/p/${size}${posterPath}` : null;
}

// ---------------------------------------------------------------- year-round

const TMDB_ERROR_PREFIX = "TMDB";

async function tmdbGet(path, params = {}) {
    if (!tmdbConfigured()) throw new Error("No TMDB API key configured");
    const qs = new URLSearchParams({ api_key: window.TMDB_API_KEY, ...params });
    const res = await fetch(`${TMDB_BASE}${path}?${qs}`);
    if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
            const body = await res.json();
            if (body?.status_message) detail = body.status_message;
        } catch {
            // not JSON
        }
        throw new Error(`${TMDB_ERROR_PREFIX}: ${detail}`);
    }
    return res.json();
}

function mediaTypeOf(item) {
    return item?.media_type === "tv" ? "tv" : "movie";
}

// Same keys as a TMDB movie, whatever the source.
function normalizeTitle(raw, mediaType = raw.media_type) {
    const isTv = mediaType === "tv";
    const out = {
        id: raw.id,
        title: isTv ? raw.name || raw.original_name || "" : raw.title || raw.original_title || "",
        overview: raw.overview || "",
        poster_path: raw.poster_path || null,
        release_date: (isTv ? raw.first_air_date : raw.release_date) || "",
        genre_ids: raw.genre_ids || (raw.genres || []).map((g) => g.id),
        genres: raw.genres || [],
    };
    if (isTv) out.media_type = "tv";
    return out;
}

// Every genre, movies and TV. horrorOnly keeps the October filter (TV's
// closest genres: Mystery 9648, Sci-Fi & Fantasy 10765).
async function tmdbSearchTitles(query, { horrorOnly = false, includeTv = true } = {}) {
    if (!tmdbConfigured() || !query.trim()) return [];
    const json = await tmdbGet(includeTv ? "/search/multi" : "/search/movie", { query, include_adult: "false" });
    const tvHorrorGenres = new Set([9648, 10765]);
    return (json.results || [])
        .filter((r) => (includeTv ? r.media_type === "movie" || r.media_type === "tv" : true))
        .map((r) => normalizeTitle(r, includeTv ? r.media_type : "movie"))
        .filter((t) => {
            if (!horrorOnly) return true;
            if (t.media_type === "tv") return t.genre_ids.some((id) => tvHorrorGenres.has(id));
            return movieMatchesAllowedGenres(t);
        });
}

const titleDetailCache = new Map();

async function tmdbFetchTitle(mediaType, id) {
    const key = `${mediaType}:${id}`;
    if (!titleDetailCache.has(key)) {
        titleDetailCache.set(
            key,
            tmdbGet(`/${mediaType === "tv" ? "tv" : "movie"}/${id}`).then((raw) => ({ ...normalizeTitle(raw, mediaType), raw }))
        );
    }
    try {
        return await titleDetailCache.get(key);
    } catch (err) {
        titleDetailCache.delete(key);
        throw err;
    }
}

async function tmdbFetchSeason(tvId, seasonNumber) {
    return tmdbGet(`/tv/${tvId}/season/${seasonNumber}`);
}

function titleUrl(item) {
    return `title.html?type=${mediaTypeOf(item)}&id=${item.id ?? item.tmdb_id}`;
}
