// Edge Function: resolve a public share token → project + previews.
// Clients are anonymous; this runs with the service-role key and validates the token itself
// (RLS deliberately does not expose anonymous gallery access).
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

  const { shareToken } = await req.json().catch(() => ({ shareToken: null }));
  if (!shareToken) return json({ error: 'missing shareToken' }, 400);

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, share_expires_at, studios(brand_color)')
    .eq('share_token', shareToken)
    .maybeSingle();

  if (!project) return json({ error: 'not found' }, 404);
  if (project.share_expires_at && new Date(project.share_expires_at) < new Date()) {
    return json({ error: 'expired' }, 410);
  }

  const { data: photos } = await supabase
    .from('photos')
    .select('uuid, project_id, original_filename, preview_path, width, height, sort_order')
    .eq('project_id', project.id)
    .order('sort_order', { ascending: true });

  return json({
    projectName: project.name,
    brandColor: (project as any).studios?.brand_color ?? null,
    photos: (photos ?? []).map((p) => ({
      uuid: p.uuid,
      projectId: p.project_id,
      originalFilename: p.original_filename,
      previewPath: p.preview_path,
      width: p.width,
      height: p.height,
      sortOrder: p.sort_order,
    })),
  });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}
