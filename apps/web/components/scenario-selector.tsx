import type { ScenarioDefinition } from '@infratwin/scenarios';

type ScenarioSelectorProps = {
  scenarios: ScenarioDefinition[];
  selectedId: string;
  selectedLabel?: string;
  onSelect: (id: ScenarioDefinition['id']) => void;
};

export function ScenarioSelector({ scenarios, selectedId, selectedLabel, onSelect }: ScenarioSelectorProps) {
  const imported = !scenarios.some((item) => item.id === selectedId);
  return (
    <label className="network-selector-control">
      <span>Network</span>
      <select data-testid="network-selector" aria-label="Current network" value={selectedId} onChange={(event) => onSelect(event.target.value as ScenarioDefinition['id'])}>
        {imported && <option value={selectedId}>{selectedLabel ?? 'Imported network'}</option>}
        {scenarios.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
    </label>
  );
}
