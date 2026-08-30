from pathlib import Path

path = Path('packages/optimizer/src/level4-design.ts')
text = path.read_text()

old_import = "import { HIGHS_PACKAGE_VERSION, HIGHS_SOLVER_NAME, normalizeSolverStatus, type OptimizationProof, type SolverRunOptions } from './index.ts';\n"
new_import = old_import + "import { approximateLevel4PathCacheBytes, createPathEngineProfile, designTopologyFingerprint, generateRoutePaths, type PathEngineProfile } from './level4-path-engine.ts';\n"
if "./level4-path-engine.ts" not in text:
    text = text.replace(old_import, new_import, 1)

old_candidate = "export interface CandidatePathSet { pathsByScenarioDemand:Record<string,DesignPath[]>; hash:string; totalPaths:number; generatedAtModelHash:string; maxCandidatePaths:number }"
new_candidate = "export interface CandidatePathGenerationDiagnostics extends PathEngineProfile { totalMs:number; pathSetHashMs:number; totalDemands:number; approximateRetainedCacheBytes:number }\nexport interface CandidatePathSet { pathsByScenarioDemand:Record<string,DesignPath[]>; hash:string; totalPaths:number; generatedAtModelHash:string; maxCandidatePaths:number; generationDiagnostics?:CandidatePathGenerationDiagnostics }"
text = text.replace(old_candidate, new_candidate, 1)

old_fn_prefix = "export function generateCandidatePaths(project:NetworkProject,input:AdaptiveDesignRequirements={}):CandidatePathSet{"
if old_fn_prefix in text:
    text = text.replace(old_fn_prefix, "export function generateCandidatePathsReference(project:NetworkProject,input:AdaptiveDesignRequirements={}):CandidatePathSet{", 1)
    lines = text.splitlines()
    ref_index = next(i for i, line in enumerate(lines) if line.startswith('export function generateCandidatePathsReference('))
    optimized = r'''export function generateCandidatePaths(project:NetworkProject,input:AdaptiveDesignRequirements={},options:{signal?:AbortSignal}={}):CandidatePathSet{
  const started=now(),r=normalizeRequirements(input);validateCandidateLinks(project,r);const map:Record<string,DesignPath[]>={};let total=0;
  const profile=createPathEngineProfile(),fingerprints=new Set<string>(),routePairs=new Set<string>();let totalDemands=0;
  const topologyOptions={forbiddenRoutingLinkIds:r.forbiddenRoutingLinkIds,forbiddenRoutingNodeIds:r.forbiddenRoutingNodeIds,lockedNodeIds:r.lockedNodeIds,candidateLinkOptions:r.candidateLinkOptions,includeCandidateLinks:r.allowedActions.newLinks,maxCandidatePaths:r.maxCandidatePaths,diversityPenalty:r.diversityPenalty};
  for(const sc of selectedScenarios(r)){checkAbort(options.signal);const snap=applyScenario(project,sc.patch),fingerprint=designTopologyFingerprint(snap,topologyOptions);fingerprints.add(fingerprint);for(const d of snap.demands){checkAbort(options.signal);totalDemands++;routePairs.add(`${d.source}>${d.target}`);const key=`${sc.hash}:${d.id}`,raw=generateRoutePaths(snap,d.source,d.target,topologyOptions,profile,options.signal),paths=raw.map((p,i):DesignPath=>({id:`path:${sc.hash.slice(-10)}:${d.id}:${i+1}`,demandId:d.id,nodes:p.nodes,hops:p.hops,linkIds:p.hops.map(h=>h.linkId),cost:p.cost,selectionReason:i===0?'shortest':p.hops.some(h=>h.candidateLink)?'declared candidate connection':i===1?'alternate corridor':`diverse alternate ${i}`}));map[key]=paths;total+=paths.length}}
  profile.topologyFingerprints=fingerprints.size;profile.uniqueSourceTargetPairs=routePairs.size;const hashStarted=now(),hash=stablePathSetHash(map),pathSetHashMs=now()-hashStarted;
  return{pathsByScenarioDemand:map,hash,totalPaths:total,generatedAtModelHash:modelHash(project),maxCandidatePaths:r.maxCandidatePaths,generationDiagnostics:{...profile,totalMs:round(now()-started,3),pathSetHashMs:round(pathSetHashMs,3),totalDemands,approximateRetainedCacheBytes:approximateLevel4PathCacheBytes()}};
}'''
    lines.insert(ref_index + 1, optimized)
    text = '\n'.join(lines) + '\n'

old_sig = "options:SolverRunOptions&{signal?:AbortSignal;sourcePlanHash?:string|null;label?:AdaptiveDesignVariant['label']}={}"
new_sig = "options:SolverRunOptions&{signal?:AbortSignal;sourcePlanHash?:string|null;label?:AdaptiveDesignVariant['label'];candidatePathSet?:CandidatePathSet}={}"
text = text.replace(old_sig, new_sig, 1)
text = text.replace("const started=now(),ps=now(),pathSet=generateCandidatePaths(project,input),pathMs=now()-ps;", "const started=now(),ps=now(),pathSet=options.candidatePathSet??generateCandidatePaths(project,input,{signal:options.signal}),pathMs=options.candidatePathSet?0:now()-ps;", 1)

lines = text.splitlines()
for i, line in enumerate(lines):
    if line.startswith('export async function optimizeDesignPareto('):
        lines[i] = r'''export async function optimizeDesignPareto(project:NetworkProject,input:AdaptiveDesignRequirements={},options:SolverRunOptions&{signal?:AbortSignal;sourcePlanHash?:string|null;targets?:number[]}={}):Promise<AdaptiveDesignVariant[]>{
  const base=Number(input.targetUtilizationPct??80),targets=[...new Set((options.targets??[base,Math.max(40,base-10),Math.max(30,base-20)]).map(v=>Math.max(1,Math.min(100,round(v)))))].sort((a,b)=>b-a).slice(0,7),variants:AdaptiveDesignVariant[]=[];
  checkAbort(options.signal);const candidatePathSet=generateCandidatePaths(project,input,{signal:options.signal});
  for(let i=0;i<targets.length;i++){checkAbort(options.signal);const label:AdaptiveDesignVariant['label']=i===0?'Lowest cost':i===targets.length-1?'Maximum headroom':'Balanced',r=await optimizeAdaptiveDesign(project,{...input,targetUtilizationPct:targets[i]},{...options,label,candidatePathSet});if(r.variant?.verification.status==='verified')variants.push(r.variant)}
  return filterParetoVariants(variants);
}'''
        break
text = '\n'.join(lines) + '\n'
path.write_text(text)

index = Path('packages/optimizer/src/index.ts')
index_text = index.read_text()
export_line = 'export * from "./level4-path-engine.ts";\n'
if export_line not in index_text:
    index_text = index_text.rstrip() + '\n' + export_line
index.write_text(index_text)
