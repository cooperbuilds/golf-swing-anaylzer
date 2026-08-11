import type { AnalysisProgress } from '../domain/types'

const STAGES = ['quality', 'pose', 'phases', 'measurements', 'comparison', 'coaching'] as const
const LABELS = ['Video check', 'Pose tracking', 'Swing phases', 'Measurements', 'Reference match', 'Coaching']

export function ProgressPipeline({ progress }: { progress: AnalysisProgress }) {
  const active = progress.stage === 'complete' ? STAGES.length : Math.max(0, STAGES.indexOf(progress.stage as (typeof STAGES)[number]))
  return (
    <div className="progress-card" role="status" aria-live="polite">
      <div className="progress-card__top">
        <div>
          <span className="eyebrow">Analyzing swing</span>
          <h2>{progress.message}</h2>
        </div>
        <strong>{progress.percent}%</strong>
      </div>
      <div className="progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
      <ol className="progress-stages">
        {STAGES.map((stage, index) => (
          <li key={stage} className={index < active ? 'is-complete' : index === active ? 'is-active' : ''}>
            <span>{index < active ? '✓' : index + 1}</span>{LABELS[index]}
          </li>
        ))}
      </ol>
      <p className="muted">The original video stays in this browser. Pose and derived measurements are cached by file fingerprint.</p>
    </div>
  )
}
