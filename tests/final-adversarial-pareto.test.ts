import test from 'node:test';
import assert from 'node:assert/strict';
import { filterParetoVariants, type AdaptiveDesignVariant } from '../packages/optimizer/src/index.ts';

function point(id: string, totalCost: number, peakUtilizationPct: number, scenarioPassCount: number): AdaptiveDesignVariant {
  return {
    id,
    name: id,
    label: 'Adaptive design',
    sourceModelHash: 'model',
    sourcePlanHash: 'plan',
    candidatePathSet: { pathsByScenarioDemand: {}, hash: 'paths', totalPaths: 0, generatedAtModelHash: 'model', maxCandidatePaths: 1 },
    allocations: [],
    selectedUpgrades: [],
    selectedNewLinks: [],
    totalCost,
    peakUtilizationPct,
    scenarioPassCount,
    scenarioCount: 3,
    candidate: { id: `candidate-${id}`, name: id, baseModelHash: 'model', commands: [], objective: { name: 'cost', value: totalCost, unit: 'cost-units' }, rationaleEvidenceIds: [] },
    evidence: {
      sourceModelHash: 'model', sourcePlanHash: 'plan', candidatePathSetHash: 'paths', selectedScenarioIds: [], selectedScenarioHashes: [],
      solver: 'HiGHS', solverVersion: 'test', solverStatus: 'Optimal', proof: 'optimal', objective: 'minimum-declared-cost', cost: totalCost,
      peakUtilizationPct, selectedUpgrades: [], selectedNewLinks: [], routingAllocationSummary: [], mipGap: 0, timeoutMs: 1000, verification: 'verified',
    },
    verification: {
      status: 'verified', verifier: 'independently-reconstructed-primal-v1', sourceModelHash: 'model', pathSetHashMatches: true,
      demandConservation: true, validActions: true, linkLoadsValid: true, utilizationValid: true, budgetValid: true, objectiveValid: true,
      selectedScenariosValid: true, calculatedCost: totalCost, calculatedPeakUtilizationPct: peakUtilizationPct, violations: [],
    },
  };
}

test('AV-28: Pareto filtering removes dominated and exact duplicate objective points deterministically', () => {
  const duplicateHighId = point('z-duplicate', 5, 60, 3);
  const duplicateLowId = point('a-canonical', 5, 60, 3);
  const dominated = point('dominated', 6, 65, 3);
  const cheaperButHotter = point('tradeoff', 4, 70, 3);
  const incompleteButCooler = point('coverage-tradeoff', 3, 50, 2);

  const result = filterParetoVariants([duplicateHighId, dominated, cheaperButHotter, duplicateLowId, incompleteButCooler]);
  assert.deepEqual(result.map((variant) => variant.id), ['coverage-tradeoff', 'tradeoff', 'a-canonical']);
  assert.equal(result.filter((variant) => variant.totalCost === 5 && variant.peakUtilizationPct === 60 && variant.scenarioPassCount === 3).length, 1);
});
