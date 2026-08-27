import type { PlanHistoryEvent } from '@infratwin/model';

export function PlanHistory({ events }: { events: PlanHistoryEvent[] }) {
  return (
    <div className="plan-history" data-testid="plan-history">
      {events.length === 0 ? <p className="muted">No semantic plan activity yet.</p> : [...events].reverse().slice(0, 12).map((event) => (
        <div className="plan-history-row" key={event.id}>
          <time suppressHydrationWarning>{event.occurredAt.slice(11, 16)}</time>
          <strong>{event.actor === 'agent' ? 'Optimizer' : event.actor === 'system' ? 'System' : 'Human'}</strong>
          <span>{event.summary}</span>
        </div>
      ))}
    </div>
  );
}
