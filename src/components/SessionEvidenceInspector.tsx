import type { SessionEvidenceDiagnostic } from '../domain/types'

export function SessionEvidenceInspector({ diagnostics }: { diagnostics: SessionEvidenceDiagnostic[] }) {
  return (
    <section className="evidence-inspector panel" aria-label="Developer session evidence inspector">
      <div className="panel-heading"><div><span className="eyebrow">Developer only</span><h2>Session evidence inspector</h2></div><span className="evidence-inspector__summary">{diagnostics.filter((item) => item.status === 'passed').length} passed · {diagnostics.filter((item) => item.status === 'withheld').length} withheld</span></div>
      <div className="evidence-inspector__rules">
        {diagnostics.map((diagnostic) => (
          <details className={`evidence-rule evidence-rule--${diagnostic.status}`} key={`${diagnostic.issueId}:${diagnostic.direction}`} open>
            <summary><span className="evidence-rule__status">{diagnostic.status}</span><strong>{diagnostic.title}</strong><small>{diagnostic.reason}</small></summary>
            <div className="evidence-rule__body">
              <dl className="evidence-rule__facts">
                <div><dt>Direction</dt><dd>{diagnostic.direction}</dd></div>
                <div><dt>Independent support</dt><dd>{diagnostic.supportingSwingCount} / {diagnostic.eligibleSwingCount} eligible swings</dd></div>
                <div><dt>Videos</dt><dd>{diagnostic.supportingVideoCount}</dd></div>
                <div><dt>Persistence</dt><dd>{diagnostic.persistence.toFixed(2)} / {diagnostic.requiredPersistence.toFixed(2)}</dd></div>
                <div><dt>Median materiality</dt><dd>{diagnostic.medianMateriality.toFixed(2)} / {diagnostic.requiredMedianMateriality.toFixed(2)}</dd></div>
                <div><dt>Confidence</dt><dd>{diagnostic.confidence?.toFixed(2) ?? 'withheld'} · cap {diagnostic.confidenceCap.toFixed(2)}</dd></div>
              </dl>
            </div>
          </details>
        ))}
      </div>
    </section>
  )
}
