import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import webmcpPackage from '../packages/webmcp/package.json' with { type: 'json' };
import { ALL_PRODUCT_TOOL_NAMES } from '../packages/webmcp/src/m35d.ts';

function sourceFiles(root: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

test('AV-23: shipped WebMCP surface cannot silently apply/deploy/commit canonical infrastructure', () => {
  assert.equal(webmcpPackage.exports, './src/m35d.ts');
  const names = [...ALL_PRODUCT_TOOL_NAMES];
  assert.equal(names.includes('apply_candidate' as never), false);
  assert.equal(names.some((name) => /(^|_)(apply|deploy|commit)($|_)/i.test(name)), false, names.join(', '));
  assert.ok(names.includes('accept_proposal_change'));
  assert.ok(names.includes('reject_proposal_change'));
  assert.ok(names.includes('discard_proposal'));
});

test('AV-46: application and exported product sources contain no unsafe HTML/eval execution sinks', () => {
  const files = [...sourceFiles('apps/web'), ...sourceFiles('packages/application'), ...sourceFiles('packages/webmcp/src')
    .filter((path) => !path.endsWith(join('packages', 'webmcp', 'src', 'index.ts')))];
  const forbidden: Array<[string, RegExp]> = [
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['innerHTML assignment', /\.innerHTML\s*=/],
    ['insertAdjacentHTML', /insertAdjacentHTML\s*\(/],
    ['document.write', /document\.write\s*\(/],
    ['eval', /\beval\s*\(/],
    ['Function constructor', /new\s+Function\s*\(/],
    ['javascript URL', /javascript\s*:/i],
  ];
  const hits: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const [label, pattern] of forbidden) if (pattern.test(text)) hits.push(`${label}: ${file}`);
  }
  assert.deepEqual(hits, []);
});
