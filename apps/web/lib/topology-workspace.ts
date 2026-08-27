import type { NetworkProject } from '@infratwin/model';

export interface TopologyPoint {
  x: number;
  y: number;
}

export type TopologyLayout = Record<string, TopologyPoint>;
export type TopologyDisplayMode = 'all' | 'change-plan' | 'violations' | 'selected-routes';
export type TopologySearchKind = 'node' | 'link' | 'demand';

export interface TopologySearchResult {
  kind: TopologySearchKind;
  id: string;
  label: string;
  secondary: string;
  score: number;
}

export interface LayoutOptions {
  ignoreExplicit?: boolean;
  width?: number;
  height?: number;
}

const DEFAULT_WIDTH = 1200;
const DEFAULT_HEIGHT = 760;
const REGION_PAD_X = 150;
const REGION_PAD_Y = 130;

function stableHash(text: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

function normalizedJitter(text: string, salt: number): number {
  const value = stableHash(`${salt}:${text}`) % 2001;
  return (value - 1000) / 1000;
}

export function topologyRegions(project: NetworkProject): string[] {
  return [...new Set(project.nodes.map((node) => node.region?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

function regionKey(region?: string): string {
  return region?.trim() || '__ungrouped__';
}

export function computeDeterministicLayout(project: NetworkProject, options: LayoutOptions = {}): TopologyLayout {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const ignoreExplicit = options.ignoreExplicit ?? false;
  const layout: TopologyLayout = {};
  const grouped = new Map<string, typeof project.nodes>();
  for (const node of project.nodes) {
    const key = regionKey(node.region);
    const rows = grouped.get(key) ?? [];
    rows.push(node);
    grouped.set(key, rows);
  }

  const regionNames = [...grouped.keys()].sort((a, b) => a.localeCompare(b));
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(regionNames.length, 1) * 1.45)));
  const rows = Math.max(1, Math.ceil(regionNames.length / columns));
  const usableWidth = Math.max(320, width - REGION_PAD_X * 2);
  const usableHeight = Math.max(280, height - REGION_PAD_Y * 2);
  const cellWidth = columns === 1 ? usableWidth : usableWidth / (columns - 1);
  const cellHeight = rows === 1 ? usableHeight : usableHeight / (rows - 1);

  regionNames.forEach((region, regionIndex) => {
    const col = regionIndex % columns;
    const row = Math.floor(regionIndex / columns);
    const centerX = REGION_PAD_X + (columns === 1 ? usableWidth / 2 : col * cellWidth);
    const centerY = REGION_PAD_Y + (rows === 1 ? usableHeight / 2 : row * cellHeight);
    const nodes = [...(grouped.get(region) ?? [])].sort((a, b) => {
      const coreDelta = Number(b.type === 'core') - Number(a.type === 'core');
      return coreDelta || a.id.localeCompare(b.id);
    });
    const coreNodes = nodes.filter((node) => node.type === 'core');
    const edgeNodes = nodes.filter((node) => node.type !== 'core');

    const placeRing = (ringNodes: typeof project.nodes, radius: number, phase: number) => {
      const count = Math.max(1, ringNodes.length);
      ringNodes.forEach((node, index) => {
        if (!ignoreExplicit && Number.isFinite(node.x) && Number.isFinite(node.y)) {
          layout[node.id] = { x: Number(node.x), y: Number(node.y) };
          return;
        }
        const angle = phase + (Math.PI * 2 * index) / count;
        const radialJitter = 1 + normalizedJitter(node.id, 17) * 0.08;
        layout[node.id] = {
          x: Math.round((centerX + Math.cos(angle) * radius * radialJitter + normalizedJitter(node.id, 31) * 9) * 100) / 100,
          y: Math.round((centerY + Math.sin(angle) * radius * radialJitter + normalizedJitter(node.id, 47) * 9) * 100) / 100,
        };
      });
    };

    placeRing(coreNodes, 54, -Math.PI / 4 + normalizedJitter(region, 3) * 0.12);
    if (edgeNodes.length <= 14) {
      placeRing(edgeNodes, 118, normalizedJitter(region, 5) * 0.18);
    } else {
      const split = Math.ceil(edgeNodes.length / 2);
      placeRing(edgeNodes.slice(0, split), 108, normalizedJitter(region, 5) * 0.18);
      placeRing(edgeNodes.slice(split), 145, Math.PI / Math.max(4, split) + normalizedJitter(region, 7) * 0.18);
    }
  });

  return layout;
}

export function layoutBounds(layout: TopologyLayout, ids?: Iterable<string>): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  const selected = ids ? new Set(ids) : null;
  const points = Object.entries(layout).filter(([id]) => !selected || selected.has(id)).map(([, point]) => point);
  if (!points.length) return null;
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function searchScore(query: string, ...values: Array<string | undefined>): number | null {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return null;
  let best: number | null = null;
  for (const raw of values) {
    const value = raw?.toLocaleLowerCase() ?? '';
    if (!value) continue;
    let score: number | null = null;
    if (value === normalized) score = 0;
    else if (value.startsWith(normalized)) score = 10 + value.length - normalized.length;
    else {
      const index = value.indexOf(normalized);
      if (index >= 0) score = 100 + index + value.length - normalized.length;
    }
    if (score !== null && (best === null || score < best)) best = score;
  }
  return best;
}

export function searchTopology(project: NetworkProject, query: string, limit = 12): TopologySearchResult[] {
  const results: TopologySearchResult[] = [];
  for (const node of project.nodes) {
    const score = searchScore(query, node.id, node.name, node.region, node.type);
    if (score !== null) results.push({ kind: 'node', id: node.id, label: node.name || node.id, secondary: [node.id, node.region].filter(Boolean).join(' · '), score });
  }
  for (const link of project.links) {
    const score = searchScore(query, link.id, link.source, link.target, `${link.source}-${link.target}`);
    if (score !== null) results.push({ kind: 'link', id: link.id, label: link.id, secondary: `${link.source} ↔ ${link.target} · ${link.capacityGbps} Gbps`, score: score + 1 });
  }
  for (const demand of project.demands) {
    const score = searchScore(query, demand.id, demand.name, demand.source, demand.target);
    if (score !== null) results.push({ kind: 'demand', id: demand.id, label: demand.name || demand.id, secondary: `${demand.id} · ${demand.source} → ${demand.target} · ${demand.bandwidthGbps} Gbps`, score: score + 2 });
  }
  return results
    .sort((a, b) => a.score - b.score || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
    .slice(0, Math.max(1, limit));
}

export function layoutCacheKey(project: NetworkProject, ignoreExplicit = false): string {
  const topology = {
    ignoreExplicit,
    nodes: project.nodes.map((node) => ({ id: node.id, region: node.region ?? '', type: node.type ?? '', ...(ignoreExplicit ? {} : { x: node.x, y: node.y }) })),
    links: project.links.map((link) => ({ id: link.id, source: link.source, target: link.target })),
  };
  return JSON.stringify(topology);
}
