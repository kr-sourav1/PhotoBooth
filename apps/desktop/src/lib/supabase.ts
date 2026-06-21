import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Authenticated studio client. The desktop app signs in as a studio user; all DB writes
// (projects, photos) go through this client and are constrained by RLS to the user's studio.
export const supabase = createClient(url, anonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Base CDN URL for previews, e.g. https://previews.yourcdn.com */
export const previewBaseUrl = (import.meta.env.VITE_R2_PUBLIC_BASE_URL as string) ?? '';
