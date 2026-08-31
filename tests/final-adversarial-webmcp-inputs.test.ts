import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangePlan, type ChangePlan } from '../packages/model/src/index.ts';
import { type ChangePlanAnalysis } from '../packages/evidence/src/index.ts';
import { CollaborativeWorkspaceService, type CollaborativeWorkspaceAdapters, type WorkspaceSelection } from '../packages/application/src/index.ts';
import { getScenarioDefinition } from '../packages/scenarios/src/index.ts';
import { registerCollaborativeTools, type ModelContextLike, type WebMCPTool } from '../packages/webmcp/src/m35d.ts';

function harness() {
  const project = structuredClone(getScenarioDefinition('maintenance-trap').project);
  let plan: ChangePlan = createChangePlan(project, 'WebMCP input adversarial');
  let selection: WorkspaceSelection = null;
  let analysis: ChangePlanAnalysis | null = null;
  const adapters: CollaborativeWorkspaceAdapters = {
    getProject: () => project,
    getPlan: () => plan,
    setPlan: (next) => { plan = next; },
    getSelection: () => selection,
    setSelection: (next) => { selection = next; },
    getDestination: () => 'network',
    setDestination: () => {},
    getAnalysis: () => analysis,
    publishAnalysis: (next) => { analysis = next; },
  };
  const service = new CollaborativeWorkspaceService(adapters);
  const tools = new Map<string, WebMCPTool>();
  const context: ModelContextLike = {
    registerTool(tool, options) {
      tools.set(tool.name, tool);
      options?.signal?.addEventListener('abort', () => tools.delete(tool.name), { once: true });
    },
  };
  return { service, tools, context, get plan() { return plan; } };
}

test('AV-20: direct WebMCP execute rejects non-object and undeclared top-level input independently of host JSON Schema', async () => {
  const h = harness();
  const registration = await registerCollaborativeTools(h.context, h.service);
  const initialChanges = h.plan.changes.length;

  await assert.rejects(
    Promise.resolve(h.tools.get('inspect_workspace')!.execute({ unexpected: true })),
    /unexpected|unknown|not allowed|undeclared/i,
  );
  await assert.rejects(
    Promise.resolve(h.tools.get('add_plan_change')!.execute({ type: 'disable_link', linkId: 'L1', surprise: { nested: true } })),
    /surprise|unknown|not allowed|undeclared/i,
  );
  await assert.rejects(
    Promise.resolve((h.tools.get('inspect_workspace')!.execute as any)(null)),
    /object/i,
  );
  assert.equal(h.plan.changes.length, initialChanges, 'schema-bypassing extra input must not partially mutate shared state');
  registration.dispose();
});

test('AV-20: optional violation identifiers reject wrong primitive types instead of silently becoming no-id lookups', async () => {
  const h = harness();
  const registration = await registerCollaborativeTools(h.context, h.service);
  h.service.addPlanChange({ type: 'disable_link', linkId: 'L1' }, 'human');
  await h.service.analyzePlan(undefined, 'human');
  await registration.refresh();
  assert.ok(h.tools.has('inspect_violation'));
  assert.ok(h.tools.has('focus_violation'));

  await assert.rejects(
    Promise.resolve(h.tools.get('inspect_violation')!.execute({ violationId: 123 as any })),
    /violationId.*string|string.*violationId/i,
  );
  await assert.rejects(
    Promise.resolve(h.tools.get('focus_violation')!.execute({ violationId: { id: 'capacity:L3' } as any })),
    /violationId.*string|string.*violationId/i,
  );
  registration.dispose();
});
