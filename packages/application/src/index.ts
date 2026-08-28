import type {
  CandidatePlan, ChangePlan, NetworkProject, PlanActor, PlanChange, PlanConstraints, PlanEvidenceStamp, PlanProposal,
  PlanRevisionStamp, ScenarioPatch,
} from '../../model/src/index.ts';
import {
  acceptAllCandidateChanges, acceptCandidateChange, addPlanChange, assertValidChangePlan, changePlanEvidenceStamp, changePlanHash,
  changePlanRevisionStamp, compileChangePlanToScenarioPatch, describePlanChange, discardCandidateProposals,
  isPlanEvidenceFresh, isPlanRevisionFresh, modelHash, rejectCandidateChange, removePlanChange, setCandidateProposals,
  setChangePlanStatus, setPlanConstraint, setPlanLinkLocked, setPlanNodeLocked,
} from '../../model/src/index.ts';
import {
  analyzeBottleneck, analyzeChangePlan, runLinkContingenciesAsync, runScenarioCapacityAnalysis,
  type BottleneckAnalysis, type ChangePlanAnalysis, type ContingencyAnalysis, type ContingencyRunOptions, type EvidenceRef, type Violation,
} from '../../evidence/src/index.ts';
import type { CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification } from '../../optimizer/src/index.ts';

export type WorkspaceDestination = 'network' | 'analysis' | 'plans' | 'settings';
export type WorkspaceSelection = { kind: 'link' | 'node' | 'demand'; id: string } | null;
export type WorkspaceActivityActor = 'human' | 'agent' | 'system';
export interface WorkspaceActivityEvent { id: string; actor: WorkspaceActivityActor; action: string; summary: string; occurredAt: string; relatedId?: string }
export interface WorkspaceVerification {
  status: 'verified' | 'failed' | 'partial' | 'stale' | 'cancelled';
  modelHash: string; planHash: string; assumptions: string[]; constraintsChecked: string[];
  scenarioCoverage: { tested: number; eligible: number; status: 'complete' | 'partial' | 'not-required' };
  evidenceIds: string[]; candidateVerification?: CandidateVerification;
}
export interface PublishedVerification { result: WorkspaceVerification; stamp: PlanRevisionStamp }
export interface CollaborativeWorkspaceAdapters {
  getProject(): NetworkProject;
  getPlan(): ChangePlan;
  setPlan(plan: ChangePlan): void;
  getSelection?(): WorkspaceSelection;
  setSelection?(selection: WorkspaceSelection): void;
  getDestination?(): WorkspaceDestination;
  setDestination?(destination: WorkspaceDestination): void;
  getFocusedEvidence?(): EvidenceRef | null;
  setFocusedEvidence?(evidence: EvidenceRef | null): void;
  getAnalysis?(): ChangePlanAnalysis | null;
  publishAnalysis?(analysis: ChangePlanAnalysis | null): void;
  getContingencies?(): { analysis: ContingencyAnalysis; stamp: PlanEvidenceStamp } | null;
  publishContingencies?(analysis: ContingencyAnalysis | null, stamp: PlanEvidenceStamp | null): void;
  getCandidate?(): CandidatePlan | null;
  publishCandidate?(candidate: CandidatePlan | null): void;
  getVerification?(): PublishedVerification | null;
  publishVerification?(verification: PublishedVerification | null): void;
  analyzePlanAsync?(project: NetworkProject, plan: ChangePlan, signal?: AbortSignal): Promise<ChangePlanAnalysis>;
  runContingenciesAsync?(project: NetworkProject, patch: ScenarioPatch | null, options: ContingencyRunOptions): Promise<ContingencyAnalysis>;
  optimizeCapacity?(project: NetworkProject, requirements: CapacityPlanRequirements, signal?: AbortSignal): Promise<CapacityOptimizationResult>;
  verifyCandidate?(project: NetworkProject, candidate: CandidatePlan, requirements: CapacityPlanRequirements, signal?: AbortSignal): Promise<CandidateVerification>;
  onActivity?(event: WorkspaceActivityEvent): void;
  onSemanticMutation?(): void;
  now?(): string;
}
export type PlanChangeInput =
  | { type: 'disable_link'; linkId?: string; target?: 'selection' }
  | { type: 'enable_link'; linkId?: string; target?: 'selection' }
  | { type: 'disable_node'; nodeId?: string; target?: 'selection' }
  | { type: 'enable_node'; nodeId?: string; target?: 'selection' }
  | { type: 'set_link_capacity'; linkId?: string; target?: 'selection'; capacityGbps: number }
  | { type: 'set_demand_bandwidth'; demandId?: string; target?: 'selection'; bandwidthGbps: number }
  | { type: 'add_demand'; demand: NetworkProject['demands'][number] }
  | { type: 'demand_growth'; demandIds?: string[]; target?: 'selection'; multiplier: number };

function uniq(values: readonly string[]): string[] { return [...new Set(values)].sort(); }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function abortError(): Error { const e = new Error('Operation cancelled'); e.name = 'AbortError'; return e; }
function ensureNotAborted(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }

export class CollaborativeWorkspaceService {
  private sequence = 0;
  private readonly a: CollaborativeWorkspaceAdapters;
  constructor(adapters: CollaborativeWorkspaceAdapters) { this.a = adapters; }
  private now(): string { return this.a.now?.() ?? new Date().toISOString(); }
  private commitPlan(next: ChangePlan, semanticMutation = true): void { if (semanticMutation) this.a.onSemanticMutation?.(); this.a.setPlan(next); }
  private activity(actor: WorkspaceActivityActor, action: string, summary: string, relatedId?: string): void {
    this.a.onActivity?.({ id: `workspace-${++this.sequence}`, actor, action, summary, occurredAt: this.now(), relatedId });
  }
  getProject(): NetworkProject { return this.a.getProject(); }
  getChangePlan(): ChangePlan { return this.a.getPlan(); }
  getSelection(): WorkspaceSelection { return this.a.getSelection?.() ?? null; }
  getAnalysis(): ChangePlanAnalysis | null { return this.a.getAnalysis?.() ?? null; }
  getRestrictions() { return clone(this.a.getPlan().restrictions); }
  getProposal(): { candidate: CandidatePlan | null; proposals: PlanProposal[]; stale: boolean } {
    const plan = this.a.getPlan(); const currentHash = changePlanHash(plan); const proposals = plan.proposals.filter((p) => p.state === 'pending');
    return { candidate: this.a.getCandidate?.() ?? null, proposals: clone(proposals), stale: proposals.some((p) => p.sourcePlanHash !== currentHash) };
  }
  getWorkspaceSummary() {
    const project = this.a.getProject(), plan = this.a.getPlan(), analysis = this.a.getAnalysis?.() ?? null;
    const current = Boolean(analysis && isPlanEvidenceFresh(analysis.stamp, project, plan));
    const proposal = this.getProposal(); const verification = this.a.getVerification?.() ?? null;
    return {
      project: { id: project.id, name: project.name, modelHash: modelHash(project), nodes: project.nodes.length, links: project.links.length, demands: project.demands.length, routingMode: project.routingProfile.mode },
      plan: { id: plan.id, name: plan.name, status: plan.status, hash: changePlanHash(plan), changeCount: plan.changes.length, changes: plan.changes.slice(0, 50).map((c) => ({ id: c.id, actor: c.actor, type: c.type, summary: describePlanChange(c) })), constraints: clone(plan.constraints), restrictions: clone(plan.restrictions) },
      selection: this.getSelection(), destination: this.a.getDestination?.() ?? 'network', focusedEvidence: this.a.getFocusedEvidence?.() ?? null,
      analysis: analysis ? { state: current ? 'current' : 'stale', verdict: analysis.verdict, peakUtilizationPct: analysis.capacity.routing.peakUtilizationPct, violations: analysis.capacity.result.violations.length, evidenceIds: analysis.capacity.result.witnesses.slice(0, 12).map((w) => w.id) } : { state: 'not-run' },
      proposal: { present: proposal.proposals.length > 0, stale: proposal.stale, count: proposal.proposals.length, pending: proposal.proposals.map((p) => ({ id: p.id, state: p.state, type: p.change.type, target: clone(p.change.target), summary: describePlanChange(p.change) })) },
      verification: verification ? (() => { const verificationCurrent = isPlanRevisionFresh(verification.stamp, project, plan); return { ...verification.result, status: verificationCurrent ? verification.result.status : 'stale', current: verificationCurrent }; })() : { status: 'not-run', current: false },
    };
  }
  inspectSelection() {
    const selection = this.getSelection(); if (!selection) return { state: 'none' as const };
    const project = this.a.getProject(), plan = this.a.getPlan(), analysis = this.a.getAnalysis?.() ?? null;
    const analysisCurrent = Boolean(analysis && isPlanEvidenceFresh(analysis.stamp, project, plan));
    if (selection.kind === 'link') {
      const link = project.links.find((x) => x.id === selection.id); if (!link) return { state: 'missing' as const, selection };
      const proposed = plan.proposals.filter((p) => p.state === 'pending' && p.change.target.kind === 'link' && p.change.target.id === link.id);
      const violations = analysisCurrent ? analysis!.capacity.result.violations.filter((v) => v.linkId === link.id) : [];
      return { state: 'selected' as const, kind: 'link', id: link.id, source: link.source, target: link.target, capacityGbps: link.capacityGbps, available: link.available !== false, utilizationPct: analysisCurrent ? analysis!.capacity.routing.linkUtilizationPct[link.id] ?? null : null, locked: plan.restrictions.lockedLinkIds.includes(link.id), planChanges: plan.changes.filter((c) => c.target.kind === 'link' && c.target.id === link.id).map((c) => ({ id: c.id, actor: c.actor, summary: describePlanChange(c) })), proposals: proposed.map((p) => ({ id: p.id, summary: describePlanChange(p.change), stale: p.sourcePlanHash !== changePlanHash(plan) })), violations: violations.slice(0, 12).map(compactViolation) };
    }
    if (selection.kind === 'node') {
      const node = project.nodes.find((x) => x.id === selection.id); if (!node) return { state: 'missing' as const, selection };
      return { state: 'selected' as const, kind: 'node', id: node.id, name: node.name ?? node.id, region: node.region ?? null, available: node.available !== false, locked: plan.restrictions.lockedNodeIds.includes(node.id), planChanges: plan.changes.filter((c) => c.target.kind === 'node' && c.target.id === node.id).map((c) => ({ id: c.id, actor: c.actor, summary: describePlanChange(c) })) };
    }
    const demand = project.demands.find((x) => x.id === selection.id); if (!demand) return { state: 'missing' as const, selection };
    const route = analysisCurrent ? analysis!.capacity.routing.routes.find((r) => r.demandId === demand.id) : undefined;
    return { state: 'selected' as const, kind: 'demand', id: demand.id, name: demand.name ?? demand.id, source: demand.source, target: demand.target, bandwidthGbps: demand.bandwidthGbps, serviceClassId: demand.serviceClassId, route: route ? { reachable: route.reachable, linkIds: Object.keys(route.linkFractions).filter((id) => route.linkFractions[id] > 0).sort() } : null, planChanges: plan.changes.filter((c) => (c.target.kind === 'demand' && c.target.id === demand.id) || (c.target.kind === 'demands' && c.target.ids.includes(demand.id))).map((c) => ({ id: c.id, actor: c.actor, summary: describePlanChange(c) })) };
  }
  inspectPlan() { const p = this.a.getPlan(); return { id: p.id, name: p.name, status: p.status, hash: changePlanHash(p), changeCount: p.changes.length, changes: p.changes.slice(0, 100).map((c) => ({ id: c.id, actor: c.actor, type: c.type, summary: describePlanChange(c) })), constraints: clone(p.constraints), restrictions: clone(p.restrictions), proposalCount: p.proposals.length, proposals: p.proposals.slice(0, 100).map((q) => ({ id: q.id, candidateId: q.candidateId, sourcePlanHash: q.sourcePlanHash, state: q.state, stale: q.sourcePlanHash !== changePlanHash(p), type: q.change.type, target: clone(q.change.target), summary: describePlanChange(q.change) })) }; }
  inspectAnalysis() { const project = this.a.getProject(), plan = this.a.getPlan(), a = this.a.getAnalysis?.() ?? null; if (!a) return { state: 'not-run' as const }; const current = isPlanEvidenceFresh(a.stamp, project, plan); return { state: current ? 'current' as const : 'stale' as const, verdict: a.verdict, planHash: a.planHash, peakUtilizationPct: a.capacity.routing.peakUtilizationPct, violationCount: a.capacity.result.violations.length, violations: a.capacity.result.violations.slice(0, 12).map(compactViolation), reasons: a.reasons, runtimeMs: a.capacity.result.runtimeMs, solver: a.capacity.result.solver }; }
  private resolveTarget(kind: 'link'|'node'|'demand', explicit?: string, target?: 'selection'): string {
    if (target === 'selection') { const s = this.getSelection(); if (!s) throw new Error('No current selection.'); if (s.kind !== kind) throw new Error(`Current selection is ${s.kind}, not ${kind}.`); return s.id; }
    if (!explicit) throw new Error(`${kind} id is required.`); return explicit;
  }
  private assertUnlocked(change: PlanChange, actor: PlanActor): void {
    if (actor !== 'agent') return; const p = this.a.getPlan();
    if (change.target.kind === 'link' && p.restrictions.lockedLinkIds.includes(change.target.id)) throw new Error(`Link ${change.target.id} is locked by the human.`);
    if (change.target.kind === 'node' && p.restrictions.lockedNodeIds.includes(change.target.id)) throw new Error(`Node ${change.target.id} is locked by the human.`);
  }
  addPlanChange(input: PlanChangeInput, actor: PlanActor = 'agent'): ChangePlan {
    const project = this.a.getProject(), plan = this.a.getPlan(), now = this.now(); const id = `change:${actor}:${++this.sequence}`; let change: PlanChange;
    if (input.type === 'disable_link' || input.type === 'enable_link') { const linkId = this.resolveTarget('link', input.linkId, input.target); if (!project.links.some((x) => x.id === linkId)) throw new Error(`Unknown link ${linkId}`); change = { id, actor, type: input.type, target: { kind:'link', id:linkId }, payload:{}, createdAt:now }; }
    else if (input.type === 'disable_node' || input.type === 'enable_node') { const nodeId = this.resolveTarget('node', input.nodeId, input.target); if (!project.nodes.some((x) => x.id === nodeId)) throw new Error(`Unknown node ${nodeId}`); change = { id, actor, type: input.type, target: { kind:'node', id:nodeId }, payload:{}, createdAt:now }; }
    else if (input.type === 'set_link_capacity') { const linkId = this.resolveTarget('link', input.linkId, input.target); if (!Number.isFinite(input.capacityGbps) || input.capacityGbps <= 0) throw new Error('capacityGbps must be > 0'); change = { id, actor, type:input.type, target:{kind:'link',id:linkId}, payload:{capacityGbps:input.capacityGbps}, createdAt:now }; }
    else if (input.type === 'set_demand_bandwidth') { const demandId = this.resolveTarget('demand', input.demandId, input.target); if (!Number.isFinite(input.bandwidthGbps) || input.bandwidthGbps < 0) throw new Error('bandwidthGbps must be >= 0'); change = { id, actor, type:input.type, target:{kind:'demand',id:demandId}, payload:{bandwidthGbps:input.bandwidthGbps}, createdAt:now }; }
    else if (input.type === 'add_demand') change = { id, actor, type:'add_demand', target:{kind:'demand',id:input.demand.id}, payload:{demand:clone(input.demand)}, createdAt:now }; }
    else if (input.type === 'demand_growth') { if (!Number.isFinite(input.multiplier) || input.multiplier < 0) throw new Error('multiplier must be >= 0'); const demandIds = input.target === 'selection' ? [this.resolveTarget('demand', undefined, 'selection')] : uniq(input.demandIds ?? []); if (!demandIds.length) throw new Error('At least one demand id or a current demand selection is required.'); for (const demandId of demandIds) if (!project.demands.some((d) => d.id === demandId)) throw new Error(`Unknown demand ${demandId}`); change = { id, actor, type:'demand_growth', target:{kind:'demands',ids:demandIds}, payload:{multiplier:input.multiplier}, createdAt:now }; }
    else { const unreachable: never = input; throw new Error(`Unsupported plan change ${(unreachable as { type?: string }).type ?? 'unknown'}`); }
    this.assertUnlocked(change, actor); let next = addPlanChange(plan, change, now); assertValidChangePlan(project, next); this.commitPlan(next); this.activity(actor, 'added_change', describePlanChange(change), change.id); return next;
  }
  removePlanChange(changeId: string, actor: PlanActor = 'agent'): ChangePlan { const current = this.a.getPlan(); const target = current.changes.find((c) => c.id === changeId); if (!target) throw new Error(`Unknown plan change ${changeId}`); this.assertUnlocked(target, actor); const next = removePlanChange(current, changeId, this.now(), actor); this.commitPlan(next); this.activity(actor, 'removed_change', `Removed ${describePlanChange(target)}`, changeId); return next; }
  setPlanConstraint<K extends keyof PlanConstraints>(key: K, value: PlanConstraints[K], actor: PlanActor = 'agent'): ChangePlan { let next = setPlanConstraint(this.a.getPlan(), key, value, this.now(), actor); assertValidChangePlan(this.a.getProject(), next); this.commitPlan(next); this.activity(actor, 'set_constraint', `Set ${String(key)}`); return next; }
  setPlanRestriction(kind:'link'|'node', id:string, locked:boolean, actor:PlanActor='human'): ChangePlan { const project=this.a.getProject(); if (kind==='link' && !project.links.some((x)=>x.id===id)) throw new Error(`Unknown link ${id}`); if (kind==='node' && !project.nodes.some((x)=>x.id===id)) throw new Error(`Unknown node ${id}`); if (actor==='agent' && !locked) throw new Error('Agent cannot remove a human restriction.'); let next=kind==='link'?setPlanLinkLocked(this.a.getPlan(),id,locked,this.now(),actor):setPlanNodeLocked(this.a.getPlan(),id,locked,this.now(),actor); this.commitPlan(next); this.activity(actor,locked?'locked_resource':'unlocked_resource',`${locked?'Locked':'Unlocked'} ${id}`,id); return next; }
  select(selection:WorkspaceSelection):void { if (selection) { const p=this.a.getProject(); const ok=selection.kind==='link'?p.links.some(x=>x.id===selection.id):selection.kind==='node'?p.nodes.some(x=>x.id===selection.id):p.demands.some(x=>x.id===selection.id); if(!ok) throw new Error(`Unknown ${selection.kind} ${selection.id}`); } this.a.setSelection?.(selection); }
  clearSelection():void { this.a.setSelection?.(null); this.a.setFocusedEvidence?.(null); }
  focusEvidence(evidence:EvidenceRef, navigate=true):void { this.a.setFocusedEvidence?.(evidence); if(evidence.type==='link')this.a.setSelection?.({kind:'link',id:evidence.id}); else if(evidence.type==='demand'||evidence.type==='route')this.a.setSelection?.({kind:'demand',id:evidence.demandId ?? evidence.id.replace(/^route:/,'')}); else if((evidence.linkIds?.length ?? 0)>0) this.a.setSelection?.({kind:'link',id:evidence.linkIds![0]}); if(navigate) this.a.setDestination?.('network'); }
  async analyzePlan(signal?:AbortSignal, actor:PlanActor='agent'):Promise<ReturnType<CollaborativeWorkspaceService['inspectAnalysis']>> { ensureNotAborted(signal); const project=clone(this.a.getProject()), plan=clone(this.a.getPlan()), stamp=changePlanEvidenceStamp(project,plan); const result=this.a.analyzePlanAsync?await this.a.analyzePlanAsync(project,plan,signal):analyzeChangePlan(project,plan); ensureNotAborted(signal); if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan())) throw new Error('Stale analysis discarded because the Change Plan changed.'); this.a.publishAnalysis?.(result); const next=setChangePlanStatus(this.a.getPlan(),result.verdict==='PASS'?'analyzed':'failing',`${actor === 'agent' ? 'Agent' : 'Human'} plan analysis: ${result.verdict}`,this.now(),actor); this.commitPlan(next,false); this.activity(actor,'analyzed_plan',`Analysis ${result.verdict}`); return this.inspectAnalysis(); }
  async runContingencies(signal?:AbortSignal,maxScenarios?:number, actor:PlanActor='agent'):Promise<{status:string;tested:number;eligible:number;worstLinkId:string|null}> { ensureNotAborted(signal); const project=clone(this.a.getProject()), plan=clone(this.a.getPlan()), stamp=changePlanEvidenceStamp(project,plan), patch=plan.changes.length?compileChangePlanToScenarioPatch(project,plan):null; const runner=this.a.runContingenciesAsync ?? ((p,pa,o)=>runLinkContingenciesAsync(p,pa,o)); const result=await runner(project,patch,{signal,maxScenarios}); ensureNotAborted(signal); if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan())) throw new Error('Stale contingency result discarded because the Change Plan changed.'); this.a.publishContingencies?.(result,stamp); this.activity(actor,'ran_contingencies',`${result.completedScenarios}/${result.totalEligibleScenarios} ${result.status}`); return {status:result.status,tested:result.completedScenarios,eligible:result.totalEligibleScenarios,worstLinkId:result.worst?.linkId ?? null}; }
  inspectViolation(id?:string) { const project=this.a.getProject(), plan=this.a.getPlan(), analysis=this.a.getAnalysis?.() ?? null; if(!analysis || !isPlanEvidenceFresh(analysis.stamp,project,plan)) throw new Error('Current analysis is required.'); const violation=id?analysis.capacity.result.violations.find(v=>v.id===id):analysis.capacity.result.violations[0]; if(!violation) throw new Error('No current violation.'); const evidence=violation.linkId?{type:'link' as const,id:violation.linkId}:{type:'demand' as const,id:violation.demandId ?? violation.id,demandId:violation.demandId}; return {...compactViolation(violation),evidence}; }
  focusViolation(id?:string) { const row=this.inspectViolation(id); this.focusEvidence(row.evidence,true); return row; }
  findBottlenecks() { const project=this.a.getProject(), plan=this.a.getPlan(), analysis=this.a.getAnalysis?.()??null; if(!analysis||!isPlanEvidenceFresh(analysis.stamp,project,plan)||analysis.verdict!=='FAIL') throw new Error('Current failing analysis is required.'); const demandId=analysis.capacity.result.violations.find(v=>v.demandId)?.demandId; const demand=demandId?analysis.capacity.snapshot.demands.find(d=>d.id===demandId):[...analysis.capacity.snapshot.demands].sort((a,b)=>b.bandwidthGbps-a.bandwidthGbps)[0]; if(!demand) throw new Error('No demand available for bottleneck inspection.'); const b=analyzeBottleneck(project,demand.source,demand.target,plan.changes.length?compileChangePlanToScenarioPatch(project,plan):null); return {sourceId:b.sourceId,targetId:b.targetId,cutCapacityGbps:b.cut.cutCapacityGbps,cutLinkIds:b.cut.cutLinkIds,headroomGbps:b.headroomGbps,evidence:b.evidence}; }
  private requirements():CapacityPlanRequirements { const p=this.a.getPlan(), c=this.a.getContingencies?.(); const patches:ScenarioPatch[]=[]; if(p.changes.length) patches.push(compileChangePlanToScenarioPatch(this.a.getProject(),p)); if(p.constraints.requireN1 && c && isPlanEvidenceFresh(c.stamp,this.a.getProject(),p) && c.analysis.status==='complete') patches.push(...c.analysis.cases.map(x=>x.patch)); return {targetUtilizationPct:p.constraints.targetUtilizationPct,budgetCostUnits:p.constraints.budgetCostUnits ?? undefined,includeBaseline:true,scenarioPatches:patches,lockedLinkIds:[...p.restrictions.lockedLinkIds]}; }
  async generateMitigation(signal?:AbortSignal, actor:PlanActor='agent'):Promise<{candidateId:string;proposalCount:number;objective:number}|null> { if(!this.a.optimizeCapacity) throw new Error('Capacity optimizer is unavailable.'); ensureNotAborted(signal); const project=clone(this.a.getProject()), plan=clone(this.a.getPlan()), stamp=changePlanEvidenceStamp(project,plan); const result=await this.a.optimizeCapacity(project,this.requirements(),signal); ensureNotAborted(signal); if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan())) throw new Error('Stale optimizer result discarded because the Change Plan changed.'); if(!result.candidate) { this.a.publishCandidate?.(null); return null; } const next=setCandidateProposals(this.a.getProject(),this.a.getPlan(),result.candidate,this.now()); this.commitPlan(next,false); this.a.publishCandidate?.(result.candidate); this.activity(actor,'proposed_mitigation',`Proposed ${result.candidate.commands.length} mitigation change(s)`,result.candidate.id); return {candidateId:result.candidate.id,proposalCount:result.candidate.commands.length,objective:result.candidate.objective.value}; }
  async reviseMitigation(signal?:AbortSignal, actor:PlanActor='agent'){ return this.generateMitigation(signal,actor); }
  acceptProposalChange(id:string,actor:PlanActor='human'):ChangePlan { const next=acceptCandidateChange(this.a.getPlan(),id,this.now(),actor); this.commitPlan(next); this.activity(actor,'accepted_proposal',`Accepted proposal ${id}`,id); return next; }
  acceptAllProposalChanges(actor:PlanActor='human'):ChangePlan { const next=acceptAllCandidateChanges(this.a.getPlan(),this.now(),actor); this.commitPlan(next); this.activity(actor,'accepted_all_proposals','Accepted all current proposal changes'); return next; }
  rejectProposalChange(id:string,actor:PlanActor='human'):ChangePlan { const next=rejectCandidateChange(this.a.getPlan(),id,this.now(),actor); this.commitPlan(next,false); this.activity(actor,'rejected_proposal',`Rejected proposal ${id}`,id); return next; }
  discardProposal(actor:PlanActor='human'):ChangePlan { const next=discardCandidateProposals(this.a.getPlan(),this.now(),actor); this.commitPlan(next,false); this.a.publishCandidate?.(null); this.activity(actor,'discarded_proposal','Discarded pending optimizer proposal'); return next; }
  async verifyPlan(signal?:AbortSignal, actor:PlanActor='agent'):Promise<WorkspaceVerification> { ensureNotAborted(signal); const project=clone(this.a.getProject()), plan=clone(this.a.getPlan()), stamp=changePlanRevisionStamp(project,plan); const analysis=analyzeChangePlan(project,plan); let coverage:WorkspaceVerification['scenarioCoverage']={tested:0,eligible:0,status:'not-required'}; let status:WorkspaceVerification['status']=analysis.verdict==='PASS'?'verified':'failed'; const evidenceIds=analysis.capacity.result.witnesses.map(w=>w.id).slice(0,24); if(plan.constraints.requireN1){const c=this.a.getContingencies?.(); if(!c||!isPlanEvidenceFresh(c.stamp,project,plan)){status='partial';coverage={tested:0,eligible:project.links.filter(l=>l.available!==false).length,status:'partial'};} else {coverage={tested:c.analysis.completedScenarios,eligible:c.analysis.totalEligibleScenarios,status:c.analysis.status==='complete'?'complete':'partial'}; if(c.analysis.status!=='complete')status='partial'; else if(c.analysis.result.verdict==='FAIL')status='failed';}}
    let candidateVerification:CandidateVerification|undefined; const candidate=this.a.getCandidate?.()??null; if(candidate&&this.a.verifyCandidate){candidateVerification=await this.a.verifyCandidate(project,candidate,this.requirements(),signal); ensureNotAborted(signal); if(candidateVerification.status!=='verified')status='failed';}
    if(!isPlanRevisionFresh(stamp,this.a.getProject(),this.a.getPlan())) throw new Error('Stale verification discarded because the plan or proposal state changed.'); const result:WorkspaceVerification={status,modelHash:modelHash(project),planHash:changePlanHash(plan),assumptions:analysis.capacity.result.assumptions,constraintsChecked:[`targetUtilizationPct<=${plan.constraints.targetUtilizationPct}`,`budgetCostUnits=${plan.constraints.budgetCostUnits ?? 'unbounded'}`,`protectedServiceClassIds=${plan.constraints.protectedServiceClassIds.join(',')||'none'}`,`requireN1=${plan.constraints.requireN1}`],scenarioCoverage:coverage,evidenceIds,candidateVerification}; this.a.publishVerification?.({result,stamp}); if(status==='verified'){const next=setChangePlanStatus(this.a.getPlan(),'verified','Deterministic shared-plan verification passed.',this.now(),actor);this.commitPlan(next,false);} this.activity(actor,'verified_plan',`Verification ${status}`); return result; }
  capabilityState() { const project=this.a.getProject(), plan=this.a.getPlan(), analysis=this.a.getAnalysis?.()??null, proposal=this.getProposal(); const analysisCurrent=Boolean(analysis&&isPlanEvidenceFresh(analysis.stamp,project,plan)); const hasViolation=Boolean(analysisCurrent&&analysis!.verdict==='FAIL'&&analysis!.capacity.result.violations.length); const violatingLinkIds=new Set(analysisCurrent?analysis!.capacity.result.violations.map(v=>v.linkId).filter((id):id is string=>Boolean(id)):[]); const hasUnlockedUpgradeTarget=project.links.some(l=>violatingLinkIds.has(l.id)&&!plan.restrictions.lockedLinkIds.includes(l.id)&&(l.upgradeOptions?.some(option=>option.capacityGbps>l.capacityGbps+1e-9)??false)); return {analysisCurrent,hasViolation,proposalPresent:proposal.proposals.length>0,proposalStale:proposal.stale,canDecideProposal:proposal.proposals.length>0&&!proposal.stale,canProposeMitigation:hasViolation&&hasUnlockedUpgradeTarget,hasCompleteN1:Boolean(this.a.getContingencies?.()?.analysis.status==='complete')}; }
}
function compactViolation(v:Violation){return {id:v.id,type:v.type,linkId:v.linkId,demandId:v.demandId,actual:v.actual,limit:v.limit,unit:v.unit,message:v.message};}
