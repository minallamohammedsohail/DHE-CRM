// Supabase connection settings.
//
// This file IS committed to the repository. The anon (publishable) key is
// public by design — it ships in the browser bundle of every Supabase app
// and is protected by Row Level Security, not by secrecy. With no build
// step there is no way to inject it at deploy time, so gitignoring it
// would simply break production.
//
// The service-role key must NEVER appear here, anywhere in this repository,
// or anywhere outside the Supabase dashboard. This project has no backend
// and no Edge Functions, so it should never be needed at all.
//
// Replace both placeholder values from:
//   Supabase dashboard -> Project Settings -> API

export const SUPABASE_URL = 'https://YOUR-PROJECT-REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR-ANON-PUBLISHABLE-KEY';

// Pinned Supabase JS client version. Never use a floating range like @2 —
// a third-party release could then break production with no change here.
// Confirm the current published version before changing this.
export const SUPABASE_JS_VERSION = '2.58.0';

// Business timezone. All "today" / "overdue" / "this month" boundaries are
// computed in this zone, never in UTC or the browser's local zone.
export const TIMEZONE = 'Asia/Kolkata';
