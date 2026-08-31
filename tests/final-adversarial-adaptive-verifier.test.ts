import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeAdaptiveDesign, verifyAdaptiveDesign, type AdaptiveDesignVariant } from '../packages/optimizer/src/index.ts';
import { createLevel4ReplanReference } from '../packages/scenarios/src/index.ts';

const cloneVariant = (variant: AdaptiveDesignVariant): AdaptiveDesignVariant => structuredClone(variant);

test('AV-25: reconstructed adaptive verifier rejects cost, flow, scenario, lock, and routing-restriction tampering', async () => {
  const project = createLevel4ReplanReference();
  const input = { targetUtilizationPct: 80, maxCandidatePaths: 5 };
  const solved = await optimizeAdaptiveDesign(project, input, { timeLimitMs: 5_000 });
  assert.ok(solved.variant);
  const valid = solved.variant!;
  assert.equal(valid.verification.status, 'verified');

  const badCost = cloneVariant(valid);
  badCost.totalCost += 1;
  assert.equal(verifyAdaptiveDesign(project, badCost, input).status, 'disagreement');

  const badFlow = cloneVariant(valid);
  badFlow.allocations[0].flowGbps += 1;
  const badFlowVerification = verifyAdaptiveDesign(project, badFlow, input);
  assert.equal(badFlowVerification.status, 'disagreement');
  assert.equal(badFlowVerification.demandConservation, false);

  const badScenario = cloneVariant(valid);
  badScenario.allocations[0].scenarioHash = 'scenario:forged';
  const badScenarioVerification = verifyAdaptiveDesign(project, badScenario, input);
  assert.equal(badScenarioVerification.status, 'disagreement');
  assert.equal(badScenarioVerification.selectedScenariosValid, false);

  const selectedUpgrade = valid.selectedUpgrades[0];
  assert.ok(selectedUpgrade, 'reference design should select a declared upgrade');
  const lockedVerification = verifyAdaptiveDesign(project, valid, { ...input, lockedLinkIds: [selectedUpgrade.linkId] });
  assert.equal(lockedVerification.status, 'disagreement');
  assert.equal(lockedVerification.validActions, false);

  const usedLink = valid.allocations
    .flatMap((allocation) => valid.candidatePathSet.pathsByScenarioDemand[`${allocation.scenarioHash}:${allocation.demandId}`] ?? [])
    .find((path) => valid.allocations.some((allocation) => allocation.pathId === path.id && allocation.flowGbps > 1e-8))
    ?.linkIds[0];
  assert.ok(usedLink);
  const restrictedVerification = verifyAdaptiveDesign(project, valid, { ...input, forbiddenRoutingLinkIds: [usedLink!] });
  assert.equal(restrictedVerification.status, 'disagreement');
  assert.equal(restrictedVerification.linkLoadsValid, false);
});
