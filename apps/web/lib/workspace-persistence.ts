import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { createChangePlan, modelHash, validateChangePlan, validateNetworkProject } from '@infratwin/model';

export const WORKSPACE_FORMAT = 'infratwin-workspace';
export const WORKSPACE_VERSION = 1;
export const PLAN_FORMAT = 'infratwin-change-plan';
export const PLAN_VERSION = 1;
export const LOCAL_DRAFT_KEY = 'infratwin.workspaceDraft.v1';

export interface PlanBundle {
  format: typeof PLAN_FORMAT;
  version: typeof PLAN_VERSION;
  exportedAt: string;
  baseModelHash: string;
  plan: ChangePlan;
}

export interface WorkspaceBundle {
  format: typeof WORKSPACE_FORMAT;
  version: typeof WORKSPACE_VERSION;
  savedAt: string;
  project: NetworkProject;
  plan: ChangePlan;
}


export function createPlanBundle(project: NetworkProject, plan: ChangePlan, exportedAt = new Date().toISOString()): PlanBundle {
  const validation = validateChangePlan(project, plan);
  if (!validation.valid) throw new Error(`Cannot save invalid ChangePlan: ${validation.errors.join('; ')}`);
  return { format: PLAN_FORMAT, version: PLAN_VERSION, exportedAt, baseModelHash: modelHash(project), plan: JSON.parse(JSON.stringify(plan)) };
}

export function parsePlanBundle(value: unknown): PlanBundle {
  if (!value || typeof value !== 'object') throw new Error('ChangePlan JSON must be an object.');
  const candidate = value as Partial<PlanBundle>;
  if (candidate.format !== PLAN_FORMAT || candidate.version !== PLAN_VERSION || !candidate.plan || typeof candidate.baseModelHash !== 'string') throw new Error('This file is not a supported InfraTwin ChangePlan export.');
  if (candidate.plan.baseModelHash !== candidate.baseModelHash) throw new Error('ChangePlan export has inconsistent base-network identity.');
  return { format: PLAN_FORMAT, version: PLAN_VERSION, exportedAt: typeof candidate.exportedAt === 'string' ? candidate.exportedAt : new Date().toISOString(), baseModelHash: candidate.baseModelHash, plan: JSON.parse(JSON.stringify(candidate.plan)) };
}

export function cloneWorkspaceBundle(bundle: WorkspaceBundle): WorkspaceBundle {
  return JSON.parse(JSON.stringify(bundle)) as WorkspaceBundle;
}

export function createWorkspaceBundle(project: NetworkProject, plan: ChangePlan, savedAt = new Date().toISOString()): WorkspaceBundle {
  const networkValidation = validateNetworkProject(project);
  if (!networkValidation.valid) throw new Error(`Cannot save invalid network: ${networkValidation.errors.join('; ')}`);
  const planValidation = validateChangePlan(project, plan);
  if (!planValidation.valid) throw new Error(`Cannot save invalid ChangePlan: ${planValidation.errors.join('; ')}`);
  return { format: WORKSPACE_FORMAT, version: WORKSPACE_VERSION, savedAt, project: JSON.parse(JSON.stringify(project)), plan: JSON.parse(JSON.stringify(plan)) };
}

export function parseWorkspaceBundle(value: unknown): WorkspaceBundle {
  if (!value || typeof value !== 'object') throw new Error('Workspace JSON must be an object.');
  const candidate = value as Partial<WorkspaceBundle>;
  if (candidate.format !== WORKSPACE_FORMAT || candidate.version !== WORKSPACE_VERSION) throw new Error('This file is not a supported InfraTwin workspace export.');
  if (!candidate.project || !candidate.plan) throw new Error('Workspace export must contain both network and ChangePlan data.');
  const networkValidation = validateNetworkProject(candidate.project);
  if (!networkValidation.valid) throw new Error(`Workspace network is invalid: ${networkValidation.errors.join('; ')}`);
  const planValidation = validateChangePlan(candidate.project, candidate.plan);
  if (!planValidation.valid) throw new Error(`Workspace ChangePlan is invalid: ${planValidation.errors.join('; ')}`);
  return createWorkspaceBundle(candidate.project, candidate.plan, typeof candidate.savedAt === 'string' ? candidate.savedAt : new Date().toISOString());
}

export function hasMeaningfulPlanWork(project: NetworkProject, plan: ChangePlan): boolean {
  const fresh = createChangePlan(project, plan.name, { id: plan.id, now: plan.createdAt });
  const constraintsChanged = JSON.stringify(plan.constraints) !== JSON.stringify(fresh.constraints);
  return Boolean(
    plan.changes.length ||
    plan.proposals.length ||
    plan.restrictions.lockedLinkIds.length ||
    plan.restrictions.lockedNodeIds.length ||
    plan.restrictions.forbiddenRoutingLinkIds.length ||
    plan.restrictions.forbiddenRoutingNodeIds.length ||
    constraintsChanged ||
    plan.status !== 'draft'
  );
}

export function describePlanWork(plan: ChangePlan): string {
  const locks = plan.restrictions.lockedLinkIds.length + plan.restrictions.lockedNodeIds.length;
  const pending = plan.proposals.filter((item) => item.state === 'pending').length;
  const pieces = [
    `${plan.changes.length} planned change${plan.changes.length === 1 ? '' : 's'}`,
    `${locks} lock${locks === 1 ? '' : 's'}`,
    pending ? `${pending} pending proposal${pending === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  return pieces.join(' · ');
}

export function readLocalWorkspaceDraft(): WorkspaceBundle | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_DRAFT_KEY);
    if (!raw) return null;
    return parseWorkspaceBundle(JSON.parse(raw));
  } catch {
    try { window.localStorage.removeItem(LOCAL_DRAFT_KEY); } catch { /* ignore storage failure */ }
    return null;
  }
}

export function writeLocalWorkspaceDraft(project: NetworkProject, plan: ChangePlan): void {
  if (typeof window === 'undefined') return;
  try {
    if (!hasMeaningfulPlanWork(project, plan)) {
      window.localStorage.removeItem(LOCAL_DRAFT_KEY);
      return;
    }
    window.localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(createWorkspaceBundle(project, plan)));
  } catch {
    // Local recovery is best-effort. Export remains the explicit durable path.
  }
}

export function clearLocalWorkspaceDraft(): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.removeItem(LOCAL_DRAFT_KEY); } catch { /* ignore */ }
}

export function downloadJson(filename: string, value: unknown): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function safeFilename(value: string): string {
  const normalized = value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'infratwin';
}

export function planMatchesProject(project: NetworkProject, plan: ChangePlan): boolean {
  return plan.baseModelHash === modelHash(project) && validateChangePlan(project, plan).valid;
}
