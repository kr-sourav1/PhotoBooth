// Edge Function: mint short-lived presigned PUT URLs for uploading previews to Cloudflare R2.
//
// The desktop app is authenticated as a studio user (Supabase JWT). This function:
//   1. resolves the caller's studio_id from their JWT,
//   2. confirms the target project belongs to that studio,
//   3. validates every requested object key is under the studio's prefix (storage-layer tenant
//      isolation, mirroring DB RLS),
//   4. returns a presigned PUT URL per key.
//
// R2 credentials never leave the server — the desktop app only ever sees time-limited URLs.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { AwsClient } from 'npm:aws4fetch@1';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

const R2_ACCOUNT_ID = Deno.env.get('R2_ACCOUNT_ID')!;
const R2_BUCKET = Deno.env.get('R2_BUCKET')!;
const aws = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
  region: 'auto',
  service: 's3',
});

const PRESIGN_TTL_SECONDS = 900; // 15 minutes

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401);

  // A client scoped to the caller's JWT — RLS applies, so any project/studio lookups are
  // automatically constrained to what this user is allowed to see.
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );

  const { data: userRow, error: userErr } = await supabase
    .from('users')
    .select('studio_id')
    .single();
  if (userErr || !userRow) return json({ error: 'unauthorized' }, 401);
  const studioId = userRow.studio_id as string;

  const body = await req.json().catch(() => null);
  const projectId: string | undefined = body?.projectId;
  const keys: string[] | undefined = body?.keys;
  if (!projectId || !Array.isArray(keys) || keys.length === 0) {
    return json({ error: 'bad request' }, 400);
  }
  if (keys.length > 1000) return json({ error: 'too many keys (max 1000)' }, 400);

  // Project must belong to the caller's studio (RLS already filters; double-check explicitly).
  const { data: project } = await supabase
    .from('projects')
    .select('id, studio_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project || project.studio_id !== studioId) return json({ error: 'forbidden' }, 403);

  // Every key must live under this studio's prefix.
  const prefix = `${studioId}/`;
  if (!keys.every((k) => typeof k === 'string' && k.startsWith(prefix))) {
    return json({ error: 'key outside studio prefix' }, 403);
  }

  const base = `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}`;
  const urls: Record<string, string> = {};
  for (const key of keys) {
    const signed = await aws.sign(
      `${base}/${encodeURI(key)}?X-Amz-Expires=${PRESIGN_TTL_SECONDS}`,
      { method: 'PUT', aws: { signQuery: true } },
    );
    urls[key] = signed.url;
  }

  return json({ urls, expiresIn: PRESIGN_TTL_SECONDS });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
