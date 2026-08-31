import type { CandidatePlan, ChangePlan, NetworkProject, PlanActor, PlanChange, PlanConstraints, PlanEvidenceStamp, PlanRevisionStamp, ScenarioPatch } from '../../model/src/index.ts';
import { acceptAllCandidateChanges, acceptCandidateChange, addPlanChange, assertValidChangePlan, changePlanEvidenceStamp, changePlanHash, changePlanRevisionStamp, compileChangePlanToScenarioPatch, describePlanChange, discardCandidateProposals, isPlanEvidenceFresh, isPlanRevisionFresh, modelHash, rejectCandidateChange, removePlanChange, setCandidateProposals, setChangePlanStatus, setPlanConstraint, setPlanLinkLocked, setPlanNodeLocked, setPlanLinkRoutingForbidden, setPlanNodeRoutingForbidden } from '../../model/src/index.ts';
import { analyzeBottleneck, analyzeChangePlan, runLinkContingenciesAsync, type ChangePlanAnalysis, type ContingencyAnalysis, type ContingencyRunOptions, type EvidenceRef, type Violation } from '../../evidence/src/index.ts';
import type { AdaptiveDesignRequirements, AdaptiveDesignResult, AdaptiveDesignVariant, AdaptiveDesignVerification, CapacityOptimizationResult, CapacityPlanRequirements, CandidateVerification } from '../../optimizer/src/index.ts';

export type WorkspaceDestination = 'network' | 'analysis' | 'plans' | 'settings';
export type WorkspaceSelection = { kind: 'link' | 'node' | 'demand'; id: string } | null;
export type WorkspaceActivityActor = 'human' | 'agent' | 'system';
export interface WorkspaceActivityEvent { id: string; actor: WorkspaceActivityActor; action: string; summary: string; occurredAt: string; relatedId?: string }
export interface WorkspaceVerification { status: 'verified'|'failed'|'partial'|'stale'|'cancelled'; modelHash: string; planHash: string; assumptions: string[]; constraintsChecked: string[]; scenarioCoverage: { tested: number; eligible: number; status: 'complete'|'partial'|'not-required' }; evidenceIds: string[]; candidateVerification?: CandidateVerification; adaptiveDesignVerification?: AdaptiveDesignVerification }
export interface PublishedVerification { result: WorkspaceVerification; stamp: PlanRevisionStamp }
export interface WorkspaceDesignState { variants: AdaptiveDesignVariant[]; selectedVariantId: string|null; stamp: PlanEvidenceStamp }
export interface CollaborativeWorkspaceAdapters {
  getProject(): NetworkProject; getPlan(): ChangePlan; setPlan(plan: ChangePlan): void;
  getSelection?(): WorkspaceSelection; setSelection?(selection: WorkspaceSelection): void;
  getDestination?(): WorkspaceDestination; setDestination?(destination: WorkspaceDestination): void;
  getFocusedEvidence?(): EvidenceRef|null; setFocusedEvidence?(evidence: EvidenceRef|null): void;
  getAnalysis?(): ChangePlanAnalysis|null; publishAnalysis?(analysis: ChangePlanAnalysis|null): void;
  getContingencies?(): { analysis: ContingencyAnalysis; stamp: PlanEvidenceStamp }|null; publishContingencies?(analysis: ContingencyAnalysis|null, stamp: PlanEvidenceStamp|null): void;
  getCandidate?(): CandidatePlan|null; publishCandidate?(candidate: CandidatePlan|null): void;
  getVerification?(): PublishedVerification|null; publishVerification?(verification: PublishedVerification|null): void;
  getDesignState?(): WorkspaceDesignState|null; publishDesignState?(state: WorkspaceDesignState|null): void;
  analyzePlanAsync?(project: NetworkProject, plan: ChangePlan, signal?: AbortSignal): Promise<ChangePlanAnalysis>;
  runContingenciesAsync?(project: NetworkProject, patch: ScenarioPatch|null, options: ContingencyRunOptions): Promise<ContingencyAnalysis>;
  optimizeCapacity?(project: NetworkProject, requirements: CapacityPlanRequirements, signal?: AbortSignal): Promise<CapacityOptimizationResult>;
  verifyCandidate?(project: NetworkProject, candidate: CandidatePlan, requirements: CapacityPlanRequirements, signal?: AbortSignal): Promise<CandidateVerification>;
  optimizeAdaptiveDesign?(project: NetworkProject, requirements: AdaptiveDesignRequirements, signal?: AbortSignal, sourcePlanHash?: string): Promise<AdaptiveDesignResult>;
  optimizeDesignPareto?(project: NetworkProject, requirements: AdaptiveDesignRequirements, signal?: AbortSignal, sourcePlanHash?: string): Promise<AdaptiveDesignVariant[]>;
  onActivity?(event: WorkspaceActivityEvent): void; onSemanticMutation?(): void; now?(): string;
}
export type PlanChangeInput =
  | { type:'disable_link'|'enable_link'; linkId?:string; target?:'selection' }
  | { type:'disable_node'|'enable_node'; nodeId?:string; target?:'selection' }
  | { type:'set_link_capacity'; linkId?:string; target?:'selection'; capacityGbps:number }
  | { type:'set_demand_bandwidth'; demandId?:string; target?:'selection'; bandwidthGbps:number }
  | { type:'add_demand'; demand:NetworkProject['demands'][number] }
  | { type:'demand_growth'; demandIds?:string[]; target?:'selection'; multiplier:number };

const clone = <T>(v:T):T => JSON.parse(JSON.stringify(v)) as T;
const compactViolation = (v:Violation) => ({ id:v.id,type:v.type,linkId:v.linkId,demandId:v.demandId,actual:v.actual,limit:v.limit,unit:v.unit,message:v.message });
function abortError(){ const e=new Error('Operation cancelled'); e.name='AbortError'; return e; }
function checkAbort(signal?:AbortSignal){ if(signal?.aborted) throw abortError(); }
function retag(plan:ChangePlan, actor:PlanActor, action?:string){ if(actor==='human') return plan; const next=clone(plan); for(let i=next.history.length-1;i>=0;i--){ if(!action || next.history[i].action===action){ next.history[i].actor=actor; break; } } return next; }

export class CollaborativeWorkspaceService {
  private seq=0;
  private readonly a: CollaborativeWorkspaceAdapters;
  constructor(a: CollaborativeWorkspaceAdapters){ this.a=a; }
  private now(){ return this.a.now?.() ?? new Date().toISOString(); }
  private publishPlan(plan:ChangePlan, semantic=true){ if(semantic) this.a.onSemanticMutation?.(); this.a.setPlan(plan); }
  private activity(actor:WorkspaceActivityActor,action:string,summary:string,relatedId?:string){ this.a.onActivity?.({id:`workspace-${++this.seq}`,actor,action,summary,occurredAt:this.now(),relatedId}); }
  getProject(){ return this.a.getProject(); } getChangePlan(){ return this.a.getPlan(); } getSelection(){ return this.a.getSelection?.() ?? null; } getAnalysis(){ return this.a.getAnalysis?.() ?? null; }
  private proposal(){ const project=this.a.getProject(),p=this.a.getPlan(),hash=changePlanHash(p),baseStale=p.baseModelHash!==modelHash(project),proposals=p.proposals.filter(x=>x.state==='pending'); return {candidate:this.a.getCandidate?.()??null,proposals:clone(proposals),stale:baseStale||proposals.some(x=>x.sourcePlanHash!==hash)}; }
  getWorkspaceSummary(){ const project=this.a.getProject(),plan=this.a.getPlan(),analysis=this.getAnalysis(),current=!!analysis&&isPlanEvidenceFresh(analysis.stamp,project,plan),proposal=this.proposal(),verification=this.a.getVerification?.()??null; return { project:{id:project.id,name:project.name,modelHash:modelHash(project),nodes:project.nodes.length,links:project.links.length,demands:project.demands.length,routingMode:project.routingProfile.mode}, plan:{id:plan.id,name:plan.name,status:plan.status,hash:changePlanHash(plan),changeCount:plan.changes.length,changes:plan.changes.slice(0,50).map(c=>({id:c.id,actor:c.actor,type:c.type,summary:describePlanChange(c)})),constraints:clone(plan.constraints),restrictions:clone(plan.restrictions)}, selection:this.getSelection(), destination:this.a.getDestination?.()??'network', focusedEvidence:this.a.getFocusedEvidence?.()??null, analysis:analysis?{state:current?'current':'stale',verdict:analysis.verdict,peakUtilizationPct:analysis.capacity.routing.peakUtilizationPct,violations:analysis.capacity.result.violations.length,evidenceIds:analysis.capacity.result.witnesses.slice(0,12).map(w=>w.id)}:{state:'not-run'}, proposal:{present:proposal.proposals.length>0,stale:proposal.stale,count:proposal.proposals.length,pending:proposal.proposals.map(p=>({id:p.id,state:p.state,type:p.change.type,target:clone(p.change.target),summary:describePlanChange(p.change)}))}, verification:verification?(()=>{const fresh=isPlanRevisionFresh(verification.stamp,project,plan);return {...verification.result,status:fresh?verification.result.status:'stale',current:fresh};})():{status:'not-run',current:false}, design:(()=>{const d=this.a.getDesignState?.()??null;const fresh=!!d&&isPlanEvidenceFresh(d.stamp,project,plan);return d?{state:fresh?'current':'stale',variantCount:d.variants.length,selectedVariantId:d.selectedVariantId}:{state:'not-run',variantCount:0,selectedVariantId:null};})() }; }
  inspectSelection(){ const s=this.getSelection(); if(!s)return {state:'none' as const}; const p=this.a.getProject(),plan=this.a.getPlan(),analysis=this.getAnalysis(),fresh=!!analysis&&isPlanEvidenceFresh(analysis.stamp,p,plan); if(s.kind==='link'){const x=p.links.find(v=>v.id===s.id);if(!x)return{state:'missing' as const,selection:s};const proposals=plan.proposals.filter(q=>q.state==='pending'&&q.change.target.kind==='link'&&q.change.target.id===x.id);return{state:'selected' as const,kind:'link',id:x.id,source:x.source,target:x.target,capacityGbps:x.capacityGbps,available:x.available!==false,utilizationPct:fresh?analysis!.capacity.routing.linkUtilizationPct[x.id]??null:null,locked:plan.restrictions.lockedLinkIds.includes(x.id),planChanges:plan.changes.filter(c=>c.target.kind==='link'&&c.target.id===x.id).map(c=>({id:c.id,actor:c.actor,summary:describePlanChange(c)})),proposals:proposals.map(q=>({id:q.id,summary:describePlanChange(q.change),stale:plan.baseModelHash!==modelHash(p)||q.sourcePlanHash!==changePlanHash(plan)})),violations:fresh?analysis!.capacity.result.violations.filter(v=>v.linkId===x.id).slice(0,12).map(compactViolation):[]};} if(s.kind==='node'){const x=p.nodes.find(v=>v.id===s.id);if(!x)return{state:'missing' as const,selection:s};return{state:'selected' as const,kind:'node',id:x.id,name:x.name??x.id,region:x.region??null,available:x.available!==false,locked:plan.restrictions.lockedNodeIds.includes(x.id),planChanges:plan.changes.filter(c=>c.target.kind==='node'&&c.target.id===x.id).map(c=>({id:c.id,actor:c.actor,summary:describePlanChange(c)}))};} const d=p.demands.find(v=>v.id===s.id);if(!d)return{state:'missing' as const,selection:s};const route=fresh?analysis!.capacity.routing.routes.find(r=>r.demandId===d.id):undefined;return{state:'selected' as const,kind:'demand',id:d.id,name:d.name??d.id,source:d.source,target:d.target,bandwidthGbps:d.bandwidthGbps,serviceClassId:d.serviceClassId,route:route?{reachable:route.reachable,linkIds:Object.keys(route.linkFractions).filter(id=>route.linkFractions[id]>0).sort()}:null,planChanges:plan.changes.filter(c=>(c.target.kind==='demand'&&c.target.id===d.id)||(c.target.kind==='demands'&&c.target.ids.includes(d.id))).map(c=>({id:c.id,actor:c.actor,summary:describePlanChange(c)}))}; }
  inspectPlan(){const project=this.a.getProject(),p=this.a.getPlan(),h=changePlanHash(p),baseStale=p.baseModelHash!==modelHash(project);return{id:p.id,name:p.name,status:p.status,hash:h,changeCount:p.changes.length,changes:p.changes.slice(0,100).map(c=>({id:c.id,actor:c.actor,type:c.type,summary:describePlanChange(c)})),constraints:clone(p.constraints),restrictions:clone(p.restrictions),proposalCount:p.proposals.length,proposals:p.proposals.slice(0,100).map(q=>({id:q.id,candidateId:q.candidateId,sourcePlanHash:q.sourcePlanHash,state:q.state,stale:baseStale||q.sourcePlanHash!==h,type:q.change.type,target:clone(q.change.target),summary:describePlanChange(q.change)}))};}
  inspectAnalysis(){const p=this.a.getProject(),plan=this.a.getPlan(),a=this.getAnalysis();if(!a)return{state:'not-run' as const};const fresh=isPlanEvidenceFresh(a.stamp,p,plan);return{state:fresh?'current' as const:'stale' as const,verdict:a.verdict,planHash:a.planHash,peakUtilizationPct:a.capacity.routing.peakUtilizationPct,violationCount:a.capacity.result.violations.length,violations:a.capacity.result.violations.slice(0,12).map(compactViolation),reasons:a.reasons,runtimeMs:a.capacity.result.runtimeMs,solver:a.capacity.result.solver};}
  private target(kind:'link'|'node'|'demand',explicit?:string,target?:'selection'){if(target==='selection'){const s=this.getSelection();if(!s)throw new Error('No current selection.');if(s.kind!==kind)throw new Error(`Current selection is ${s.kind}, not ${kind}.`);return s.id;}if(!explicit)throw new Error(`${kind} id is required.`);return explicit;}
  private unlocked(change:PlanChange,actor:PlanActor){if(actor!=='agent')return;const p=this.a.getPlan();if(change.target.kind==='link'&&p.restrictions.lockedLinkIds.includes(change.target.id))throw new Error(`Link ${change.target.id} is locked by the human.`);if(change.target.kind==='node'&&p.restrictions.lockedNodeIds.includes(change.target.id))throw new Error(`Node ${change.target.id} is locked by the human.`);}
  addPlanChange(input:PlanChangeInput,actor:PlanActor='agent'){
    const p=this.a.getProject(),plan=this.a.getPlan(),now=this.now(),id=`change:${actor}:${++this.seq}`;
    let c:PlanChange;
    if(input.type==='disable_link'||input.type==='enable_link'){
      const x=this.target('link',input.linkId,input.target);
      if(!p.links.some(v=>v.id===x))throw new Error(`Unknown link ${x}`);
      c={id,actor,type:input.type,target:{kind:'link',id:x},payload:{},createdAt:now};
    }else if(input.type==='disable_node'||input.type==='enable_node'){
      const x=this.target('node',input.nodeId,input.target);
      if(!p.nodes.some(v=>v.id===x))throw new Error(`Unknown node ${x}`);
      c={id,actor,type:input.type,target:{kind:'node',id:x},payload:{},createdAt:now};
    }else if(input.type==='set_link_capacity'){
      const x=this.target('link',input.linkId,input.target);
      if(!p.links.some(v=>v.id===x))throw new Error(`Unknown link ${x}`);
      if(!Number.isFinite(input.capacityGbps)||input.capacityGbps<=0)throw new Error('capacityGbps must be > 0');
      c={id,actor,type:input.type,target:{kind:'link',id:x},payload:{capacityGbps:input.capacityGbps},createdAt:now};
    }else if(input.type==='set_demand_bandwidth'){
      const x=this.target('demand',input.demandId,input.target);
      if(!p.demands.some(v=>v.id===x))throw new Error(`Unknown demand ${x}`);
      if(!Number.isFinite(input.bandwidthGbps)||input.bandwidthGbps<0)throw new Error('bandwidthGbps must be >= 0');
      c={id,actor,type:input.type,target:{kind:'demand',id:x},payload:{bandwidthGbps:input.bandwidthGbps},createdAt:now};
    }else if(input.type==='add_demand'){
      c={id,actor,type:'add_demand',target:{kind:'demand',id:input.demand.id},payload:{demand:clone(input.demand)},createdAt:now};
    }else{
      const growth=input as Extract<PlanChangeInput,{type:'demand_growth'}>;
      const multiplier=growth.multiplier;
      if(!Number.isFinite(multiplier)||multiplier<0)throw new Error('multiplier must be >= 0');
      const ids:string[]=growth.target==='selection'
        ? [this.target('demand',undefined,'selection')]
        : [...new Set<string>(growth.demandIds??[])].sort();
      if(!ids.length)throw new Error('At least one demand id or a current demand selection is required.');
      for(const x of ids)if(!p.demands.some(d=>d.id===x))throw new Error(`Unknown demand ${x}`);
      c={id,actor,type:'demand_growth',target:{kind:'demands',ids},payload:{multiplier},createdAt:now};
    }
    this.unlocked(c,actor);
    const next=addPlanChange(plan,c,now);
    assertValidChangePlan(p,next);
    this.publishPlan(next);
    this.activity(actor,'added_change',describePlanChange(c),c.id);
    return next;
  }
  removePlanChange(id:string,actor:PlanActor='agent'){const plan=this.a.getPlan(),c=plan.changes.find(x=>x.id===id);if(!c)throw new Error(`Unknown plan change ${id}`);this.unlocked(c,actor);const next=retag(removePlanChange(plan,id,this.now()),actor,'removed_change');this.publishPlan(next);this.activity(actor,'removed_change',`Removed ${describePlanChange(c)}`,id);return next;}
  setPlanConstraint<K extends keyof PlanConstraints>(key:K,value:PlanConstraints[K],actor:PlanActor='agent'){const next=retag(setPlanConstraint(this.a.getPlan(),key,value,this.now()),actor,'set_constraint');assertValidChangePlan(this.a.getProject(),next);this.publishPlan(next);this.activity(actor,'set_constraint',`Set ${String(key)}`);return next;}
  setPlanRestriction(kind:'link'|'node',id:string,locked:boolean,actor:PlanActor='human'){const p=this.a.getProject();if(kind==='link'&&!p.links.some(x=>x.id===id))throw new Error(`Unknown link ${id}`);if(kind==='node'&&!p.nodes.some(x=>x.id===id))throw new Error(`Unknown node ${id}`);if(actor==='agent'&&!locked)throw new Error('Agent cannot remove a human restriction.');const raw=kind==='link'?setPlanLinkLocked(this.a.getPlan(),id,locked,this.now()):setPlanNodeLocked(this.a.getPlan(),id,locked,this.now());const next=retag(raw,actor,locked?(kind==='link'?'locked_link':'locked_node'):(kind==='link'?'unlocked_link':'unlocked_node'));this.publishPlan(next);this.activity(actor,locked?'locked_resource':'unlocked_resource',`${locked?'Locked':'Unlocked'} ${id}`,id);return next;}
  setRoutingRestriction(kind:'link'|'node',id:string,forbidden:boolean,actor:PlanActor='human'){const p=this.a.getProject();if(kind==='link'&&!p.links.some(x=>x.id===id))throw new Error(`Unknown link ${id}`);if(kind==='node'&&!p.nodes.some(x=>x.id===id))throw new Error(`Unknown node ${id}`);if(actor==='agent'&&!forbidden)throw new Error('Agent cannot remove a human routing restriction.');const raw=kind==='link'?setPlanLinkRoutingForbidden(this.a.getPlan(),id,forbidden,this.now()):setPlanNodeRoutingForbidden(this.a.getPlan(),id,forbidden,this.now());const next=retag(raw,actor,'set_routing_restriction');this.publishPlan(next);this.activity(actor,'set_routing_restriction',`${forbidden?'Avoid':'Allow'} ${id} in proposed routing`,id);return next;}
  select(selection:WorkspaceSelection){if(selection){const p=this.a.getProject(),ok=selection.kind==='link'?p.links.some(x=>x.id===selection.id):selection.kind==='node'?p.nodes.some(x=>x.id===selection.id):p.demands.some(x=>x.id===selection.id);if(!ok)throw new Error(`Unknown ${selection.kind} ${selection.id}`);}this.a.setSelection?.(selection);}
  focusEvidence(e:EvidenceRef,navigate=true){this.a.setFocusedEvidence?.(e);if(e.type==='link')this.a.setSelection?.({kind:'link',id:e.id});else if(e.type==='demand'||e.type==='route')this.a.setSelection?.({kind:'demand',id:e.demandId??e.id.replace(/^route:/,'')});else if(e.linkIds?.length)this.a.setSelection?.({kind:'link',id:e.linkIds[0]});if(navigate)this.a.setDestination?.('network');}
  async analyzePlan(signal?:AbortSignal,actor:PlanActor='agent'){checkAbort(signal);const p=clone(this.a.getProject()),plan=clone(this.a.getPlan()),stamp=changePlanEvidenceStamp(p,plan),result=this.a.analyzePlanAsync?await this.a.analyzePlanAsync(p,plan,signal):analyzeChangePlan(p,plan);checkAbort(signal);if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale analysis discarded because the Change Plan changed.');this.a.publishAnalysis?.(result);const next=retag(setChangePlanStatus(this.a.getPlan(),result.verdict==='PASS'?'analyzed':'failing',`${actor==='agent'?'Agent':'Human'} plan analysis: ${result.verdict}`,this.now()),actor,'plan_status');this.publishPlan(next,false);this.activity(actor,'analyzed_plan',`Analysis ${result.verdict}`);return this.inspectAnalysis();}
  async runContingencies(signal?:AbortSignal,maxScenarios?:number,actor:PlanActor='agent'){checkAbort(signal);const p=clone(this.a.getProject()),plan=clone(this.a.getPlan()),stamp=changePlanEvidenceStamp(p,plan),patch=plan.changes.length?compileChangePlanToScenarioPatch(p,plan):null,run=this.a.runContingenciesAsync??((x,y,o)=>runLinkContingenciesAsync(x,y,o)),r=await run(p,patch,{signal,maxScenarios});checkAbort(signal);if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale contingency result discarded because the Change Plan changed.');this.a.publishContingencies?.(r,stamp);this.activity(actor,'ran_contingencies',`${r.completedScenarios}/${r.totalEligibleScenarios} ${r.status}`);return{status:r.status,tested:r.completedScenarios,eligible:r.totalEligibleScenarios,worstLinkId:r.worst?.linkId??null};}
  inspectViolation(id?:string){const p=this.a.getProject(),plan=this.a.getPlan(),a=this.getAnalysis();if(!a||!isPlanEvidenceFresh(a.stamp,p,plan))throw new Error('Current analysis is required.');const v=id?a.capacity.result.violations.find(x=>x.id===id):a.capacity.result.violations[0];if(!v)throw new Error('No current violation.');const evidence=v.linkId?{type:'link' as const,id:v.linkId}:{type:'demand' as const,id:v.demandId??v.id,demandId:v.demandId};return{...compactViolation(v),evidence};}
  focusViolation(id?:string){const x=this.inspectViolation(id);this.focusEvidence(x.evidence,true);return x;}
  findBottlenecks(){const p=this.a.getProject(),plan=this.a.getPlan(),a=this.getAnalysis();if(!a||!isPlanEvidenceFresh(a.stamp,p,plan)||a.verdict!=='FAIL')throw new Error('Current failing analysis is required.');const demandId=a.capacity.result.violations.find(v=>v.demandId)?.demandId,d=demandId?a.capacity.snapshot.demands.find(x=>x.id===demandId):[...a.capacity.snapshot.demands].sort((x,y)=>y.bandwidthGbps-x.bandwidthGbps)[0];if(!d)throw new Error('No demand available for bottleneck inspection.');const b=analyzeBottleneck(p,d.source,d.target,plan.changes.length?compileChangePlanToScenarioPatch(p,plan):null);return{sourceId:b.sourceId,targetId:b.targetId,cutCapacityGbps:b.cut.cutCapacityGbps,cutLinkIds:b.cut.cutLinkIds,headroomGbps:b.headroomGbps,evidence:b.evidence};}
  private requirements():CapacityPlanRequirements{const p=this.a.getPlan(),c=this.a.getContingencies?.(),patches:ScenarioPatch[]=[];if(p.changes.length)patches.push(compileChangePlanToScenarioPatch(this.a.getProject(),p));if(p.constraints.requireN1&&c&&isPlanEvidenceFresh(c.stamp,this.a.getProject(),p)&&c.analysis.status==='complete')patches.push(...c.analysis.cases.map(x=>x.patch));return{targetUtilizationPct:p.constraints.targetUtilizationPct,budgetCostUnits:p.constraints.budgetCostUnits??undefined,includeBaseline:true,scenarioPatches:patches,lockedLinkIds:[...p.restrictions.lockedLinkIds]};}
  private adaptiveRequirements():AdaptiveDesignRequirements{const p=this.a.getPlan(),c=this.a.getContingencies?.(),patches:ScenarioPatch[]=[];if(p.changes.length)patches.push(compileChangePlanToScenarioPatch(this.a.getProject(),p));if(p.constraints.requireN1&&c&&isPlanEvidenceFresh(c.stamp,this.a.getProject(),p)&&c.analysis.status==='complete')patches.push(...c.analysis.cases.map(x=>x.patch));return{targetUtilizationPct:p.constraints.targetUtilizationPct,budgetCostUnits:p.constraints.budgetCostUnits??undefined,includeBaseline:true,scenarioPatches:patches,lockedLinkIds:[...p.restrictions.lockedLinkIds],lockedNodeIds:[...p.restrictions.lockedNodeIds],forbiddenRoutingLinkIds:[...(p.restrictions.forbiddenRoutingLinkIds??[])],forbiddenRoutingNodeIds:[...(p.restrictions.forbiddenRoutingNodeIds??[])],allowedActions:{...(p.constraints.allowedMitigationActions??{capacityUpgrades:true,routingChanges:false,newLinks:false})},maxCandidatePaths:p.constraints.maxCandidatePaths??5,candidateLinkOptions:[...(p.constraints.candidateLinkOptions??[])]};}
  async generateMitigation(signal?:AbortSignal,actor:PlanActor='agent'){
    checkAbort(signal);const p=clone(this.a.getProject()),plan=clone(this.a.getPlan()),stamp=changePlanEvidenceStamp(p,plan),sourcePlanHash=changePlanHash(plan),adaptive=this.adaptiveRequirements();
    if(adaptive.allowedActions?.capacityUpgrades!==false&&this.a.optimizeCapacity){const r=await this.a.optimizeCapacity(p,this.requirements(),signal);checkAbort(signal);if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale optimizer result discarded because the Change Plan changed.');if(r.candidate){const next=setCandidateProposals(this.a.getProject(),this.a.getPlan(),r.candidate,this.now());this.publishPlan(next,false);this.a.publishCandidate?.(r.candidate);this.a.publishDesignState?.(null);this.activity(actor,'proposed_mitigation',`Proposed ${r.candidate.commands.length} mitigation change(s)`,r.candidate.id);return{status:'candidate' as const,candidateId:r.candidate.id,proposalCount:r.candidate.commands.length,objective:r.candidate.objective.value,mode:'capacity-only' as const};}}
    if(adaptive.allowedActions?.routingChanges===false||!this.a.optimizeAdaptiveDesign){this.a.publishCandidate?.(null);this.a.publishDesignState?.(null);return null;}
    const result=await this.a.optimizeAdaptiveDesign(p,adaptive,signal,sourcePlanHash);checkAbort(signal);if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale adaptive optimizer result discarded because the Change Plan changed.');if(!result.variant){this.a.publishCandidate?.(null);this.a.publishDesignState?.(null);return{status:'infeasible' as const,candidateId:null,proposalCount:0,objective:null,mode:'adaptive-design' as const,failureReason:result.failureReason,diagnostics:result.diagnostics};}
    const variant=result.variant;if(variant.verification.status!=='verified')throw new Error(`Adaptive design was not independently reconstructed as valid: ${variant.verification.violations.join(' ')}`);const next=setCandidateProposals(this.a.getProject(),this.a.getPlan(),variant.candidate,this.now());this.publishPlan(next,false);this.a.publishCandidate?.(variant.candidate);this.a.publishDesignState?.({variants:[variant],selectedVariantId:variant.id,stamp});this.activity(actor,'proposed_adaptive_mitigation',`Proposed verified adaptive design at cost ${variant.totalCost}`,variant.candidate.id);return{status:'candidate' as const,candidateId:variant.candidate.id,proposalCount:variant.candidate.commands.length,objective:variant.totalCost,mode:'adaptive-design' as const,peakUtilizationPct:variant.peakUtilizationPct,verification:variant.verification.status,failureReason:null};
  }
  async compareMitigationVariants(signal?:AbortSignal,actor:PlanActor='agent'){if(!this.a.optimizeDesignPareto)throw new Error('Adaptive design variant optimizer is unavailable.');checkAbort(signal);const p=clone(this.a.getProject()),plan=clone(this.a.getPlan()),stamp=changePlanEvidenceStamp(p,plan),sourcePlanHash=changePlanHash(plan);const variants=await this.a.optimizeDesignPareto(p,this.adaptiveRequirements(),signal,sourcePlanHash);checkAbort(signal);if(!isPlanEvidenceFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale design variants discarded because the Change Plan changed.');const verified=variants.filter(v=>v.verification.status==='verified');const selectedVariantId=verified[0]?.id??null;this.a.publishDesignState?.({variants:verified,selectedVariantId,stamp});this.activity(actor,'compared_mitigation_variants',`Generated ${verified.length} verified nondominated design variant(s)`);return{count:verified.length,selectedVariantId,variants:verified.map(v=>({id:v.id,label:v.label,cost:v.totalCost,peakUtilizationPct:v.peakUtilizationPct,scenarioPassCount:v.scenarioPassCount,scenarioCount:v.scenarioCount,upgrades:v.selectedUpgrades.map(u=>u.linkId),newLinks:v.selectedNewLinks.map(l=>l.id),verification:v.verification.status}))};}
  selectMitigationVariant(id:string,actor:PlanActor='human'){const state=this.a.getDesignState?.();if(!state||!isPlanEvidenceFresh(state.stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Design variants are stale or unavailable.');const variant=state.variants.find(v=>v.id===id);if(!variant)throw new Error(`Unknown design variant ${id}`);const next=setCandidateProposals(this.a.getProject(),this.a.getPlan(),variant.candidate,this.now());this.publishPlan(next,false);this.a.publishCandidate?.(variant.candidate);this.a.publishDesignState?.({...state,selectedVariantId:id});this.activity(actor,'selected_mitigation_variant',`Selected ${variant.label} design`,id);return{id:variant.id,label:variant.label,totalCost:variant.totalCost,peakUtilizationPct:variant.peakUtilizationPct};}
  acceptProposalChange(id:string,actor:PlanActor='human'){const project=this.a.getProject(),plan=this.a.getPlan();if(plan.baseModelHash!==modelHash(project))throw new Error('Optimizer proposal is stale because the base network changed. Re-run candidate generation.');const next=retag(acceptCandidateChange(plan,id,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_proposal',`Accepted proposal ${id}`,id);return next;}
  acceptAllProposalChanges(actor:PlanActor='human'){const project=this.a.getProject(),plan=this.a.getPlan();if(plan.baseModelHash!==modelHash(project))throw new Error('Optimizer proposal is stale because the base network changed. Re-run candidate generation.');const next=retag(acceptAllCandidateChanges(plan,this.now()),actor,'accepted_proposal');this.publishPlan(next);this.activity(actor,'accepted_all_proposals','Accepted all current proposal changes');return next;}
  rejectProposalChange(id:string,actor:PlanActor='human'){const next=retag(rejectCandidateChange(this.a.getPlan(),id,this.now()),actor,'rejected_proposal');this.publishPlan(next,false);this.activity(actor,'rejected_proposal',`Rejected proposal ${id}`,id);return next;}
  discardProposal(actor:PlanActor='human'){const next=discardCandidateProposals(this.a.getPlan(),this.now(),actor);this.publishPlan(next,false);this.a.publishCandidate?.(null);this.a.publishDesignState?.(null);this.activity(actor,'discarded_proposal','Discarded pending optimizer proposal');return next;}
  async verifyPlan(signal?:AbortSignal,actor:PlanActor='agent'):Promise<WorkspaceVerification>{
    checkAbort(signal);
    const p=clone(this.a.getProject()),plan=clone(this.a.getPlan()),stamp=changePlanRevisionStamp(p,plan);
    const analysis=this.a.analyzePlanAsync?await this.a.analyzePlanAsync(p,plan,signal):analyzeChangePlan(p,plan);
    checkAbort(signal);
    if(!isPlanRevisionFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale verification discarded because the plan or proposal state changed.');
    let coverage:WorkspaceVerification['scenarioCoverage']={tested:0,eligible:0,status:'not-required'};
    let status:WorkspaceVerification['status']=analysis.verdict==='PASS'?'verified':'failed';
    if(plan.constraints.requireN1){
      const c=this.a.getContingencies?.();
      if(!c||!isPlanEvidenceFresh(c.stamp,p,plan)){
        status='partial';
        coverage={tested:0,eligible:p.links.filter(l=>l.available!==false).length,status:'partial'};
      }else{
        coverage={tested:c.analysis.completedScenarios,eligible:c.analysis.totalEligibleScenarios,status:c.analysis.status==='complete'?'complete':'partial'};
        if(c.analysis.status!=='complete')status='partial';
        else if(c.analysis.result.verdict==='FAIL')status='failed';
      }
    }
    let candidateVerification:CandidateVerification|undefined;
    let adaptiveDesignVerification:AdaptiveDesignVerification|undefined;
    const candidate=this.a.getCandidate?.()??null;
    const designState=this.a.getDesignState?.()??null;
    const selectedDesign=designState&&isPlanEvidenceFresh(designState.stamp,p,plan)?designState.variants.find(v=>v.id===designState.selectedVariantId)??designState.variants[0]??null:null;
    if(candidate&&selectedDesign&&selectedDesign.candidate.id===candidate.id){adaptiveDesignVerification=selectedDesign.verification;status=adaptiveDesignVerification.status==='verified'?'verified':'failed';coverage={tested:selectedDesign.scenarioPassCount,eligible:selectedDesign.scenarioCount,status:selectedDesign.scenarioPassCount===selectedDesign.scenarioCount?'complete':'partial'};}
    else if(candidate&&this.a.verifyCandidate){candidateVerification=await this.a.verifyCandidate(p,candidate,this.requirements(),signal);checkAbort(signal);if(candidateVerification.status!=='verified')status='failed';}
    if(!isPlanRevisionFresh(stamp,this.a.getProject(),this.a.getPlan()))throw new Error('Stale verification discarded because the plan or proposal state changed.');
    const result:WorkspaceVerification={
      status,
      modelHash:modelHash(p),
      planHash:changePlanHash(plan),
      assumptions:analysis.capacity.result.assumptions,
      constraintsChecked:[
        `targetUtilizationPct<=${plan.constraints.targetUtilizationPct}`,
        `budgetCostUnits=${plan.constraints.budgetCostUnits??'unbounded'}`,
        `protectedServiceClassIds=${plan.constraints.protectedServiceClassIds.join(',')||'none'}`,
        `requireN1=${plan.constraints.requireN1}`,
      ],
      scenarioCoverage:coverage,
      evidenceIds:analysis.capacity.result.witnesses.slice(0,24).map(w=>w.id),
      candidateVerification,
      adaptiveDesignVerification,
    };
    this.a.publishVerification?.({result,stamp});
    if(status==='verified'){
      const next=retag(setChangePlanStatus(this.a.getPlan(),'verified','Deterministic shared-plan verification passed.',this.now()),actor,'plan_status');
      this.publishPlan(next,false);
    }
    this.activity(actor,'verified_plan',`Verification ${status}`);
    return result;
  }
  capabilityState(){const p=this.a.getProject(),plan=this.a.getPlan(),a=this.getAnalysis(),current=!!a&&isPlanEvidenceFresh(a.stamp,p,plan),hasViolation=!!(current&&a!.verdict==='FAIL'&&a!.capacity.result.violations.length),ids=new Set(current?a!.capacity.result.violations.map(v=>v.linkId).filter((id):id is string=>!!id):[]),hasUnlockedUpgradeTarget=p.links.some(l=>ids.has(l.id)&&!plan.restrictions.lockedLinkIds.includes(l.id)&&(l.upgradeOptions?.some(o=>o.capacityGbps>l.capacityGbps+1e-9)??false)),adaptiveAllowed=plan.constraints.allowedMitigationActions?.routingChanges??false,proposal=this.proposal(),design=this.a.getDesignState?.()??null,designCurrent=!!design&&isPlanEvidenceFresh(design.stamp,p,plan);return{analysisCurrent:current,hasViolation,proposalPresent:proposal.proposals.length>0,proposalStale:proposal.stale,canDecideProposal:proposal.proposals.length>0&&!proposal.stale,canProposeMitigation:hasViolation&&(hasUnlockedUpgradeTarget||(adaptiveAllowed&&!!this.a.optimizeAdaptiveDesign)),canCompareMitigationVariants:hasViolation&&adaptiveAllowed&&!!this.a.optimizeDesignPareto,designCurrent,designVariantCount:designCurrent?design!.variants.length:0,hasCompleteN1:(()=>{const c=this.a.getContingencies?.()??null;return !!c&&isPlanEvidenceFresh(c.stamp,p,plan)&&c.analysis.status==='complete';})()};}
}
