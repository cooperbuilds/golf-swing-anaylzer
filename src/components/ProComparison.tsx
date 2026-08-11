import { useState } from 'react'
import { GitCompareArrows, UserRound } from 'lucide-react'
import { nearestFrame } from '../core/geometry'
import { LANDMARK, POSE_CONNECTIONS } from '../domain/landmarks'
import type { AnalysisResult, PhaseComparison, PhaseName, PoseFrame } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

type CompareMode = 'user' | 'reference' | 'difference'

export function ProComparison({ analysis, previous, onSeek }: { analysis: AnalysisResult; previous?: AnalysisResult; onSeek: (timeMs: number) => void }) {
  const comparisons = analysis.phaseComparisons ?? []
  const [phaseName, setPhaseName] = useState<PhaseName>('Impact')
  const [mode, setMode] = useState<CompareMode>('difference')
  const phase = analysis.phases.find((item) => item.name === phaseName) ?? analysis.phases[0]
  const phaseComparison = comparisons.find((item) => item.phase === phaseName)
  const userFrame = nearestFrame(analysis.poseFrames, phase.anchorMs)
  const previousPhase = previous?.quality.cameraView === analysis.quality.cameraView ? previous.phases.find((item) => item.name === phaseName) : undefined
  const referenceFrame = previousPhase && previous ? nearestFrame(previous.poseFrames, previousPhase.anchorMs) : undefined

  return (
    <section className="pro-comparison panel">
      <div className="panel-heading">
        <div><span className="eyebrow">User → reference → difference</span><h2>Compare with reference</h2></div>
        <span className="reference-kind">{referenceLabel(phaseComparison?.referenceKind)}</span>
      </div>
      <div className="comparison-toolbar">
        <div className="comparison-phases">
          {analysis.phases.map((item) => <button type="button" key={item.name} className={item.name === phaseName ? 'is-active' : ''} onClick={() => { setPhaseName(item.name); onSeek(item.anchorMs) }}>{item.name}</button>)}
        </div>
        <div className="comparison-modes" aria-label="Comparison display mode">
          {(['user', 'reference', 'difference'] as const).map((item) => <button type="button" key={item} className={mode === item ? 'is-active' : ''} onClick={() => setMode(item)}>{item}</button>)}
        </div>
      </div>
      <div className="comparison-body">
        <div className="pose-compare-stage">
          {mode !== 'reference' && userFrame ? <PoseFigure frame={userFrame} className="pose-user" /> : null}
          {mode !== 'user' && referenceFrame ? <PoseFigure frame={referenceFrame} className="pose-reference" /> : null}
          {mode !== 'user' && !referenceFrame ? <div className="reference-missing"><UserRound size={26} /><strong>No licensed pose exemplar loaded</strong><p>Timing ranges can still be compared. Upload another swing from the same view for a personal pose baseline, or add a rights-cleared aggregate pose profile.</p></div> : null}
          <div className="pose-legend"><span className="is-user">Your pose</span><span className="is-reference">Reference / previous</span></div>
        </div>
        <div className="phase-differences">
          <div className="phase-differences__heading"><GitCompareArrows size={17} /><span><strong>{phaseName}</strong><small>{phaseComparison?.note ?? 'This stored analysis predates phase comparison.'}</small></span></div>
          {phaseComparison?.features.length ? phaseComparison.features.map((feature) => (
            <article key={feature.measurementKey}>
              <div><span>User</span><strong>{feature.userValue}</strong></div>
              <div><span>Reference</span><strong>{feature.referenceValue}</strong></div>
              <div><span>Difference</span><strong>{feature.difference}</strong></div>
              <ConfidenceBadge value={feature.confidence} compact />
            </article>
          )) : <p className="no-phase-reference">No compatible reference feature is available for this phase. The analyzer will not turn an unsupported pose into a pro comparison.</p>}
        </div>
      </div>
    </section>
  )
}

function PoseFigure({ frame, className }: { frame: PoseFrame; className: string }) {
  const hip = midpoint(frame, LANDMARK.leftHip, LANDMARK.rightHip)
  const shoulder = midpoint(frame, LANDMARK.leftShoulder, LANDMARK.rightShoulder)
  const scale = Math.max(Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y), 1e-6)
  const point = (index: number) => ({ x: 50 + (frame.landmarks[index].x - hip.x) / scale * 27, y: 62 + (frame.landmarks[index].y - hip.y) / scale * 27 })
  return <svg className={className} viewBox="0 0 100 100" role="img" aria-label={`${className === 'pose-user' ? 'User' : 'Reference'} normalized pose`}>
    {POSE_CONNECTIONS.map(([from, to]) => {
      if (Math.min(frame.landmarks[from].visibility, frame.landmarks[to].visibility) < 0.45) return null
      const a = point(from); const b = point(to)
      return <line key={`${from}-${to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
    })}
  </svg>
}

function midpoint(frame: PoseFrame, a: number, b: number) {
  return { x: (frame.landmarks[a].x + frame.landmarks[b].x) / 2, y: (frame.landmarks[a].y + frame.landmarks[b].y) / 2 }
}

function referenceLabel(kind: PhaseComparison['referenceKind'] | undefined): string {
  if (kind === 'golfdb-timing-range') return 'GolfDB timing range'
  if (kind === 'personal-baseline') return 'Your previous swing'
  if (kind === 'licensed-pose-profile') return 'Licensed pose profile'
  return 'No pose reference'
}
