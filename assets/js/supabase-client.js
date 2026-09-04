// Shared Supabase client, built from config.js. Every page that touches
// auth or data loads this after the supabase-js CDN script and config.js.
window.sb = supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: "31for31-web-auth",
    },
});
