interface AnalysisJourneyProps {
  scenarioLabel: string;
  verdict: 'PASS' | 'FAIL';
  peakUtilizationPct: number;
  violationCount: number;
  primaryFailure?: string | null;
  candidateLabel: string;
  verificationStatus?: 'verified' | 'disagreement' | null;
  nextStep: string;
}

function pct(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

export function AnalysisJourney({
  scenarioLabel,
  verdict,
  peakUtilizationPct,
  violationCount,
  primaryFailure,
  candidateLabel,
  verificationStatus,
  nextStep,
}: AnalysisJourneyProps) {
  return (
    <section className="journey-strip" aria-label="Current engineering decision journey" data-testid="analysis-journey">
      <article className="journey-step">
        <span>1 · What are we testing?</span>
        <strong>{scenarioLabel}</strong>
        <small>One explicit baseline or scenario overlay.</small>
      </article>
      <article className="journey-step topology-step">
        <span>2 · Network topology</span>
        <strong>Live canonical model</strong>
        <small>Routes, load, failures, and selected evidence share stable IDs.</small>
      </article>
      <article className={`journey-step result-step ${verdict === 'PASS' ? 'pass' : 'fail'}`}>
        <span>3 · Result</span>
        <strong data-testid="verdict">{verdict}</strong>
        <small>Peak {pct(peakUtilizationPct)} · {violationCount} modeled violation(s)</small>
      </article>
      <article className={`journey-step why-step ${verdict === 'FAIL' ? 'active' : ''}`}>
        <span>4 · Why?</span>
        <strong>{verdict === 'PASS' ? 'No active violation' : primaryFailure ?? 'Inspect evidence'}</strong>
        <small>{verdict === 'PASS' ? 'The displayed assumptions satisfy their constraints.' : 'Open the evidence panel for the concrete constraint and route.'}</small>
      </article>
      <article className={`journey-step action-step ${verificationStatus === 'verified' ? 'verified' : ''}`}>
        <span>5 · What should we do?</span>
        <strong>{verificationStatus === 'verified' ? 'VERIFIED candidate' : candidateLabel}</strong>
        <small>{nextStep}</small>
      </article>
    </section>
  );
}
