import { formatTimestamp } from '../core/geometry'
import type { Finding, PhaseSegment } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

interface PhaseTimelineProps {
  phases: PhaseSegment[]
  findings?: Finding[]
  durationMs: number
  currentMs: number
  onSeek: (timeMs: number) => void
}

export function PhaseTimeline({ phases, findings = [], durationMs, currentMs, onSeek }: PhaseTimelineProps) {
  return (
    <section className="timeline-card panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Swing map</span><h2>Nine detected phases</h2></div>
        <span className="muted">Select a phase to inspect</span>
      </div>
      <div className="phase-track" aria-label="Swing phase timeline">
        <span className="phase-playhead" style={{ left: `${Math.min(100, currentMs / durationMs * 100)}%` }} />
        {phases.map((phase, index) => (
          <button
            type="button"
            key={phase.name}
            className={currentMs >= phase.startMs && currentMs <= phase.endMs ? 'is-active' : ''}
            style={{ width: `${Math.max(6, (phase.endMs - phase.startMs) / durationMs * 100)}%` }}
            onClick={() => onSeek(phase.anchorMs)}
            title={`${phase.name} · ${formatTimestamp(phase.anchorMs)}`}
          >
            {findings.some((finding) => finding.phase === phase.name) ? <i className="phase-finding" aria-hidden="true" /> : null}
            <span>{String(index + 1).padStart(2, '0')}</span>
            <strong>{phase.name}</strong>
            <small>{formatTimestamp(phase.anchorMs)}</small>
          </button>
        ))}
      </div>
      <div className="timeline-legend">
        <ConfidenceBadge value={Math.min(...phases.map((phase) => phase.confidence))} compact />
        <span>Interpolated phases inherit lower confidence from detected anchors.</span>
      </div>
    </section>
  )
}
