// Edge Function: a client submits its final selection for a project (via share token).
// Idempotent: re-submitting replaces the prior selection for that project.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const { shareToken, photoUuids } = await req.json().catch(() => ({}));
  if (!shareToken || !Array.isArray(photoUuids)) return json({ error: 'bad request' }, 400);

  const { data: project } = await supabase
    .from('projects')
    .select('id, studio_id, share_expires_at')
    .eq('share_token', shareToken)
    .maybeSingle();

  if (!project) return json({ error: 'not found' }, 404);
  if (project.share_expires_at && new Date(project.share_expires_at) < new Date()) {
    return json({ error: 'expired' }, 410);
  }

  // Validate the submitted UUIDs actually belong to this project.
  const { data: valid } = await supabase
    .from('photos')
    .select('uuid')
    .eq('project_id', project.id)
    .in('uuid', photoUuids);

  const validUuids = new Set((valid ?? []).map((p) => p.uuid));
  const rows = photoUuids
    .filter((u: string) => validUuids.has(u))
    .map((photo_uuid: string) => ({
      project_id: project.id,
      studio_id: project.studio_id,
      photo_uuid,
      status: 'submitted' as const,
    }));

  // Replace prior selection, then insert the new set.
  await supabase.from('selections').delete().eq('project_id', project.id);
  if (rows.length) await supabase.from('selections').insert(rows);

  await supabase
    .from('projects')
    .update({ status: 'selection_submitted' })
    .eq('id', project.id);

  return json({ ok: true, count: rows.length });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
