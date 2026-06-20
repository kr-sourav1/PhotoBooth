// Shared domain types for PhotoBooth. These mirror the Postgres schema
// (supabase/migrations/0001_init.sql). The fully generated DB types live in
// ./database.ts (run `pnpm db:types`); these hand-written types are the ergonomic
// surface used across the desktop app, gallery, core logic, and edge functions.

export type StudioPlan = 'free' | 'starter' | 'studio' | 'enterprise';
export type MemberRole = 'owner' | 'admin' | 'member';

export type ProjectStatus =
  | 'draft'
  | 'previews_uploading'
  | 'awaiting_selection'
  | 'selection_submitted'
  | 'collected'
  | 'archived';

export interface Studio {
  id: string;
  name: string;
  plan: StudioPlan;
  brandLogoUrl: string | null;
  brandColor: string | null;
  createdAt: string;
}

export interface Project {
  id: string;
  studioId: string;
  name: string;
  clientName: string | null;
  clientEmail: string | null;
  status: ProjectStatus;
  shareToken: string | null;
  shareExpiresAt: string | null;
  photoCount: number;
  createdAt: string;
}

/** Cloud-side preview record. The original high-res file is NOT represented here —
 * it stays on the studio machine, tracked by the local manifest (see LocalPhotoEntry). */
export interface Photo {
  uuid: string;
  projectId: string;
  originalFilename: string;
  previewPath: string;
  contentHash: string | null;
  width: number | null;
  height: number | null;
  takenAt: string | null;
  sortOrder: number | null;
}

/** A photo the client picked, as the gallery submits it. */
export interface SelectionItem {
  projectId: string;
  photoUuid: string;
}

/** Local manifest entry kept by the desktop app (SQLite). Maps a photo's stable identity
 * to the absolute path of its original on the studio's disk, for later collection. */
export interface LocalPhotoEntry {
  uuid: string;
  originalFilename: string;
  /** absolute path to the original high-res file on the studio's machine */
  originalPath: string;
  contentHash: string;
}
