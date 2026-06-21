// Local-dev seed: create a demo project with sample previews in local Supabase + Storage, so the
// gallery has something to show without running the full desktop upload. Run via run-seed below.
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL;
const svc = process.env.SERVICE_ROLE_KEY;
const studioId = process.env.STUDIO_ID;
if (!url || !svc || !studioId) throw new Error('set SUPABASE_URL, SERVICE_ROLE_KEY, STUDIO_ID');

const supabase = createClient(url, svc, { auth: { persistSession: false } });
const N = Number(process.env.N ?? 8);

const { data: proj, error } = await supabase
  .from('projects')
  .insert({
    studio_id: studioId,
    name: 'Demo Shoot',
    client_name: 'Demo Client',
    status: 'awaiting_selection',
    share_token: 'demo',
    share_expires_at: new Date(Date.now() + 90 * 864e5).toISOString(),
  })
  .select('id')
  .single();
if (error) throw error;
const projectId = proj.id;

for (let i = 0; i < N; i++) {
  const uuid = crypto.randomUUID();
  const key = `${studioId}/${projectId}/${uuid}.jpg`;
  const res = await fetch(`https://picsum.photos/seed/photobooth${i}/900/600`);
  if (!res.ok) throw new Error(`fetch sample ${i}: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const up = await supabase.storage.from('previews').upload(key, bytes, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (up.error) throw up.error;
  const ins = await supabase.from('photos').insert({
    uuid,
    project_id: projectId,
    studio_id: studioId,
    original_filename: `IMG_${1000 + i}.jpg`,
    preview_path: key,
    width: 900,
    height: 600,
    sort_order: i,
  });
  if (ins.error) throw ins.error;
  console.log(`  uploaded ${i + 1}/${N}`);
}

await supabase.from('projects').update({ photo_count: N }).eq('id', projectId);
console.log(`SEEDED project ${projectId} — open the gallery at /g/demo`);
