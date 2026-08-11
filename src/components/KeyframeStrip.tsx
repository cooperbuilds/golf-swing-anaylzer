import { nearestFrame } from '../core/geometry'
import { POSE_CONNECTIONS } from '../domain/landmarks'
import type { PhaseSegment, PoseFrame } from '../domain/types'

interface KeyframeStripProps {
  phases: PhaseSegment[]
  poseFrames: PoseFrame[]
  currentMs: number
  onSeek: (timeMs: number) => void
}

export function KeyframeStrip({ phases, poseFrames, currentMs, onSeek }: KeyframeStripProps) {
  return (
    <div className="keyframe-strip" aria-label="Detected phase keyframes">
      {phases.map((phase) => {
        const frame = nearestFrame(poseFrames, phase.anchorMs)
        const active = currentMs >= phase.startMs && currentMs <= phase.endMs
        return (
          <button type="button" key={phase.name} className={active ? 'is-active' : ''} onClick={() => onSeek(phase.anchorMs)}>
            <PoseThumbnail frame={frame} />
            <span>{phase.name}</span>
          </button>
        )
      })}
    </div>
  )
}

function PoseThumbnail({ frame }: { frame?: PoseFrame }) {
  if (!frame) return <span className="keyframe-empty">No pose</span>
  return (
    <svg viewBox="0 0 100 100" role="img" aria-label="Pose skeleton at this phase">
      {POSE_CONNECTIONS.map(([from, to]) => {
        const a = frame.landmarks[from]
        const b = frame.landmarks[to]
        if (!a || !b || Math.min(a.visibility, b.visibility) < 0.42) return null
        return <line key={`${from}-${to}`} x1={a.x * 100} y1={a.y * 100} x2={b.x * 100} y2={b.y * 100} />
      })}
    </svg>
  )
}
