from pathlib import Path


def replace(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    if old not in text:
        raise SystemExit(f'missing expected snippet in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new))

# --- graph engine: exact ECMP count + preserve decision precision ---
graph = 'packages/graph-engine/src/index.ts'
replace(graph,
'''  paths: RoutePath[];\n  linkFractions: Record<string, number>;''',
'''  paths: RoutePath[];\n  /** Exact number of equal-cost shortest paths. Kept as decimal text so very large DAG counts stay exact. */\n  equalCostPathCountExact: string;\n  /** Numeric path count when it is safely representable, otherwise null. */\n  equalCostPathCount: number | null;\n  materializedPathCount: number;\n  pathsTruncated: boolean;\n  linkFractions: Record<string, number>;''')
replace(graph,
'''function unreachableRoute(demandId: string): DemandRoute {\n  return { demandId, reachable: false, nodeIds: [], linkIds: [], totalWeight: null, paths: [], linkFractions: {} };\n}''',
'''function pathCountFields(total: bigint, materialized: number) {\n  return {\n    equalCostPathCountExact: total.toString(),\n    equalCostPathCount: total <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(total) : null,\n    materializedPathCount: materialized,\n    pathsTruncated: total > BigInt(materialized),\n  };\n}\n\nfunction ratioBigInt(numerator: bigint, denominator: bigint): number {\n  if (denominator <= 0n) return 0;\n  const scale = 1_000_000_000_000_000n;\n  return Number((numerator * scale) / denominator) / 1_000_000_000_000_000;\n}\n\nfunction unreachableRoute(demandId: string): DemandRoute {\n  return { demandId, reachable: false, nodeIds: [], linkIds: [], totalWeight: null, paths: [], ...pathCountFields(0n, 0), linkFractions: {} };\n}''')
replace(graph,
'''    return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], linkFractions: {} };''',
'''    return { demandId: demand.id, reachable: true, nodeIds: [demand.source], linkIds: [], totalWeight: 0, paths: [{ nodeIds: [demand.source], linkIds: [], fraction: 1 }], ...pathCountFields(1n, 1), linkFractions: {} };''')
# occurs in both shortestPath and ecmpRoute
replace(graph,
'''    paths: [{ nodeIds, linkIds, fraction: 1 }],\n    linkFractions,''',
'''    paths: [{ nodeIds, linkIds, fraction: 1 }],\n    ...pathCountFields(1n, 1),\n    linkFractions,''')
replace(graph,
'''  const pathCount = new Map<string, number>();\n  pathCount.set(demand.target, 1);\n  for (const nodeId of nodesByDescendingDistance) {\n    if (nodeId === demand.target) continue;\n    const count = (dag.get(nodeId) ?? []).reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0), 0);\n    pathCount.set(nodeId, count);\n  }\n  const totalPaths = pathCount.get(demand.source) ?? 0;\n  if (totalPaths <= 0) return unreachableRoute(demand.id);''',
'''  const pathCount = new Map<string, bigint>();\n  pathCount.set(demand.target, 1n);\n  for (const nodeId of nodesByDescendingDistance) {\n    if (nodeId === demand.target) continue;\n    const count = (dag.get(nodeId) ?? []).reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0n), 0n);\n    pathCount.set(nodeId, count);\n  }\n  const totalPaths = pathCount.get(demand.source) ?? 0n;\n  if (totalPaths <= 0n) return unreachableRoute(demand.id);''')
replace(graph,
'''    const edges = (dag.get(nodeId) ?? []).filter((edge) => (pathCount.get(edge.to) ?? 0) > 0);\n    const denominator = edges.reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0), 0);\n    if (denominator <= 0) continue;\n    for (const edge of edges) {\n      const fraction = flow * ((pathCount.get(edge.to) ?? 0) / denominator);\n      linkFractions[edge.linkId] = round((linkFractions[edge.linkId] ?? 0) + fraction);\n      nodeFlow.set(edge.to, round((nodeFlow.get(edge.to) ?? 0) + fraction));\n    }''',
'''    const edges = (dag.get(nodeId) ?? []).filter((edge) => (pathCount.get(edge.to) ?? 0n) > 0n);\n    const denominator = edges.reduce((sum, edge) => sum + (pathCount.get(edge.to) ?? 0n), 0n);\n    if (denominator <= 0n) continue;\n    for (const edge of edges) {\n      const fraction = flow * ratioBigInt(pathCount.get(edge.to) ?? 0n, denominator);\n      linkFractions[edge.linkId] = (linkFractions[edge.linkId] ?? 0) + fraction;\n      nodeFlow.set(edge.to, (nodeFlow.get(edge.to) ?? 0) + fraction);\n    }''')
replace(graph,
'''    const next = (dag.get(cursor) ?? []).find((edge) => (pathCount.get(edge.to) ?? 0) > 0);''',
'''    const next = (dag.get(cursor) ?? []).find((edge) => (pathCount.get(edge.to) ?? 0n) > 0n);''')
replace(graph,
'''      paths.push({ nodeIds: [...nodeIds], linkIds: [...linkIds], fraction: round(1 / totalPaths) });''',
'''      paths.push({ nodeIds: [...nodeIds], linkIds: [...linkIds], fraction: ratioBigInt(1n, totalPaths) });''')
replace(graph,
'''      if ((pathCount.get(edge.to) ?? 0) <= 0) continue;''',
'''      if ((pathCount.get(edge.to) ?? 0n) <= 0n) continue;''')
replace(graph,
'''    totalWeight: round(totalWeight),\n    paths,\n    linkFractions,''',
'''    totalWeight: round(totalWeight),\n    paths,\n    ...pathCountFields(totalPaths, paths.length),\n    linkFractions,''')
replace(graph,
'''    for (const [linkId, fraction] of Object.entries(route.linkFractions)) linkLoadsGbps[linkId] = round((linkLoadsGbps[linkId] ?? 0) + demand.bandwidthGbps * fraction);''',
'''    for (const [linkId, fraction] of Object.entries(route.linkFractions)) linkLoadsGbps[linkId] = (linkLoadsGbps[linkId] ?? 0) + demand.bandwidthGbps * fraction;''')
replace(graph,
'''    linkUtilizationPct[linkId] = link ? round((load / link.capacityGbps) * 100) : 0;''',
'''    linkUtilizationPct[linkId] = link ? (load / link.capacityGbps) * 100 : 0;''')

# --- model validation + canonicalization safety ---
model = 'packages/model/src/index.ts'
replace(model,
'''const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);\nconst nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;\nconst finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);''',
'''const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);\nconst nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;\nconst finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);\n\nexport const MODEL_LIMITS = {\n  nodes: 500, links: 2000, demands: 2000, serviceClasses: 64, upgradeOptionsPerLink: 64,\n  idLength: 128, nameLength: 512, metadataDepth: 32, metadataEntries: 4096, metadataStringLength: 16_384,\n} as const;\n\nfunction rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]): void {\n  const allowedSet = new Set(allowed);\n  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${label}.${key} is not a recognized canonical property`);\n}\n\nfunction validateMetadata(value: unknown, errors: string[]): void {\n  if (value === undefined) return;\n  if (!isRecord(value)) { errors.push('metadata must be an object'); return; }\n  const stack: Array<{ value: unknown; depth: number; path: string }> = [{ value, depth: 0, path: 'metadata' }];\n  let entries = 0;\n  while (stack.length) {\n    const item = stack.pop()!;\n    if (item.depth > MODEL_LIMITS.metadataDepth) { errors.push(`metadata nesting exceeds ${MODEL_LIMITS.metadataDepth}`); return; }\n    if (Array.isArray(item.value)) {\n      entries += item.value.length;\n      if (entries > MODEL_LIMITS.metadataEntries) { errors.push(`metadata contains more than ${MODEL_LIMITS.metadataEntries} entries`); return; }\n      item.value.forEach((child, index) => stack.push({ value: child, depth: item.depth + 1, path: `${item.path}[${index}]` }));\n    } else if (isRecord(item.value)) {\n      const keys = Object.keys(item.value);\n      entries += keys.length;\n      if (entries > MODEL_LIMITS.metadataEntries) { errors.push(`metadata contains more than ${MODEL_LIMITS.metadataEntries} entries`); return; }\n      for (const key of keys) {\n        if (key.length > MODEL_LIMITS.nameLength) errors.push(`${item.path} contains an overlong key`);\n        stack.push({ value: item.value[key], depth: item.depth + 1, path: `${item.path}.${key}` });\n      }\n    } else if (typeof item.value === 'string') {\n      if (item.value.length > MODEL_LIMITS.metadataStringLength) errors.push(`${item.path} string exceeds ${MODEL_LIMITS.metadataStringLength} characters`);\n    } else if (typeof item.value === 'number' && !Number.isFinite(item.value)) {\n      errors.push(`${item.path} must not contain non-finite numbers`);\n    } else if (typeof item.value === 'function' || typeof item.value === 'symbol' || typeof item.value === 'bigint' || item.value === undefined) {\n      errors.push(`${item.path} contains a value that is not JSON data`);\n    }\n  }\n}\n\nfunction checkBoundedString(value: unknown, max: number, label: string, errors: string[], optional = false): void {\n  if (optional && value === undefined) return;\n  if (!nonEmptyString(value)) { errors.push(`${label} must be non-empty`); return; }\n  if (value.length > max) errors.push(`${label} must be at most ${max} characters`);\n}''')
replace(model,
'''  if (!nonEmptyString(value.id)) errors.push('id must be a non-empty string');\n  if (!nonEmptyString(value.name)) errors.push('name must be a non-empty string');''',
'''  checkBoundedString(value.id, MODEL_LIMITS.idLength, 'id', errors);\n  checkBoundedString(value.name, MODEL_LIMITS.nameLength, 'name', errors);''')
replace(model,
'''  if (errors.length) return { valid: false, errors };\n\n  const nodes = value.nodes as unknown[];''',
'''  if (errors.length) return { valid: false, errors };\n  rejectUnknownKeys(value, ['schemaVersion', 'id', 'name', 'nodes', 'links', 'demands', 'serviceClasses', 'routingProfile', 'metadata'], 'project', errors);\n  validateMetadata(value.metadata, errors);\n\n  const nodes = value.nodes as unknown[];''')
replace(model,
'''  if (nodes.length > 500) errors.push('nodes must contain at most 500 entries for browser-local analysis');\n  if (links.length > 2000) errors.push('links must contain at most 2000 entries for browser-local analysis');\n  if (demands.length > 2000) errors.push('demands must contain at most 2000 entries for browser-local analysis');\n  if (classes.length > 64) errors.push('serviceClasses must contain at most 64 entries');''',
'''  if (nodes.length > MODEL_LIMITS.nodes) errors.push(`nodes must contain at most ${MODEL_LIMITS.nodes} entries for browser-local analysis`);\n  if (links.length > MODEL_LIMITS.links) errors.push(`links must contain at most ${MODEL_LIMITS.links} entries for browser-local analysis`);\n  if (demands.length > MODEL_LIMITS.demands) errors.push(`demands must contain at most ${MODEL_LIMITS.demands} entries for browser-local analysis`);\n  if (classes.length > MODEL_LIMITS.serviceClasses) errors.push(`serviceClasses must contain at most ${MODEL_LIMITS.serviceClasses} entries`);''')
replace(model,
'''    if (!nonEmptyString(node.id)) errors.push(`nodes[${index}].id must be non-empty`);''',
'''    rejectUnknownKeys(node, ['id', 'name', 'region', 'type', 'available', 'x', 'y'], `nodes[${index}]`, errors);\n    checkBoundedString(node.id, MODEL_LIMITS.idLength, `nodes[${index}].id`, errors);\n    if (!nonEmptyString(node.id)) {}''')
# repair duplicate ID branch now that bounded check owns empty error
replace(model,
'''    if (!nonEmptyString(node.id)) {}\n    else if (nodeIds.has(node.id)) errors.push(`duplicate node id ${node.id}`);\n    else nodeIds.add(node.id);\n    if (!nonEmptyString(node.name)) errors.push(`nodes[${index}].name must be non-empty`);''',
'''    if (nonEmptyString(node.id)) { if (nodeIds.has(node.id)) errors.push(`duplicate node id ${node.id}`); else nodeIds.add(node.id); }\n    checkBoundedString(node.name, MODEL_LIMITS.nameLength, `nodes[${index}].name`, errors);\n    if (node.region !== undefined && typeof node.region !== 'string') errors.push(`nodes[${index}].region must be a string`);\n    if (node.type !== undefined && typeof node.type !== 'string') errors.push(`nodes[${index}].type must be a string`);''')
replace(model,
'''    if (!nonEmptyString(serviceClass.id)) errors.push(`serviceClasses[${index}].id must be non-empty`);''',
'''    rejectUnknownKeys(serviceClass, ['id', 'name', 'priority', 'maxUtilizationPct', 'allowShedding'], `serviceClasses[${index}]`, errors);\n    checkBoundedString(serviceClass.id, MODEL_LIMITS.idLength, `serviceClasses[${index}].id`, errors);\n    if (!nonEmptyString(serviceClass.id)) {}''')
replace(model,
'''    if (!nonEmptyString(serviceClass.id)) {}\n    else if (classIds.has(serviceClass.id)) errors.push(`duplicate service class id ${serviceClass.id}`);\n    else classIds.add(serviceClass.id);\n    if (!nonEmptyString(serviceClass.name)) errors.push(`serviceClasses[${index}].name must be non-empty`);''',
'''    if (nonEmptyString(serviceClass.id)) { if (classIds.has(serviceClass.id)) errors.push(`duplicate service class id ${serviceClass.id}`); else classIds.add(serviceClass.id); }\n    checkBoundedString(serviceClass.name, MODEL_LIMITS.nameLength, `serviceClasses[${index}].name`, errors);''')
replace(model,
'''    if (!Number.isInteger(serviceClass.priority) || Number(serviceClass.priority) < 0) errors.push(`serviceClasses[${index}].priority must be a non-negative integer`);''',
'''    if (!Number.isInteger(serviceClass.priority) || Number(serviceClass.priority) < 0) errors.push(`serviceClasses[${index}].priority must be a non-negative integer`);\n    if (serviceClass.allowShedding !== undefined && typeof serviceClass.allowShedding !== 'boolean') errors.push(`serviceClasses[${index}].allowShedding must be boolean`);''')
replace(model,
'''    if (!nonEmptyString(link.id)) errors.push(`links[${index}].id must be non-empty`);''',
'''    rejectUnknownKeys(link, ['id', 'source', 'target', 'bidirectional', 'capacityGbps', 'latencyMs', 'weight', 'available', 'upgradeOptions'], `links[${index}]`, errors);\n    checkBoundedString(link.id, MODEL_LIMITS.idLength, `links[${index}].id`, errors);\n    if (!nonEmptyString(link.id)) {}''')
replace(model,
'''    if (!nonEmptyString(link.id)) {}\n    else if (linkIds.has(link.id)) errors.push(`duplicate link id ${link.id}`);\n    else linkIds.add(link.id);''',
'''    if (nonEmptyString(link.id)) { if (linkIds.has(link.id)) errors.push(`duplicate link id ${link.id}`); else linkIds.add(link.id); }''')
replace(model,
'''    if (!nonEmptyString(link.target) || !nodeIds.has(String(link.target))) errors.push(`links[${index}].target must reference a node`);''',
'''    if (!nonEmptyString(link.target) || !nodeIds.has(String(link.target))) errors.push(`links[${index}].target must reference a node`);\n    if (nonEmptyString(link.source) && nonEmptyString(link.target) && link.source === link.target) errors.push(`links[${index}] must not be a self-link`);''')
replace(model,
'''    if (!finiteNumber(link.weight) || Number(link.weight) < 0) errors.push(`links[${index}].weight must be >= 0`);''',
'''    if (!finiteNumber(link.weight) || Number(link.weight) < 0) errors.push(`links[${index}].weight must be >= 0`);\n    if (link.latencyMs !== undefined && (!finiteNumber(link.latencyMs) || Number(link.latencyMs) < 0)) errors.push(`links[${index}].latencyMs must be >= 0`);''')
replace(model,
'''      else link.upgradeOptions.forEach((option, optionIndex) => {\n        if (!isRecord(option) || !finiteNumber(option.capacityGbps) || Number(option.capacityGbps) <= Number(link.capacityGbps) || !finiteNumber(option.cost) || Number(option.cost) < 0) {\n          errors.push(`links[${index}].upgradeOptions[${optionIndex}] must have capacity above current capacity and non-negative cost`);\n        }\n      });''',
'''      else {\n        if (link.upgradeOptions.length > MODEL_LIMITS.upgradeOptionsPerLink) errors.push(`links[${index}].upgradeOptions must contain at most ${MODEL_LIMITS.upgradeOptionsPerLink} entries`);\n        let priorCapacity = Number(link.capacityGbps);\n        link.upgradeOptions.forEach((option, optionIndex) => {\n          if (!isRecord(option) || !finiteNumber(option.capacityGbps) || Number(option.capacityGbps) <= Number(link.capacityGbps) || !finiteNumber(option.cost) || Number(option.cost) < 0) {\n            errors.push(`links[${index}].upgradeOptions[${optionIndex}] must have capacity above current capacity and non-negative cost`);\n            return;\n          }\n          rejectUnknownKeys(option, ['capacityGbps', 'cost'], `links[${index}].upgradeOptions[${optionIndex}]`, errors);\n          if (Number(option.capacityGbps) <= priorCapacity) errors.push(`links[${index}].upgradeOptions must use unique strictly increasing capacities`);\n          priorCapacity = Number(option.capacityGbps);\n        });\n      }''')
replace(model,
'''    if (!nonEmptyString(demand.id)) errors.push(`demands[${index}].id must be non-empty`);''',
'''    rejectUnknownKeys(demand, ['id', 'name', 'source', 'target', 'bandwidthGbps', 'serviceClassId'], `demands[${index}]`, errors);\n    checkBoundedString(demand.id, MODEL_LIMITS.idLength, `demands[${index}].id`, errors);\n    if (!nonEmptyString(demand.id)) {}''')
replace(model,
'''    if (!nonEmptyString(demand.id)) {}\n    else if (demandIds.has(demand.id)) errors.push(`duplicate demand id ${demand.id}`);\n    else demandIds.add(demand.id);''',
'''    if (nonEmptyString(demand.id)) { if (demandIds.has(demand.id)) errors.push(`duplicate demand id ${demand.id}`); else demandIds.add(demand.id); }\n    if (demand.name !== undefined && (typeof demand.name !== 'string' || demand.name.length > MODEL_LIMITS.nameLength)) errors.push(`demands[${index}].name must be a string of at most ${MODEL_LIMITS.nameLength} characters`);''')
# routing profile unknown keys
replace(model,
'''  const routingMode = (value.routingProfile as Record<string, unknown>).mode;''',
'''  const routing = value.routingProfile as Record<string, unknown>;\n  rejectUnknownKeys(routing, ['mode'], 'routingProfile', errors);\n  const routingMode = routing.mode;''')
# null-prototype canonical objects
replace(model,
'''    return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {\n      out[key] = stableValue(value[key]);\n      return out;\n    }, {});''',
'''    return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {\n      Object.defineProperty(out, key, { value: stableValue(value[key]), enumerable: true, configurable: true, writable: true });\n      return out;\n    }, Object.create(null) as Record<string, unknown>);''')
replace(model,
'''  return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {\n    if (!PRESENTATION_METADATA_KEYS.has(key)) out[key] = stripPresentationMetadata(value[key]);\n    return out;\n  }, {});''',
'''  return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {\n    if (!PRESENTATION_METADATA_KEYS.has(key)) Object.defineProperty(out, key, { value: stripPresentationMetadata(value[key]), enumerable: true, configurable: true, writable: true });\n    return out;\n  }, Object.create(null) as Record<string, unknown>);''')

# --- optimizer: unavailable-node parity + independent LP primal verification ---
opt = 'packages/optimizer/src/index.ts'
replace(opt,
'''export interface TrafficAllocationResult {\n  diagnostics: SolverDiagnostics;\n  maxUtilizationPct: number | null;\n  allocations: Array<{ demandId: string; linkId: string; direction: 'forward' | 'reverse'; flowGbps: number }>;\n}''',
'''export interface TrafficAllocationVerification {\n  valid: boolean;\n  nonnegativeFlows: boolean;\n  flowConservation: boolean;\n  capacityConstraints: boolean;\n  objectiveConsistent: boolean;\n  computedMaxUtilizationPct: number | null;\n  violations: string[];\n}\n\nexport interface TrafficAllocationResult {\n  diagnostics: SolverDiagnostics;\n  maxUtilizationPct: number | null;\n  allocations: Array<{ demandId: string; linkId: string; direction: 'forward' | 'reverse'; flowGbps: number }>;\n  verification: TrafficAllocationVerification | null;\n}''')
replace(opt,
'''function activeArcs(project: NetworkProject): Array<{ linkId: string; source: string; target: string; direction: 'forward' | 'reverse' }> {\n  const arcs: Array<{ linkId: string; source: string; target: string; direction: 'forward' | 'reverse' }> = [];\n  for (const link of project.links) {\n    if (link.available === false) continue;''',
'''function activeArcs(project: NetworkProject): Array<{ linkId: string; source: string; target: string; direction: 'forward' | 'reverse' }> {\n  const arcs: Array<{ linkId: string; source: string; target: string; direction: 'forward' | 'reverse' }> = [];\n  const availableNodes = new Set(project.nodes.filter((node) => node.available !== false).map((node) => node.id));\n  for (const link of project.links) {\n    if (link.available === false || !availableNodes.has(link.source) || !availableNodes.has(link.target)) continue;''')
replace(opt,
'''export async function optimizeRouting(project: NetworkProject, options: SolverRunOptions = {}): Promise<TrafficAllocationResult> {\n  const timeLimitMs = Math.max(50, options.timeLimitMs ?? 5_000);\n  const { problem, variables } = buildTrafficAllocationLP(project);\n  const startedAt = performanceNow();\n  const highs = await loadHighs(options);\n  const raw = highs.solve(problem, { output_flag: false, time_limit: timeLimitMs / 1000 });\n  const diagnostics = diagnosticsFrom(raw, project, [null], problem, startedAt, timeLimitMs);\n  const allocations = variables.map((variable) => ({ ...variable, flowGbps: round(numeric(raw.Columns?.[variable.name]?.Primal) ?? 0) })).filter((row) => row.flowGbps > 1e-8);\n  const t = numeric(raw.Columns?.t?.Primal);\n  return { diagnostics, maxUtilizationPct: t === null ? null : round(t * 100), allocations };\n}''',
'''export function verifyTrafficAllocationSolution(\n  project: NetworkProject,\n  allocations: TrafficAllocationResult['allocations'],\n  maxUtilizationPct: number | null,\n  tolerance = 1e-6,\n): TrafficAllocationVerification {\n  const violations: string[] = [];\n  const arcs = activeArcs(project);\n  const arcKey = new Set(arcs.map((arc) => `${arc.linkId}:${arc.direction}:${arc.source}:${arc.target}`));\n  const demandById = new Map(project.demands.map((demand) => [demand.id, demand]));\n  const linkById = new Map(project.links.map((link) => [link.id, link]));\n  const flowByDemandNode = new Map<string, number>();\n  const linkLoads = new Map<string, number>();\n  let nonnegativeFlows = true;\n\n  for (const row of allocations) {\n    if (!Number.isFinite(row.flowGbps) || row.flowGbps < -tolerance) { nonnegativeFlows = false; violations.push(`Non-finite or negative flow for ${row.demandId}/${row.linkId}.`); continue; }\n    const demand = demandById.get(row.demandId);\n    const link = linkById.get(row.linkId);\n    if (!demand || !link) { violations.push(`Allocation references unknown demand/link ${row.demandId}/${row.linkId}.`); continue; }\n    const source = row.direction === 'forward' ? link.source : link.target;\n    const target = row.direction === 'forward' ? link.target : link.source;\n    if (!arcKey.has(`${row.linkId}:${row.direction}:${source}:${target}`)) { violations.push(`Allocation uses unavailable or invalid arc ${row.linkId}/${row.direction}.`); continue; }\n    flowByDemandNode.set(`${row.demandId}:${source}`, (flowByDemandNode.get(`${row.demandId}:${source}`) ?? 0) + row.flowGbps);\n    flowByDemandNode.set(`${row.demandId}:${target}`, (flowByDemandNode.get(`${row.demandId}:${target}`) ?? 0) - row.flowGbps);\n    linkLoads.set(row.linkId, (linkLoads.get(row.linkId) ?? 0) + row.flowGbps);\n  }\n\n  let flowConservation = true;\n  for (const demand of project.demands) {\n    for (const node of project.nodes) {\n      const expected = node.id === demand.source ? demand.bandwidthGbps : node.id === demand.target ? -demand.bandwidthGbps : 0;\n      const actual = flowByDemandNode.get(`${demand.id}:${node.id}`) ?? 0;\n      if (Math.abs(actual - expected) > tolerance) { flowConservation = false; violations.push(`Flow conservation failed for ${demand.id} at ${node.id}: ${actual} vs ${expected}.`); }\n    }\n  }\n\n  let capacityConstraints = true;\n  let computedMaxUtilizationPct = 0;\n  for (const link of project.links) {\n    if (link.available === false) continue;\n    const load = linkLoads.get(link.id) ?? 0;\n    const utilization = (load / link.capacityGbps) * 100;\n    computedMaxUtilizationPct = Math.max(computedMaxUtilizationPct, utilization);\n    if (maxUtilizationPct !== null && load > link.capacityGbps * (maxUtilizationPct / 100) + tolerance) { capacityConstraints = false; violations.push(`Capacity envelope failed for ${link.id}.`); }\n  }\n  const objectiveConsistent = maxUtilizationPct !== null && Math.abs(computedMaxUtilizationPct - maxUtilizationPct) <= Math.max(tolerance, 1e-5);\n  if (!objectiveConsistent) violations.push(`Reported max utilization ${maxUtilizationPct} does not match calculated ${computedMaxUtilizationPct}.`);\n  return { valid: nonnegativeFlows && flowConservation && capacityConstraints && objectiveConsistent && violations.length === 0, nonnegativeFlows, flowConservation, capacityConstraints, objectiveConsistent, computedMaxUtilizationPct: round(computedMaxUtilizationPct), violations };\n}\n\nexport async function optimizeRouting(project: NetworkProject, options: SolverRunOptions = {}): Promise<TrafficAllocationResult> {\n  const timeLimitMs = Math.max(50, options.timeLimitMs ?? 5_000);\n  const { problem, variables } = buildTrafficAllocationLP(project);\n  const startedAt = performanceNow();\n  const highs = await loadHighs(options);\n  const raw = highs.solve(problem, { output_flag: false, time_limit: timeLimitMs / 1000 });\n  let diagnostics = diagnosticsFrom(raw, project, [null], problem, startedAt, timeLimitMs);\n  const allocations = variables.map((variable) => ({ ...variable, flowGbps: round(numeric(raw.Columns?.[variable.name]?.Primal) ?? 0) })).filter((row) => row.flowGbps > 1e-8);\n  const t = numeric(raw.Columns?.t?.Primal);\n  const maxUtilizationPct = t === null ? null : round(t * 100);\n  const hasSolution = diagnostics.proof === 'optimal' || diagnostics.proof === 'feasible-incumbent';\n  const verification = hasSolution ? verifyTrafficAllocationSolution(project, allocations, maxUtilizationPct) : null;\n  if (verification && !verification.valid) {\n    diagnostics = { ...diagnostics, proof: 'unknown', status: `Invalid primal (${diagnostics.status})`, message: `Solver primal failed independent verification: ${verification.violations.join(' ')}` };\n  }\n  return { diagnostics, maxUtilizationPct, allocations, verification };\n}''')

# --- WebMCP + UI path reporting ---
webmcp = 'packages/webmcp/src/index.ts'
replace(webmcp,
'''    equalCostPathCount: number;''',
'''    equalCostPathCount: number | null;\n    equalCostPathCountExact: string;\n    materializedPathCount: number;\n    pathsTruncated: boolean;''')
replace(webmcp,
'''        equalCostPathCount: route?.paths.length ?? 0,''',
'''        equalCostPathCount: route?.equalCostPathCount ?? 0,\n        equalCostPathCountExact: route?.equalCostPathCountExact ?? '0',\n        materializedPathCount: route?.materializedPathCount ?? 0,\n        pathsTruncated: route?.pathsTruncated ?? false,''')

workbench = 'apps/web/components/workbench.tsx'
replace(workbench,
'''<small>{route?.reachable ? `${route.paths.length || 1} equal-cost path(s) · ${links.join(' / ') || 'local'}` : 'unreachable'} · {serviceClass?.name ?? demand.serviceClassId} ≤ {serviceClass?.maxUtilizationPct ?? 100}%</small>''',
'''<small>{route?.reachable ? `${route.equalCostPathCountExact} equal-cost path(s)${route.pathsTruncated ? ` · showing ${route.materializedPathCount}` : ''} · ${links.join(' / ') || 'local'}` : 'unreachable'} · {serviceClass?.name ?? demand.serviceClassId} ≤ {serviceClass?.maxUtilizationPct ?? 100}%</small>''')

# --- JSON schema mirrors canonical validator bounds ---
schema = Path('packages/model/network-model.schema.json')
text = schema.read_text()
text = text.replace('"minLength": 1\n    },\n    "name"', '"minLength": 1,\n      "maxLength": 128\n    },\n    "name"', 1)
text = text.replace('"minLength": 1\n    },\n    "nodes"', '"minLength": 1,\n      "maxLength": 512\n    },\n    "nodes"', 1)
text = text.replace('"upgradeOptions": {\n          "type": "array",', '"upgradeOptions": {\n          "type": "array",\n          "maxItems": 64,')
schema.write_text(text)

# Make the first repro assert the now-explicit exact count shape without a type trick.
test_path = Path('tests/level3-adversarial-findings.test.ts')
t = test_path.read_text()
t = t.replace("  const route = routeProject(manyPathProject()).routes[0] as typeof routeProject extends (...args: never[]) => infer R ? R extends { routes: Array<infer T> } ? T & Record<string, unknown> : never : never;", "  const route = routeProject(manyPathProject()).routes[0];")
t = t.replace("  assert.equal(route.equalCostPathCount, '128');", "  assert.equal(route.equalCostPathCountExact, '128');\n  assert.equal(route.equalCostPathCount, 128);")
test_path.write_text(t)
