import type { ScenarioDefinition } from '@infratwin/scenarios';

type ScenarioSelectorProps = {
  scenarios: ScenarioDefinition[];
  selectedId: string;
  onSelect: (id: ScenarioDefinition['id']) => void;
};

export function ScenarioSelector({ scenarios, selectedId, onSelect }: ScenarioSelectorProps) {
  return (
    <div className="scenario-list" role="list" aria-label="Example and reference networks">
      {scenarios.map((item) => (
        <button
          key={item.id}
          type="button"
          role="listitem"
          data-testid={`scenario-${item.id}`}
          className={`scenario-card ${selectedId === item.id ? 'active' : ''}`}
          aria-pressed={selectedId === item.id}
          onClick={() => onSelect(item.id)}
        >
          <span className="scenario-card-kicker">{item.kind === 'flagship' ? 'Realistic synthetic model' : item.kind === 'blank' ? 'Workspace' : 'Reference network'}</span>
          <strong>{item.title}</strong>
          <small>{item.description}</small>
        </button>
      ))}
    </div>
  );
}
