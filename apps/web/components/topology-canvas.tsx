import { useMemo } from 'react';
import type { NetworkProject } from '@infratwin/model';
import type { CapacityAnalysis } from '@infratwin/evidence';

interface TopologyCanvasProps {
  project: NetworkProject;
  analysis: CapacityAnalysis;
  selectedLinkIds: Set<string>;
  selectedLinkId: string | null;
  selectedNodeId: string | null;
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
}

function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
function gbps(value: number): string { return `${Math.round(value * 100) / 100} Gbps`; }

export function TopologyCanvas(props: TopologyCanvasProps) {
  const { project, analysis } = props;
  const snapshot = analysis.snapshot;
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);
  if (snapshot.nodes.length === 0) return <div className="empty-canvas" data-testid="topology-empty"><strong>Blank project</strong><p>Import a valid InfraTwin JSON model to populate the workspace.</p></div>;

  return (
    <svg className="topology" viewBox="0 0 700 455" role="img" aria-label={`${project.name} network topology`} data-testid="topology-canvas">
      {snapshot.links.map((link) => {
        const source = nodeById.get(link.source); const target = nodeById.get(link.target); if (!source || !target) return null;
        const utilization = analysis.routing.linkUtilizationPct[link.id] ?? 0;
        const disabled = link.available === false;
        const selected = props.selectedLinkIds.has(link.id) || props.selectedLinkId === link.id;
        const classes = [
          'link-line', disabled ? 'disabled' : utilization > 100 ? 'overloaded' : utilization > 80 ? 'high' : '',
          props.plannedOutageLinkIds.has(link.id) ? 'planned-outage' : '', props.plannedChangedLinkIds.has(link.id) ? 'planned-change' : '',
          props.proposalLinkIds.has(link.id) ? 'proposal-link' : '', props.lockedLinkIds.has(link.id) ? 'locked-link' : '',
          props.violationLinkIds.has(link.id) ? 'violation-link' : '', selected ? 'selected' : '',
        ].filter(Boolean).join(' ');
        const canonical = project.links.find((item) => item.id === link.id);
        return (
          <g key={link.id} className="link-group" onClick={() => props.onSelectLink(link.id)} tabIndex={0} role="button" data-testid={`topology-link-${link.id}`} aria-label={`${link.id} ${disabled ? 'disabled' : `${pct(utilization)} utilized`}. Select link for Change Plan action.`} aria-pressed={props.selectedLinkId === link.id} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelectLink(link.id); } }}>
            <line x1={source.x} y1={source.y} x2={target.x} y2={target.y} style={{ strokeWidth: Math.min(12, 4 + utilization / 18) }} className={classes} />
            <text x={((source.x ?? 0) + (target.x ?? 0)) / 2} y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 10} className="link-label">{link.id} · {disabled ? 'OFF' : `${pct(utilization)} · ${link.capacityGbps}G`}{props.lockedLinkIds.has(link.id) ? ' · 🔒' : ''}</text>
            <title>{`${link.id}: ${gbps(analysis.routing.linkLoadsGbps[link.id] ?? 0)} / ${gbps(link.capacityGbps)}${canonical && canonical.capacityGbps !== link.capacityGbps ? ' planned override' : ''}`}</title>
          </g>
        );
      })}
      {snapshot.nodes.map((node) => {
        const selected = props.selectedNodeId === node.id;
        const classes = ['node-circle', node.available === false ? 'disabled-node' : '', props.plannedOutageNodeIds.has(node.id) ? 'planned-outage-node' : '', props.plannedChangedNodeIds.has(node.id) ? 'planned-change-node' : '', props.proposalNodeIds.has(node.id) ? 'proposal-node' : '', props.lockedNodeIds.has(node.id) ? 'locked-node' : '', selected ? 'selected-node' : ''].filter(Boolean).join(' ');
        return <g key={node.id} transform={`translate(${node.x ?? 0} ${node.y ?? 0})`} className="node-group" role="button" tabIndex={0} data-testid={`topology-node-${node.id}`} aria-pressed={selected} onClick={() => props.onSelectNode(node.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); props.onSelectNode(node.id); } }}><circle r="31" className={classes} /><text y="4" textAnchor="middle" className="node-id">{node.id}</text><text y="49" textAnchor="middle" className="node-name">{node.name}{props.lockedNodeIds.has(node.id) ? ' 🔒' : ''}</text></g>;
      })}
    </svg>
  );
}
