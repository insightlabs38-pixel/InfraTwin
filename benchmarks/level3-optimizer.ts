import { runLinkContingencies } from '../packages/evidence/src/index.ts';
import { getScenarioDefinition, loadGrowthWall, loadResilienceGap } from '../packages/scenarios/src/index.ts';
import { optimizeCapacityPlan, optimizeRouting, verifyCapacityCandidate, type CapacityPlanRequirements } from '../packages/optimizer/src/index.ts';
import type { ScenarioPatch } from '../packages/model/src/index.ts';

function growthPatch(): ScenarioPatch {
  const definition = getScenarioDefinition('growth-wall');
  return { id: 'benchmark-growth-1.4', name: 'Growth Wall +40%', disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: (definition.growthDemandIds ?? []).map((demandId) => ({ demandId, multiplier: 1.4 })), addedDemands: [], linkCapacityOverrides: [] };
}

const growth = loadGrowthWall();
const growthRequirements: CapacityPlanRequirements = { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: [growthPatch()] };
const routing = await optimizeRouting(growth, { timeLimitMs: 5_000 });
const capacity = await optimizeCapacityPlan(growth, growthRequirements, { timeLimitMs: 8_000 });
const verification = capacity.candidate ? verifyCapacityCandidate(growth, capacity.candidate, growthRequirements) : null;

const resilience = loadResilienceGap();
const worst = runLinkContingencies(resilience).worst;
const resilienceRequirements: CapacityPlanRequirements = { targetUtilizationPct: 80, includeBaseline: true, scenarioPatches: worst ? [worst.patch] : [] };
const resiliencePlan = await optimizeCapacityPlan(resilience, resilienceRequirements, { timeLimitMs: 8_000 });

console.log(JSON.stringify({
  routing: { status: routing.diagnostics.status, proof: routing.diagnostics.proof, maxUtilizationPct: routing.maxUtilizationPct, runtimeMs: routing.diagnostics.runtimeMs },
  growth: { status: capacity.diagnostics.status, proof: capacity.diagnostics.proof, objective: capacity.diagnostics.objectiveValue, upgrades: capacity.selectedUpgrades, runtimeMs: capacity.diagnostics.runtimeMs, verification: verification?.status ?? 'none' },
  resilience: { worstLinkId: worst?.linkId ?? null, status: resiliencePlan.diagnostics.status, proof: resiliencePlan.diagnostics.proof, objective: resiliencePlan.diagnostics.objectiveValue, upgrades: resiliencePlan.selectedUpgrades, runtimeMs: resiliencePlan.diagnostics.runtimeMs },
}, null, 2));
