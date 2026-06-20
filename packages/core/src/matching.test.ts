import { describe, it, expect } from 'vitest';
import { matchSelectionToOriginals } from './matching.js';
import type { LocalPhotoEntry } from '@photobooth/types';

const entry = (uuid: string, filename: string, path: string): LocalPhotoEntry => ({
  uuid,
  originalFilename: filename,
  originalPath: path,
  contentHash: `hash-${uuid}`,
});

describe('matchSelectionToOriginals', () => {
  it('matches selected photos by UUID', () => {
    const manifest = [
      entry('u1', 'IMG_1023.jpg', '/shoot/IMG_1023.jpg'),
      entry('u2', 'IMG_1055.jpg', '/shoot/IMG_1055.jpg'),
      entry('u3', 'IMG_1102.jpg', '/shoot/IMG_1102.jpg'),
    ];
    const result = matchSelectionToOriginals({ selectedUuids: ['u1', 'u3'], manifest });

    expect(result.unmatched).toHaveLength(0);
    expect(result.matched.map((m) => m.originalPath)).toEqual([
      '/shoot/IMG_1023.jpg',
      '/shoot/IMG_1102.jpg',
    ]);
    expect(result.matched.every((m) => m.method === 'uuid')).toBe(true);
  });

  it('handles duplicate filenames across cameras WITHOUT collision (the key win)', () => {
    // Two different originals share the filename IMG_1023.jpg but have distinct UUIDs.
    const manifest = [
      entry('camA-1', 'IMG_1023.jpg', '/cameraA/IMG_1023.jpg'),
      entry('camB-1', 'IMG_1023.jpg', '/cameraB/IMG_1023.jpg'),
    ];
    // Client selected only camera B's copy.
    const result = matchSelectionToOriginals({ selectedUuids: ['camB-1'], manifest });

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.originalPath).toBe('/cameraB/IMG_1023.jpg');
    expect(result.unmatched).toHaveLength(0);
  });

  it('falls back to filename when UUID is absent and filename is unique', () => {
    const manifest = [entry('u9', 'IMG_2000.jpg', '/shoot/IMG_2000.jpg')];
    const result = matchSelectionToOriginals({
      selectedUuids: ['unknown-uuid'],
      manifest,
      filenamesByUuid: { 'unknown-uuid': 'IMG_2000.jpg' },
    });

    expect(result.matched).toHaveLength(1);
    expect(result.matched[0]!.method).toBe('filename');
    expect(result.matched[0]!.originalPath).toBe('/shoot/IMG_2000.jpg');
  });

  it('reports ambiguous filename fallback as unmatched rather than guessing', () => {
    const manifest = [
      entry('a', 'IMG_1023.jpg', '/cameraA/IMG_1023.jpg'),
      entry('b', 'IMG_1023.jpg', '/cameraB/IMG_1023.jpg'),
    ];
    const result = matchSelectionToOriginals({
      selectedUuids: ['ghost'],
      manifest,
      filenamesByUuid: { ghost: 'IMG_1023.jpg' },
    });

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]).toMatchObject({ uuid: 'ghost', reason: 'ambiguous_filename' });
  });

  it('reports selections with no local original as not_in_manifest', () => {
    const result = matchSelectionToOriginals({
      selectedUuids: ['missing'],
      manifest: [entry('u1', 'a.jpg', '/x/a.jpg')],
    });
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched[0]).toMatchObject({ uuid: 'missing', reason: 'not_in_manifest' });
  });

  it('de-duplicates a repeated selected uuid', () => {
    const manifest = [entry('u1', 'a.jpg', '/x/a.jpg')];
    const result = matchSelectionToOriginals({ selectedUuids: ['u1', 'u1'], manifest });
    expect(result.matched).toHaveLength(1);
  });
});
