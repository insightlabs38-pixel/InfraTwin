import { useMemo } from 'react';
import type { NetworkProject } from '@infratwin/model';
import type { CapacityAnalysis } from '@infratwin/evidence';

interface TopologyCanvasProps {
  project: NetworkProject;
  analysis: CapacityAnalysis;
  selectedLinkIds: Set<string>;
  candidateLinkIds: Set<string>;
  selectedLinkId: string | null;
  onSelectLink: (linkId: string) => void;
}

function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function gbps(value: number): string {
  return `${Math.round(value * 100) / 100} Gbps`;
}

export function TopologyCanvas({
  project,
  analysis,
  selectedLinkIds,
  candidateLinkIds,
  selectedLinkId,
  onSelectLink,
}: TopologyCanvasProps) {
  const snapshot = analysis.snapshot;
  const nodeById = useMemo(() => new Map(snapshot.nodes.map((node) => [node.id, node])), [snapshot.nodes]);

  if (snapshot.nodes.length === 0) {
    return (
      <div className="empty-canvas" data-testid="topology-empty">
        <strong>Blank project</strong>
        <p>Import a valid InfraTwin JSON model to populate the workspace.</p>
      </div>
    );
  }

  return (
    <svg
      className="topology"
      viewBox="0 0 700 455"
      role="img"
      aria-label={`${project.name} network topology`}
      data-testid="topology-canvas"
    >
      {snapshot.links.map((link) => {
        const source = nodeById.get(link.source);
        const target = nodeById.get(link.target);
        if (!source || !target) return null;
        const utilization = analysis.routing.linkUtilizationPct[link.id] ?? 0;
        const disabled = link.available === false;
        const overloaded = utilization > 100;
        const high = utilization > 80;
        const selected = selectedLinkIds.has(link.id) || selectedLinkId === link.id;
        const candidateLink = candidateLinkIds.has(link.id);
        const canonical = project.links.find((item) => item.id === link.id);
        return (
          <g
            key={link.id}
            className="link-group"
            onClick={() => onSelectLink(link.id)}
            tabIndex={0}
            role="button"
            data-testid={`topology-link-${link.id}`}
            aria-label={`${link.id} ${disabled ? 'disabled' : `${pct(utilization)} utilized`}. Select link for engineering edit.`}
            aria-pressed={selectedLinkId === link.id}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelectLink(link.id);
              }
            }}
          >
            <line
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              style={{ strokeWidth: Math.min(12, 4 + utilization / 18) }}
              className={`link-line ${disabled ? 'disabled' : overloaded ? 'overloaded' : high ? 'high' : ''} ${selected ? 'selected' : ''} ${candidateLink ? 'candidate-link' : ''}`}
            />
            <text
              x={((source.x ?? 0) + (target.x ?? 0)) / 2}
              y={((source.y ?? 0) + (target.y ?? 0)) / 2 - 10}
              className="link-label"
            >
              {link.id} · {disabled ? 'OFF' : `${pct(utilization)} · ${link.capacityGbps}G`}
            </text>
            <title>{`${link.id}: ${gbps(analysis.routing.linkLoadsGbps[link.id] ?? 0)} / ${gbps(link.capacityGbps)}${canonical && canonical.capacityGbps !== link.capacityGbps ? ' scenario override' : ''}`}</title>
          </g>
        );
      })}
      {snapshot.nodes.map((node) => (
        <g key={node.id} transform={`translate(${node.x ?? 0} ${node.y ?? 0})`}>
          <circle r="31" className={`node-circle ${node.available === false ? 'disabled-node' : ''}`} />
          <text y="4" textAnchor="middle" className="node-id">{node.id}</text>
          <text y="49" textAnchor="middle" className="node-name">{node.name}</text>
        </g>
      ))}
    </svg>
  );
}
