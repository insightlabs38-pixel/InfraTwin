'use client';

import { useEffect, useMemo, useState } from 'react';
import type { LinkModel, LinkUpgradeOption } from '@infratwin/model';

interface UpgradeProfileEditorProps {
  links: LinkModel[];
  onApply: (linkIds: string[], options: LinkUpgradeOption[]) => void;
}

function emptyOption(minCapacity: number): LinkUpgradeOption {
  return { capacityGbps: Math.max(10, Math.ceil(minCapacity / 10) * 10 + 10), cost: 1 };
}

export function UpgradeProfileEditor({ links, onApply }: UpgradeProfileEditorProps) {
  const linkKey = links.map((link) => link.id).sort().join('|');
  const maximumCurrent = useMemo(() => Math.max(0, ...links.map((link) => link.capacityGbps)), [links]);
  const [options, setOptions] = useState<LinkUpgradeOption[]>([]);

  useEffect(() => {
    if (links.length === 1) setOptions((links[0].upgradeOptions ?? []).map((option) => ({ ...option })));
    else setOptions([]);
  }, [linkKey]);

  if (!links.length) return null;

  const update = (index: number, patch: Partial<LinkUpgradeOption>) => setOptions((current) => current.map((option, row) => row === index ? { ...option, ...patch } : option));
  const add = () => setOptions((current) => [...current, emptyOption(Math.max(maximumCurrent, ...current.map((option) => option.capacityGbps)))]);

  return (
    <section className="upgrade-editor" data-testid="upgrade-profile-editor" aria-label="Network assumptions and upgrade catalog">
      <div className="workspace-subheading">
        <div><p className="eyebrow">Network assumptions / upgrade catalog</p><strong>{links.length === 1 ? `Selected link ${links[0].id}` : `${links.length} selected links`}</strong></div>
        <small>Base-network design space · not a Change Plan action</small>
      </div>
      <p className="muted compact-copy">Current capacity {links.length === 1 ? `${links[0].capacityGbps} Gbps` : `up to ${maximumCurrent} Gbps`}. Costs remain abstract cost units unless the imported model defines real economics.</p>
      <div className="upgrade-options">
        {options.map((option, index) => (
          <div className="upgrade-option-row" key={`${index}:${option.capacityGbps}`}>
            <label>Capacity Gbps<input aria-label={`Upgrade capacity ${index + 1}`} type="number" min={0} step="1" value={option.capacityGbps} onChange={(event) => update(index, { capacityGbps: Number(event.target.value) })} /></label>
            <label>Cost units<input aria-label={`Upgrade cost ${index + 1}`} type="number" min={0} step="1" value={option.cost} onChange={(event) => update(index, { cost: Number(event.target.value) })} /></label>
            <button type="button" onClick={() => setOptions((current) => current.filter((_, row) => row !== index))}>Remove</button>
          </div>
        ))}
        {!options.length && <div className="empty-inline">No declared upgrade options.</div>}
      </div>
      <div className="inline-actions">
        <button type="button" onClick={add}>+ Add option</button>
        <button type="button" className="primary" data-testid="apply-upgrade-profile" onClick={() => onApply(links.map((link) => link.id), options)}>Apply catalog</button>
      </div>
    </section>
  );
}
