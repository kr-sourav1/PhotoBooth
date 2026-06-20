import type { LocalPhotoEntry } from '@photobooth/types';

/**
 * Selection → originals matching.
 *
 * The naive approach matches selected photos to local files purely by filename, but real
 * shoots produce filename collisions (two cameras both emit `IMG_1023.jpg`). PhotoBooth
 * assigns every photo a stable UUID at preview-generation time and stores it in both the
 * cloud record and the local manifest. Collection matches on UUID first and only falls back
 * to filename when a UUID can't be resolved (e.g. a manifest rebuilt from an older export).
 */

export interface MatchInput {
  /** photo UUIDs the client selected (from the cloud `selections` table) */
  selectedUuids: string[];
  /** the desktop app's local manifest (SQLite rows) */
  manifest: LocalPhotoEntry[];
  /** filename of each selected photo, keyed by UUID — enables the fallback path */
  filenamesByUuid?: Record<string, string>;
}

export type MatchMethod = 'uuid' | 'filename';

export interface Matched {
  uuid: string;
  originalPath: string;
  originalFilename: string;
  method: MatchMethod;
}

export interface Unmatched {
  uuid: string;
  /** filename if known, else null */
  filename: string | null;
  reason: 'not_in_manifest' | 'ambiguous_filename';
}

export interface MatchResult {
  matched: Matched[];
  /** selected photos with no resolvable local original */
  unmatched: Unmatched[];
}

/**
 * Resolve selected photo UUIDs to absolute original file paths on the studio's disk.
 *
 * Resolution order per selected UUID:
 *   1. Direct UUID hit in the manifest → method 'uuid'.
 *   2. Fallback: look up the selected photo's filename and match a manifest entry by
 *      filename — but ONLY when exactly one manifest entry has that filename. An ambiguous
 *      filename (collision) is reported as unmatched rather than guessed.
 */
export function matchSelectionToOriginals(input: MatchInput): MatchResult {
  const { selectedUuids, manifest, filenamesByUuid = {} } = input;

  const byUuid = new Map<string, LocalPhotoEntry>();
  const byFilename = new Map<string, LocalPhotoEntry[]>();
  for (const entry of manifest) {
    byUuid.set(entry.uuid, entry);
    const list = byFilename.get(entry.originalFilename) ?? [];
    list.push(entry);
    byFilename.set(entry.originalFilename, list);
  }

  const matched: Matched[] = [];
  const unmatched: Unmatched[] = [];
  const seen = new Set<string>();

  for (const uuid of selectedUuids) {
    if (seen.has(uuid)) continue; // de-dupe selected list
    seen.add(uuid);

    const direct = byUuid.get(uuid);
    if (direct) {
      matched.push({
        uuid,
        originalPath: direct.originalPath,
        originalFilename: direct.originalFilename,
        method: 'uuid',
      });
      continue;
    }

    const filename = filenamesByUuid[uuid] ?? null;
    if (filename) {
      const candidates = byFilename.get(filename) ?? [];
      if (candidates.length === 1) {
        const only = candidates[0]!;
        matched.push({
          uuid,
          originalPath: only.originalPath,
          originalFilename: only.originalFilename,
          method: 'filename',
        });
        continue;
      }
      if (candidates.length > 1) {
        unmatched.push({ uuid, filename, reason: 'ambiguous_filename' });
        continue;
      }
    }

    unmatched.push({ uuid, filename, reason: 'not_in_manifest' });
  }

  return { matched, unmatched };
}
