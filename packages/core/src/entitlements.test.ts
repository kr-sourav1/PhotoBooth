import { describe, it, expect } from 'vitest';
import { canCreateProject, canUploadProject, limitsFor } from './entitlements.js';

describe('entitlements', () => {
  it('free plan blocks a second active project', () => {
    expect(canCreateProject('free', { activeProjects: 0, storageGbUsed: 0 }).allowed).toBe(true);
    const r = canCreateProject('free', { activeProjects: 1, storageGbUsed: 0 });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('project_limit_reached');
  });

  it('enterprise plan has no project ceiling', () => {
    expect(limitsFor('enterprise').maxActiveProjects).toBeNull();
    expect(canCreateProject('enterprise', { activeProjects: 9999, storageGbUsed: 0 }).allowed).toBe(
      true,
    );
  });

  it('rejects a project exceeding the per-project photo limit', () => {
    const r = canUploadProject('free', { activeProjects: 0, storageGbUsed: 0 }, 500, 0.1);
    expect(r.reason).toBe('photo_limit_exceeded');
  });

  it('rejects an upload that would exceed the storage budget', () => {
    const r = canUploadProject('starter', { activeProjects: 0, storageGbUsed: 24.9 }, 100, 0.5);
    expect(r.reason).toBe('storage_limit_reached');
  });

  it('allows an upload within limits', () => {
    const r = canUploadProject('studio', { activeProjects: 2, storageGbUsed: 10 }, 5000, 3);
    expect(r.allowed).toBe(true);
  });
});
