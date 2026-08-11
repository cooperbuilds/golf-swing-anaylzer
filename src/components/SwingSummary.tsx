import { Camera, ShieldCheck } from 'lucide-react'
import type { AnalysisResult } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

export function SwingSummary({ analysis }: { analysis: AnalysisResult }) {
  return (
    <section className="swing-summary panel">
      <div>
        <span className="eyebrow eyebrow--accent"><span /> Your swing</span>
        <h2>{analysis.overallSummary ?? 'Review the evidence-backed priorities below.'}</h2>
      </div>
      <div className="swing-summary__facts">
        <span><Camera size={15} /> {analysis.quality.cameraView}</span>
        <span><ShieldCheck size={15} /> {analysis.findings.length} validated {analysis.findings.length === 1 ? 'priority' : 'priorities'}</span>
        <ConfidenceBadge value={analysis.globalConfidence} />
      </div>
    </section>
  )
}
