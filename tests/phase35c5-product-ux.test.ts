import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangePlan, setPlanConstraint } from '../packages/model/src/index.ts';
import { loadScenario } from '../packages/scenarios/src/index.ts';
import { createApplicationPresentationState, semanticStateFingerprint, updateApplicationPresentationState } from '../apps/web/lib/application-shell.ts';

test('Phase 3.5C.5 A: destination changes are presentation-only and preserve NetworkProject/ChangePlan hashes', () => {
  const project = loadScenario('continental-service-network');
  const plan = createChangePlan(project, 'IA state preservation', { id: 'phase35c5-state' });
  const before = semanticStateFingerprint(project, plan);
  let presentation = createApplicationPresentationState();
  presentation = updateApplicationPresentationState(presentation, { activeView: 'analysis', analysisTab: 'violations' });
  presentation = updateApplicationPresentationState(presentation, { activeView: 'settings' });
  presentation = updateApplicationPresentationState(presentation, { activeView: 'network' });
  assert.deepEqual(semanticStateFingerprint(project, plan), before);
  assert.equal(presentation.activeView, 'network');
});

test('Phase 3.5C.5 B: Advanced and panel disclosure are presentation-only', () => {
  const project = loadScenario('maintenance-trap');
  const plan = setPlanConstraint(createChangePlan(project, 'Disclosure state', { id: 'phase35c5-disclosure' }), 'requireN1', true);
  const before = semanticStateFingerprint(project, plan);
  let presentation = createApplicationPresentationState();
  presentation = updateApplicationPresentationState(presentation, { advancedOpen: true, leftPanelCollapsed: true, rightPanelCollapsed: true });
  presentation = updateApplicationPresentationState(presentation, { advancedOpen: false, leftPanelCollapsed: false, rightPanelCollapsed: false });
  assert.deepEqual(semanticStateFingerprint(project, plan), before);
  assert.equal(presentation.advancedOpen, false);
});
