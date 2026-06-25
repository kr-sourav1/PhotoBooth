// Platform admin API — the product operator provisions studios here. Every action is gated by an
// allowlist (PLATFORM_ADMIN_EMAILS): the caller must be signed in AND their email must be on the
// list. Privileged work uses the service role; no studio account can reach this.
//
// Actions:
//   create_studio   { studioName, ownerEmail, ownerName?, password } → creates a confirmed owner
//                     account (no email sent); the signup trigger bootstraps the studio.
//   list_studios    → all studios with owner + project counts.
//   reset_password  { ownerId, password } → set a studio owner's password.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ADMIN_EMAILS = (Deno.env.get('PLATFORM_ADMIN_EMAILS') ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  // Verify the caller is an allowlisted platform admin.
  const caller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: who } = await caller.auth.getUser();
  const email = who?.user?.email?.toLowerCase();
  if (!email || !ADMIN_EMAILS.includes(email)) return json({ error: 'forbidden' }, 403);

  const svc = createClient(SUPABASE_URL, SERVICE);
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case 'create_studio': {
      const { studioName, ownerEmail, ownerName, password } = body;
      if (!studioName || !ownerEmail || !password) return json({ error: 'missing fields' }, 400);
      if (String(password).length < 6) return json({ error: 'password too short' }, 400);
      const { data, error } = await svc.auth.admin.createUser({
        email: ownerEmail,
        password,
        email_confirm: true, // pre-confirmed — no email service needed
        user_metadata: { studio_name: studioName, full_name: ownerName ?? '' },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, ownerId: data.user.id, ownerEmail });
    }

    case 'list_studios': {
      const { data, error } = await svc
        .from('studios')
        .select('id, name, plan, created_at, users(id, email, role), projects(count)')
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 400);
      return json({ studios: data ?? [] });
    }

    case 'reset_password': {
      const { ownerId, password } = body;
      if (!ownerId || !password) return json({ error: 'missing fields' }, 400);
      if (String(password).length < 6) return json({ error: 'password too short' }, 400);
      const { error } = await svc.auth.admin.updateUserById(ownerId, { password });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    default:
      return json({ error: 'unknown action' }, 400);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
