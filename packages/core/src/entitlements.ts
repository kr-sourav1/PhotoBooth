import type { StudioPlan } from '@photobooth/types';

/**
 * Plan limits + entitlement checks. This module is the single, provider-agnostic seam for
 * monetization: it maps a plan → limits and answers "is this action allowed?". It knows
 * NOTHING about Stripe (or any gateway). A payment provider's only responsibility is to keep
 * the studio's `subscriptions.plan` accurate; everything here reads that plan.
 *
 * Until a payment gateway is attached, studios default to the 'free' plan and the app stays
 * fully usable. See docs/INTEGRATIONS.md.
 */

export interface PlanLimits {
  /** max active (non-archived) projects; null = unlimited */
  maxActiveProjects: number | null;
  /** max photos per project; null = unlimited */
  maxPhotosPerProject: number | null;
  /** total preview storage budget in GB; null = unlimited */
  storageGb: number | null;
  /** can remove PhotoBooth branding / use own logo on the gallery */
  customBranding: boolean;
  /** can apply watermarks to previews */
  watermarking: boolean;
}

export const PLAN_LIMITS: Record<StudioPlan, PlanLimits> = {
  free: {
    maxActiveProjects: 1,
    maxPhotosPerProject: 300,
    storageGb: 1,
    customBranding: false,
    watermarking: false,
  },
  starter: {
    maxActiveProjects: 10,
    maxPhotosPerProject: 2000,
    storageGb: 25,
    customBranding: true,
    watermarking: true,
  },
  studio: {
    maxActiveProjects: 50,
    maxPhotosPerProject: 10000,
    storageGb: 200,
    customBranding: true,
    watermarking: true,
  },
  enterprise: {
    maxActiveProjects: null,
    maxPhotosPerProject: null,
    storageGb: null,
    customBranding: true,
    watermarking: true,
  },
};

export function limitsFor(plan: StudioPlan): PlanLimits {
  return PLAN_LIMITS[plan];
}

export interface StudioUsage {
  activeProjects: number;
  storageGbUsed: number;
}

export type DenyReason =
  | 'project_limit_reached'
  | 'photo_limit_exceeded'
  | 'storage_limit_reached';

export interface EntitlementCheck {
  allowed: boolean;
  reason?: DenyReason;
}

const ok: EntitlementCheck = { allowed: true };
const deny = (reason: DenyReason): EntitlementCheck => ({ allowed: false, reason });

/** May this studio create another project given current usage? */
export function canCreateProject(plan: StudioPlan, usage: StudioUsage): EntitlementCheck {
  const max = limitsFor(plan).maxActiveProjects;
  if (max !== null && usage.activeProjects >= max) return deny('project_limit_reached');
  return ok;
}

/** May this studio add a project with `photoCount` photos and `addGb` of previews? */
export function canUploadProject(
  plan: StudioPlan,
  usage: StudioUsage,
  photoCount: number,
  addGb: number,
): EntitlementCheck {
  const limits = limitsFor(plan);
  if (limits.maxPhotosPerProject !== null && photoCount > limits.maxPhotosPerProject) {
    return deny('photo_limit_exceeded');
  }
  if (limits.storageGb !== null && usage.storageGbUsed + addGb > limits.storageGb) {
    return deny('storage_limit_reached');
  }
  return ok;
}
