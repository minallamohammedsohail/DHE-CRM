// Creates the single Supabase client used by every page.
//
// The version in this URL must match SUPABASE_JS_VERSION in config.js.
// ES module imports cannot use a variable, so the version is written out
// here as well. Never use a floating range like @2 — pin an exact version.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
