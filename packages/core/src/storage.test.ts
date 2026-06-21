import { describe, it, expect } from 'vitest';
import { previewObjectKey, studioPrefix, keyBelongsToStudio } from './storage.js';

describe('storage keys', () => {
  it('builds a studio/project/uuid key', () => {
    expect(previewObjectKey('studio-1', 'proj-2', 'photo-3')).toBe('studio-1/proj-2/photo-3.jpg');
  });

  it('derives a per-studio prefix', () => {
    expect(studioPrefix('studio-1')).toBe('studio-1/');
  });

  it('accepts a key under the owning studio', () => {
    const key = previewObjectKey('studio-1', 'proj-2', 'photo-3');
    expect(keyBelongsToStudio(key, 'studio-1')).toBe(true);
  });

  it('rejects a key from a different studio (no cross-tenant upload)', () => {
    const key = previewObjectKey('studio-1', 'proj-2', 'photo-3');
    expect(keyBelongsToStudio(key, 'studio-2')).toBe(false);
    // and a prefix-spoofing attempt
    expect(keyBelongsToStudio('studio-12/x/y.jpg', 'studio-1')).toBe(false);
  });
});
