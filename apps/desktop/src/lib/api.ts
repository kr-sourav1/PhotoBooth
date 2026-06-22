import { invoke } from '@tauri-apps/api/core';
import { previewObjectKey } from '@photobooth/core';
import { supabase } from './supabase.js';

export interface PreviewResult {
  uuid: string;
  original_filename: string;
  original_path: string;
  content_hash: string;
  preview_path: string; // local filename, e.g. "<uuid>.jpg"
  width: number;
  height: number;
}

/** The signed-in studio user's studio_id (needed to satisfy RLS on inserts). */
export async function getStudioId(): Promise<string> {
  const { data, error } = await supabase.from('users').select('studio_id').single();
  if (error || !data) throw error ?? new Error('no studio for user');
  return data.studio_id as string;
}

export async function createProject(name: string, clientName?: string): Promise<string> {
  const studioId = await getStudioId();
  const { data, error } = await supabase
    .from('projects')
    .insert({ studio_id: studioId, name, client_name: clientName ?? null, status: 'draft' })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('project create failed');
  return data.id as string;
}

// Storage backend: 'r2' (production, via the r2-sign-upload edge function) or 'supabase'
// (local/simple, via Supabase Storage signed upload URLs). Both return PUT URLs the native Rust
// uploader writes preview bytes to, so the rest of the pipeline is identical.
const STORAGE_BACKEND = (import.meta.env.VITE_STORAGE_BACKEND as string) ?? 'r2';

/** Presigned PUT URLs keyed by object key, from whichever storage backend is configured. */
async function presignUploads(projectId: string, keys: string[]): Promise<Record<string, string>> {
  if (STORAGE_BACKEND === 'supabase') {
    const urls: Record<string, string> = {};
    for (const key of keys) {
      const { data, error } = await supabase.storage.from('previews').createSignedUploadUrl(key);
      if (error) throw error;
      urls[key] = data.signedUrl; // full URL; PUT bytes with Content-Type: image/jpeg
    }
    return urls;
  }
  const { data, error } = await supabase.functions.invoke('r2-sign-upload', {
    body: { projectId, keys },
  });
  if (error) throw error;
  return (data as { urls: Record<string, string> }).urls;
}

export interface SyncProgress {
  phase: 'signing' | 'uploading' | 'recording';
}

/**
 * Phase 2 pipeline: take locally generated previews → presign → upload to R2 (native, via the
 * Rust command, no CORS) → write photo rows → mark the project ready for selection.
 * Originals never leave the machine.
 */
export async function uploadAndRecord(
  studioId: string,
  projectId: string,
  previewDir: string,
  photos: PreviewResult[],
  onPhase?: (p: SyncProgress) => void,
): Promise<{ uploaded: number; failures: string[] }> {
  // 1. Build R2 keys and presign.
  const keyByUuid = new Map(photos.map((p) => [p.uuid, previewObjectKey(studioId, projectId, p.uuid)]));
  onPhase?.({ phase: 'signing' });
  const urls = await presignUploads(projectId, [...keyByUuid.values()]);

  // 2. Upload preview bytes natively (Rust).
  onPhase?.({ phase: 'uploading' });
  const items = photos.map((p) => ({
    preview_path: `${previewDir}/${p.preview_path}`,
    url: urls[keyByUuid.get(p.uuid)!]!,
  }));
  const report = await invoke<{ uploaded: number; failures: string[] }>('upload_previews', { items });

  // 3. Record one photo row per successfully uploaded preview (store the R2 key as preview_path).
  onPhase?.({ phase: 'recording' });
  const rows = photos.map((p, i) => ({
    uuid: p.uuid,
    project_id: projectId,
    studio_id: studioId,
    original_filename: p.original_filename,
    preview_path: keyByUuid.get(p.uuid)!,
    content_hash: p.content_hash,
    width: p.width,
    height: p.height,
    sort_order: i,
  }));
  const { error: insErr } = await supabase.from('photos').insert(rows);
  if (insErr) throw insErr;

  await supabase
    .from('projects')
    .update({ photo_count: rows.length, status: 'awaiting_selection' })
    .eq('id', projectId);

  // Previews are uploaded and recorded — delete the local copies (keep only the manifest for
  // collection) so re-uploads never accumulate on disk.
  try {
    await invoke('cleanup_previews', { previewDir });
  } catch {
    // non-fatal
  }

  return report;
}

/** URL-safe high-entropy share token (24 chars, ~108 bits). */
function generateShareToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Ensure the project has a share token and return the full client gallery URL. Reuses an
 * existing token so a re-shared link stays stable. Default 90-day expiry.
 */
export async function ensureShareLink(projectId: string): Promise<string> {
  const { data, error } = await supabase
    .from('projects')
    .select('share_token')
    .eq('id', projectId)
    .single();
  if (error) throw error;

  let token = data?.share_token as string | null;
  if (!token) {
    token = generateShareToken();
    const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const { error: updErr } = await supabase
      .from('projects')
      .update({ share_token: token, share_expires_at: expires })
      .eq('id', projectId);
    if (updErr) throw updErr;
  }

  const base = (import.meta.env.VITE_GALLERY_BASE_URL as string) ?? 'http://localhost:5173';
  return `${base}/g/${token}`;
}

// ── Project management ───────────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  name: string;
  clientName: string | null;
  status: string;
  photoCount: number;
  shareToken: string | null;
  createdAt: string;
}

export async function listAllProjects(): Promise<ProjectSummary[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client_name, status, photo_count, share_token, created_at')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    status: p.status,
    photoCount: p.photo_count,
    shareToken: p.share_token,
    createdAt: p.created_at,
  }));
}

/** Delete a project: removes its preview objects from storage (best effort), then the DB rows
 * (photos/selections cascade). Originals on the studio's disk are never touched. */
export async function deleteProject(projectId: string): Promise<void> {
  const studioId = await getStudioId();
  // Best-effort storage cleanup for the Supabase backend.
  if (STORAGE_BACKEND === 'supabase') {
    try {
      const prefix = `${studioId}/${projectId}`;
      const { data: files } = await supabase.storage.from('previews').list(prefix, { limit: 1000 });
      if (files && files.length) {
        await supabase.storage.from('previews').remove(files.map((f) => `${prefix}/${f.name}`));
      }
    } catch {
      // non-fatal — orphaned previews can be cleaned later
    }
  }
  const { error } = await supabase.from('projects').delete().eq('id', projectId);
  if (error) throw error;
}

// ── Phase 4: selection sync + auto-collect ───────────────────────────────────────────────────

export interface CollectableProject {
  id: string;
  name: string;
  clientName: string | null;
  photoCount: number;
  status: string;
}

export interface CollectReport {
  copied: number;
  skipped_existing: number;
  unmatched: string[];
  output_dir: string;
}

/** Projects whose clients have submitted a selection (ready for the studio to collect). */
export async function listCollectableProjects(): Promise<CollectableProject[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, client_name, photo_count, status')
    .eq('status', 'selection_submitted')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    clientName: p.client_name,
    photoCount: p.photo_count,
    status: p.status,
  }));
}

/** The photo UUIDs the client selected for a project. */
export async function getSelectedUuids(projectId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('selections')
    .select('photo_uuid')
    .eq('project_id', projectId);
  if (error) throw error;
  return (data ?? []).map((s) => s.photo_uuid as string);
}

/**
 * Collect the selected originals into `<destRoot>/Selected Photos` via the native Rust command,
 * matching by UUID against the local manifest written at generation time. Originals are copied,
 * never moved or modified.
 */
export async function collectSelected(
  manifestPath: string,
  selectedUuids: string[],
  destRoot: string,
): Promise<CollectReport> {
  return invoke<CollectReport>('collect_selected', { manifestPath, selectedUuids, destRoot });
}

/** Mark a project collected once the studio has pulled the originals. */
export async function markCollected(projectId: string): Promise<void> {
  await supabase.from('projects').update({ status: 'collected' }).eq('id', projectId);
}

/**
 * Subscribe to client submissions for this studio. Fires `onSubmit` whenever a project flips to
 * `selection_submitted`. Returns an unsubscribe function. Degrades gracefully if Realtime is off.
 */
export function subscribeToSubmissions(studioId: string, onSubmit: () => void): () => void {
  const channel = supabase
    .channel(`submissions-${studioId}`)
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'projects',
        filter: `studio_id=eq.${studioId}`,
      },
      (payload) => {
        if ((payload.new as { status?: string }).status === 'selection_submitted') onSubmit();
      },
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}
