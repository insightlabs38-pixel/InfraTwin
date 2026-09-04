import type { PlanHistoryEvent } from '@infratwin/model';

export function PlanHistory({ events }: { events: PlanHistoryEvent[] }) {
  return <div className="plan-history" data-testid="plan-history">{events.length===0?<p className="muted">No plan activity yet.</p>:[...events].reverse().slice(0,20).map((event)=><div className={`plan-history-row actor-${event.actor}`} key={event.id}><time suppressHydrationWarning>{event.occurredAt.slice(11,16)}</time><strong className={`actor-chip ${event.actor}`}>{event.actor==='agent'?'Agent':event.actor==='system'?'System':'Human'}</strong><span>{event.summary}</span></div>)}</div>;
}
