import { supabase } from './supabase.js';
import type { Photo, SelectionItem } from '@photobooth/types';

export interface GalleryData {
  projectName: string;
  brandColor: string | null;
  photos: Photo[];
}

/** Load a gallery by its public share token (resolved server-side via an Edge Function). */
export async function fetchGallery(shareToken: string): Promise<GalleryData> {
  const { data, error } = await supabase.functions.invoke('gallery-get', {
    body: { shareToken },
  });
  if (error) throw error;
  return data as GalleryData;
}

/** Submit the client's final selection for a project. */
export async function submitSelection(
  shareToken: string,
  selected: SelectionItem[],
): Promise<void> {
  const { error } = await supabase.functions.invoke('selection-submit', {
    body: { shareToken, photoUuids: selected.map((s) => s.photoUuid) },
  });
  if (error) throw error;
}
