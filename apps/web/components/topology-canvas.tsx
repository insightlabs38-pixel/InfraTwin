'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import type { LinkModel, NetworkProject } from '@infratwin/model';
import type { CapacityAnalysis } from '@infratwin/evidence';
import { computeDeterministicLayout, layoutBounds, layoutCacheKey, searchTopology, topologyRegions, type TopologyDisplayMode } from '../lib/topology-workspace';

interface TopologyCanvasProps {
  project: NetworkProject;
  analysis: CapacityAnalysis;
  analysisAuthoritative: boolean;
  selectedLinkIds: Set<string>;
  selectedLinkId: string | null;
  selectedNodeId: string | null;
  selectedDemandId?: string | null;
  plannedOutageLinkIds: Set<string>;
  plannedOutageNodeIds: Set<string>;
  plannedChangedLinkIds: Set<string>;
  plannedChangedNodeIds: Set<string>;
  proposalLinkIds: Set<string>;
  proposalNodeIds: Set<string>;
  lockedLinkIds: Set<string>;
  lockedNodeIds: Set<string>;
  violationLinkIds: Set<string>;
  onSelectLink: (linkId: string) => void;
  onSelectNode: (nodeId: string) => void;
  onSelectDemand?: (demandId: string) => void;
  onBatchPlannedOutage?: (linkIds: string[]) => void;
  onBatchLockLinks?: (linkIds: string[], locked: boolean) => void;
}

interface ViewBoxState { x: number; y: number; width: number; height: number }
interface DragState { clientX: number; clientY: number; viewBox: ViewBoxState; moved: boolean }

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 760;
export const LARGE_GRAPH_CANVAS_NODE_THRESHOLD = 400;
export const LARGE_GRAPH_CANVAS_LINK_THRESHOLD = 1000;

export type TopologyRendererMode = 'svg' | 'canvas';

/** Tier-C SVG measurements crossed multi-second render/long-task territory; retain rich SVG below that measured class. */
export function topologyRendererMode(project: Pick<NetworkProject, 'nodes' | 'links'>): TopologyRendererMode {
  return project.nodes.length >= LARGE_GRAPH_CANVAS_NODE_THRESHOLD || project.links.length >= LARGE_GRAPH_CANVAS_LINK_THRESHOLD ? 'canvas' : 'svg';
}

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1; const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(px - x1, py - y1);
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / lengthSquared, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
function gbps(value: number): string { return `${Math.round(value * 100) / 100} Gbps`; }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)); }
function regionSlug(value: string): string { return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '-'); }

function paddedView(bounds: ReturnType<typeof layoutBounds>, padding = 70): ViewBoxState {
  if (!bounds) return { x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT };
  const width = Math.max(180, bounds.width + padding * 2);
  const height = Math.max(140, bounds.height + padding * 2);
  return { x: bounds.minX - padding, y: bounds.minY - padding, width, height };
}

export function TopologyCanvas(props: TopologyCanvasProps) {
  const { project, analysis } = props;
  const snapshot = analysis.snapshot;
  const svgRef = useRef<SVGSVGElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [layoutGeneration, setLayoutGeneration] = useState(0);
  const [viewBox, setViewBox] = useState<ViewBoxState>({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [hover, setHover] = useState<{ kind: 'node' | 'link'; id: string; clientX: number; clientY: number } | null>(null);
  const [displayMode, setDisplayMode] = useState<TopologyDisplayMode>('all');
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
  const [enabledRegions, setEnabledRegions] = useState<Set<string>>(new Set());
  const [multiLinkIds, setMultiLinkIds] = useState<Set<string>>(new Set());
  const [searchHighlight, setSearchHighlight] = useState<{ kind: 'node' | 'link' | 'demand'; id: string } | null>(null);

  const rendererMode = topologyRendererMode(project);
  const regions = useMemo(() => topologyRegions(project), [project]);
  useEffect(() => { setEnabledRegions(new Set(regions)); setFocusedRegion(null); setMultiLinkIds(new Set()); setSearchHighlight(null); }, [project.id, regions.join('|')]);

  const layoutKey = useMemo(() => layoutCacheKey(project, layoutGeneration > 0), [project, layoutGeneration]);
  const layout = useMemo(() => computeDeterministicLayout(project, { ignoreExplicit: layoutGeneration > 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }), [layoutKey]);
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);
  const canonicalNodeById = useMemo(() => new Map(project.nodes.map((node) => [node.id, node])), [project.nodes]);
  const canonicalLinkById = useMemo(() => new Map(project.links.map((link) => [link.id, link])), [project.links]);
  const routeByDemand = useMemo(() => new Map(analysis.routing.routes.map((route) => [route.demandId, route])), [analysis.routing.routes]);
  const searchResults = useMemo(() => searchTopology(project, query), [project, query]);
  useEffect(() => { setActiveSearchIndex(0); }, [query]);
  const selectedDemand = props.selectedDemandId ? project.demands.find((demand) => demand.id === props.selectedDemandId) : undefined;

  const fitNetwork = () => setViewBox(paddedView(layoutBounds(layout), 90));
  useEffect(() => { fitNetwork(); }, [layoutKey]);
  const resetView = () => setViewBox({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const focusIds = (ids: Iterable<string>, padding = 95) => {
    const bounds = layoutBounds(layout, ids);
    if (bounds) setViewBox(paddedView(bounds, padding));
  };

  const selectedNodeIdsForFit = useMemo(() => {
    const ids = new Set<string>();
    if (props.selectedNodeId) ids.add(props.selectedNodeId);
    for (const linkId of new Set([...multiLinkIds, ...props.selectedLinkIds, ...(props.selectedLinkId ? [props.selectedLinkId] : [])])) {
      const link = canonicalLinkById.get(linkId);
      if (link) { ids.add(link.source); ids.add(link.target); }
    }
    if (selectedDemand) {
      ids.add(selectedDemand.source); ids.add(selectedDemand.target);
      const route = routeByDemand.get(selectedDemand.id);
      for (const linkId of Object.keys(route?.linkFractions ?? {})) {
        const link = canonicalLinkById.get(linkId);
        if (link) { ids.add(link.source); ids.add(link.target); }
      }
    }
    return ids;
  }, [props.selectedNodeId, props.selectedLinkId, props.selectedLinkIds, multiLinkIds, selectedDemand, canonicalLinkById, routeByDemand]);

  const fitSelection = () => selectedNodeIdsForFit.size ? focusIds(selectedNodeIdsForFit, 115) : fitNetwork();
  const zoomView = (factor: number) => setViewBox((current) => {
    const width = clamp(current.width * factor, 160, 2400);
    const height = width * (CANVAS_HEIGHT / CANVAS_WIDTH);
    const centerX = current.x + current.width / 2;
    const centerY = current.y + current.height / 2;
    return { x: centerX - width / 2, y: centerY - height / 2, width, height };
  });
  const zoomFactor = CANVAS_WIDTH / viewBox.width;
  const lod: 'out' | 'medium' | 'in' = zoomFactor < 0.9 ? 'out' : zoomFactor < 1.75 ? 'medium' : 'in';

  const nodeVisible = (id: string) => {
    const region = canonicalNodeById.get(id)?.region;
    return !region || enabledRegions.has(region);
  };
  const isRegionDimmed = (nodeId: string) => Boolean(focusedRegion && canonicalNodeById.get(nodeId)?.region !== focusedRegion);
  const routeHighlightIds = props.selectedLinkIds;

  const linkPriority = (linkId: string) => props.violationLinkIds.has(linkId) || props.plannedChangedLinkIds.has(linkId) || props.proposalLinkIds.has(linkId) || props.lockedLinkIds.has(linkId) || props.selectedLinkId === linkId || props.selectedLinkIds.has(linkId) || multiLinkIds.has(linkId) || searchHighlight?.kind === 'link' && searchHighlight.id === linkId;
  const nodePriority = (nodeId: string) => props.plannedChangedNodeIds.has(nodeId) || props.proposalNodeIds.has(nodeId) || props.lockedNodeIds.has(nodeId) || props.selectedNodeId === nodeId || searchHighlight?.kind === 'node' && searchHighlight.id === nodeId;
  const shouldDimLink = (linkId: string, sourceId: string, targetId: string) => {
    if (focusedRegion && isRegionDimmed(sourceId) && isRegionDimmed(targetId)) return true;
    if (displayMode === 'change-plan') return !(props.plannedChangedLinkIds.has(linkId) || props.proposalLinkIds.has(linkId) || props.lockedLinkIds.has(linkId));
    if (displayMode === 'violations') return !props.violationLinkIds.has(linkId);
    if (displayMode === 'selected-routes') return !(routeHighlightIds.has(linkId) || props.selectedLinkId === linkId || multiLinkIds.has(linkId));
    return false;
  };
  const shouldDimNode = (nodeId: string) => {
    if (focusedRegion && isRegionDimmed(nodeId)) return true;
    if (displayMode === 'change-plan') return !(props.plannedChangedNodeIds.has(nodeId) || props.proposalNodeIds.has(nodeId) || props.lockedNodeIds.has(nodeId));
    if (displayMode === 'violations') return true;
    if (displayMode === 'selected-routes') return !selectedNodeIdsForFit.has(nodeId);
    return false;
  };

  const regionBounds = useMemo(() => new Map(regions.map((region) => [region, layoutBounds(layout, project.nodes.filter((node) => node.region === region).map((node) => node.id))])), [regions, layout, project.nodes]);

  const chooseSearchResult = (result: ReturnType<typeof searchTopology>[number]) => {
    setSearchHighlight({ kind: result.kind, id: result.id });
    if (result.kind === 'node') {
      props.onSelectNode(result.id); setMultiLinkIds(new Set()); focusIds([result.id], 150);
    } else if (result.kind === 'link') {
      props.onSelectLink(result.id); setMultiLinkIds(new Set([result.id]));
      const link = canonicalLinkById.get(result.id); if (link) focusIds([link.source, link.target], 145);
    } else {
      props.onSelectDemand?.(result.id); setMultiLinkIds(new Set());
      const demand = project.demands.find((item) => item.id === result.id);
      const route = routeByDemand.get(result.id);
      const ids = new Set<string>(demand ? [demand.source, demand.target] : []);
      for (const linkId of Object.keys(route?.linkFractions ?? {})) { const link = canonicalLinkById.get(linkId); if (link) { ids.add(link.source); ids.add(link.target); } }
      if (ids.size) focusIds(ids, 120);
    }
    setQuery(result.label);
    setSearchOpen(false);
  };

  const selectLink = (linkId: string, event: Pick<ReactKeyboardEvent | ReactPointerEvent, 'metaKey' | 'ctrlKey' | 'shiftKey'>) => {
    const additive = Boolean(event.metaKey || event.ctrlKey || event.shiftKey);
    if (!additive) setMultiLinkIds(new Set([linkId]));
    else setMultiLinkIds((current) => { const next = new Set(current); if (next.has(linkId)) next.delete(linkId); else next.add(linkId); return next; });
    props.onSelectLink(linkId);
    setSearchHighlight(null);
  };

  const eventPoint = (clientX: number, clientY: number, element: Element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: viewBox.x + ((clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width,
      y: viewBox.y + ((clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height,
      rect,
    };
  };

  const zoomAt = (event: ReactWheelEvent<SVGSVGElement | HTMLCanvasElement>) => {
    event.preventDefault();
    const point = eventPoint(event.clientX, event.clientY, event.currentTarget);
    const factor = event.deltaY > 0 ? 1.18 : 0.84;
    const width = clamp(viewBox.width * factor, 160, 2400);
    const height = width * (CANVAS_HEIGHT / CANVAS_WIDTH);
    const ratioX = (point.x - viewBox.x) / viewBox.width; const ratioY = (point.y - viewBox.y) / viewBox.height;
    setViewBox({ x: point.x - ratioX * width, y: point.y - ratioY * height, width, height });
  };

  const beginPan = (event: ReactPointerEvent<SVGSVGElement | HTMLCanvasElement>) => {
    dragRef.current = { clientX: event.clientX, clientY: event.clientY, viewBox, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const movePan = (event: ReactPointerEvent<SVGSVGElement | HTMLCanvasElement>) => {
    const drag = dragRef.current; if (!drag) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const clientDx = event.clientX - drag.clientX; const clientDy = event.clientY - drag.clientY;
    if (Math.hypot(clientDx, clientDy) > 3) drag.moved = true;
    const dx = clientDx * drag.viewBox.width / Math.max(1, rect.width);
    const dy = clientDy * drag.viewBox.height / Math.max(1, rect.height);
    setViewBox({ ...drag.viewBox, x: drag.viewBox.x - dx, y: drag.viewBox.y - dy });
  };

  const canvasObjectAt = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const point = eventPoint(clientX, clientY, canvas);
    const worldPerPixel = viewBox.width / Math.max(1, point.rect.width);
    let nodeHit: { id: string; distance: number } | null = null;
    for (const node of snapshot.nodes) {
      if (!nodeVisible(node.id)) continue;
      const position = layout[node.id]; if (!position) continue;
      const distance = Math.hypot(point.x - position.x, point.y - position.y);
      const threshold = (nodePriority(node.id) ? 18 : 13) * worldPerPixel;
      if (distance <= threshold && (!nodeHit || distance < nodeHit.distance)) nodeHit = { id: node.id, distance };
    }
    if (nodeHit) return { kind: 'node' as const, id: nodeHit.id };
    let linkHit: { id: string; distance: number } | null = null;
    for (const link of snapshot.links) {
      if (!nodeVisible(link.source) || !nodeVisible(link.target)) continue;
      const source = layout[link.source]; const target = layout[link.target]; if (!source || !target) continue;
      const distance = distanceToSegment(point.x, point.y, source.x, source.y, target.x, target.y);
      const threshold = (linkPriority(link.id) ? 10 : 7) * worldPerPixel;
      if (distance <= threshold && (!linkHit || distance < linkHit.distance)) linkHit = { id: link.id, distance };
    }
    return linkHit ? { kind: 'link' as const, id: linkHit.id } : null;
  };

  const hitTestCanvas = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const hit = canvasObjectAt(event.clientX, event.clientY);
    if (!hit) return;
    if (hit.kind === 'node') { setMultiLinkIds(new Set()); props.onSelectNode(hit.id); setSearchHighlight(null); return; }
    selectLink(hit.id, event);
  };

  const finishCanvasPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current; dragRef.current = null;
    if (drag && !drag.moved) hitTestCanvas(event);
  };

  const updateCanvasHover = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    movePan(event);
    if (dragRef.current?.moved) { setHover(null); return; }
    const hit = canvasObjectAt(event.clientX, event.clientY);
    setHover(hit ? { ...hit, clientX: event.clientX, clientY: event.clientY } : null);
  };

  useEffect(() => {
    if (rendererMode !== 'canvas') return;
    const canvas = canvasRef.current; if (!canvas) return;
    const context = canvas.getContext('2d'); if (!context) return;
    const scale = CANVAS_WIDTH / viewBox.width;
    const worldPerPixel = viewBox.width / CANVAS_WIDTH;
    context.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    context.save();
    context.setTransform(scale, 0, 0, scale, -viewBox.x * scale, -viewBox.y * scale);
    context.lineCap = 'round'; context.lineJoin = 'round';

    for (const region of regions) {
      if (!enabledRegions.has(region)) continue;
      const bounds = regionBounds.get(region); if (!bounds) continue;
      context.globalAlpha = focusedRegion && focusedRegion !== region ? 0.16 : 0.55;
      context.strokeStyle = '#31435b'; context.lineWidth = 1 * worldPerPixel; context.setLineDash([6 * worldPerPixel, 8 * worldPerPixel]);
      context.strokeRect(bounds.minX - 56, bounds.minY - 68, bounds.width + 112, bounds.height + 124);
      context.setLineDash([]); context.fillStyle = '#63768f'; context.font = `700 ${12 * worldPerPixel}px ui-sans-serif, system-ui`;
      context.fillText(region, bounds.minX - 30, bounds.minY - 48);
    }

    const orderedLinks = [...snapshot.links].sort((a, b) => Number(linkPriority(a.id)) - Number(linkPriority(b.id)) || a.id.localeCompare(b.id));
    for (const link of orderedLinks) {
      const source = layout[link.source]; const target = layout[link.target];
      if (!source || !target || !nodeVisible(link.source) || !nodeVisible(link.target)) continue;
      const utilization = props.analysisAuthoritative ? (analysis.routing.linkUtilizationPct[link.id] ?? 0) : 0;
      const disabled = link.available === false; const priority = linkPriority(link.id);
      const selected = props.selectedLinkIds.has(link.id) || props.selectedLinkId === link.id || multiLinkIds.has(link.id);
      context.globalAlpha = shouldDimLink(link.id, link.source, link.target) ? 0.12 : disabled ? 0.35 : 0.9;
      context.strokeStyle = selected ? '#d5ebff' : props.violationLinkIds.has(link.id) || utilization > 100 ? '#e26b77' : props.plannedChangedLinkIds.has(link.id) ? '#68a6e6' : props.proposalLinkIds.has(link.id) ? '#8fc3f7' : props.lockedLinkIds.has(link.id) ? '#d1b77f' : utilization > 80 ? '#d9a85f' : '#486684';
      context.lineWidth = clamp(1.25 + utilization / 65 + (priority ? 1.4 : 0), 1.25, 6) * worldPerPixel;
      context.setLineDash((disabled || props.plannedOutageLinkIds.has(link.id) || props.proposalLinkIds.has(link.id)) ? [6 * worldPerPixel, 5 * worldPerPixel] : []);
      context.beginPath(); context.moveTo(source.x, source.y); context.lineTo(target.x, target.y); context.stroke();
      if (props.lockedLinkIds.has(link.id)) {
        context.strokeStyle = '#0b121d'; context.lineWidth = Math.max(worldPerPixel, context.lineWidth * 0.35); context.setLineDash([]);
        context.beginPath(); context.moveTo(source.x, source.y); context.lineTo(target.x, target.y); context.stroke();
      }
      if (priority && (lod !== 'out' || selected || props.violationLinkIds.has(link.id))) {
        context.globalAlpha = 0.95; context.fillStyle = '#dfe8f4'; context.font = `700 ${9 * worldPerPixel}px ui-monospace, monospace`;
        context.fillText(link.id, (source.x + target.x) / 2 + 5 * worldPerPixel, (source.y + target.y) / 2 - 7 * worldPerPixel);
      }
    }
    context.setLineDash([]);

    const orderedNodes = [...snapshot.nodes].sort((a, b) => Number(nodePriority(a.id)) - Number(nodePriority(b.id)) || a.id.localeCompare(b.id));
    for (const node of orderedNodes) {
      if (!nodeVisible(node.id)) continue;
      const point = layout[node.id]; if (!point) continue;
      const priority = nodePriority(node.id); const selected = props.selectedNodeId === node.id;
      const radiusPx = lod === 'out' ? 5.5 : lod === 'medium' ? 8 : 11;
      const radius = radiusPx * worldPerPixel;
      context.globalAlpha = shouldDimNode(node.id) ? 0.14 : node.available === false ? 0.45 : 0.95;
      context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = props.plannedOutageNodeIds.has(node.id) || node.available === false ? '#2b2930' : '#142237'; context.fill();
      context.strokeStyle = selected ? '#d5ebff' : props.plannedChangedNodeIds.has(node.id) ? '#68a6e6' : props.proposalNodeIds.has(node.id) ? '#8fc3f7' : props.lockedNodeIds.has(node.id) ? '#d1b77f' : '#7892b4';
      context.lineWidth = (selected ? 3.5 : priority ? 2.5 : 1.5) * worldPerPixel;
      context.setLineDash((props.plannedOutageNodeIds.has(node.id) || props.proposalNodeIds.has(node.id)) ? [4 * worldPerPixel, 3 * worldPerPixel] : []); context.stroke(); context.setLineDash([]);
      if (props.lockedNodeIds.has(node.id)) {
        context.beginPath(); context.arc(point.x, point.y, radius + 3 * worldPerPixel, 0, Math.PI * 2); context.strokeStyle = '#d1b77f'; context.lineWidth = 1.5 * worldPerPixel; context.stroke();
      }
      if ((lod !== 'out' || priority) && (priority || lod === 'in' || project.nodes.length <= 250)) {
        context.globalAlpha = 0.95; context.fillStyle = '#dfe8f4'; context.font = `700 ${8 * worldPerPixel}px ui-monospace, monospace`; context.textAlign = 'center';
        context.fillText(node.id, point.x, point.y - radius - 5 * worldPerPixel); context.textAlign = 'start';
      }
    }
    context.restore();
  });

  if (snapshot.nodes.length === 0) return <div className="empty-canvas" data-testid="topology-empty"><strong>No network loaded.</strong><p>Import JSON or CSV, or open an example network.</p></div>;

  return (
    <div className="topology-workspace" data-testid="topology-workspace">
      <div className="topology-toolbar">
        <div className="topology-search-wrap">
          <label htmlFor="topology-search" className="sr-only">Search topology</label>
          <input
            id="topology-search"
            data-testid="topology-search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={searchOpen && Boolean(query.trim())}
            aria-controls="topology-search-results"
            aria-activedescendant={searchOpen && searchResults[activeSearchIndex] ? `topology-search-option-${activeSearchIndex}` : undefined}
            value={query}
            placeholder="Search node, link, or demand"
            onFocus={() => { if (query.trim()) setSearchOpen(true); }}
            onChange={(event) => { setQuery(event.target.value); setSearchHighlight(null); setSearchOpen(true); }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') { setSearchOpen(false); return; }
              if (event.key === 'ArrowDown' && searchResults.length) { event.preventDefault(); setSearchOpen(true); setActiveSearchIndex((index) => (index + 1) % searchResults.length); return; }
              if (event.key === 'ArrowUp' && searchResults.length) { event.preventDefault(); setSearchOpen(true); setActiveSearchIndex((index) => (index - 1 + searchResults.length) % searchResults.length); return; }
              if (event.key === 'Enter' && searchResults[activeSearchIndex]) { event.preventDefault(); chooseSearchResult(searchResults[activeSearchIndex]); }
            }}
          />
          {searchOpen && query.trim() && <div id="topology-search-results" className="topology-search-results" role="listbox" aria-label="Topology search results">
            {searchResults.length ? searchResults.map((result, index) => <button id={`topology-search-option-${index}`} key={`${result.kind}:${result.id}`} type="button" role="option" aria-selected={index === activeSearchIndex} data-testid={`search-result-${result.kind}-${result.id}`} onMouseEnter={() => setActiveSearchIndex(index)} onClick={() => chooseSearchResult(result)}><span>{result.kind.toUpperCase()}</span><strong>{result.label}</strong><small>{result.secondary}</small></button>) : <div className="empty-inline">No matching network objects.</div>}
          </div>}
        </div>
        <div className="viewport-actions" aria-label="Topology view controls">
          <button type="button" data-testid="fit-network" onClick={fitNetwork}>Fit</button>
          <button type="button" data-testid="fit-selection" onClick={fitSelection} title="Fit current selection">Selection</button>
          <button type="button" data-testid="zoom-out" aria-label="Zoom out" title="Zoom out" onClick={() => zoomView(1.18)}>−</button>
          <button type="button" data-testid="zoom-in" aria-label="Zoom in" title="Zoom in" onClick={() => zoomView(0.84)}>+</button>
          <button type="button" data-testid="reset-view" className="utility-action" onClick={resetView}>Reset</button>
          <button type="button" data-testid="relayout" className="utility-action" onClick={() => setLayoutGeneration((value) => value + 1)}>Re-layout</button>
        </div>
      </div>

      <div className="topology-filterbar">
        <fieldset className="display-mode"><legend>View</legend>{(['all', 'change-plan', 'violations', 'selected-routes'] as TopologyDisplayMode[]).map((mode) => <label key={mode}><input data-testid={`display-mode-${mode}`} type="radio" name="topology-display" checked={displayMode === mode} onChange={() => setDisplayMode(mode)} />{mode === 'all' ? 'All' : mode === 'change-plan' ? 'Plan' : mode === 'violations' ? 'Violations' : 'Routes'}</label>)}</fieldset>
        {regions.length > 0 && <details className="region-filter"><summary>Regions <span>{enabledRegions.size}/{regions.length}</span></summary><div>{regions.map((region) => <div className="region-filter-row" key={region}><label><input data-testid={`region-filter-${regionSlug(region)}`} type="checkbox" checked={enabledRegions.has(region)} onChange={(event) => setEnabledRegions((current) => { const next = new Set(current); if (event.target.checked) next.add(region); else next.delete(region); return next; })} /><span>{region}</span></label><button type="button" className={focusedRegion === region ? 'active' : ''} onClick={() => { setFocusedRegion((current) => current === region ? null : region); const ids = project.nodes.filter((node) => node.region === region).map((node) => node.id); if (ids.length) focusIds(ids, 105); }}>Focus</button></div>)}</div></details>}
        <div className="viewport-readout" data-testid="viewport-readout">{lod === 'out' ? 'Overview' : lod === 'medium' ? 'Network detail' : 'Engineering detail'} · {Math.round(zoomFactor * 100)}%</div>
      </div>

      {multiLinkIds.size > 1 && <div className="multi-selection-bar" data-testid="multi-selection-bar"><strong>{multiLinkIds.size} links selected</strong><button type="button" onClick={() => focusIds([...multiLinkIds].flatMap((id) => { const link = canonicalLinkById.get(id); return link ? [link.source, link.target] : []; }), 100)}>Focus selected</button>{props.onBatchPlannedOutage && <button type="button" onClick={() => props.onBatchPlannedOutage?.([...multiLinkIds].sort())}>Plan outage</button>}{props.onBatchLockLinks && <><button type="button" onClick={() => props.onBatchLockLinks?.([...multiLinkIds].sort(), true)}>Lock selected</button><button type="button" onClick={() => props.onBatchLockLinks?.([...multiLinkIds].sort(), false)}>Unlock selected</button></>}</div>}

      <div className="topology-stage">
        {rendererMode === 'canvas' ? <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className={`topology lod-${lod}`}
          role="img"
          tabIndex={0}
          aria-label={`${project.name} large-network Canvas topology. Use search and object details for keyboard-accessible navigation.`}
          data-testid="topology-canvas"
          data-lod={lod}
          data-renderer="canvas"
          onWheel={zoomAt}
          onPointerDown={beginPan}
          onPointerMove={updateCanvasHover}
          onPointerLeave={() => setHover(null)}
          onPointerUp={finishCanvasPointer}
          onPointerCancel={() => { dragRef.current = null; }}
        /> : (
        <svg
            ref={svgRef}
            className={`topology lod-${lod}`}
            viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
            role="img"
            aria-label={`${project.name} network topology. Use search and object details for keyboard-accessible navigation.`}
            data-testid="topology-canvas"
            data-lod={lod}
            data-renderer="svg"
            onWheel={zoomAt}
            onPointerDown={(event) => { const target = event.target as Element; if (event.target !== event.currentTarget && !target.classList.contains('topology-pan-surface')) return; beginPan(event); }}
            onPointerMove={movePan}
            onPointerUp={() => { dragRef.current = null; }}
            onPointerCancel={() => { dragRef.current = null; }}
          >
            <rect x={-1200} y={-760} width={3600} height={2280} className="topology-pan-surface" />
            {regions.map((region) => {
              if (!enabledRegions.has(region)) return null;
              const bounds = regionBounds.get(region); if (!bounds) return null;
              return <g key={`region:${region}`} className={`region-hull ${focusedRegion && focusedRegion !== region ? 'dimmed' : ''}`}><rect x={bounds.minX - 56} y={bounds.minY - 68} width={bounds.width + 112} height={bounds.height + 124} rx={44} /><text x={bounds.minX - 30} y={bounds.minY - 48}>{region}</text></g>;
            })}
            <g className="link-layer">
              {snapshot.links.map((link) => {
                const source = layout[link.source]; const target = layout[link.target]; if (!source || !target || !nodeVisible(link.source) || !nodeVisible(link.target)) return null;
                const utilization = props.analysisAuthoritative ? (analysis.routing.linkUtilizationPct[link.id] ?? 0) : 0;
                const disabled = link.available === false;
                const selected = props.selectedLinkIds.has(link.id) || props.selectedLinkId === link.id || multiLinkIds.has(link.id);
                const dimmed = shouldDimLink(link.id, link.source, link.target);
                const priority = linkPriority(link.id);
                const classes = [
                  'link-line', disabled ? 'disabled' : utilization > 100 ? 'overloaded' : utilization > 80 ? 'high' : '',
                  props.plannedOutageLinkIds.has(link.id) ? 'planned-outage' : '', props.plannedChangedLinkIds.has(link.id) ? 'planned-change' : '',
                  props.proposalLinkIds.has(link.id) ? 'proposal-link' : '', props.lockedLinkIds.has(link.id) ? 'locked-link' : '',
                  props.violationLinkIds.has(link.id) ? 'violation-link' : '', selected ? 'selected' : '', dimmed ? 'dimmed' : '',
                ].filter(Boolean).join(' ');
                const showLabel = lod === 'in' ? (priority || project.links.length <= 80) : lod === 'medium' ? priority : priority && (selected || props.violationLinkIds.has(link.id) || props.plannedChangedLinkIds.has(link.id));
                const linkDx = target.x - source.x; const linkDy = target.y - source.y; const linkLength = Math.hypot(linkDx, linkDy); const linkAngleDeg = Math.atan2(linkDy, linkDx) * 180 / Math.PI;
                const midpointX = (source.x + target.x) / 2; const midpointY = (source.y + target.y) / 2;
                return (
                  <g key={link.id} className="link-group" onPointerEnter={(event) => setHover({ kind: 'link', id: link.id, clientX: event.clientX, clientY: event.clientY })} onPointerMove={(event) => setHover({ kind: 'link', id: link.id, clientX: event.clientX, clientY: event.clientY })} onPointerLeave={() => setHover(null)} onClick={(event) => { event.stopPropagation(); selectLink(link.id, event); }}>
                    <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={classes} style={{ strokeWidth: clamp(1.4 + utilization / 48 + (priority ? 1.5 : 0), 1.4, 7) }} vectorEffect="non-scaling-stroke" />
                    <rect x={source.x} y={source.y - 8} width={linkLength} height={16} transform={`rotate(${linkAngleDeg} ${source.x} ${source.y})`} className="link-hit-target" data-testid={`topology-link-${link.id}`} tabIndex={0} role="button" aria-label={`${link.id}: ${disabled ? 'offline' : props.analysisAuthoritative ? `${pct(utilization)} utilized` : 'not analyzed'}. ${selected ? 'Selected.' : ''}`} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); selectLink(link.id, event); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectLink(link.id, event); } }} />
                    {showLabel && <text x={midpointX} y={midpointY - 8} className={`link-label ${priority ? 'priority-label' : 'normal-context'}`}>{link.id}{lod === 'in' ? ` · ${disabled ? 'OFF' : props.analysisAuthoritative ? `${pct(utilization)} · ${link.capacityGbps}G` : `${link.capacityGbps}G · NOT ANALYZED`}` : ''}{props.lockedLinkIds.has(link.id) ? ' · LOCK' : ''}</text>}
                    {props.plannedOutageLinkIds.has(link.id) && <text x={midpointX} y={midpointY + 11} className="state-badge">OUTAGE</text>}
                    {props.proposalLinkIds.has(link.id) && <text x={midpointX} y={midpointY + 11} className="state-badge proposal">PROPOSAL</text>}
                    {props.violationLinkIds.has(link.id) && <text x={midpointX} y={midpointY + 11} className="state-badge violation">!</text>}
                  </g>
                );
              })}
            </g>
            <g className="node-layer">
              {snapshot.nodes.map((node) => {
                const point = layout[node.id]; if (!point || !nodeVisible(node.id)) return null;
                const selected = props.selectedNodeId === node.id;
                const dimmed = shouldDimNode(node.id);
                const priority = nodePriority(node.id);
                const classes = ['node-circle', node.available === false ? 'disabled-node' : '', props.plannedOutageNodeIds.has(node.id) ? 'planned-outage-node' : '', props.plannedChangedNodeIds.has(node.id) ? 'planned-change-node' : '', props.proposalNodeIds.has(node.id) ? 'proposal-node' : '', props.lockedNodeIds.has(node.id) ? 'locked-node' : '', selected ? 'selected-node' : '', dimmed ? 'dimmed' : ''].filter(Boolean).join(' ');
                const showId = lod !== 'out' || priority;
                const showName = lod === 'in' && (priority || project.nodes.length <= 50);
                return <g key={node.id} transform={`translate(${point.x} ${point.y})`} className="node-group" role="button" onPointerEnter={(event) => setHover({ kind: 'node', id: node.id, clientX: event.clientX, clientY: event.clientY })} onPointerMove={(event) => setHover({ kind: 'node', id: node.id, clientX: event.clientX, clientY: event.clientY })} onPointerLeave={() => setHover(null)} tabIndex={0} data-testid={`topology-node-${node.id}`} aria-pressed={selected} aria-label={`${node.name} ${node.id}${node.region ? `, ${node.region}` : ''}. Select node for Change Plan actions.`} onClick={(event) => { event.stopPropagation(); setMultiLinkIds(new Set()); props.onSelectNode(node.id); setSearchHighlight(null); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMultiLinkIds(new Set()); props.onSelectNode(node.id); } }}><circle r={lod === 'out' ? 7 : lod === 'medium' ? 11 : 16} className={classes} vectorEffect="non-scaling-stroke" />{showId && <text y={lod === 'in' ? -21 : -15} textAnchor="middle" className={`node-id ${priority ? 'priority-label' : ''}`}>{node.id}</text>}{showName && <text y={31} textAnchor="middle" className="node-name">{node.name}</text>}{props.lockedNodeIds.has(node.id) && <text x={14} y={-13} className="node-state-badge">L</text>}</g>;
              })}
            </g>
          </svg>
        )}
      </div>

      <div className="topology-legend" aria-label="Graph legend"><span><i className="legend-line planned" />Planned</span><span><i className="legend-line proposal" />Proposal</span><span><i className="legend-line locked" />Locked</span><span><i className="legend-line violation" />Violation</span><span><i className="legend-line selected" />Selected</span></div>
      {hover && (() => {
        if (hover.kind === 'link') {
          const link = canonicalLinkById.get(hover.id); if (!link) return null;
          const load = props.analysisAuthoritative ? analysis.routing.linkLoadsGbps[link.id] : undefined;
          const util = props.analysisAuthoritative ? analysis.routing.linkUtilizationPct[link.id] : undefined;
          const states = [props.plannedChangedLinkIds.has(link.id) ? 'Planned' : '', props.proposalLinkIds.has(link.id) ? 'Proposal' : '', props.lockedLinkIds.has(link.id) ? 'Locked' : '', props.violationLinkIds.has(link.id) ? 'Violation' : ''].filter(Boolean);
          return <div className="topology-hover-tooltip" role="status" style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}><strong>{link.id}</strong><span>{link.source} ↔ {link.target}</span><span>{link.capacityGbps} Gbps capacity</span><span>{load === undefined || util === undefined ? 'Not analyzed' : `${gbps(load)} load · ${pct(util)} utilized`}</span>{states.length > 0 && <small>{states.join(' · ')}</small>}</div>;
        }
        const node = canonicalNodeById.get(hover.id); if (!node) return null;
        const states = [props.plannedChangedNodeIds.has(node.id) ? 'Planned' : '', props.proposalNodeIds.has(node.id) ? 'Proposal' : '', props.lockedNodeIds.has(node.id) ? 'Locked' : ''].filter(Boolean);
        return <div className="topology-hover-tooltip" role="status" style={{ left: hover.clientX + 14, top: hover.clientY + 14 }}><strong>{node.name}</strong><span>{node.id}{node.region ? ` · ${node.region}` : ''}</span><span>{node.available === false ? 'Unavailable' : 'Available'}</span>{states.length > 0 && <small>{states.join(' · ')}</small>}</div>;
      })()}

    </div>
  );
}
