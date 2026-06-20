import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

// Anonymous client. The gallery never authenticates as a studio user; all gallery reads and
// the selection submit go through Edge Functions that validate the share token server-side.
export const supabase = createClient(url, anonKey);
