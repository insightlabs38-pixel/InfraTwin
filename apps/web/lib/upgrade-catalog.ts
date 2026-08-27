import type { LinkUpgradeOption, NetworkProject } from '@infratwin/model';
import { cloneProject, validateNetworkProject } from '@infratwin/model';

export function normalizeUpgradeOptions(currentCapacityGbps: number, options: readonly LinkUpgradeOption[]): LinkUpgradeOption[] {
  const normalized = options.map((option) => ({ capacityGbps: Number(option.capacityGbps), cost: Number(option.cost) }))
    .sort((a, b) => a.capacityGbps - b.capacityGbps || a.cost - b.cost);
  let previous = currentCapacityGbps;
  const seen = new Set<number>();
  for (const option of normalized) {
    if (!Number.isFinite(option.capacityGbps) || option.capacityGbps <= currentCapacityGbps) throw new Error(`Upgrade capacity must be greater than ${currentCapacityGbps} Gbps.`);
    if (!Number.isFinite(option.cost) || option.cost < 0) throw new Error('Upgrade cost units must be a non-negative number.');
    if (seen.has(option.capacityGbps) || option.capacityGbps <= previous) throw new Error('Upgrade capacities must be unique and strictly increasing.');
    seen.add(option.capacityGbps);
    previous = option.capacityGbps;
  }
  return normalized;
}

export function applyUpgradeProfile(project: NetworkProject, linkIds: readonly string[], options: readonly LinkUpgradeOption[]): NetworkProject {
  const uniqueIds = [...new Set(linkIds)].sort();
  if (!uniqueIds.length) throw new Error('Select at least one link before assigning an upgrade profile.');
  const next = cloneProject(project);
  for (const linkId of uniqueIds) {
    const link = next.links.find((item) => item.id === linkId);
    if (!link) throw new Error(`Unknown link ${linkId}.`);
    const normalized = normalizeUpgradeOptions(link.capacityGbps, options);
    if (normalized.length) link.upgradeOptions = normalized.map((option) => ({ ...option }));
    else delete link.upgradeOptions;
  }
  const validation = validateNetworkProject(next);
  if (!validation.valid) throw new Error(validation.errors.join('; '));
  return next;
}
