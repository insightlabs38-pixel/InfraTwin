'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import type { LinkModel, LinkUpgradeOption, NetworkProject } from '@infratwin/model';
import type { CapacityAnalysis } from '@infratwin/evidence';
import { computeDeterministicLayout, layoutBounds, layoutCacheKey, searchTopology, topologyRegions, type TopologyDisplayMode } from '../lib/topology-workspace';
import { UpgradeProfileEditor } from './upgrade-profile-editor';

interface TopologyCanvasProps {
  project: NetworkProject;
  analysis: CapacityAnalysis;
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
  onApplyUpgradeProfile?: (linkIds: string[], options: LinkUpgradeOption[]) => void;
}

interface ViewBoxState { x: number; y: number; width: number; height: number }
interface DragState { clientX: number; clientY: number; viewBox: ViewBoxState }

const CANVAS_WIDTH = 1200;
const CANVAS_HEIGHT = 760;

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
  const dragRef = useRef<DragState | null>(null);
  const [layoutGeneration, setLayoutGeneration] = useState(0);
  const [viewBox, setViewBox] = useState<ViewBoxState>({ x: 0, y: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT });
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [displayMode, setDisplayMode] = useState<TopologyDisplayMode>('all');
  const [focusedRegion, setFocusedRegion] = useState<string | null>(null);
  const [enabledRegions, setEnabledRegions] = useState<Set<string>>(new Set());
  const [multiLinkIds, setMultiLinkIds] = useState<Set<string>>(new Set());
  const [searchHighlight, setSearchHighlight] = useState<{ kind: 'node' | 'link' | 'demand'; id: string } | null>(null);

  const regions = useMemo(() => topologyRegions(project), [project]);
  useEffect(() => { setEnabledRegions(new Set(regions)); setFocusedRegion(null); setMultiLinkIds(new Set()); setSearchHighlight(null); }, [project.id, regions.join('|')]);

  const layoutKey = useMemo(() => layoutCacheKey(project, layoutGeneration > 0), [project, layoutGeneration]);
  const layout = useMemo(() => computeDeterministicLayout(project, { ignoreExplicit: layoutGeneration > 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT }), [layoutKey]);
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);
  const canonicalNodeById = useMemo(() => new Map(project.nodes.map((node) => [node.id, node])), [project.nodes]);
  const canonicalLinkById = useMemo(() => new Map(project.links.map((link) => [link.id, link])), [project.links]);
  const routeByDemand = useMemo(() => new Map(analysis.routing.routes.map((route) => [route.demandId, route])), [analysis.routing.routes]);
  const searchResults = useMemo(() => searchTopology(project, query), [project, query]);
  const selectedDemand = props.selectedDemandId ? project.demands.find((demand) => demand.id === props.selectedDemandId) : undefined;
  const selectedLink = props.selectedLinkId ? canonicalLinkById.get(props.selectedLinkId) : undefined;
  const selectedNode = props.selectedNodeId ? canonicalNodeById.get(props.selectedNodeId) : undefined;

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

  const selectLink = (linkId: string, event: ReactMouseEvent | ReactKeyboardEvent) => {
    const additive = Boolean('metaKey' in event && (event.metaKey || event.ctrlKey || event.shiftKey));
    if (!additive) setMultiLinkIds(new Set([linkId]));
    else setMultiLinkIds((current) => { const next = new Set(current); if (next.has(linkId)) next.delete(linkId); else next.add(linkId); return next; });
    props.onSelectLink(linkId);
    setSearchHighlight(null);
  };

  const selectedCatalogLinks = useMemo(() => {
    const ids = multiLinkIds.size ? [...multiLinkIds] : props.selectedLinkId ? [props.selectedLinkId] : [];
    return ids.map((id) => canonicalLinkById.get(id)).filter((link): link is LinkModel => Boolean(link));
  }, [multiLinkIds, props.selectedLinkId, canonicalLinkById]);

  if (snapshot.nodes.length === 0) return <div className="empty-canvas" data-testid="topology-empty"><strong>Blank project</strong><p>Import canonical JSON or a CSV bundle to populate the engineering workspace.</p></div>;

  return (
    <div className="topology-workspace" data-testid="topology-workspace">
      <div className="topology-toolbar">
        <div className="topology-search-wrap">
          <label htmlFor="topology-search" className="sr-only">Search topology</label>
          <input id="topology-search" data-testid="topology-search" value={query} placeholder="Search node, link, or demand" onFocus={() => { if (query.trim()) setSearchOpen(true); }} onChange={(event) => { setQuery(event.target.value); setSearchHighlight(null); setSearchOpen(true); }} onKeyDown={(event) => { if (event.key === 'Escape') { setSearchOpen(false); return; } if (event.key === 'Enter' && searchResults[0]) chooseSearchResult(searchResults[0]); }} />
          {searchOpen && query.trim() && <div className="topology-search-results" role="listbox" aria-label="Topology search results">
            {searchResults.length ? searchResults.map((result) => <button key={`${result.kind}:${result.id}`} type="button" role="option" data-testid={`search-result-${result.kind}-${result.id}`} onClick={() => chooseSearchResult(result)}><span>{result.kind.toUpperCase()}</span><strong>{result.label}</strong><small>{result.secondary}</small></button>) : <div className="empty-inline">No matching semantic objects.</div>}
          </div>}
        </div>
        <div className="viewport-actions">
          <button type="button" data-testid="fit-network" onClick={fitNetwork}>Fit network</button>
          <button type="button" data-testid="fit-selection" onClick={fitSelection}>Fit selection</button><button type="button" data-testid="zoom-in" onClick={() => zoomView(0.84)}>Zoom in</button><button type="button" data-testid="zoom-out" onClick={() => zoomView(1.18)}>Zoom out</button>
          <button type="button" data-testid="reset-view" onClick={resetView}>Reset view</button>
          <button type="button" data-testid="relayout" onClick={() => setLayoutGeneration((value) => value + 1)}>Re-layout</button>
        </div>
      </div>

      <div className="topology-filterbar">
        <fieldset className="display-mode"><legend>Show</legend>{(['all', 'change-plan', 'violations', 'selected-routes'] as TopologyDisplayMode[]).map((mode) => <label key={mode}><input data-testid={`display-mode-${mode}`} type="radio" name="topology-display" checked={displayMode === mode} onChange={() => setDisplayMode(mode)} />{mode === 'all' ? 'All' : mode === 'change-plan' ? 'Change Plan' : mode === 'violations' ? 'Violations' : 'Selected routes'}</label>)}</fieldset>
        {regions.length > 0 && <details className="region-filter" open={regions.length <= 6}><summary>Regions <span>{enabledRegions.size}/{regions.length}</span></summary><div>{regions.map((region) => <label key={region}><input data-testid={`region-filter-${regionSlug(region)}`} type="checkbox" checked={enabledRegions.has(region)} onChange={(event) => setEnabledRegions((current) => { const next = new Set(current); if (event.target.checked) next.add(region); else next.delete(region); return next; })} /><span>{region}</span><button type="button" className={focusedRegion === region ? 'active' : ''} onClick={(event) => { event.preventDefault(); setFocusedRegion((current) => current === region ? null : region); const ids = project.nodes.filter((node) => node.region === region).map((node) => node.id); if (ids.length) focusIds(ids, 105); }}>Focus</button></label>)}</div></details>}
        <div className="viewport-readout" data-testid="viewport-readout">{lod === 'out' ? 'Overview' : lod === 'medium' ? 'Network detail' : 'Engineering detail'} · {Math.round(zoomFactor * 100)}%</div>
      </div>

      {multiLinkIds.size > 1 && <div className="multi-selection-bar" data-testid="multi-selection-bar"><strong>{multiLinkIds.size} links selected</strong><button type="button" onClick={() => focusIds([...multiLinkIds].flatMap((id) => { const link = canonicalLinkById.get(id); return link ? [link.source, link.target] : []; }), 100)}>Focus selected</button>{props.onBatchPlannedOutage && <button type="button" onClick={() => props.onBatchPlannedOutage?.([...multiLinkIds].sort())}>Plan outage</button>}{props.onBatchLockLinks && <><button type="button" onClick={() => props.onBatchLockLinks?.([...multiLinkIds].sort(), true)}>Lock selected</button><button type="button" onClick={() => props.onBatchLockLinks?.([...multiLinkIds].sort(), false)}>Unlock selected</button></>}</div>}

      <div className="topology-stage">
        <svg
          ref={svgRef}
          className={`topology lod-${lod}`}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
          role="img"
          aria-label={`${project.name} network topology. Use search and object details for keyboard-accessible navigation.`}
          data-testid="topology-canvas"
          data-lod={lod}
          onWheel={(event) => {
            event.preventDefault();
            const svg = svgRef.current; if (!svg) return;
            const rect = svg.getBoundingClientRect();
            const px = viewBox.x + ((event.clientX - rect.left) / Math.max(1, rect.width)) * viewBox.width;
            const py = viewBox.y + ((event.clientY - rect.top) / Math.max(1, rect.height)) * viewBox.height;
            const factor = event.deltaY > 0 ? 1.18 : 0.84;
            const width = clamp(viewBox.width * factor, 160, 2400);
            const height = width * (CANVAS_HEIGHT / CANVAS_WIDTH);
            const ratioX = (px - viewBox.x) / viewBox.width; const ratioY = (py - viewBox.y) / viewBox.height;
            setViewBox({ x: px - ratioX * width, y: py - ratioY * height, width, height });
          }}
          onPointerDown={(event) => { const target = event.target as Element; if (event.target !== event.currentTarget && !target.classList.contains('topology-pan-surface')) return; dragRef.current = { clientX: event.clientX, clientY: event.clientY, viewBox }; event.currentTarget.setPointerCapture(event.pointerId); }}
          onPointerMove={(event) => { const drag = dragRef.current; const svg = svgRef.current; if (!drag || !svg) return; const rect = svg.getBoundingClientRect(); const dx = (event.clientX - drag.clientX) * drag.viewBox.width / Math.max(1, rect.width); const dy = (event.clientY - drag.clientY) * drag.viewBox.height / Math.max(1, rect.height); setViewBox({ ...drag.viewBox, x: drag.viewBox.x - dx, y: drag.viewBox.y - dy }); }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          <rect x={-1200} y={-760} width={3600} height={2280} className="topology-pan-surface" />
          {regions.map((region) => {
            if (!enabledRegions.has(region)) return null;
            const bounds = regionBounds.get(region); if (!bounds) return null;
            return <g key={`region:${region}`} className={`region-hull ${focusedRegion && focusedRegion !== region ? 'dimmed' : ''}`}><rect x={bounds.minX - 48} y={bounds.minY - 48} width={bounds.width + 96} height={bounds.height + 96} rx={44} /><text x={bounds.minX - 28} y={bounds.minY - 18}>{region}</text></g>;
          })}
          <g className="link-layer">
            {snapshot.links.map((link) => {
              const source = layout[link.source]; const target = layout[link.target]; if (!source || !target || !nodeVisible(link.source) || !nodeVisible(link.target)) return null;
              const utilization = analysis.routing.linkUtilizationPct[link.id] ?? 0;
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
              const midpointX = (source.x + target.x) / 2; const midpointY = (source.y + target.y) / 2;
              return (
                <g key={link.id} className="link-group" data-testid={`topology-link-${link.id}`} onClick={(event) => { event.stopPropagation(); selectLink(link.id, event); }}>
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={classes} style={{ strokeWidth: clamp(1.4 + utilization / 48 + (priority ? 1.5 : 0), 1.4, 7) }} vectorEffect="non-scaling-stroke" />
                  <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} className="link-hit-target" vectorEffect="non-scaling-stroke" tabIndex={0} role="button" aria-label={`${link.id}: ${disabled ? 'offline' : `${pct(utilization)} utilized`}. ${selected ? 'Selected.' : ''}`} aria-pressed={selected} onClick={(event) => { event.stopPropagation(); selectLink(link.id, event); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectLink(link.id, event); } }} />
                  {showLabel && <text x={midpointX} y={midpointY - 8} className={`link-label ${priority ? 'priority-label' : 'normal-context'}`}>{link.id}{lod === 'in' ? ` · ${disabled ? 'OFF' : `${pct(utilization)} · ${link.capacityGbps}G`}` : ''}{props.lockedLinkIds.has(link.id) ? ' · LOCK' : ''}</text>}
                  {props.plannedOutageLinkIds.has(link.id) && <text x={midpointX} y={midpointY + 11} className="state-badge">OUTAGE</text>}
                  {props.proposalLinkIds.has(link.id) && <text x={midpointX} y={midpointY + 11} className="state-badge proposal">PROPOSAL</text>}
                  {props.violationLinkIds.has(link.id) && <text x={midpointX} y={midpointY + 11} className="state-badge violation">!</text>}
                  <title>{`${link.id}: ${gbps(analysis.routing.linkLoadsGbps[link.id] ?? 0)} / ${gbps(link.capacityGbps)}`}</title>
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
              return <g key={node.id} transform={`translate(${point.x} ${point.y})`} className="node-group" role="button" tabIndex={0} data-testid={`topology-node-${node.id}`} aria-pressed={selected} aria-label={`${node.name} ${node.id}${node.region ? `, ${node.region}` : ''}. Select node for Change Plan actions.`} onClick={(event) => { event.stopPropagation(); setMultiLinkIds(new Set()); props.onSelectNode(node.id); setSearchHighlight(null); }} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMultiLinkIds(new Set()); props.onSelectNode(node.id); } }}><circle r={lod === 'out' ? 7 : lod === 'medium' ? 11 : 16} className={classes} vectorEffect="non-scaling-stroke" />{showId && <text y={lod === 'in' ? -21 : -15} textAnchor="middle" className={`node-id ${priority ? 'priority-label' : ''}`}>{node.id}</text>}{showName && <text y={31} textAnchor="middle" className="node-name">{node.name}</text>}{props.lockedNodeIds.has(node.id) && <text x={14} y={-13} className="node-state-badge">L</text>}</g>;
            })}
          </g>
        </svg>
      </div>

      <div className="topology-legend" aria-label="Graph legend"><span><i className="legend-line normal" />normal</span><span><i className="legend-line planned" />planned change</span><span><i className="legend-line proposal" />proposal / dashed</span><span><i className="legend-line locked" />locked / double outline</span><span><i className="legend-line violation" />violation / ! badge</span><span><i className="legend-line selected" />selected / glow</span></div>

      {(selectedLink || selectedNode || selectedDemand) && <section className="object-inspector" data-testid="object-inspector" aria-live="polite">
        {selectedLink && <><div className="workspace-subheading"><div><p className="eyebrow">Selected link</p><strong>{selectedLink.id} · {selectedLink.source} ↔ {selectedLink.target}</strong></div><small>{pct(analysis.routing.linkUtilizationPct[selectedLink.id] ?? 0)} utilized</small></div><div className="object-facts"><span>Capacity <strong>{selectedLink.capacityGbps} Gbps</strong></span><span>Load <strong>{gbps(analysis.routing.linkLoadsGbps[selectedLink.id] ?? 0)}</strong></span><span>Weight <strong>{selectedLink.weight}</strong></span><span>State <strong>{props.plannedOutageLinkIds.has(selectedLink.id) ? 'Planned outage' : props.violationLinkIds.has(selectedLink.id) ? 'Violation' : 'Available'}</strong></span></div></>}
        {selectedNode && <><div className="workspace-subheading"><div><p className="eyebrow">Selected node</p><strong>{selectedNode.name}</strong></div><small>{selectedNode.id}</small></div><div className="object-facts"><span>Region <strong>{selectedNode.region || 'Unspecified'}</strong></span><span>Type <strong>{selectedNode.type || 'Unspecified'}</strong></span><span>State <strong>{props.plannedOutageNodeIds.has(selectedNode.id) ? 'Planned outage' : selectedNode.available === false ? 'Unavailable' : 'Available'}</strong></span></div></>}
        {selectedDemand && <><div className="workspace-subheading"><div><p className="eyebrow">Selected demand</p><strong>{selectedDemand.name || selectedDemand.id}</strong></div><small>{selectedDemand.id}</small></div><div className="object-facts"><span>Route <strong>{selectedDemand.source} → {selectedDemand.target}</strong></span><span>Bandwidth <strong>{selectedDemand.bandwidthGbps} Gbps</strong></span><span>Class <strong>{selectedDemand.serviceClassId}</strong></span><span>Routed links <strong>{Object.keys(routeByDemand.get(selectedDemand.id)?.linkFractions ?? {}).length}</strong></span></div><p className="muted compact-copy">Use the Change Plan traffic editor to set this demand’s bandwidth or include it in a growth action. The highlighted route is solver-derived.</p></>}
      </section>}

      {props.onApplyUpgradeProfile && selectedCatalogLinks.length > 0 && <UpgradeProfileEditor links={selectedCatalogLinks} onApply={props.onApplyUpgradeProfile} />}
    </div>
  );
}
