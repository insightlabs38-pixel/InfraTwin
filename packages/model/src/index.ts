export interface NodeModel {
  id: string;
  name: string;
  region?: string;
  type?: string;
  available?: boolean;
  x?: number;
  y?: number;
}

export interface LinkUpgradeOption {
  capacityGbps: number;
  cost: number;
}

export interface CandidateLinkOption {
  id: string;
  source: string;
  target: string;
  bidirectional?: boolean;
  capacityGbps: number;
  weight: number;
  cost: number;
  upgradeOptions?: LinkUpgradeOption[];
  metadata?: Record<string, unknown>;
}

export interface MitigationActionClasses {
  capacityUpgrades: boolean;
  routingChanges: boolean;
  newLinks: boolean;
}

export interface LinkModel {
  id: string;
  source: string;
  target: string;
  bidirectional?: boolean;
  capacityGbps: number;
  latencyMs?: number;
  weight: number;
  available?: boolean;
  upgradeOptions?: LinkUpgradeOption[];
}

export interface DemandModel {
  id: string;
  name?: string;
  source: string;
  target: string;
  bandwidthGbps: number;
  serviceClassId: string;
}

export interface ServiceClassModel {
  id: string;
  name: string;
  priority: number;
  maxUtilizationPct: number;
  allowShedding?: boolean;
}

export interface RoutingProfile {
  mode: 'single-shortest-path' | 'ecmp';
}

export interface NetworkProject {
  schemaVersion: '0.1';
  id: string;
  name: string;
  nodes: NodeModel[];
  links: LinkModel[];
  demands: DemandModel[];
  serviceClasses: ServiceClassModel[];
  routingProfile: RoutingProfile;
  metadata?: Record<string, unknown>;
}

export interface ScenarioPatch {
  id: string;
  name: string;
  disabledNodeIds: string[];
  disabledLinkIds: string[];
  /** Explicit restoration relative to a base project. Optional for Level 0–3 patch compatibility. */
  enabledNodeIds?: string[];
  enabledLinkIds?: string[];
  demandMultipliers: Array<{ demandId: string; multiplier: number }>;
  /** Exact bandwidth is only needed when a zero-bandwidth base demand cannot be represented by a multiplier. */
  demandBandwidthOverrides?: Array<{ demandId: string; bandwidthGbps: number }>;
  addedDemands: DemandModel[];
  /** Declared design links selected by an adaptive design proposal. */
  addedLinks?: LinkModel[];
  linkCapacityOverrides: Array<{ linkId: string; capacityGbps: number }>;
}

export type ModelCommandType =
  | 'set_link_availability'
  | 'set_link_capacity'
  | 'set_demand_bandwidth'
  | 'add_link'
  | 'add_demand';

export interface ModelCommand {
  id: string;
  type: ModelCommandType;
  actor: 'human' | 'agent';
  args: Record<string, unknown>;
  createdAt: string;
}

export interface CandidatePlan {
  id: string;
  name: string;
  baseModelHash: string;
  commands: ModelCommand[];
  objective: { name: string; value: number; unit?: string };
  rationaleEvidenceIds: string[];
}

export type PlanActor = 'human' | 'agent';
export type PlanHistoryActor = PlanActor | 'system';
export type ChangePlanStatus = 'draft' | 'analyzed' | 'failing' | 'candidate' | 'verified';

interface PlanChangeBase {
  id: string;
  actor: PlanActor;
  createdAt: string;
  rationaleEvidenceIds?: string[];
}

export type PlanChange =
  | (PlanChangeBase & { type: 'disable_link' | 'enable_link'; target: { kind: 'link'; id: string }; payload: Record<string, never> })
  | (PlanChangeBase & { type: 'disable_node' | 'enable_node'; target: { kind: 'node'; id: string }; payload: Record<string, never> })
  | (PlanChangeBase & { type: 'set_link_capacity'; target: { kind: 'link'; id: string }; payload: { capacityGbps: number } })
  | (PlanChangeBase & { type: 'set_demand_bandwidth'; target: { kind: 'demand'; id: string }; payload: { bandwidthGbps: number } })
  | (PlanChangeBase & { type: 'add_demand'; target: { kind: 'demand'; id: string }; payload: { demand: DemandModel } })
  | (PlanChangeBase & { type: 'add_link'; target: { kind: 'link'; id: string }; payload: { link: LinkModel; declaredCost: number } })
  | (PlanChangeBase & { type: 'demand_growth'; target: { kind: 'demands'; ids: string[] }; payload: { multiplier: number } });

export interface PlanConstraints {
  targetUtilizationPct: number;
  budgetCostUnits: number | null;
  requireN1: boolean;
  protectedServiceClassIds: string[];
  /** Human-controlled Level 4A design-space boundary. */
  allowedMitigationActions: MitigationActionClasses;
  /** Bounded deterministic candidate paths per demand. */
  maxCandidatePaths: number;
  /** Explicit candidate links the optimizer may choose; endpoints/costs are never fabricated. */
  candidateLinkOptions: CandidateLinkOption[];
}

export interface PlanRestrictions {
  lockedLinkIds: string[];
  lockedNodeIds: string[];
  /** Routing avoidance is distinct from a modification lock. */
  forbiddenRoutingLinkIds: string[];
  forbiddenRoutingNodeIds: string[];
}

export type PlanProposalState = 'pending' | 'accepted' | 'rejected';

export interface PlanProposal {
  id: string;
  candidateId: string;
  sourcePlanHash: string;
  change: PlanChange;
  state: PlanProposalState;
  createdAt: string;
  decidedAt?: string;
}

export interface PlanHistoryEvent {
  id: string;
  actor: PlanHistoryActor;
  occurredAt: string;
  action: string;
  summary: string;
  relatedId?: string;
}

export interface ChangePlan {
  id: string;
  name: string;
  baseModelHash: string;
  changes: PlanChange[];
  constraints: PlanConstraints;
  restrictions: PlanRestrictions;
  proposals: PlanProposal[];
  history: PlanHistoryEvent[];
  status: ChangePlanStatus;
  createdAt: string;
  updatedAt: string;
}

export interface PlanEvidenceStamp {
  baseModelHash: string;
  planHash: string;
}

export interface PlanRevisionStamp extends PlanEvidenceStamp {
  revisionHash: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export const MODEL_LIMITS = {
  nodes: 500, links: 2000, demands: 2000, serviceClasses: 64, upgradeOptionsPerLink: 64,
  idLength: 128, nameLength: 512, metadataDepth: 32, metadataEntries: 4096, metadataStringLength: 16_384,
} as const;

function rejectUnknownKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, errors: string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) errors.push(`${label}.${key} is not a recognized canonical property`);
}

function validateMetadata(value: unknown, errors: string[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) { errors.push('metadata must be an object'); return; }
  const stack: Array<{ value: unknown; depth: number; path: string }> = [{ value, depth: 0, path: 'metadata' }];
  let entries = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (item.depth > MODEL_LIMITS.metadataDepth) { errors.push(`metadata nesting exceeds ${MODEL_LIMITS.metadataDepth}`); return; }
    if (Array.isArray(item.value)) {
      entries += item.value.length;
      if (entries > MODEL_LIMITS.metadataEntries) { errors.push(`metadata contains more than ${MODEL_LIMITS.metadataEntries} entries`); return; }
      item.value.forEach((child, index) => stack.push({ value: child, depth: item.depth + 1, path: `${item.path}[${index}]` }));
    } else if (isRecord(item.value)) {
      const keys = Object.keys(item.value);
      entries += keys.length;
      if (entries > MODEL_LIMITS.metadataEntries) { errors.push(`metadata contains more than ${MODEL_LIMITS.metadataEntries} entries`); return; }
      for (const key of keys) {
        if (key.length > MODEL_LIMITS.nameLength) errors.push(`${item.path} contains an overlong key`);
        stack.push({ value: item.value[key], depth: item.depth + 1, path: `${item.path}.${key}` });
      }
    } else if (typeof item.value === 'string') {
      if (item.value.length > MODEL_LIMITS.metadataStringLength) errors.push(`${item.path} string exceeds ${MODEL_LIMITS.metadataStringLength} characters`);
    } else if (typeof item.value === 'number' && !Number.isFinite(item.value)) {
      errors.push(`${item.path} must not contain non-finite numbers`);
    } else if (typeof item.value === 'function' || typeof item.value === 'symbol' || typeof item.value === 'bigint' || item.value === undefined) {
      errors.push(`${item.path} contains a value that is not JSON data`);
    }
  }
}

function checkBoundedString(value: unknown, max: number, label: string, errors: string[], optional = false): void {
  if (optional && value === undefined) return;
  if (!nonEmptyString(value)) { errors.push(`${label} must be non-empty`); return; }
  if (value.length > max) errors.push(`${label} must be at most ${max} characters`);
}

export function validateNetworkProject(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['project must be an object'] };
  if (value.schemaVersion !== '0.1') errors.push('schemaVersion must equal 0.1');
  checkBoundedString(value.id, MODEL_LIMITS.idLength, 'id', errors);
  checkBoundedString(value.name, MODEL_LIMITS.nameLength, 'name', errors);
  if (!Array.isArray(value.nodes)) errors.push('nodes must be an array');
  if (!Array.isArray(value.links)) errors.push('links must be an array');
  if (!Array.isArray(value.demands)) errors.push('demands must be an array');
  if (!Array.isArray(value.serviceClasses)) errors.push('serviceClasses must be an array');
  if (!isRecord(value.routingProfile) || !['single-shortest-path', 'ecmp'].includes(String(value.routingProfile.mode))) {
    errors.push('routingProfile.mode must be single-shortest-path or ecmp');
  }
  if (errors.length) return { valid: false, errors };
  rejectUnknownKeys(value, ['schemaVersion', 'id', 'name', 'nodes', 'links', 'demands', 'serviceClasses', 'routingProfile', 'metadata'], 'project', errors);
  validateMetadata(value.metadata, errors);

  const nodes = value.nodes as unknown[];
  const links = value.links as unknown[];
  const demands = value.demands as unknown[];
  const classes = value.serviceClasses as unknown[];
  const nodeIds = new Set<string>();
  const linkIds = new Set<string>();
  const demandIds = new Set<string>();
  const classIds = new Set<string>();

  if (nodes.length > MODEL_LIMITS.nodes) errors.push(`nodes must contain at most ${MODEL_LIMITS.nodes} entries for browser-local analysis`);
  if (links.length > MODEL_LIMITS.links) errors.push(`links must contain at most ${MODEL_LIMITS.links} entries for browser-local analysis`);
  if (demands.length > MODEL_LIMITS.demands) errors.push(`demands must contain at most ${MODEL_LIMITS.demands} entries for browser-local analysis`);
  if (classes.length > MODEL_LIMITS.serviceClasses) errors.push(`serviceClasses must contain at most ${MODEL_LIMITS.serviceClasses} entries`);
  const routing = value.routingProfile as Record<string, unknown>;
  rejectUnknownKeys(routing, ['mode'], 'routingProfile', errors);
  const routingMode = routing.mode;

  nodes.forEach((node, index) => {
    if (!isRecord(node)) return void errors.push(`nodes[${index}] must be an object`);
    rejectUnknownKeys(node, ['id', 'name', 'region', 'type', 'available', 'x', 'y'], `nodes[${index}]`, errors);
    checkBoundedString(node.id, MODEL_LIMITS.idLength, `nodes[${index}].id`, errors);
    if (nonEmptyString(node.id)) { if (nodeIds.has(node.id)) errors.push(`duplicate node id ${node.id}`); else nodeIds.add(node.id); }
    checkBoundedString(node.name, MODEL_LIMITS.nameLength, `nodes[${index}].name`, errors);
    if (node.region !== undefined && typeof node.region !== 'string') errors.push(`nodes[${index}].region must be a string`);
    if (node.type !== undefined && typeof node.type !== 'string') errors.push(`nodes[${index}].type must be a string`);
    if (node.available !== undefined && typeof node.available !== 'boolean') errors.push(`nodes[${index}].available must be boolean`);
    if (node.x !== undefined && !finiteNumber(node.x)) errors.push(`nodes[${index}].x must be finite`);
    if (node.y !== undefined && !finiteNumber(node.y)) errors.push(`nodes[${index}].y must be finite`);
  });

  classes.forEach((serviceClass, index) => {
    if (!isRecord(serviceClass)) return void errors.push(`serviceClasses[${index}] must be an object`);
    rejectUnknownKeys(serviceClass, ['id', 'name', 'priority', 'maxUtilizationPct', 'allowShedding'], `serviceClasses[${index}]`, errors);
    checkBoundedString(serviceClass.id, MODEL_LIMITS.idLength, `serviceClasses[${index}].id`, errors);
    if (nonEmptyString(serviceClass.id)) { if (classIds.has(serviceClass.id)) errors.push(`duplicate service class id ${serviceClass.id}`); else classIds.add(serviceClass.id); }
    checkBoundedString(serviceClass.name, MODEL_LIMITS.nameLength, `serviceClasses[${index}].name`, errors);
    if (!Number.isInteger(serviceClass.priority) || Number(serviceClass.priority) < 0) errors.push(`serviceClasses[${index}].priority must be a non-negative integer`);
    if (serviceClass.allowShedding !== undefined && typeof serviceClass.allowShedding !== 'boolean') errors.push(`serviceClasses[${index}].allowShedding must be boolean`);
    if (!finiteNumber(serviceClass.maxUtilizationPct) || Number(serviceClass.maxUtilizationPct) <= 0 || Number(serviceClass.maxUtilizationPct) > 100) {
      errors.push(`serviceClasses[${index}].maxUtilizationPct must be in (0,100]`);
    }
  });

  links.forEach((link, index) => {
    if (!isRecord(link)) return void errors.push(`links[${index}] must be an object`);
    rejectUnknownKeys(link, ['id', 'source', 'target', 'bidirectional', 'capacityGbps', 'latencyMs', 'weight', 'available', 'upgradeOptions'], `links[${index}]`, errors);
    checkBoundedString(link.id, MODEL_LIMITS.idLength, `links[${index}].id`, errors);
    if (nonEmptyString(link.id)) { if (linkIds.has(link.id)) errors.push(`duplicate link id ${link.id}`); else linkIds.add(link.id); }
    if (!nonEmptyString(link.source) || !nodeIds.has(String(link.source))) errors.push(`links[${index}].source must reference a node`);
    if (!nonEmptyString(link.target) || !nodeIds.has(String(link.target))) errors.push(`links[${index}].target must reference a node`);
    if (nonEmptyString(link.source) && nonEmptyString(link.target) && link.source === link.target) errors.push(`links[${index}] must not be a self-link`);
    if (!finiteNumber(link.capacityGbps) || Number(link.capacityGbps) <= 0) errors.push(`links[${index}].capacityGbps must be > 0`);
    if (!finiteNumber(link.weight) || Number(link.weight) < 0) errors.push(`links[${index}].weight must be >= 0`);
    if (link.latencyMs !== undefined && (!finiteNumber(link.latencyMs) || Number(link.latencyMs) < 0)) errors.push(`links[${index}].latencyMs must be >= 0`);
    if (routingMode === 'ecmp' && finiteNumber(link.weight) && Number(link.weight) <= 0) errors.push(`links[${index}].weight must be > 0 when routingProfile.mode is ecmp`);
    if (link.bidirectional !== undefined && typeof link.bidirectional !== 'boolean') errors.push(`links[${index}].bidirectional must be boolean`);
    if (link.available !== undefined && typeof link.available !== 'boolean') errors.push(`links[${index}].available must be boolean`);
    if (link.upgradeOptions !== undefined) {
      if (!Array.isArray(link.upgradeOptions)) errors.push(`links[${index}].upgradeOptions must be an array`);
      else {
        if (link.upgradeOptions.length > MODEL_LIMITS.upgradeOptionsPerLink) errors.push(`links[${index}].upgradeOptions must contain at most ${MODEL_LIMITS.upgradeOptionsPerLink} entries`);
        let priorCapacity = Number(link.capacityGbps);
        link.upgradeOptions.forEach((option, optionIndex) => {
          if (!isRecord(option) || !finiteNumber(option.capacityGbps) || Number(option.capacityGbps) <= Number(link.capacityGbps) || !finiteNumber(option.cost) || Number(option.cost) < 0) {
            errors.push(`links[${index}].upgradeOptions[${optionIndex}] must have capacity above current capacity and non-negative cost`);
            return;
          }
          rejectUnknownKeys(option, ['capacityGbps', 'cost'], `links[${index}].upgradeOptions[${optionIndex}]`, errors);
          if (Number(option.capacityGbps) <= priorCapacity) errors.push(`links[${index}].upgradeOptions must use unique strictly increasing capacities`);
          priorCapacity = Number(option.capacityGbps);
        });
      }
    }
  });

  demands.forEach((demand, index) => {
    if (!isRecord(demand)) return void errors.push(`demands[${index}] must be an object`);
    rejectUnknownKeys(demand, ['id', 'name', 'source', 'target', 'bandwidthGbps', 'serviceClassId'], `demands[${index}]`, errors);
    checkBoundedString(demand.id, MODEL_LIMITS.idLength, `demands[${index}].id`, errors);
    if (nonEmptyString(demand.id)) { if (demandIds.has(demand.id)) errors.push(`duplicate demand id ${demand.id}`); else demandIds.add(demand.id); }
    if (demand.name !== undefined && (typeof demand.name !== 'string' || demand.name.length > MODEL_LIMITS.nameLength)) errors.push(`demands[${index}].name must be a string of at most ${MODEL_LIMITS.nameLength} characters`);
    if (!nonEmptyString(demand.source) || !nodeIds.has(String(demand.source))) errors.push(`demands[${index}].source must reference a node`);
    if (!nonEmptyString(demand.target) || !nodeIds.has(String(demand.target))) errors.push(`demands[${index}].target must reference a node`);
    if (!finiteNumber(demand.bandwidthGbps) || Number(demand.bandwidthGbps) < 0) errors.push(`demands[${index}].bandwidthGbps must be >= 0`);
    if (!nonEmptyString(demand.serviceClassId) || !classIds.has(String(demand.serviceClassId))) errors.push(`demands[${index}].serviceClassId must reference a service class`);
  });

  return { valid: errors.length === 0, errors };
}

export function assertValidNetworkProject(value: unknown): asserts value is NetworkProject {
  const result = validateNetworkProject(value);
  if (!result.valid) throw new Error(`Invalid network project: ${result.errors.join('; ')}`);
}

export function cloneProject(project: NetworkProject): NetworkProject {
  return JSON.parse(JSON.stringify(project)) as NetworkProject;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (isRecord(value)) {
    return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {
      Object.defineProperty(out, key, { value: stableValue(value[key]), enumerable: true, configurable: true, writable: true });
      return out;
    }, Object.create(null) as Record<string, unknown>);
  }
  return value;
}

export function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const PRESENTATION_METADATA_KEYS = new Set(['ui', 'layout', 'presentation', 'viewport', 'canvas', 'positions', 'nodePositions']);

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let i = 0; i < 16; i += 1) words[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotateRight(words[i - 15], 7) ^ rotateRight(words[i - 15], 18) ^ (words[i - 15] >>> 3);
      const s1 = rotateRight(words[i - 2], 17) ^ rotateRight(words[i - 2], 19) ^ (words[i - 2] >>> 10);
      words[i] = (words[i - 16] + s0 + words[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + SHA256_K[i] + words[i]) >>> 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0; d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    state[0] = (state[0] + a) >>> 0; state[1] = (state[1] + b) >>> 0; state[2] = (state[2] + c) >>> 0; state[3] = (state[3] + d) >>> 0;
    state[4] = (state[4] + e) >>> 0; state[5] = (state[5] + f) >>> 0; state[6] = (state[6] + g) >>> 0; state[7] = (state[7] + h) >>> 0;
  }
  return Array.from(state, (value) => value.toString(16).padStart(8, '0')).join('');
}

function stripPresentationMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripPresentationMetadata);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((out, key) => {
    if (!PRESENTATION_METADATA_KEYS.has(key)) Object.defineProperty(out, key, { value: stripPresentationMetadata(value[key]), enumerable: true, configurable: true, writable: true });
    return out;
  }, Object.create(null) as Record<string, unknown>);
}

export function semanticProjectValue(project: NetworkProject): NetworkProject {
  const semantic = cloneProject(project);
  semantic.nodes = semantic.nodes.map(({ x: _x, y: _y, ...node }) => node);
  if (semantic.metadata) semantic.metadata = stripPresentationMetadata(semantic.metadata) as Record<string, unknown>;
  return semantic;
}

export function semanticStableStringify(project: NetworkProject): string {
  return stableStringify(semanticProjectValue(project));
}

export function semanticModelHash(project: NetworkProject): string {
  return `sha256:${sha256Hex(semanticStableStringify(project))}`;
}

export function projectDocumentHash(project: NetworkProject): string {
  return `sha256:${sha256Hex(stableStringify(project))}`;
}

export async function semanticModelHashWebCrypto(project: NetworkProject): Promise<string> {
  if (!globalThis.crypto?.subtle) return semanticModelHash(project);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(semanticStableStringify(project)));
  return `sha256:${Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('')}`;
}

// Backward-compatible name used throughout Level 0–3 evidence and stale-result checks.
// It now means semantic engineering identity, not byte identity of the UI document.
export function modelHash(project: NetworkProject): string {
  return semanticModelHash(project);
}

export function createScenarioPatch(id: string, name: string): ScenarioPatch {
  return { id, name, disabledNodeIds: [], disabledLinkIds: [], demandMultipliers: [], addedDemands: [], linkCapacityOverrides: [] };
}

export function scenarioHash(patch?: ScenarioPatch | null): string {
  return patch ? `sha256:${sha256Hex(stableStringify(patch))}` : 'baseline';
}

export function applyScenario(project: NetworkProject, patch?: ScenarioPatch | null): NetworkProject {
  if (!patch) return cloneProject(project);
  const snapshot = cloneProject(project);
  const disabledNodes = new Set(patch.disabledNodeIds);
  const disabledLinks = new Set(patch.disabledLinkIds);
  const enabledNodes = new Set(patch.enabledNodeIds ?? []);
  const enabledLinks = new Set(patch.enabledLinkIds ?? []);
  const multipliers = new Map(patch.demandMultipliers.map((item) => [item.demandId, item.multiplier]));
  const bandwidthOverrides = new Map((patch.demandBandwidthOverrides ?? []).map((item) => [item.demandId, item.bandwidthGbps]));
  const capacities = new Map(patch.linkCapacityOverrides.map((item) => [item.linkId, item.capacityGbps]));

  snapshot.nodes = snapshot.nodes.map((node) => enabledNodes.has(node.id) ? { ...node, available: true } : disabledNodes.has(node.id) ? { ...node, available: false } : node);
  if (patch.addedLinks?.length) snapshot.links.push(...patch.addedLinks.map((link) => ({ ...link, ...(link.upgradeOptions ? { upgradeOptions: link.upgradeOptions.map((option) => ({ ...option })) } : {}) })));
  snapshot.links = snapshot.links.map((link) => {
    const capacityGbps = capacities.get(link.id) ?? link.capacityGbps;
    const upgradeOptions = capacities.has(link.id)
      ? link.upgradeOptions?.filter((option) => option.capacityGbps > capacityGbps + 1e-9)
      : link.upgradeOptions;
    return {
      ...link,
      available: enabledLinks.has(link.id) ? true : disabledLinks.has(link.id) ? false : link.available,
      capacityGbps,
      ...(upgradeOptions === undefined ? {} : { upgradeOptions }),
    };
  });
  snapshot.demands = snapshot.demands.map((demand) => ({
    ...demand,
    bandwidthGbps: bandwidthOverrides.get(demand.id) ?? demand.bandwidthGbps * (multipliers.get(demand.id) ?? 1),
  }));
  snapshot.demands.push(...patch.addedDemands.map((demand) => ({ ...demand })));
  assertValidNetworkProject(snapshot);
  return snapshot;
}


function cloneChangePlan(plan: ChangePlan): ChangePlan {
  return JSON.parse(JSON.stringify(plan)) as ChangePlan;
}

function normalizeStringIds(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

function assertPlanBoundToProject(project: NetworkProject, plan: ChangePlan): void {
  const currentHash = modelHash(project);
  if (plan.baseModelHash !== currentHash) throw new Error('Change Plan is stale because its base network changed.');
}

function historyEvent(plan: ChangePlan, actor: PlanHistoryActor, action: string, summary: string, occurredAt: string, relatedId?: string): PlanHistoryEvent {
  const next = plan.history.length + 1;
  return { id: `history-${next}`, actor, occurredAt, action, summary, relatedId };
}

export function describePlanChange(change: PlanChange): string {
  switch (change.type) {
    case 'disable_link': return `Take ${change.target.id} offline`;
    case 'enable_link': return `Restore ${change.target.id}`;
    case 'disable_node': return `Take node ${change.target.id} offline`;
    case 'enable_node': return `Restore node ${change.target.id}`;
    case 'set_link_capacity': return `Set ${change.target.id} capacity to ${change.payload.capacityGbps} Gbps`;
    case 'set_demand_bandwidth': return `Set ${change.target.id} traffic to ${change.payload.bandwidthGbps} Gbps`;
    case 'add_demand': return `Add ${change.payload.demand.name ?? change.payload.demand.id}: ${change.payload.demand.source}→${change.payload.demand.target} ${change.payload.demand.bandwidthGbps} Gbps`;
    case 'add_link': return `Add declared link ${change.payload.link.id}: ${change.payload.link.source}↔${change.payload.link.target} ${change.payload.link.capacityGbps} Gbps (cost ${change.payload.declaredCost})`;
    case 'demand_growth': return `Grow ${change.target.ids.join(', ')} by ${Math.round((change.payload.multiplier - 1) * 1000) / 10}%`;
  }
}

function semanticPlanChange(change: PlanChange): unknown {
  return { type: change.type, target: change.target, payload: change.payload };
}

export function changePlanSemanticValue(plan: ChangePlan): unknown {
  return {
    changes: plan.changes.map(semanticPlanChange),
    constraints: {
      targetUtilizationPct: plan.constraints.targetUtilizationPct,
      budgetCostUnits: plan.constraints.budgetCostUnits,
      requireN1: plan.constraints.requireN1,
      protectedServiceClassIds: normalizeStringIds(plan.constraints.protectedServiceClassIds),
      allowedMitigationActions: { ...plan.constraints.allowedMitigationActions },
      maxCandidatePaths: plan.constraints.maxCandidatePaths,
      candidateLinkOptions: [...plan.constraints.candidateLinkOptions].sort((a, b) => a.id.localeCompare(b.id)).map((option) => ({ ...option, ...(option.upgradeOptions ? { upgradeOptions: option.upgradeOptions.map((item) => ({ ...item })) } : {}) })),
    },
    restrictions: {
      lockedLinkIds: normalizeStringIds(plan.restrictions.lockedLinkIds),
      lockedNodeIds: normalizeStringIds(plan.restrictions.lockedNodeIds),
      forbiddenRoutingLinkIds: normalizeStringIds(plan.restrictions.forbiddenRoutingLinkIds),
      forbiddenRoutingNodeIds: normalizeStringIds(plan.restrictions.forbiddenRoutingNodeIds),
    },
  };
}

export function changePlanHash(plan: ChangePlan): string {
  return `sha256:${sha256Hex(stableStringify(changePlanSemanticValue(plan)))}`;
}

export function changePlanRevisionHash(plan: ChangePlan): string {
  return `sha256:${sha256Hex(stableStringify({
    semantic: changePlanSemanticValue(plan),
    proposals: plan.proposals.map((proposal) => ({ candidateId: proposal.candidateId, sourcePlanHash: proposal.sourcePlanHash, state: proposal.state, change: semanticPlanChange(proposal.change) })),
  }))}`;
}

export function changePlanEvidenceStamp(project: NetworkProject, plan: ChangePlan): PlanEvidenceStamp {
  return { baseModelHash: modelHash(project), planHash: changePlanHash(plan) };
}

export function changePlanRevisionStamp(project: NetworkProject, plan: ChangePlan): PlanRevisionStamp {
  return { ...changePlanEvidenceStamp(project, plan), revisionHash: changePlanRevisionHash(plan) };
}

export function isPlanEvidenceFresh(stamp: PlanEvidenceStamp | null | undefined, project: NetworkProject, plan: ChangePlan): boolean {
  return Boolean(stamp && stamp.baseModelHash === modelHash(project) && stamp.planHash === changePlanHash(plan));
}

export function isPlanRevisionFresh(stamp: PlanRevisionStamp | null | undefined, project: NetworkProject, plan: ChangePlan): boolean {
  return Boolean(isPlanEvidenceFresh(stamp, project, plan) && stamp?.revisionHash === changePlanRevisionHash(plan));
}

export function createChangePlan(project: NetworkProject, name = 'New Change Plan', options: { id?: string; now?: string } = {}): ChangePlan {
  const now = options.now ?? new Date().toISOString();
  return {
    id: options.id ?? `plan:${project.id}`,
    name: name.trim() || 'New Change Plan',
    baseModelHash: modelHash(project),
    changes: [],
    constraints: { targetUtilizationPct: 80, budgetCostUnits: null, requireN1: false, protectedServiceClassIds: [], allowedMitigationActions: { capacityUpgrades: true, routingChanges: true, newLinks: false }, maxCandidatePaths: 5, candidateLinkOptions: [] },
    restrictions: { lockedLinkIds: [], lockedNodeIds: [], forbiddenRoutingLinkIds: [], forbiddenRoutingNodeIds: [] },
    proposals: [],
    history: [{ id: 'history-1', actor: 'human', occurredAt: now, action: 'created_plan', summary: `Created ${name.trim() || 'New Change Plan'}` }],
    status: 'draft',
    createdAt: now,
    updatedAt: now,
  };
}

export function validateChangePlan(project: NetworkProject, plan: ChangePlan): ValidationResult {
  const errors: string[] = [];
  if (!plan || typeof plan !== 'object') return { valid: false, errors: ['plan must be an object'] };
  if (!nonEmptyString(plan.id)) errors.push('plan.id must be non-empty');
  if (!nonEmptyString(plan.name)) errors.push('plan.name must be non-empty');
  if (plan.baseModelHash !== modelHash(project)) errors.push('plan.baseModelHash does not match the base network');
  if (!finiteNumber(plan.constraints.targetUtilizationPct) || plan.constraints.targetUtilizationPct <= 0 || plan.constraints.targetUtilizationPct > 100) errors.push('plan target utilization must be in (0,100]');
  if (plan.constraints.budgetCostUnits !== null && (!finiteNumber(plan.constraints.budgetCostUnits) || plan.constraints.budgetCostUnits < 0)) errors.push('plan budget must be null or non-negative');
  if (!Number.isInteger(plan.constraints.maxCandidatePaths) || plan.constraints.maxCandidatePaths < 1 || plan.constraints.maxCandidatePaths > 8) errors.push('plan maxCandidatePaths must be an integer in [1,8]');
  const actions = plan.constraints.allowedMitigationActions;
  if (!actions || typeof actions.capacityUpgrades !== 'boolean' || typeof actions.routingChanges !== 'boolean' || typeof actions.newLinks !== 'boolean') errors.push('plan allowedMitigationActions must contain boolean capacityUpgrades/routingChanges/newLinks');
  const nodeIds = new Set(project.nodes.map((node) => node.id));
  const linkIds = new Set(project.links.map((link) => link.id));
  const demandIds = new Set(project.demands.map((demand) => demand.id));
  const classIds = new Set(project.serviceClasses.map((serviceClass) => serviceClass.id));
  for (const id of plan.restrictions.lockedLinkIds) if (!linkIds.has(id)) errors.push(`locked link ${id} does not exist`);
  for (const id of plan.restrictions.lockedNodeIds) if (!nodeIds.has(id)) errors.push(`locked node ${id} does not exist`);
  const candidateLinkIds = new Set<string>();
  for (const option of plan.constraints.candidateLinkOptions) {
    if (!nonEmptyString(option.id) || linkIds.has(option.id) || candidateLinkIds.has(option.id)) errors.push(`candidate link ${option.id || '(empty)'} must have a unique non-canonical id`); else candidateLinkIds.add(option.id);
    if (!nodeIds.has(option.source) || !nodeIds.has(option.target) || option.source === option.target) errors.push(`candidate link ${option.id} endpoints must reference two distinct existing nodes`);
    if (!finiteNumber(option.capacityGbps) || option.capacityGbps <= 0) errors.push(`candidate link ${option.id} capacity must be > 0`);
    if (!finiteNumber(option.weight) || option.weight <= 0) errors.push(`candidate link ${option.id} weight must be > 0`);
    if (!finiteNumber(option.cost) || option.cost < 0) errors.push(`candidate link ${option.id} cost must be >= 0`);
  }
  for (const id of plan.restrictions.forbiddenRoutingLinkIds) if (!linkIds.has(id) && !candidateLinkIds.has(id)) errors.push(`forbidden routing link ${id} does not exist`);
  for (const id of plan.restrictions.forbiddenRoutingNodeIds) if (!nodeIds.has(id)) errors.push(`forbidden routing node ${id} does not exist`);
  for (const id of plan.constraints.protectedServiceClassIds) if (!classIds.has(id)) errors.push(`protected service class ${id} does not exist`);
  const seen = new Set<string>();
  const addedDemandIds = new Set<string>();
  for (const change of plan.changes) {
    if (!nonEmptyString(change.id) || seen.has(change.id)) errors.push(`plan change id ${change.id || '(empty)'} must be unique`); else seen.add(change.id);
    if (!['human', 'agent'].includes(change.actor)) errors.push(`plan change ${change.id} has invalid actor`);
    switch (change.type) {
      case 'disable_link': case 'enable_link': case 'set_link_capacity':
        if (!linkIds.has(change.target.id)) errors.push(`plan change ${change.id} references unknown link ${change.target.id}`);
        if (change.type === 'set_link_capacity' && (!finiteNumber(change.payload.capacityGbps) || change.payload.capacityGbps <= 0)) errors.push(`plan change ${change.id} capacity must be > 0`);
        break;
      case 'disable_node': case 'enable_node':
        if (!nodeIds.has(change.target.id)) errors.push(`plan change ${change.id} references unknown node ${change.target.id}`);
        break;
      case 'set_demand_bandwidth':
        if (!demandIds.has(change.target.id) && !addedDemandIds.has(change.target.id)) errors.push(`plan change ${change.id} references unknown demand ${change.target.id}`);
        if (!finiteNumber(change.payload.bandwidthGbps) || change.payload.bandwidthGbps < 0) errors.push(`plan change ${change.id} bandwidth must be >= 0`);
        break;
      case 'add_link': {
        const link = change.payload.link;
        if (link.id !== change.target.id) errors.push(`plan change ${change.id} link target must match payload id`);
        if (linkIds.has(link.id)) errors.push(`plan change ${change.id} adds duplicate link ${link.id}`);
        if (!nodeIds.has(link.source) || !nodeIds.has(link.target) || link.source === link.target) errors.push(`plan change ${change.id} link endpoints must exist and be distinct`);
        if (!finiteNumber(link.capacityGbps) || link.capacityGbps <= 0 || !finiteNumber(link.weight) || link.weight <= 0) errors.push(`plan change ${change.id} link capacity/weight must be > 0`);
        if (!finiteNumber(change.payload.declaredCost) || change.payload.declaredCost < 0) errors.push(`plan change ${change.id} declaredCost must be >= 0`);
        break;
      }
      case 'add_demand': {
        const demand = change.payload.demand;
        if (demand.id !== change.target.id) errors.push(`plan change ${change.id} demand target must match payload id`);
        if (demandIds.has(demand.id) || addedDemandIds.has(demand.id)) errors.push(`plan change ${change.id} adds duplicate demand ${demand.id}`); else addedDemandIds.add(demand.id);
        if (!nodeIds.has(demand.source) || !nodeIds.has(demand.target)) errors.push(`plan change ${change.id} demand endpoints must exist`);
        if (!classIds.has(demand.serviceClassId)) errors.push(`plan change ${change.id} service class must exist`);
        if (!finiteNumber(demand.bandwidthGbps) || demand.bandwidthGbps < 0) errors.push(`plan change ${change.id} demand bandwidth must be >= 0`);
        break;
      }
      case 'demand_growth':
        if (!finiteNumber(change.payload.multiplier) || change.payload.multiplier < 0) errors.push(`plan change ${change.id} multiplier must be >= 0`);
        if (!change.target.ids.length) errors.push(`plan change ${change.id} must target at least one demand`);
        for (const id of change.target.ids) if (!demandIds.has(id) && !addedDemandIds.has(id)) errors.push(`plan change ${change.id} references unknown demand ${id}`);
        break;
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidChangePlan(project: NetworkProject, plan: ChangePlan): void {
  const result = validateChangePlan(project, plan);
  if (!result.valid) throw new Error(`Invalid Change Plan: ${result.errors.join('; ')}`);
}

export function compileChangePlanToScenarioPatch(project: NetworkProject, plan: ChangePlan): ScenarioPatch {
  assertPlanBoundToProject(project, plan);
  assertValidChangePlan(project, plan);
  const linkAvailability = new Map(project.links.map((link) => [link.id, link.available !== false]));
  const nodeAvailability = new Map(project.nodes.map((node) => [node.id, node.available !== false]));
  const linkCapacity = new Map(project.links.map((link) => [link.id, link.capacityGbps]));
  const baseBandwidth = new Map(project.demands.map((demand) => [demand.id, demand.bandwidthGbps]));
  const demandBandwidth = new Map(baseBandwidth);
  const addedDemands = new Map<string, DemandModel>();
  const addedLinks = new Map<string, LinkModel>();

  for (const change of plan.changes) {
    switch (change.type) {
      case 'disable_link': linkAvailability.set(change.target.id, false); break;
      case 'enable_link': linkAvailability.set(change.target.id, true); break;
      case 'disable_node': nodeAvailability.set(change.target.id, false); break;
      case 'enable_node': nodeAvailability.set(change.target.id, true); break;
      case 'set_link_capacity': linkCapacity.set(change.target.id, change.payload.capacityGbps); break;
      case 'set_demand_bandwidth':
        if (addedDemands.has(change.target.id)) addedDemands.get(change.target.id)!.bandwidthGbps = change.payload.bandwidthGbps;
        else demandBandwidth.set(change.target.id, change.payload.bandwidthGbps);
        break;
      case 'add_link': addedLinks.set(change.payload.link.id, { ...change.payload.link, ...(change.payload.link.upgradeOptions ? { upgradeOptions: change.payload.link.upgradeOptions.map((option) => ({ ...option })) } : {}) }); break;
      case 'add_demand': addedDemands.set(change.payload.demand.id, { ...change.payload.demand }); break;
      case 'demand_growth':
        for (const demandId of change.target.ids) {
          if (addedDemands.has(demandId)) addedDemands.get(demandId)!.bandwidthGbps *= change.payload.multiplier;
          else demandBandwidth.set(demandId, (demandBandwidth.get(demandId) ?? 0) * change.payload.multiplier);
        }
        break;
    }
  }

  const disabledNodeIds: string[] = [];
  const enabledNodeIds: string[] = [];
  for (const node of project.nodes) {
    const final = nodeAvailability.get(node.id) ?? true; const base = node.available !== false;
    if (!final && base) disabledNodeIds.push(node.id);
    if (final && !base) enabledNodeIds.push(node.id);
  }
  const disabledLinkIds: string[] = [];
  const enabledLinkIds: string[] = [];
  for (const link of project.links) {
    const final = linkAvailability.get(link.id) ?? true; const base = link.available !== false;
    if (!final && base) disabledLinkIds.push(link.id);
    if (final && !base) enabledLinkIds.push(link.id);
  }
  const demandMultipliers: Array<{ demandId: string; multiplier: number }> = [];
  const demandBandwidthOverrides: Array<{ demandId: string; bandwidthGbps: number }> = [];
  for (const demand of project.demands) {
    const final = demandBandwidth.get(demand.id) ?? demand.bandwidthGbps;
    if (Math.abs(final - demand.bandwidthGbps) <= 1e-12) continue;
    if (Math.abs(demand.bandwidthGbps) > 1e-12) demandMultipliers.push({ demandId: demand.id, multiplier: final / demand.bandwidthGbps });
    else demandBandwidthOverrides.push({ demandId: demand.id, bandwidthGbps: final });
  }
  const linkCapacityOverrides = project.links.flatMap((link) => {
    const final = linkCapacity.get(link.id) ?? link.capacityGbps;
    return Math.abs(final - link.capacityGbps) <= 1e-12 ? [] : [{ linkId: link.id, capacityGbps: final }];
  });
  const patch: ScenarioPatch = {
    id: `change-plan:${plan.id}:${changePlanHash(plan).split(':')[1].slice(0, 12)}`,
    name: plan.name,
    disabledNodeIds: disabledNodeIds.sort(), disabledLinkIds: disabledLinkIds.sort(),
    demandMultipliers: demandMultipliers.sort((a, b) => a.demandId.localeCompare(b.demandId)),
    addedDemands: [...addedDemands.values()].sort((a, b) => a.id.localeCompare(b.id)).map((demand) => ({ ...demand })),
    ...(addedLinks.size ? { addedLinks: [...addedLinks.values()].sort((a, b) => a.id.localeCompare(b.id)).map((link) => ({ ...link })) } : {}),
    linkCapacityOverrides: linkCapacityOverrides.sort((a, b) => a.linkId.localeCompare(b.linkId)),
  };
  if (enabledNodeIds.length) patch.enabledNodeIds = enabledNodeIds.sort();
  if (enabledLinkIds.length) patch.enabledLinkIds = enabledLinkIds.sort();
  if (demandBandwidthOverrides.length) patch.demandBandwidthOverrides = demandBandwidthOverrides.sort((a, b) => a.demandId.localeCompare(b.demandId));
  return patch;
}

export function applyChangePlan(project: NetworkProject, plan: ChangePlan): NetworkProject {
  return applyScenario(project, compileChangePlanToScenarioPatch(project, plan));
}

function invalidatePlan(plan: ChangePlan, now: string, summary: string): ChangePlan {
  const wasAuthoritative = plan.status === 'analyzed' || plan.status === 'failing' || plan.status === 'candidate' || plan.status === 'verified' || plan.proposals.some((proposal) => proposal.state === 'pending');
  plan.status = 'draft';
  plan.updatedAt = now;
  if (wasAuthoritative) plan.history.push(historyEvent(plan, 'system', 'verification_invalidated', summary, now));
  return plan;
}

export function renameChangePlan(plan: ChangePlan, name: string, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const trimmed = name.trim(); if (!trimmed) throw new Error('Plan name must be non-empty.');
  next.name = trimmed; next.updatedAt = now; next.history.push(historyEvent(next, 'human', 'renamed_plan', `Renamed plan to ${trimmed}`, now)); return next;
}

export function addPlanChange(plan: ChangePlan, change: PlanChange, now = change.createdAt): ChangePlan {
  const next = cloneChangePlan(plan);
  if (next.changes.some((item) => item.id === change.id)) throw new Error(`Duplicate plan change id ${change.id}`);
  next.changes.push(JSON.parse(JSON.stringify(change)) as PlanChange);
  next.history.push(historyEvent(next, change.actor, 'added_change', describePlanChange(change), now, change.id));
  return invalidatePlan(next, now, 'Verification invalidated because the Change Plan changed.');
}

export function removePlanChange(plan: ChangePlan, changeId: string, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const index = next.changes.findIndex((change) => change.id === changeId);
  if (index < 0) throw new Error(`Unknown plan change ${changeId}`);
  const [removed] = next.changes.splice(index, 1);
  next.history.push(historyEvent(next, 'human', 'removed_change', `Removed ${describePlanChange(removed)}`, now, removed.id));
  return invalidatePlan(next, now, 'Verification invalidated because a planned change was removed.');
}

export function setPlanConstraint<K extends keyof PlanConstraints>(plan: ChangePlan, key: K, value: PlanConstraints[K], now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); (next.constraints[key] as PlanConstraints[K]) = JSON.parse(JSON.stringify(value)) as PlanConstraints[K];
  if (key === 'protectedServiceClassIds') next.constraints.protectedServiceClassIds = normalizeStringIds(next.constraints.protectedServiceClassIds);
  if (key === 'candidateLinkOptions') next.constraints.candidateLinkOptions = [...next.constraints.candidateLinkOptions].sort((a, b) => a.id.localeCompare(b.id));
  next.history.push(historyEvent(next, 'human', 'set_constraint', `Set ${String(key)} to ${Array.isArray(value) ? value.join(', ') || 'none' : String(value)}`, now));
  return invalidatePlan(next, now, 'Verification invalidated because plan constraints changed.');
}

export function setPlanLinkLocked(plan: ChangePlan, linkId: string, locked: boolean, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const values = new Set(next.restrictions.lockedLinkIds); locked ? values.add(linkId) : values.delete(linkId); next.restrictions.lockedLinkIds = [...values].sort();
  next.history.push(historyEvent(next, 'human', locked ? 'locked_link' : 'unlocked_link', `${locked ? 'Locked' : 'Unlocked'} ${linkId} for agent/optimizer modification`, now, linkId));
  return invalidatePlan(next, now, 'Verification invalidated because plan restrictions changed.');
}

export function setPlanNodeLocked(plan: ChangePlan, nodeId: string, locked: boolean, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const values = new Set(next.restrictions.lockedNodeIds); locked ? values.add(nodeId) : values.delete(nodeId); next.restrictions.lockedNodeIds = [...values].sort();
  next.history.push(historyEvent(next, 'human', locked ? 'locked_node' : 'unlocked_node', `${locked ? 'Locked' : 'Unlocked'} ${nodeId} for agent/optimizer modification`, now, nodeId));
  return invalidatePlan(next, now, 'Verification invalidated because plan restrictions changed.');
}

export function setPlanLinkRoutingForbidden(plan: ChangePlan, linkId: string, forbidden: boolean, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const values = new Set(next.restrictions.forbiddenRoutingLinkIds); forbidden ? values.add(linkId) : values.delete(linkId); next.restrictions.forbiddenRoutingLinkIds = [...values].sort();
  next.history.push(historyEvent(next, 'human', forbidden ? 'forbid_routing_link' : 'allow_routing_link', `${forbidden ? 'Avoid' : 'Allow'} ${linkId} in optimized routing`, now, linkId));
  return invalidatePlan(next, now, 'Verification invalidated because routing restrictions changed.');
}

export function setPlanNodeRoutingForbidden(plan: ChangePlan, nodeId: string, forbidden: boolean, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const values = new Set(next.restrictions.forbiddenRoutingNodeIds); forbidden ? values.add(nodeId) : values.delete(nodeId); next.restrictions.forbiddenRoutingNodeIds = [...values].sort();
  next.history.push(historyEvent(next, 'human', forbidden ? 'forbid_routing_node' : 'allow_routing_node', `${forbidden ? 'Avoid' : 'Allow'} ${nodeId} in optimized routing`, now, nodeId));
  return invalidatePlan(next, now, 'Verification invalidated because routing restrictions changed.');
}

export function setChangePlanStatus(plan: ChangePlan, status: ChangePlanStatus, summary: string, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); next.status = status; next.updatedAt = now; next.history.push(historyEvent(next, 'system', 'plan_status', summary, now)); return next;
}

function candidateCommandToPlanChange(command: ModelCommand, candidate: CandidatePlan, index: number, sourcePlanHash: string): PlanChange {
  const common = { id: `proposal:${candidate.id}:${index + 1}`, actor: 'agent' as const, createdAt: command.createdAt, rationaleEvidenceIds: [...candidate.rationaleEvidenceIds] };
  if (command.type === 'set_link_capacity') return { ...common, type: 'set_link_capacity', target: { kind: 'link', id: String(command.args.linkId ?? '') }, payload: { capacityGbps: Number(command.args.capacityGbps) } };
  if (command.type === 'set_link_availability') return { ...common, type: command.args.available === false ? 'disable_link' : 'enable_link', target: { kind: 'link', id: String(command.args.linkId ?? '') }, payload: {} };
  if (command.type === 'set_demand_bandwidth') return { ...common, type: 'set_demand_bandwidth', target: { kind: 'demand', id: String(command.args.demandId ?? '') }, payload: { bandwidthGbps: Number(command.args.bandwidthGbps) } };
  if (command.type === 'add_link') {
    const link = command.args.link as LinkModel | undefined; const declaredCost = Number(command.args.declaredCost ?? 0); if (!link) throw new Error('Candidate add_link is missing its link payload.');
    return { ...common, type: 'add_link', target: { kind: 'link', id: link.id }, payload: { link: { ...link }, declaredCost } };
  }
  if (command.type === 'add_demand') {
    const demand = command.args.demand as DemandModel | undefined; if (!demand) throw new Error('Candidate add_demand is missing its demand payload.');
    return { ...common, type: 'add_demand', target: { kind: 'demand', id: demand.id }, payload: { demand: { ...demand } } };
  }
  throw new Error(`Candidate command ${command.type} cannot be represented as a Change Plan proposal.`);
}

export function setCandidateProposals(project: NetworkProject, plan: ChangePlan, candidate: CandidatePlan, now = new Date().toISOString()): ChangePlan {
  assertPlanBoundToProject(project, plan);
  if (candidate.baseModelHash !== modelHash(project)) throw new Error('Candidate is stale because the base network changed.');
  const sourcePlanHash = changePlanHash(plan);
  const lockedLinks = new Set(plan.restrictions.lockedLinkIds);
  const lockedNodes = new Set(plan.restrictions.lockedNodeIds);
  const next = cloneChangePlan(plan);
  next.proposals = next.proposals.filter((proposal) => proposal.state !== 'pending');
  const proposalOffset = next.proposals.length;
  const proposals = candidate.commands.map((command, index): PlanProposal => {
    const change = candidateCommandToPlanChange(command, candidate, index, sourcePlanHash);
    if (change.target.kind === 'link' && lockedLinks.has(change.target.id)) throw new Error(`Optimizer candidate violates lock on ${change.target.id}.`);
    if (change.type === 'add_link' && (lockedNodes.has(change.payload.link.source) || lockedNodes.has(change.payload.link.target))) throw new Error(`Optimizer candidate uses a locked node as an endpoint for ${change.payload.link.id}.`);
    if (change.target.kind === 'node' && lockedNodes.has(change.target.id)) throw new Error(`Optimizer candidate violates lock on ${change.target.id}.`);
    return { id: `plan-proposal:${candidate.id}:${proposalOffset + index + 1}`, candidateId: candidate.id, sourcePlanHash, change, state: 'pending', createdAt: now };
  });
  next.proposals.push(...proposals); next.status = proposals.length ? 'candidate' : next.status; next.updatedAt = now;
  next.history.push(historyEvent(next, 'agent', 'candidate_proposed', `Optimizer proposed ${proposals.length} change${proposals.length === 1 ? '' : 's'} (${candidate.objective.value} ${candidate.objective.unit ?? ''})`.trim(), now, candidate.id));
  return next;
}

export function acceptCandidateChange(plan: ChangePlan, proposalId: string, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const proposal = next.proposals.find((item) => item.id === proposalId && item.state === 'pending');
  if (!proposal) throw new Error(`Unknown pending proposal ${proposalId}`);
  if (proposal.sourcePlanHash !== changePlanHash(next)) throw new Error('Optimizer proposal is stale because the Change Plan changed. Re-run candidate generation.');
  proposal.state = 'accepted'; proposal.decidedAt = now;
  if (next.changes.some((change) => change.id === proposal.change.id)) throw new Error(`Accepted proposal change ${proposal.change.id} already exists in the plan.`);
  next.changes.push(JSON.parse(JSON.stringify(proposal.change)) as PlanChange);
  next.history.push(historyEvent(next, 'human', 'accepted_proposal', `Accepted ${describePlanChange(proposal.change)}`, now, proposal.id));
  next.history.push(historyEvent(next, 'system', 'verification_invalidated', 'Verification invalidated because an optimizer proposal was accepted.', now, proposal.id));
  next.status = 'draft'; next.updatedAt = now; return next;
}

export function rejectCandidateChange(plan: ChangePlan, proposalId: string, now = new Date().toISOString()): ChangePlan {
  const next = cloneChangePlan(plan); const proposal = next.proposals.find((item) => item.id === proposalId && item.state === 'pending');
  if (!proposal) throw new Error(`Unknown pending proposal ${proposalId}`);
  proposal.state = 'rejected'; proposal.decidedAt = now;
  next.history.push(historyEvent(next, 'human', 'rejected_proposal', `Rejected ${describePlanChange(proposal.change)}`, now, proposal.id));
  next.history.push(historyEvent(next, 'system', 'verification_invalidated', 'Verification invalidated because an optimizer proposal was rejected.', now, proposal.id));
  next.status = 'draft'; next.updatedAt = now; return next;
}

export function acceptAllCandidateChanges(plan: ChangePlan, now = new Date().toISOString()): ChangePlan {
  let next = cloneChangePlan(plan);
  for (const proposal of next.proposals.filter((item) => item.state === 'pending')) next = acceptCandidateChange(next, proposal.id, now);
  return next;
}

export function discardCandidateProposals(plan: ChangePlan, now = new Date().toISOString(), actor: PlanHistoryActor = 'human'): ChangePlan {
  let next = cloneChangePlan(plan); const pending = next.proposals.filter((item) => item.state === 'pending');
  for (const proposal of pending) { const row = next.proposals.find((item) => item.id === proposal.id)!; row.state = 'rejected'; row.decidedAt = now; }
  next.history.push(historyEvent(next, actor, 'discarded_candidate', `Discarded ${pending.length} pending optimizer proposal${pending.length === 1 ? '' : 's'}`, now));
  if (pending.length) next.history.push(historyEvent(next, 'system', 'verification_invalidated', 'Verification invalidated because the optimizer candidate was discarded.', now));
  next.status = 'draft'; next.updatedAt = now; return next;
}

export function applyModelCommand(project: NetworkProject, command: ModelCommand): NetworkProject {
  const next = cloneProject(project);
  switch (command.type) {
    case 'set_link_availability': {
      const linkId = String(command.args.linkId ?? '');
      const link = next.links.find((item) => item.id === linkId);
      if (!link) throw new Error(`Unknown link ${linkId}`);
      if (!Object.prototype.hasOwnProperty.call(command.args, 'available')) throw new Error('set_link_availability requires args.available');
      const available = command.args.available;
      if (available === null) delete link.available;
      else if (typeof available === 'boolean') link.available = available;
      else throw new Error('available must be boolean or null for exact restoration');
      break;
    }
    case 'set_link_capacity': {
      const linkId = String(command.args.linkId ?? '');
      const capacityGbps = Number(command.args.capacityGbps);
      const link = next.links.find((item) => item.id === linkId);
      if (!link) throw new Error(`Unknown link ${linkId}`);
      if (!Number.isFinite(capacityGbps) || capacityGbps <= 0) throw new Error('capacityGbps must be > 0');
      link.capacityGbps = capacityGbps;
      if (Object.prototype.hasOwnProperty.call(command.args, 'upgradeOptions')) {
        const upgradeOptions = command.args.upgradeOptions;
        if (upgradeOptions === null) delete link.upgradeOptions;
        else if (Array.isArray(upgradeOptions)) {
          link.upgradeOptions = upgradeOptions.map((option) => {
            if (!isRecord(option) || !finiteNumber(option.capacityGbps) || !finiteNumber(option.cost)) throw new Error('upgradeOptions must contain numeric capacityGbps and cost');
            return { capacityGbps: option.capacityGbps, cost: option.cost };
          });
        } else throw new Error('upgradeOptions must be an array or null for exact restoration');
      } else if (link.upgradeOptions) {
        link.upgradeOptions = link.upgradeOptions.filter((option) => option.capacityGbps > capacityGbps + 1e-9);
      }
      break;
    }
    case 'set_demand_bandwidth': {
      const demandId = String(command.args.demandId ?? '');
      const bandwidthGbps = Number(command.args.bandwidthGbps);
      const demand = next.demands.find((item) => item.id === demandId);
      if (!demand) throw new Error(`Unknown demand ${demandId}`);
      if (!Number.isFinite(bandwidthGbps) || bandwidthGbps < 0) throw new Error('bandwidthGbps must be >= 0');
      demand.bandwidthGbps = bandwidthGbps;
      break;
    }
    case 'add_link': {
      const link = command.args.link as LinkModel | undefined;
      if (!link) throw new Error('add_link requires args.link');
      next.links.push({ ...link });
      break;
    }
    case 'add_demand': {
      const demand = command.args.demand as DemandModel | undefined;
      if (!demand) throw new Error('add_demand requires args.demand');
      next.demands.push({ ...demand });
      break;
    }
    default:
      throw new Error(`Unsupported command ${(command as ModelCommand).type}`);
  }
  assertValidNetworkProject(next);
  return next;
}

export function applyCandidatePlan(project: NetworkProject, candidate: CandidatePlan): NetworkProject {
  if (candidate.baseModelHash !== modelHash(project)) {
    throw new Error('Candidate is stale because the project changed after it was proposed.');
  }
  return candidate.commands.reduce((current, command) => applyModelCommand(current, command), project);
}

export function invertCandidatePlan(project: NetworkProject, candidate: CandidatePlan): CandidatePlan {
  if (candidate.baseModelHash !== modelHash(project)) throw new Error('Candidate is stale because the project changed after it was proposed.');
  let current = cloneProject(project);
  const inverseCommands: ModelCommand[] = [];

  candidate.commands.forEach((command, index) => {
    let inverse: ModelCommand;
    if (command.type === 'set_link_capacity') {
      const linkId = String(command.args.linkId ?? '');
      const link = current.links.find((item) => item.id === linkId);
      if (!link) throw new Error(`Unknown link ${linkId}`);
      inverse = {
        id: `undo-${index}-${command.id}`,
        type: 'set_link_capacity',
        actor: 'human',
        args: {
          linkId,
          capacityGbps: link.capacityGbps,
          upgradeOptions: link.upgradeOptions ? link.upgradeOptions.map((option) => ({ ...option })) : null,
        },
        createdAt: new Date(0).toISOString(),
      };
    } else if (command.type === 'set_link_availability') {
      const linkId = String(command.args.linkId ?? '');
      const link = current.links.find((item) => item.id === linkId);
      if (!link) throw new Error(`Unknown link ${linkId}`);
      inverse = {
        id: `undo-${index}-${command.id}`,
        type: 'set_link_availability',
        actor: 'human',
        args: { linkId, available: Object.prototype.hasOwnProperty.call(link, 'available') ? link.available : null },
        createdAt: new Date(0).toISOString(),
      };
    } else if (command.type === 'set_demand_bandwidth') {
      const demandId = String(command.args.demandId ?? '');
      const demand = current.demands.find((item) => item.id === demandId);
      if (!demand) throw new Error(`Unknown demand ${demandId}`);
      inverse = {
        id: `undo-${index}-${command.id}`,
        type: 'set_demand_bandwidth',
        actor: 'human',
        args: { demandId, bandwidthGbps: demand.bandwidthGbps },
        createdAt: new Date(0).toISOString(),
      };
    } else {
      throw new Error(`Candidate command ${command.type} is not reversibly supported.`);
    }
    inverseCommands.unshift(inverse);
    current = applyModelCommand(current, command);
  });

  return {
    id: `undo:${candidate.id}`,
    name: `Undo ${candidate.name}`,
    baseModelHash: modelHash(current),
    commands: inverseCommands,
    objective: { name: 'undo', value: 0 },
    rationaleEvidenceIds: [...candidate.rationaleEvidenceIds],
  };
}
