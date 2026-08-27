import type { NetworkProject } from '@infratwin/model';
import { validateNetworkProject } from '@infratwin/model';

export interface CsvBundleInput {
  nodesCsv: string;
  linksCsv: string;
  demandsCsv?: string;
  projectName?: string;
}

export interface ImportReview {
  project: NetworkProject;
  warnings: string[];
  defaults: string[];
  counts: { nodes: number; links: number; demands: number; regions: number; serviceClasses: number };
}

function parseCsv(text: string, label: string): Array<Record<string, string>> {
  const source = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(field.trim()); field = ''; continue; }
    if (char === '\n') { row.push(field.trim()); field = ''; if (row.some((value) => value.length)) rows.push(row); row = []; continue; }
    if (char !== '\r') field += char;
  }
  if (quoted) throw new Error(`${label} contains an unterminated quoted field.`);
  row.push(field.trim());
  if (row.some((value) => value.length)) rows.push(row);
  if (!rows.length) throw new Error(`${label} is empty.`);
  const headers = rows[0].map((header) => header.trim());
  if (headers.some((header) => !header)) throw new Error(`${label} contains an empty header.`);
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length) throw new Error(`${label} contains duplicate header ${duplicates[0]}.`);
  return rows.slice(1).map((values, index) => {
    if (values.length > headers.length) throw new Error(`${label} row ${index + 2} has more columns than the header.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column] ?? '']));
  });
}

function requireField(row: Record<string, string>, field: string, label: string): string {
  const value = row[field]?.trim();
  if (!value) throw new Error(`${label}.${field} is required.`);
  return value;
}

function parsePositive(value: string, label: string, allowZero = false): number {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) throw new Error(`${label} must be ${allowZero ? 'non-negative' : 'greater than zero'}.`);
  return number;
}

function parseBoolean(value: string, label: string, fallback: boolean): boolean {
  if (!value.trim()) return fallback;
  const normalized = value.trim().toLocaleLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`${label} must be true or false.`);
}

function slug(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'imported-network';
}

export function reviewNetworkProject(project: NetworkProject): ImportReview {
  const validation = validateNetworkProject(project);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  const missingCoordinates = project.nodes.filter((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y)).length;
  const warnings: string[] = [];
  if (missingCoordinates) warnings.push(`${missingCoordinates} node${missingCoordinates === 1 ? '' : 's'} have no explicit coordinates; deterministic workspace layout will be used.`);
  if (!project.demands.length) warnings.push('No demands supplied; routing/capacity analysis will have no traffic until demands are authored or imported.');
  return {
    project,
    warnings,
    defaults: [],
    counts: {
      nodes: project.nodes.length,
      links: project.links.length,
      demands: project.demands.length,
      regions: new Set(project.nodes.map((node) => node.region).filter(Boolean)).size,
      serviceClasses: project.serviceClasses.length,
    },
  };
}

export function parseCsvBundle(input: CsvBundleInput): ImportReview {
  const warnings: string[] = [];
  const defaults: string[] = [];
  const nodeRows = parseCsv(input.nodesCsv, 'nodes.csv');
  const linkRows = parseCsv(input.linksCsv, 'links.csv');
  const demandRows = input.demandsCsv?.trim() ? parseCsv(input.demandsCsv, 'demands.csv') : [];

  const nodes = nodeRows.map((row, index) => ({
    id: requireField(row, 'id', `nodes.csv row ${index + 2}`),
    name: requireField(row, 'name', `nodes.csv row ${index + 2}`),
    ...(row.region?.trim() ? { region: row.region.trim() } : {}),
    ...(row.type?.trim() ? { type: row.type.trim() } : {}),
    available: true,
  }));
  const nodeIds = new Set(nodes.map((node) => node.id));

  let missingWeight = 0;
  let missingBidirectional = 0;
  const links = linkRows.map((row, index) => {
    const label = `links.csv row ${index + 2}`;
    const source = requireField(row, 'source', label);
    const target = requireField(row, 'target', label);
    if (!nodeIds.has(source)) throw new Error(`${label}.source references unknown node ${source}.`);
    if (!nodeIds.has(target)) throw new Error(`${label}.target references unknown node ${target}.`);
    if (source === target) throw new Error(`${label} cannot connect a node to itself.`);
    if (!row.weight?.trim()) missingWeight += 1;
    if (!row.bidirectional?.trim()) missingBidirectional += 1;
    return {
      id: requireField(row, 'id', label),
      source,
      target,
      capacityGbps: parsePositive(requireField(row, 'capacityGbps', label), `${label}.capacityGbps`),
      weight: row.weight?.trim() ? parsePositive(row.weight, `${label}.weight`) : 1,
      bidirectional: parseBoolean(row.bidirectional ?? '', `${label}.bidirectional`, true),
      available: true,
    };
  });
  if (missingWeight) { warnings.push(`${missingWeight} link${missingWeight === 1 ? '' : 's'} have no explicit weight; default 1 was applied.`); defaults.push('Missing link weight → 1'); }
  if (missingBidirectional) { warnings.push(`${missingBidirectional} link${missingBidirectional === 1 ? '' : 's'} have no bidirectional value; true was applied.`); defaults.push('Missing bidirectional → true'); }

  const defaultClassId = 'imported-default';
  const serviceClasses = [{ id: defaultClassId, name: 'Imported default', priority: 50, maxUtilizationPct: 80, allowShedding: false }];
  if (demandRows.length) defaults.push('Traffic service class → Imported default (80% planning threshold)');
  const demands = demandRows.map((row, index) => {
    const label = `demands.csv row ${index + 2}`;
    const source = requireField(row, 'source', label);
    const target = requireField(row, 'target', label);
    if (!nodeIds.has(source)) throw new Error(`${label}.source references unknown node ${source}.`);
    if (!nodeIds.has(target)) throw new Error(`${label}.target references unknown node ${target}.`);
    const requestedClass = row.serviceClassId?.trim();
    if (requestedClass && requestedClass !== defaultClassId && requestedClass !== 'default') {
      throw new Error(`${label}.serviceClassId references ${requestedClass}, but this CSV bundle has no service-class catalog. Leave it blank/default or import canonical JSON with explicit service classes.`);
    }
    return {
      id: requireField(row, 'id', label),
      ...(row.name?.trim() ? { name: row.name.trim() } : {}),
      source,
      target,
      bandwidthGbps: parsePositive(requireField(row, 'bandwidthGbps', label), `${label}.bandwidthGbps`, true),
      serviceClassId: defaultClassId,
    };
  });
  if (!demandRows.length) warnings.push('No demands supplied.');

  const name = input.projectName?.trim() || 'Imported CSV Network';
  const project: NetworkProject = {
    schemaVersion: '0.1',
    id: slug(name),
    name,
    nodes,
    links,
    demands,
    serviceClasses,
    routingProfile: { mode: 'ecmp' },
    metadata: {
      import: { format: 'csv-bundle', defaults: [...defaults] },
      description: 'Network imported from nodes.csv, links.csv, and optional demands.csv.',
    },
  };
  const validation = validateNetworkProject(project);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return {
    project,
    warnings: [...warnings, `${nodes.length} node${nodes.length === 1 ? '' : 's'} have no explicit coordinates; deterministic workspace layout will be used.`],
    defaults,
    counts: { nodes: nodes.length, links: links.length, demands: demands.length, regions: new Set(nodes.map((node) => node.region).filter(Boolean)).size, serviceClasses: serviceClasses.length },
  };
}
