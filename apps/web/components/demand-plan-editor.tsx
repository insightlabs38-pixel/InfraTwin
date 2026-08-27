import { useEffect, useMemo, useState } from 'react';
import type { ChangePlan, NetworkProject } from '@infratwin/model';

interface Props {
  project: NetworkProject;
  plan: ChangePlan;
  onSetBandwidth: (demandId: string, bandwidthGbps: number) => void;
  onAddDemand: (input: { name: string; source: string; target: string; bandwidthGbps: number; serviceClassId: string }) => void;
  onAddGrowth: (demandIds: string[], multiplier: number) => void;
}

export function DemandPlanEditor({ project, plan, onSetBandwidth, onAddDemand, onAddGrowth }: Props) {
  const [demandId, setDemandId] = useState(project.demands[0]?.id ?? '');
  const [bandwidth, setBandwidth] = useState(project.demands[0]?.bandwidthGbps ?? 0);
  const [newName, setNewName] = useState('');
  const [source, setSource] = useState(project.nodes[0]?.id ?? '');
  const [target, setTarget] = useState(project.nodes[1]?.id ?? project.nodes[0]?.id ?? '');
  const [newBandwidth, setNewBandwidth] = useState(1);
  const [serviceClassId, setServiceClassId] = useState(project.serviceClasses[0]?.id ?? '');
  const [growthPct, setGrowthPct] = useState(40);
  const [growthAll, setGrowthAll] = useState(true);
  const [growthIds, setGrowthIds] = useState<string[]>([]);
  const selectedDemand = useMemo(() => project.demands.find((item) => item.id === demandId), [project.demands, demandId]);
  const added = plan.changes.filter((item) => item.type === 'add_demand');
  useEffect(() => { const first = project.demands[0]; setDemandId(first?.id ?? ''); setBandwidth(first?.bandwidthGbps ?? 0); setSource(project.nodes[0]?.id ?? ''); setTarget(project.nodes[1]?.id ?? project.nodes[0]?.id ?? ''); setServiceClassId(project.serviceClasses[0]?.id ?? ''); setGrowthIds([]); setGrowthAll(true); }, [project.id]);

  const chooseDemand = (id: string) => {
    setDemandId(id);
    setBandwidth(project.demands.find((item) => item.id === id)?.bandwidthGbps ?? 0);
  };
  const selectedGrowthIds = growthAll ? project.demands.map((item) => item.id) : growthIds;

  return (
    <section className="plan-subsection" data-testid="demand-plan-editor">
      <div className="subsection-title"><span>Traffic</span><strong>Plan, don’t mutate base</strong></div>
      {project.demands.length > 0 && <div className="compact-form">
        <label>Existing demand<select data-testid="plan-demand-select" value={demandId} onChange={(event) => chooseDemand(event.target.value)}>{project.demands.map((demand) => <option value={demand.id} key={demand.id}>{demand.id} · {demand.name ?? demand.id}</option>)}</select></label>
        <label>Planned bandwidth<input data-testid="plan-demand-bandwidth" type="number" min="0" step="0.1" value={bandwidth} onChange={(event) => setBandwidth(Number(event.target.value))} /></label>
        <button data-testid="add-demand-bandwidth-change" type="button" disabled={!selectedDemand || !Number.isFinite(bandwidth) || bandwidth < 0} onClick={() => selectedDemand && onSetBandwidth(selectedDemand.id, bandwidth)}>Add traffic change</button>
      </div>}

      <details className="inline-details"><summary>Add new service demand</summary><div className="compact-form">
        <label>Label<input data-testid="new-demand-name" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Payments replication" /></label>
        <label>Source<select data-testid="new-demand-source" value={source} onChange={(event) => setSource(event.target.value)}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
        <label>Target<select data-testid="new-demand-target" value={target} onChange={(event) => setTarget(event.target.value)}>{project.nodes.map((node) => <option key={node.id} value={node.id}>{node.id}</option>)}</select></label>
        <label>Bandwidth Gbps<input data-testid="new-demand-bandwidth" type="number" min="0" step="0.1" value={newBandwidth} onChange={(event) => setNewBandwidth(Number(event.target.value))} /></label>
        <label>Service class<select data-testid="new-demand-class" value={serviceClassId} onChange={(event) => setServiceClassId(event.target.value)}>{project.serviceClasses.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <button data-testid="add-new-demand" type="button" disabled={!source || !target || source === target || !serviceClassId || !Number.isFinite(newBandwidth) || newBandwidth < 0} onClick={() => onAddDemand({ name: newName.trim() || 'Planned demand', source, target, bandwidthGbps: newBandwidth, serviceClassId })}>Add demand to plan</button>
        {added.length > 0 && <small>{added.length} new demand{added.length === 1 ? '' : 's'} currently planned.</small>}
      </div></details>

      {project.demands.length > 0 && <details className="inline-details"><summary>Add demand growth</summary><div className="compact-form">
        <label>Growth %<input data-testid="plan-growth-percent" type="number" min="-100" step="1" value={growthPct} onChange={(event) => setGrowthPct(Number(event.target.value))} /></label>
        <label className="check-row"><input data-testid="growth-all-demands" type="checkbox" checked={growthAll} onChange={(event) => setGrowthAll(event.target.checked)} /> All demands</label>
        {!growthAll && <div className="checkbox-grid">{project.demands.map((demand) => <label className="check-row" key={demand.id}><input data-testid={`growth-demand-${demand.id}`} type="checkbox" checked={growthIds.includes(demand.id)} onChange={(event) => setGrowthIds((current) => event.target.checked ? [...new Set([...current, demand.id])] : current.filter((id) => id !== demand.id))} />{demand.id}</label>)}</div>}
        <button data-testid="add-growth-change" type="button" disabled={!selectedGrowthIds.length || !Number.isFinite(growthPct) || growthPct < -100} onClick={() => onAddGrowth(selectedGrowthIds, 1 + growthPct / 100)}>Add growth to plan</button>
      </div></details>}
    </section>
  );
}
