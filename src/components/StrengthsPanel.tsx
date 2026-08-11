import { CheckCircle2 } from 'lucide-react'
import type { Strength } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

export function StrengthsPanel({ strengths, onSeek }: { strengths: Strength[]; onSeek: (timeMs: number) => void }) {
  return (
    <section className="strengths-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Keep these</span><h2>What you're doing well</h2></div>
      </div>
      {strengths.length > 0 ? (
        <div className="strength-grid">
          {strengths.map((strength) => (
            <button type="button" key={strength.id} onClick={() => onSeek(strength.frameMs)}>
              <CheckCircle2 size={18} />
              <span><strong>{strength.title}</strong><small>{strength.summary}</small><em>{strength.why}</em></span>
              <ConfidenceBadge value={strength.confidence} compact />
            </button>
          ))}
        </div>
      ) : <p className="strengths-empty">No positive pattern crossed the current evidence threshold. This does not mean nothing is good—it means this recording cannot support a specific claim yet.</p>}
    </section>
  )
}
