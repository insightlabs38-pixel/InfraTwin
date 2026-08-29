import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { estimateTrafficAllocationLP, estimateAdaptiveDesign, generateCandidatePaths, optimizeAdaptiveDesign, optimizeDesignPareto, optimizePathAllocation, optimizeWithScenarioGeneration } from '../packages/optimizer/src/index.ts';
import { createLevel4ReplanReference, createLevel4ScenarioFailure, createLevel4ScenarioReference } from '../packages/scenarios/src/index.ts';
import { generateScaleProject, SCALE_TIERS } from './scale-fixtures.ts';

type Measurement = Record<string, unknown>;
const startedAt = new Date().toISOString();
const measurements: Measurement[] = [];
const context = { generatedAt:startedAt, commit:process.env.GITHUB_SHA ?? 'local', node:process.version, platform:process.platform, arch:process.arch, cpuModel:os.cpus()[0]?.model ?? 'unknown', cpuCount:os.cpus().length, benchmarkKind:'level4a-adaptive-design' };
const timed = async <T>(fn:()=>Promise<T>|T) => { const start=performance.now(); const result=await fn(); return { result, runtimeMs:Math.round((performance.now()-start)*1000)/1000 }; };

mkdirSync('benchmark-results',{recursive:true});

const reference = createLevel4ReplanReference();
const paths = await timed(() => generateCandidatePaths(reference,{targetUtilizationPct:80,maxCandidatePaths:5}));
measurements.push({fixture:'lock-replan-reference',operation:'k-path-generation',runtimeMs:paths.runtimeMs,pathVariables:paths.result.totalPaths,pathSetHash:paths.result.hash});

const pathLp = await timed(() => optimizePathAllocation({
  schemaVersion:'0.1',id:'l4-bench-diamond',name:'L4 benchmark diamond',nodes:['A','B','C','D'].map(id=>({id,name:id})),
  links:[{id:'AB',source:'A',target:'B',capacityGbps:10,weight:1,bidirectional:true},{id:'AC',source:'A',target:'C',capacityGbps:10,weight:1,bidirectional:true},{id:'BD',source:'B',target:'D',capacityGbps:10,weight:1,bidirectional:true},{id:'CD',source:'C',target:'D',capacityGbps:10,weight:1,bidirectional:true}],
  demands:[{id:'D1',source:'A',target:'D',bandwidthGbps:8,serviceClassId:'gold'}],serviceClasses:[{id:'gold',name:'Gold',priority:100,maxUtilizationPct:100,allowShedding:false}],routingProfile:{mode:'ecmp'},
},{targetUtilizationPct:100,maxCandidatePaths:5},{timeLimitMs:5_000}));
measurements.push({fixture:'path-lp-diamond',operation:'path-lp-solve',runtimeMs:pathLp.runtimeMs,pathVariables:pathLp.result.diagnostics.pathVariables,constraints:pathLp.result.diagnostics.constraints,status:pathLp.result.diagnostics.status,proof:pathLp.result.diagnostics.proof,maxUtilizationPct:pathLp.result.maxUtilizationPct,verification:pathLp.result.verification?.status});

const joint = await timed(() => optimizeAdaptiveDesign(reference,{targetUtilizationPct:80,lockedLinkIds:['X'],maxCandidatePaths:5},{timeLimitMs:5_000}));
measurements.push({fixture:'lock-replan-reference',operation:'joint-milp-solve',runtimeMs:joint.runtimeMs,pathVariables:joint.result.diagnostics.pathVariables,binaryVariables:joint.result.diagnostics.binaryVariables,constraints:joint.result.diagnostics.constraints,status:joint.result.diagnostics.status,proof:joint.result.diagnostics.proof,objective:joint.result.variant?.totalCost,peakUtilizationPct:joint.result.variant?.peakUtilizationPct,verification:joint.result.variant?.verification.status});
measurements.push({fixture:'lock-replan-reference',operation:'reconstructed-verification',runtimeMs:joint.result.diagnostics.runtimeMs-joint.result.diagnostics.solveRuntimeMs,verification:joint.result.variant?.verification.status,calculatedCost:joint.result.variant?.verification.calculatedCost,calculatedPeakUtilizationPct:joint.result.variant?.verification.calculatedPeakUtilizationPct});

const pareto = await timed(() => optimizeDesignPareto(reference,{targetUtilizationPct:80,lockedLinkIds:['X'],maxCandidatePaths:5},{timeLimitMs:5_000,targets:[80,70,60]}));
measurements.push({fixture:'lock-replan-reference',operation:'pareto-frontier',runtimeMs:pareto.runtimeMs,solveCount:3,points:pareto.result.map(v=>({label:v.label,cost:v.totalCost,peakUtilizationPct:v.peakUtilizationPct,verification:v.verification.status}))});

const scenarioProject = createLevel4ScenarioReference();
const scenarioLoop = await timed(() => optimizeWithScenarioGeneration(scenarioProject,{targetUtilizationPct:80},{candidateScenarioPatches:[createLevel4ScenarioFailure()],maxIterations:4,maxScenarios:4},{timeLimitMs:5_000}));
measurements.push({fixture:'scenario-aware-reference',operation:'selected-scenario-loop',runtimeMs:scenarioLoop.runtimeMs,termination:scenarioLoop.result.termination,iterations:scenarioLoop.result.iterations,selectedScenarios:scenarioLoop.result.selectedScenarioHashes.length,objective:scenarioLoop.result.result?.variant?.totalCost,verification:scenarioLoop.result.result?.variant?.verification.status});

const scaleResults: Measurement[] = [];
for (const tierId of ['A','B','C'] as const) {
  const tier = SCALE_TIERS.find(item=>item.id===tierId)!;
  const project = generateScaleProject({...tier,seed:4400+tier.nodes,routingMode:'single-shortest-path',workload:'concentrated-sources',sourceConcentration:Math.max(8,Math.ceil(tier.nodes*0.06)),serviceClassCount:3,upgradeOptionDensity:0.25});
  const generated = await timed(() => generateCandidatePaths(project,{targetUtilizationPct:80,maxCandidatePaths:3}));
  const pathEstimate = estimateAdaptiveDesign(project,{targetUtilizationPct:80,maxCandidatePaths:3},generated.result);
  const arcEstimate = estimateTrafficAllocationLP(project);
  const row: Record<string, unknown> = {fixture:`tier-${tierId}`,operation:'path-vs-arc-size',counts:{nodes:project.nodes.length,links:project.links.length,demands:project.demands.length},kPathGenerationMs:generated.runtimeMs,pathVariables:pathEstimate.pathVariables,arcFlowVariables:arcEstimate.flowVariables,reductionRatio:Math.round((arcEstimate.flowVariables/Math.max(1,pathEstimate.pathVariables))*100)/100,pathRecommended:pathEstimate.recommended,arcRecommended:arcEstimate.recommended,jointSolveAttempted:tierId==='A'};
  if (tierId === 'A' && pathEstimate.recommended) {
    const solved = await timed(() => optimizeAdaptiveDesign(project,{targetUtilizationPct:80,maxCandidatePaths:3},{timeLimitMs:4_000}));
    Object.assign(row,{jointSolveMs:solved.runtimeMs,jointStatus:solved.result.diagnostics.status,jointProof:solved.result.diagnostics.proof,jointFailureReason:solved.result.failureReason});
  }
  scaleResults.push(row);
}
measurements.push(...scaleResults);

const output = {context,measurements};
writeFileSync('benchmark-results/level4-design.json',`${JSON.stringify(output,null,2)}\n`,'utf8');
const md = [
  '# InfraTwin Level 4A design benchmark','',
  `Generated: ${startedAt}`,'',
  '| Fixture | Operation | Key result | Runtime |','| --- | --- | --- | ---: |',
  ...measurements.map((row:any)=>{
    const key = row.operation==='path-vs-arc-size' ? `${row.pathVariables} path vars vs ${row.arcFlowVariables} arc vars (${row.reductionRatio}× smaller)` : row.operation==='joint-milp-solve' ? `cost ${row.objective}, ${row.verification}` : row.operation==='path-lp-solve' ? `${row.maxUtilizationPct}% max, ${row.verification}` : row.operation==='pareto-frontier' ? `${row.points?.length ?? 0} nondominated points` : row.operation==='selected-scenario-loop' ? `${row.termination}, cost ${row.objective}` : `${row.pathVariables ?? row.verification ?? ''}`;
    return `| ${row.fixture} | ${row.operation} | ${key} | ${row.runtimeMs ?? row.kPathGenerationMs ?? '—'} ms |`;
  }),
  '',
  'Joint routing+design is intentionally not forced at Tier B/C. Those rows measure deterministic candidate-path generation and formulation-size reduction only.',
].join('\n');
writeFileSync('benchmark-results/level4-design.md',`${md}\n`,'utf8');
console.log(md);
