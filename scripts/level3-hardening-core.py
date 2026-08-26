from pathlib import Path
import re


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f'missing expected block: {label}')
    return text.replace(old, new, 1)


# --- Semantic SHA-256 model identity -------------------------------------------------
model_path = Path('packages/model/src/index.ts')
model = model_path.read_text()
old_hash_block = """function fnv1a32(text: string): string {\n  let hash = 0x811c9dc5;\n  for (let i = 0; i < text.length; i += 1) {\n    hash ^= text.charCodeAt(i);\n    hash = Math.imul(hash, 0x01000193) >>> 0;\n  }\n  return `fnv1a32:${hash.toString(16).padStart(8, '0')}`;\n}\n\nexport function modelHash(project: NetworkProject): string {\n  return fnv1a32(stableStringify(project));\n}\n\nexport function createScenarioPatch(id: string, name: string): ScenarioPatch {\n  return { id, name, disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: [], addedDemands: [], linkCapacityOverrides: [] };\n}\n\nexport function scenarioHash(patch?: ScenarioPatch | null): string {\n  return patch ? fnv1a32(stableStringify(patch)) : 'baseline';\n}\n"""
new_hash_block = """const SHA256_K = new Uint32Array([\n  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,\n  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,\n  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,\n  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,\n  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,\n  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,\n  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,\n  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,\n]);\n\nconst PRESENTATION_METADATA_KEYS = new Set(['ui', 'layout', 'presentation', 'viewport', 'canvas', 'positions', 'nodePositions']);\n\nfunction rotateRight(value: number, bits: number): number {\n  return (value >>> bits) | (value << (32 - bits));\n}\n\nfunction sha256Hex(text: string): string {\n  const bytes = new TextEncoder().encode(text);\n  const bitLength = bytes.length * 8;\n  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;\n  const padded = new Uint8Array(paddedLength);\n  padded.set(bytes);\n  padded[bytes.length] = 0x80;\n  const view = new DataView(padded.buffer);\n  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));\n  view.setUint32(paddedLength - 4, bitLength >>> 0);\n\n  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);\n  const words = new Uint32Array(64);\n  for (let offset = 0; offset < paddedLength; offset += 64) {\n    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4);\n    for (let i = 16; i < 64; i += 1) {\n      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);\n      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);\n      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;\n    }\n    let [a, b, c, d, e, f, g, h] = state;\n    for (let i = 0; i < 64; i += 1) {\n      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);\n      const choose = (e & f) ^ (~e & g);\n      const temp1 = (h + sigma1 + choose + SHA256_K[i] + words[i]) >>> 0;\n      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);\n      const majority = (a & b) ^ (a & c) ^ (b & c);\n      const temp2 = (sigma0 + majority) >>> 0;\n      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;\n    }\n    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0; state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;\n    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0; state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;\n  }\n  return Array.from(state, (value) => value.toString(16).padStart(8, '0')).join('');\n}\n\nfunction stripPresentationMetadata(value: unknown): unknown {\n  if (Array.isArray(value)) return value.map(stripPresentationMetadata);\n  if (!isRecord(value)) return value;\n  return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {\n    if (!PRESENTATION_METADATA_KEYS.has(key)) out[key] = stripPresentationMetadata(value[key]);\n    return out;\n  }, {});\n}\n\nexport function semanticProjectValue(project: NetworkProject): NetworkProject {\n  const semantic = cloneProject(project);\n  semantic.nodes = semantic.nodes.map(({ x: _x, y: _y, ...node }) => node);\n  if (semantic.metadata) semantic.metadata = stripPresentationMetadata(semantic.metadata) as Record<string, unknown>;\n  return semantic;\n}\n\nexport function semanticStableStringify(project: NetworkProject): string {\n  return stableStringify(semanticProjectValue(project));\n}\n\nexport function semanticModelHash(project: NetworkProject): string {\n  return `sha256:${sha256Hex(semanticStableStringify(project))}`;\n}\n\nexport function projectDocumentHash(project: NetworkProject): string {\n  return `sha256:${sha256Hex(stableStringify(project))}`;\n}\n\nexport async function semanticModelHashWebCrypto(project: NetworkProject): Promise<string> {\n  if (!globalThis.crypto?.subtle) return semanticModelHash(project);\n  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(semanticStableStringify(project)));\n  return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;\n}\n\n// Backward-compatible name used throughout Level 0–3 evidence and stale-result checks.\n// It now means semantic engineering identity, not byte identity of the UI document.\nexport function modelHash(project: NetworkProject): string {\n  return semanticModelHash(project);\n}\n\nexport function createScenarioPatch(id: string, name: string): ScenarioPatch {\n  return { id, name, disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: [], addedDemands: [], linkCapacityOverrides: [] };\n}\n\nexport function scenarioHash(patch?: ScenarioPatch | null): string {\n  return patch ? `sha256:${sha256Hex(stableStringify(patch))}` : 'baseline';\n}\n"""
model = replace_once(model, old_hash_block, new_hash_block, 'model hash implementation')
model_path.write_text(model)

# --- WebMCP state / trust contract ---------------------------------------------------
webmcp_path = Path('packages/webmcp/src/index.ts')
webmcp = webmcp_path.read_text()
webmcp = replace_once(
    webmcp,
    "export const VIOLATION_TOOL_NAMES = ['inspect_violation', 'show_counterexample', 'find_bottlenecks'] as const;",
    "export const VIOLATION_TOOL_NAMES = ['inspect_violation', 'find_bottlenecks'] as const;\nexport const COUNTEREXAMPLE_TOOL_NAMES = ['show_counterexample'] as const;",
    'split violation/counterexample constants',
)
webmcp = replace_once(webmcp, "id: `webmcp-simulation-${Date.now()}`", "id: 'webmcp-simulation'", 'deterministic simulation id')
webmcp = replace_once(
    webmcp,
    """        const analysis = runScenarioCapacityAnalysis(project, patch);\n        services.setActiveScenario(patch); services.publishCapacityAnalysis(analysis); return analysis;\n""",
    """        // A read-only simulation never changes the active shared scenario or canonical project.\n        // The caller can explicitly replay a scenario through a mutating capability if desired.\n        return runScenarioCapacityAnalysis(project, patch);\n""",
    'simulate_change state mutation',
)
webmcp = replace_once(
    webmcp,
    """      services.publishContingencyAnalysis(analysis);\n      if (analysis.status === 'complete' && analysis.worst) {\n        services.setActiveScenario(analysis.worst.patch);\n        services.selectEvidence?.({ type: 'link', id: analysis.worst.linkId });\n      }\n      return analysis;\n""",
    """      // Publishing the derived ranking is allowed; replaying a counterexample is a separate\n      // mutating capability so this analysis call never changes the active scenario.\n      services.publishContingencyAnalysis(analysis);\n      return analysis;\n""",
    'run_contingencies implicit replay',
)

show_start = webmcp.index("    {\n      name: 'show_counterexample'")
show_end = webmcp.index("    {\n      name: 'find_bottlenecks'", show_start)
show_block = webmcp[show_start:show_end]
webmcp = webmcp[:show_start] + webmcp[show_end:]
show_block = show_block.rstrip()
if show_block.endswith(','):
    show_block = show_block[:-1]
candidate_marker = 'export async function registerCandidateTools'
insert_at = webmcp.index(candidate_marker)
counterexample_function = """export async function registerCounterexampleTools(context: ModelContextLike, services: InfraTwinToolServices): Promise<() => void> {\n  return registerGroup(context, [\n""" + show_block + """\n  ]);\n}\n\n"""
webmcp = webmcp[:insert_at] + counterexample_function + webmcp[insert_at:]

# All tool outputs can contain imported/user-controlled identifiers, labels, or metadata.
webmcp = re.sub(r"annotations: \{ readOnlyHint: (true|false) \}", r"annotations: { readOnlyHint: \1, untrustedContentHint: true }", webmcp)

webmcp = replace_once(
    webmcp,
    """        const requirements = optimizerScenarioRequirements(services, input);\n        const result = await services.optimizeCapacity(requirements, { signal: options?.signal });\n        assertNotAborted(options?.signal);\n        services.publishOptimizationResult?.(result);\n""",
    """        const requirements = optimizerScenarioRequirements(services, input);\n        const expectedModelHash = modelHash(services.getProject());\n        const expectedScenarioHash = scenarioHash(services.getActiveScenario());\n        const result = await services.optimizeCapacity(requirements, { signal: options?.signal });\n        assertNotAborted(options?.signal);\n        if (modelHash(services.getProject()) !== expectedModelHash || scenarioHash(services.getActiveScenario()) !== expectedScenarioHash) {\n          throw new Error('Optimizer result is stale because the model or active scenario changed before publication.');\n        }\n        services.publishOptimizationResult?.(result);\n""",
    'optimizer stale publication guard',
)
webmcp = replace_once(
    webmcp,
    """      }, async (_input, options) => {\n        if (!services.optimizeRouting) throw new Error('Optimizer is not loaded in the application.');\n        return services.optimizeRouting({ signal: options?.signal });\n      }),\n""",
    """      }, async (_input, options) => {\n        if (!services.optimizeRouting) throw new Error('Optimizer is not loaded in the application.');\n        const expectedModelHash = modelHash(services.getProject());\n        const expectedScenarioHash = scenarioHash(services.getActiveScenario());\n        const result = await services.optimizeRouting({ signal: options?.signal });\n        assertNotAborted(options?.signal);\n        if (modelHash(services.getProject()) !== expectedModelHash || scenarioHash(services.getActiveScenario()) !== expectedScenarioHash) {\n          throw new Error('Routing optimization result is stale because the model or active scenario changed.');\n        }\n        return result;\n      }),\n""",
    'routing optimizer stale guard',
)
webmcp = replace_once(
    webmcp,
    """        const result = await services.verifyCandidate(candidate, requirements, { signal: options?.signal });\n        services.publishCandidateVerification?.(result); return result;\n""",
    """        const result = await services.verifyCandidate(candidate, requirements, { signal: options?.signal });\n        assertNotAborted(options?.signal);\n        if (candidate.baseModelHash !== modelHash(services.getProject())) throw new Error('Candidate verification is stale because the project changed.');\n        services.publishCandidateVerification?.(result); return result;\n""",
    'verification stale guard',
)
webmcp_path.write_text(webmcp)

# --- Update existing WebMCP regression expectations ---------------------------------
level1_path = Path('tests/level1.test.ts')
level1 = level1_path.read_text()
level1 = replace_once(
    level1,
    """  await tools.get('simulate_change')!.execute({ disabledLinkIds: ['L1'], name: 'Agent maintenance' });\n  assert.deepEqual(services.getActiveScenario()?.disabledLinkIds, ['L1']);\n  assert.equal(project.links.find((link) => link.id === 'L1')?.available, true);\n""",
    """  const simulated = await tools.get('simulate_change')!.execute({ disabledLinkIds: ['L1'], name: 'Agent maintenance' }) as ReturnType<typeof runScenarioCapacityAnalysis>;\n  assert.equal(simulated.result.verdict, 'FAIL');\n  assert.equal(services.getActiveScenario(), null, 'read-only simulation must not change active shared scenario');\n  assert.equal(project.links.find((link) => link.id === 'L1')?.available, true);\n  assert.equal(tools.get('simulate_change')?.annotations?.untrustedContentHint, true);\n""",
    'Level 1 simulate_change expectation',
)
level1_path.write_text(level1)

level2_path = Path('tests/level2.test.ts')
level2 = level2_path.read_text()
level2 = replace_once(level2, "  CANDIDATE_TOOL_NAMES,\n", "  CANDIDATE_TOOL_NAMES,\n  COUNTEREXAMPLE_TOOL_NAMES,\n", 'Level 2 counterexample constant import')
level2 = replace_once(level2, "  registerCandidateTools,\n", "  registerCandidateTools,\n  registerCounterexampleTools,\n", 'Level 2 counterexample function import')
level2 = replace_once(
    level2,
    """  const disposeViolation = await registerViolationTools(harness.context, harness.services);\n  assert.deepEqual([...harness.tools.keys()].slice(-3), [...VIOLATION_TOOL_NAMES]);\n  const candidate = (await harness.tools.get('propose_change')!.execute({ strategy: 'set_link_capacity', linkId: 'R4', capacityGbps: 14 })) as NonNullable<ReturnType<typeof harness.services.getCandidate>>;\n""",
    """  const disposeViolation = await registerViolationTools(harness.context, harness.services);\n  assert.deepEqual([...harness.tools.keys()].slice(-2), [...VIOLATION_TOOL_NAMES]);\n  assert.equal(harness.tools.has('show_counterexample'), false);\n  harness.setContingencies(runLinkContingencies(loadResilienceGap()));\n  const disposeCounterexample = await registerCounterexampleTools(harness.context, harness.services);\n  assert.deepEqual([...harness.tools.keys()].slice(-1), [...COUNTEREXAMPLE_TOOL_NAMES]);\n  const candidate = (await harness.tools.get('propose_change')!.execute({ strategy: 'set_link_capacity', linkId: 'R4', capacityGbps: 14 })) as NonNullable<ReturnType<typeof harness.services.getCandidate>>;\n""",
    'Level 2 dynamic capability split',
)
level2 = replace_once(
    level2,
    """  disposeCandidate(); disposeViolation(); disposeResilience(); disposeCore();\n  for (const name of [...CORE_TOOL_NAMES, ...RESILIENCE_TOOL_NAMES, ...VIOLATION_TOOL_NAMES, ...CANDIDATE_TOOL_NAMES]) assert.equal(harness.signals.get(name)?.aborted, true, `${name} registration should be aborted`);\n""",
    """  disposeCandidate(); disposeCounterexample(); disposeViolation(); disposeResilience(); disposeCore();\n  for (const name of [...CORE_TOOL_NAMES, ...RESILIENCE_TOOL_NAMES, ...VIOLATION_TOOL_NAMES, ...COUNTEREXAMPLE_TOOL_NAMES, ...CANDIDATE_TOOL_NAMES]) assert.equal(harness.signals.get(name)?.aborted, true, `${name} registration should be aborted`);\n""",
    'Level 2 disposal split',
)
level2 = replace_once(
    level2,
    """  const dispose = await registerViolationTools(harness.context, harness.services);\n\n  const violation = await harness.tools.get('inspect_violation')!.execute({});\n""",
    """  const disposeViolation = await registerViolationTools(harness.context, harness.services);\n  assert.equal(harness.tools.has('show_counterexample'), false);\n  const disposeCounterexample = await registerCounterexampleTools(harness.context, harness.services);\n\n  const violation = await harness.tools.get('inspect_violation')!.execute({});\n""",
    'Level 2 replay registration split',
)
level2 = replace_once(level2, "  dispose();\n});\n\ntest('WebMCP contingency execution", "  disposeCounterexample(); disposeViolation();\n});\n\ntest('WebMCP contingency execution", 'Level 2 split cleanup')
level2_path.write_text(level2)

print('Level 3 core hardening transform applied.')
