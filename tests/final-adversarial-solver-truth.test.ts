import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSolverStatus } from '../packages/optimizer/src/index.ts';

test('AV-24/F-012: solver error or unknown status cannot become feasible proof merely because partial columns exist', () => {
  assert.deepEqual(normalizeSolverStatus('Optimal', true), { status: 'Optimal', proof: 'optimal', timedOut: false });
  assert.deepEqual(normalizeSolverStatus('Infeasible', false), { status: 'Infeasible', proof: 'infeasible', timedOut: false });
  assert.deepEqual(normalizeSolverStatus('Time limit reached', true), { status: 'Time limit reached', proof: 'feasible-incumbent', timedOut: true });
  assert.deepEqual(normalizeSolverStatus('Time limit reached', false), { status: 'Time limit reached', proof: 'unknown', timedOut: true });

  for (const status of ['Error', 'Unknown', 'Not Set', '']) {
    const normalized = normalizeSolverStatus(status, true);
    assert.equal(normalized.proof, 'unknown', `${status || '(empty)'} must fail closed even when columns exist`);
    assert.equal(normalized.timedOut, false);
  }
});
