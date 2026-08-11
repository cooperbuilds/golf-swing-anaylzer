import { Camera, CheckCircle2, TriangleAlert } from 'lucide-react'
import type { AnalysisResult } from '../domain/types'

export function QualityPanel({ analysis }: { analysis: AnalysisResult }) {
  return (
    <section className="quality-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Input confidence</span><h2>What the camera supports</h2></div>
        <span className={`quality-score ${analysis.quality.suitable ? 'is-good' : 'is-poor'}`}>{Math.round(analysis.quality.score * 100)}</span>
      </div>
      <div className="quality-grid">
        {analysis.quality.factors.map((factor) => (
          <div key={factor.key}><span>{factor.label}<strong>{Math.round(factor.score * 100)}%</strong></span><i><b style={{ width: `${factor.score * 100}%` }} /></i><small>{factor.message}</small></div>
        ))}
      </div>
      <div className="quality-notes">
        <span><Camera size={15} /> {analysis.video.width}×{analysis.video.height} · {analysis.video.orientation}</span>
        <span>{analysis.quality.suitable ? <CheckCircle2 size={15} /> : <TriangleAlert size={15} />} {analysis.quality.suitable ? 'Suitable for the available analysis' : 'Use recording guidance before trusting results'}</span>
      </div>
      <div className={`club-status club-status--${analysis.clubTracking?.status ?? 'unavailable'}`}>
        <strong>Club tracking: {analysis.clubTracking?.status ?? 'unavailable'}</strong>
        <span>{analysis.clubTracking?.note ?? 'This stored analysis predates club tracking. Re-upload the source video to run it.'}</span>
      </div>
      {analysis.quality.guidance.length > 0 ? <ul>{analysis.quality.guidance.map((item) => <li key={item}>{item}</li>)}</ul> : null}
    </section>
  )
}
