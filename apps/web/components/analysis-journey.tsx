interface AnalysisJourneyProps {
  planLabel: string;
  authority: 'DRAFT' | 'PASS' | 'FAIL' | 'STALE';
  peakUtilizationPct: number;
  violationCount: number;
  primaryFailure?: string | null;
  candidateLabel: string;
  verificationStatus?: 'verified' | 'disagreement' | 'stale' | null;
  nextStep: string;
}
function pct(value: number): string { return `${Math.round(value * 10) / 10}%`; }
export function AnalysisJourney({ planLabel, authority, peakUtilizationPct, violationCount, primaryFailure, candidateLabel, verificationStatus, nextStep }: AnalysisJourneyProps) {
  const pass = authority === 'PASS'; const fail = authority === 'FAIL';
  return <section className="journey-strip" aria-label="Current change planning journey" data-testid="analysis-journey">
    <article className="journey-step"><span>1 · Current Change Plan</span><strong>{planLabel}</strong><small>Human changes, constraints, locks, and proposals share one artifact.</small></article>
    <article className="journey-step topology-step"><span>2 · Planned network</span><strong>Base + non-destructive plan</strong><small>The canonical base stays unchanged until an explicit external apply operation.</small></article>
    <article className={`journey-step result-step ${pass ? 'pass' : fail ? 'fail' : ''}`}><span>3 · Analysis</span><strong data-testid="verdict">{authority}</strong><small>Live peak {pct(peakUtilizationPct)} · {violationCount} modeled violation(s)</small></article>
    <article className={`journey-step why-step ${fail ? 'active' : ''}`}><span>4 · Why?</span><strong>{fail ? primaryFailure ?? 'Inspect evidence' : authority === 'STALE' ? 'Plan changed' : pass ? 'Constraints satisfied' : 'Run analysis'}</strong><small>{fail ? 'Inspect concrete route/capacity evidence.' : authority === 'STALE' ? 'Prior evidence is no longer authoritative.' : 'Analysis is tied to base + semantic plan hash.'}</small></article>
    <article className={`journey-step action-step ${verificationStatus === 'verified' ? 'verified' : ''}`}><span>5 · Revision / verification</span><strong>{verificationStatus === 'verified' ? 'VERIFIED proposal' : verificationStatus === 'stale' ? 'STALE verification' : candidateLabel}</strong><small>{nextStep}</small></article>
  </section>;
}
