/**
 * Object-storage key scheme for previews in R2. Keys are namespaced by studio then project so
 * a presigning endpoint can authorize an upload simply by checking the key's `studioId/` prefix
 * (tenant isolation at the storage layer, mirroring the DB's RLS). Shared by the desktop app
 * (which builds keys) and the r2-sign-upload edge function (which validates the prefix).
 */

/** `<studioId>/<projectId>/<uuid>.jpg` */
export function previewObjectKey(studioId: string, projectId: string, photoUuid: string): string {
  return `${studioId}/${projectId}/${photoUuid}.jpg`;
}

/** The per-studio prefix that every one of a studio's preview keys must start with. */
export function studioPrefix(studioId: string): string {
  return `${studioId}/`;
}

/** Guard used server-side: does this key belong to the given studio? */
export function keyBelongsToStudio(key: string, studioId: string): boolean {
  return key.startsWith(studioPrefix(studioId));
}
