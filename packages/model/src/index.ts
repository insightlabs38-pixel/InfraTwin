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
  demandMultipliers: Array<{ demandId: string; multiplier: number }>;
  addedDemands: DemandModel[];
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

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function validateNetworkProject(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['project must be an object'] };
  if (value.schemaVersion !== '0.1') errors.push('schemaVersion must equal 0.1');
  if (!nonEmptyString(value.id)) errors.push('id must be a non-empty string');
  if (!nonEmptyString(value.name)) errors.push('name must be a non-empty string');
  if (!Array.isArray(value.nodes)) errors.push('nodes must be an array');
  if (!Array.isArray(value.links)) errors.push('links must be an array');
  if (!Array.isArray(value.demands)) errors.push('demands must be an array');
  if (!Array.isArray(value.serviceClasses)) errors.push('serviceClasses must be an array');
  if (!isRecord(value.routingProfile) || !['single-shortest-path', 'ecmp'].includes(String(value.routingProfile.mode))) {
    errors.push('routingProfile.mode must be single-shortest-path or ecmp');
  }
  if (errors.length) return { valid: false, errors };

  const nodes = value.nodes as unknown[];
  const links = value.links as unknown[];
  const demands = value.demands as unknown[];
  const classes = value.serviceClasses as unknown[];
  const nodeIds = new Set<string>();
  const linkIds = new Set<string>();
  const demandIds = new Set<string>();
  const classIds = new Set<string>();

  if (nodes.length > 500) errors.push('nodes must contain at most 500 entries for browser-local analysis');
  if (links.length > 2000) errors.push('links must contain at most 2000 entries for browser-local analysis');
  if (demands.length > 2000) errors.push('demands must contain at most 2000 entries for browser-local analysis');
  if (classes.length > 64) errors.push('serviceClasses must contain at most 64 entries');
  const routingMode = (value.routingProfile as Record<string, unknown>).mode;

  nodes.forEach((node, index) => {
    if (!isRecord(node)) return void errors.push(`nodes[${index}] must be an object`);
    if (!nonEmptyString(node.id)) errors.push(`nodes[${index}].id must be non-empty`);
    else if (nodeIds.has(node.id)) errors.push(`duplicate node id ${node.id}`);
    else nodeIds.add(node.id);
    if (!nonEmptyString(node.name)) errors.push(`nodes[${index}].name must be non-empty`);
    if (node.available !== undefined && typeof node.available !== 'boolean') errors.push(`nodes[${index}].available must be boolean`);
    if (node.x !== undefined && !finiteNumber(node.x)) errors.push(`nodes[${index}].x must be finite`);
    if (node.y !== undefined && !finiteNumber(node.y)) errors.push(`nodes[${index}].y must be finite`);
  });

  classes.forEach((serviceClass, index) => {
    if (!isRecord(serviceClass)) return void errors.push(`serviceClasses[${index}] must be an object`);
    if (!nonEmptyString(serviceClass.id)) errors.push(`serviceClasses[${index}].id must be non-empty`);
    else if (classIds.has(serviceClass.id)) errors.push(`duplicate service class id ${serviceClass.id}`);
    else classIds.add(serviceClass.id);
    if (!nonEmptyString(serviceClass.name)) errors.push(`serviceClasses[${index}].name must be non-empty`);
    if (!Number.isInteger(serviceClass.priority) || Number(serviceClass.priority) < 0) errors.push(`serviceClasses[${index}].priority must be a non-negative integer`);
    if (!finiteNumber(serviceClass.maxUtilizationPct) || Number(serviceClass.maxUtilizationPct) <= 0 || Number(serviceClass.maxUtilizationPct) > 100) {
      errors.push(`serviceClasses[${index}].maxUtilizationPct must be in (0,100]`);
    }
  });

  links.forEach((link, index) => {
    if (!isRecord(link)) return void errors.push(`links[${index}] must be an object`);
    if (!nonEmptyString(link.id)) errors.push(`links[${index}].id must be non-empty`);
    else if (linkIds.has(link.id)) errors.push(`duplicate link id ${link.id}`);
    else linkIds.add(link.id);
    if (!nonEmptyString(link.source) || !nodeIds.has(String(link.source))) errors.push(`links[${index}].source must reference a node`);
    if (!nonEmptyString(link.target) || !nodeIds.has(String(link.target))) errors.push(`links[${index}].target must reference a node`);
    if (!finiteNumber(link.capacityGbps) || Number(link.capacityGbps) <= 0) errors.push(`links[${index}].capacityGbps must be > 0`);
    if (!finiteNumber(link.weight) || Number(link.weight) < 0) errors.push(`links[${index}].weight must be >= 0`);
    if (routingMode === 'ecmp' && finiteNumber(link.weight) && Number(link.weight) <= 0) errors.push(`links[${index}].weight must be > 0 when routingProfile.mode is ecmp`);
    if (link.bidirectional !== undefined && typeof link.bidirectional !== 'boolean') errors.push(`links[${index}].bidirectional must be boolean`);
    if (link.available !== undefined && typeof link.available !== 'boolean') errors.push(`links[${index}].available must be boolean`);
    if (link.upgradeOptions !== undefined) {
      if (!Array.isArray(link.upgradeOptions)) errors.push(`links[${index}].upgradeOptions must be an array`);
      else link.upgradeOptions.forEach((option, optionIndex) => {
        if (!isRecord(option) || !finiteNumber(option.capacityGbps) || Number(option.capacityGbps) <= Number(link.capacityGbps) || !finiteNumber(option.cost) || Number(option.cost) < 0) {
          errors.push(`links[${index}].upgradeOptions[${optionIndex}] must have capacity above current capacity and non-negative cost`);
        }
      });
    }
  });

  demands.forEach((demand, index) => {
    if (!isRecord(demand)) return void errors.push(`demands[${index}] must be an object`);
    if (!nonEmptyString(demand.id)) errors.push(`demands[${index}].id must be non-empty`);
    else if (demandIds.has(demand.id)) errors.push(`duplicate demand id ${demand.id}`);
    else demandIds.add(demand.id);
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
      out[key] = stableValue(value[key]);
      return out;
    }, {});
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
    if (!PRESENTATION_METADATA_KEYS.has(key)) out[key] = stripPresentationMetadata(value[key]);
    return out;
  }, {});
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
  const multipliers = new Map(patch.demandMultipliers.map((item) => [item.demandId, item.multiplier]));
  const capacities = new Map(patch.linkCapacityOverrides.map((item) => [item.linkId, item.capacityGbps]));

  snapshot.nodes = snapshot.nodes.map((node) => disabledNodes.has(node.id) ? { ...node, available: false } : node);
  snapshot.links = snapshot.links.map((link) => ({
    ...link,
    available: disabledLinks.has(link.id) ? false : link.available,
    capacityGbps: capacities.get(link.id) ?? link.capacityGbps,
  }));
  snapshot.demands = snapshot.demands.map((demand) => ({
    ...demand,
    bandwidthGbps: demand.bandwidthGbps * (multipliers.get(demand.id) ?? 1),
  }));
  snapshot.demands.push(...patch.addedDemands.map((demand) => ({ ...demand })));
  assertValidNetworkProject(snapshot);
  return snapshot;
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
