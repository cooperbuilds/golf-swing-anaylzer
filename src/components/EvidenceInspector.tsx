import type { EvidenceRuleDiagnostic } from '../domain/types'

export function EvidenceInspector({ diagnostics }: { diagnostics: EvidenceRuleDiagnostic[] }) {
  const passed = diagnostics.filter((item) => item.status === 'passed').length
  const withheld = diagnostics.filter((item) => item.status === 'withheld').length
  const notGenerated = diagnostics.filter((item) => item.status === 'not-generated').length
  return (
    <section className="evidence-inspector panel" aria-label="Developer evidence inspector">
      <div className="panel-heading">
        <div><span className="eyebrow">Developer only</span><h2>Evidence inspector</h2></div>
        <span className="evidence-inspector__summary">{passed} passed · {withheld} withheld · {notGenerated} not generated</span>
      </div>
      <p className="evidence-inspector__intro">Every deterministic finding rule is listed, including the first exact rejection reason and all downstream gates.</p>
      <div className="evidence-inspector__rules">
        {diagnostics.map((diagnostic) => (
          <details key={diagnostic.issueId} className={`evidence-rule evidence-rule--${diagnostic.status}`} open={diagnostic.status !== 'not-generated'}>
            <summary>
              <span className="evidence-rule__status">{diagnostic.status}</span>
              <strong>{diagnostic.title}</strong>
              <small>{diagnostic.reason}</small>
            </summary>
            <div className="evidence-rule__body">
              <dl className="evidence-rule__facts">
                <div><dt>Camera</dt><dd>{diagnostic.actualCamera} / {diagnostic.requiredCameras.join(' or ')}</dd></div>
                <div><dt>Comparison</dt><dd>{diagnostic.comparisonStatus}</dd></div>
                <div><dt>Materiality</dt><dd>{diagnostic.materialityScore.toFixed(2)} / {diagnostic.requiredMaterialityScore.toFixed(2)}</dd></div>
                <div><dt>Candidate confidence</dt><dd>{format(diagnostic.candidateConfidence)} / {diagnostic.requiredConfidence.toFixed(2)}</dd></div>
                <div><dt>Rank</dt><dd>{diagnostic.rank ?? 'not ranked'}</dd></div>
                <div><dt>Required landmarks</dt><dd>{diagnostic.requiredLandmarks.join(', ')}</dd></div>
              </dl>
              <p className="evidence-rule__boundary"><strong>Conclusion boundary:</strong> {diagnostic.conclusionBoundary}</p>
              <div className="evidence-rule__measurements">
                {diagnostic.measurements.map((measurement) => (
                  <article key={measurement.key}>
                    <strong>{measurement.label}</strong>
                    <span>{format(measurement.value)} {measurement.unit}</span>
                    <small>confidence {measurement.confidence.toFixed(3)} / {measurement.requiredConfidence.toFixed(2)} · reliability {measurement.reliability}</small>
                    <small>samples {measurement.sampleCount ?? 'n/a'} / {measurement.requiredSamples} · coverage {format(measurement.temporalCoverage)} / {measurement.requiredTemporalCoverage.toFixed(2)} · visibility {format(measurement.landmarkVisibility)} / {measurement.requiredLandmarkVisibility.toFixed(2)}</small>
                  </article>
                ))}
              </div>
              <div className="evidence-rule__phases">
                {diagnostic.phases.map((phase) => <span key={phase.phase} className={phase.passed ? 'is-pass' : 'is-fail'}>{phase.phase}: {format(phase.confidence)} / {phase.requiredConfidence.toFixed(2)} · {phase.detection ?? 'missing'} / {phase.requiredDetection}</span>)}
              </div>
              <table className="evidence-rule__gates">
                <thead><tr><th>Gate</th><th>Status</th><th>Actual</th><th>Required</th><th>Reason</th></tr></thead>
                <tbody>{diagnostic.gates.map((gate) => <tr key={gate.id}><td>{gate.label}</td><td>{gate.passed ? 'PASS' : 'FAIL'}</td><td>{gate.actual}</td><td>{gate.required}</td><td>{gate.reason}</td></tr>)}</tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}

function format(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3)
}
