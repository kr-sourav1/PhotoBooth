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

/** Ask the edge function for presigned PUT URLs, keyed by R2 object key. */
async function signUploads(projectId: string, keys: string[]): Promise<Record<string, string>> {
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
  const urls = await signUploads(projectId, [...keyByUuid.values()]);

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

  return report;
}
