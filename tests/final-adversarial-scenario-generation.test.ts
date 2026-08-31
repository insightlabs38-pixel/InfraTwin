import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizeWithScenarioGeneration } from '../packages/optimizer/src/index.ts';
import { createLevel4ReplanReference } from '../packages/scenarios/src/index.ts';

test('AV-29: cancellation after a completed scenario-generation solve preserves completed iteration count and result', async () => {
  const project = createLevel4ReplanReference();
  const controller = new AbortController();
  let abortedAtVerification = false;
  const candidateScenario = {
    id: 'post-solve-probe',
    name: 'Post-solve probe',
    disabledNodeIds: [],
    disabledLinkIds: [project.links[0].id],
    demandMultipliers: [],
    addedDemands: [],
    linkCapacityOverrides: [],
  };

  const result = await optimizeWithScenarioGeneration(
    project,
    { maxCandidatePaths: 5, targetUtilizationPct: 80 },
    { maxIterations: 4, maxScenarios: 4, candidateScenarioPatches: [candidateScenario] },
    {
      signal: controller.signal,
      onProgress: (phase: string) => {
        if (!abortedAtVerification && phase === 'Verifying proposal') {
          abortedAtVerification = true;
          controller.abort();
        }
      },
    } as any,
  );

  assert.equal(abortedAtVerification, true, 'test must abort only after the first solve reaches verification');
  assert.equal(result.termination, 'CANCELLED');
  assert.ok(result.result?.variant, 'the completed first iteration result should be preserved');
  assert.equal(result.iterations, 1, 'cancellation evidence must report the completed iteration instead of resetting to zero');
});
