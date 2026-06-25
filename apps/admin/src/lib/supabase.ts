import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// The admin signs in as their own Supabase user; the `admin` edge function authorizes them
// against the PLATFORM_ADMIN_EMAILS allowlist before doing any privileged work.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});
