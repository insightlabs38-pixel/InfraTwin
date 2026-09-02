import { useEffect, useMemo, useState } from 'react';
import type { ChangePlan, NetworkProject } from '@infratwin/model';
import { SearchableSelect } from './searchable-select';

interface Props {
  project: NetworkProject; plan: ChangePlan;
  onSetBandwidth: (demandId: string, bandwidthGbps: number) => void;
  onAddDemand: (input: { name: string; source: string; target: string; bandwidthGbps: number; serviceClassId: string }) => void;
  onAddGrowth: (demandIds: string[], multiplier: number) => void;
}

export function DemandPlanEditor({ project, plan, onSetBandwidth, onAddDemand, onAddGrowth }: Props) {
  const [demandId, setDemandId] = useState(project.demands[0]?.id ?? '');
  const [bandwidth, setBandwidth] = useState(project.demands[0]?.bandwidthGbps ?? 0);
  const [newName, setNewName] = useState(''); const [source, setSource] = useState(project.nodes[0]?.id ?? ''); const [target, setTarget] = useState(project.nodes[1]?.id ?? project.nodes[0]?.id ?? '');
  const [newBandwidth, setNewBandwidth] = useState(1); const [serviceClassId, setServiceClassId] = useState(project.serviceClasses[0]?.id ?? '');
  const [growthPct, setGrowthPct] = useState(40); const [growthAll, setGrowthAll] = useState(true); const [growthIds, setGrowthIds] = useState<string[]>([]); const [growthQuery,setGrowthQuery]=useState(''); const [growthClass,setGrowthClass]=useState('all');
  const selectedDemand = useMemo(() => project.demands.find((item) => item.id === demandId), [project.demands, demandId]);
  const added = plan.changes.filter((item) => item.type === 'add_demand');
  useEffect(() => { const first = project.demands[0]; setDemandId(first?.id ?? ''); setBandwidth(first?.bandwidthGbps ?? 0); setSource(project.nodes[0]?.id ?? ''); setTarget(project.nodes[1]?.id ?? project.nodes[0]?.id ?? ''); setServiceClassId(project.serviceClasses[0]?.id ?? ''); setGrowthIds([]); setGrowthAll(true); setGrowthQuery(''); setGrowthClass('all'); }, [project.id]);

  const chooseDemand=(id:string)=>{setDemandId(id);setBandwidth(project.demands.find((item)=>item.id===id)?.bandwidthGbps??0);};
  const selectedGrowthIds=growthAll?project.demands.map((item)=>item.id):growthIds;
  const nodeOptions=project.nodes.map((node)=>({value:node.id,label:node.name?`${node.name} · ${node.id}`:node.id,secondary:node.region}));
  const demandOptions=project.demands.map((demand)=>({value:demand.id,label:`${demand.name??demand.id} · ${demand.id}`,secondary:`${demand.source}→${demand.target} · ${demand.serviceClassId}`}));
  const growthVisible=useMemo(()=>{const q=growthQuery.trim().toLocaleLowerCase();return project.demands.filter((demand)=>(growthClass==='all'||demand.serviceClassId===growthClass)&&(!q||`${demand.id} ${demand.name??''} ${demand.source} ${demand.target}`.toLocaleLowerCase().includes(q))).slice(0,80);},[project.demands,growthQuery,growthClass]);
  const addDemandReason=!source||!target?'Select source and target.':source===target?'Source and target must differ.':!serviceClassId?'Select a service class.':!Number.isFinite(newBandwidth)||newBandwidth<0?'Bandwidth must be non-negative.':'';
  const growthReason=!selectedGrowthIds.length?'Select at least one demand.':!Number.isFinite(growthPct)||growthPct< -100?'Growth must be at least -100%.':'';

  return <section className="plan-subsection" data-testid="demand-plan-editor">
    <div className="subsection-title"><span>Traffic</span><strong>Changes stay in this plan</strong></div>
    {project.demands.length>0&&<div className="compact-form"><SearchableSelect label="Existing demand" testId="plan-demand-select" value={demandId} options={demandOptions} onChange={chooseDemand}/><label>Planned bandwidth (Gbps)<input data-testid="plan-demand-bandwidth" type="number" min="0" step="0.1" value={bandwidth} onChange={(event)=>setBandwidth(Number(event.target.value))}/></label><button data-testid="add-demand-bandwidth-change" type="button" disabled={!selectedDemand||!Number.isFinite(bandwidth)||bandwidth<0} title={!selectedDemand?'Select a demand first.':undefined} onClick={()=>selectedDemand&&onSetBandwidth(selectedDemand.id,bandwidth)}>Add traffic change</button></div>}

    <details className="inline-details"><summary>Add new service demand</summary><div className="compact-form"><label>Label<input data-testid="new-demand-name" value={newName} onChange={(event)=>setNewName(event.target.value)} placeholder="Payments replication"/></label><SearchableSelect label="Source" value={source} options={nodeOptions} onChange={setSource} testId="new-demand-source"/><SearchableSelect label="Target" value={target} options={nodeOptions} onChange={setTarget} testId="new-demand-target"/><label>Bandwidth (Gbps)<input data-testid="new-demand-bandwidth" type="number" min="0" step="0.1" value={newBandwidth} onChange={(event)=>setNewBandwidth(Number(event.target.value))}/></label><label>Service class<select data-testid="new-demand-class" value={serviceClassId} onChange={(event)=>setServiceClassId(event.target.value)}>{project.serviceClasses.map((item)=><option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button data-testid="add-new-demand" type="button" disabled={Boolean(addDemandReason)} title={addDemandReason||undefined} onClick={()=>onAddDemand({name:newName.trim()||'Planned demand',source,target,bandwidthGbps:newBandwidth,serviceClassId})}>Add demand to plan</button>{addDemandReason&&<small className="control-help">{addDemandReason}</small>}{added.length>0&&<small>{added.length} new demand{added.length===1?'':'s'} currently planned.</small>}</div></details>

    {project.demands.length>0&&<details className="inline-details"><summary>Add demand growth</summary><div className="compact-form"><label>Growth %<input data-testid="plan-growth-percent" type="number" min="-100" step="1" value={growthPct} onChange={(event)=>setGrowthPct(Number(event.target.value))}/></label><label className="check-row"><input data-testid="growth-all-demands" type="checkbox" checked={growthAll} onChange={(event)=>setGrowthAll(event.target.checked)}/>All {project.demands.length.toLocaleString()} demands</label>{!growthAll&&<><div className="growth-filter-row"><input aria-label="Filter demands for growth" placeholder="Filter demand ID, name, or endpoint" value={growthQuery} onChange={(event)=>setGrowthQuery(event.target.value)}/><select aria-label="Filter growth demands by service class" value={growthClass} onChange={(event)=>setGrowthClass(event.target.value)}><option value="all">All service classes</option>{project.serviceClasses.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></div><div className="checkbox-grid growth-demand-list">{growthVisible.map((demand)=><label className="check-row" key={demand.id}><input data-testid={`growth-demand-${demand.id}`} type="checkbox" checked={growthIds.includes(demand.id)} onChange={(event)=>setGrowthIds((current)=>event.target.checked?[...new Set([...current,demand.id])]:current.filter((id)=>id!==demand.id))}/><span>{demand.id}</span><small>{demand.name??demand.serviceClassId}</small></label>)}</div><small>{growthIds.length} selected · showing {growthVisible.length} of {project.demands.length}. Search to reach additional demands.</small></>}<button data-testid="add-growth-change" type="button" disabled={Boolean(growthReason)} title={growthReason||undefined} onClick={()=>onAddGrowth(selectedGrowthIds,1+growthPct/100)}>Add growth to plan</button>{growthReason&&<small className="control-help">{growthReason}</small>}</div></details>}
  </section>;
}
