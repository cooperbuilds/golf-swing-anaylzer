import { CircleCheckBig, CircleDot, Sparkles, TrendingUp } from 'lucide-react'
import type { ReactNode } from 'react'
import type { AnalysisResult } from '../domain/types'

export function ProgressComparison({ analysis }: { analysis: AnalysisResult }) {
  const delta = analysis.progressDelta
  if (!delta) return null
  return (
    <section className="progress-comparison panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Previous → current</span><h2>What changed</h2></div>
        {delta.tempoChange === null ? null : <span className="tempo-change"><TrendingUp size={14} /> Tempo {delta.tempoChange >= 0 ? '+' : ''}{delta.tempoChange.toFixed(2)}</span>}
      </div>
      <div className="progress-comparison__grid">
        <ProgressColumn icon={<CircleCheckBig size={16} />} title="Improving" items={delta.improving} empty={delta.comparableQuality ? 'No priority has cleared the finding gate yet.' : 'New footage quality is not comparable.'} />
        <ProgressColumn icon={<CircleDot size={16} />} title="Persistent" items={delta.persistent} empty="No priority persisted." />
        <ProgressColumn icon={<Sparkles size={16} />} title="New" items={delta.newIssues} empty="No new priority crossed the gate." />
      </div>
      <p>“Improving” means the prior finding did not recur in footage of comparable quality; it does not prove the movement is fully resolved.</p>
    </section>
  )
}

function ProgressColumn({ icon, title, items, empty }: { icon: ReactNode; title: string; items: string[]; empty: string }) {
  return <div><span>{icon}{title}</span>{items.length ? items.map((item) => <strong key={item}>{item}</strong>) : <em>{empty}</em>}</div>
}
