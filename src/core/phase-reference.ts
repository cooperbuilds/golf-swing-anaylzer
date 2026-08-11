import { LANDMARK } from '../domain/landmarks'
import type { AnalysisResult, CameraView, Comparison, Measurement, PhaseComparison, PhaseName, PhaseSegment, PoseFrame } from '../domain/types'
import { clamp, distance, mean, midpoint, nearestFrame } from './geometry'

const TIMING_BY_PHASE: Partial<Record<PhaseName, string>> = {
  Takeaway: 'timing_takeaway_pct',
  Top: 'timing_backswing_pct',
  Transition: 'timing_transition_pct',
  Impact: 'timing_impact_pct',
  Finish: 'timing_follow_through_pct',
}

const JOINTS = [
  LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftElbow, LANDMARK.rightElbow,
  LANDMARK.leftWrist, LANDMARK.rightWrist, LANDMARK.leftHip, LANDMARK.rightHip,
  LANDMARK.leftKnee, LANDMARK.rightKnee, LANDMARK.leftAnkle, LANDMARK.rightAnkle,
]

export function buildPhaseComparisons(
  measurements: Measurement[],
  comparisons: Comparison[],
  phases: PhaseSegment[],
  poseFrames: PoseFrame[],
  cameraView: CameraView,
  previous?: AnalysisResult,
): PhaseComparison[] {
  const comparisonByKey = new Map(comparisons.map((comparison) => [comparison.measurementKey, comparison]))
  const sameViewPrevious = previous && cameraView !== 'unknown' && previous.quality.cameraView === cameraView ? previous : undefined

  return phases.map((phase) => {
    const phaseMeasurements = measurements
      .filter((measurement) => measurement.phase === phase.name && measurement.value !== null)
      .toSorted((a, b) => b.confidence - a.confidence)
    const timingKey = TIMING_BY_PHASE[phase.name]
    const timing = timingKey ? measurements.find((measurement) => measurement.key === timingKey && measurement.value !== null) : undefined
    const selected = [...(timing ? [timing] : []), ...phaseMeasurements].slice(0, 3)
    const features = selected.map((measurement) => {
      const comparison = comparisonByKey.get(measurement.key)
      const reference = comparison?.reference
      return {
        measurementKey: measurement.key,
        label: measurement.label,
        userValue: formatMeasurement(measurement),
        referenceValue: reference ? `${reference.p10.toFixed(1)}–${reference.p90.toFixed(1)} ${unitLabel(reference.unit)}` : 'No licensed range',
        difference: differenceText(measurement, comparison),
        status: comparison?.status ?? 'no-coverage',
        confidence: measurement.confidence,
      }
    })

    if (sameViewPrevious) {
      const currentFrame = nearestFrame(poseFrames, phase.anchorMs)
      const oldPhase = sameViewPrevious.phases.find((item) => item.name === phase.name)
      const oldFrame = oldPhase ? nearestFrame(sameViewPrevious.poseFrames, oldPhase.anchorMs) : undefined
      const poseDifference = currentFrame && oldFrame ? confidenceWeightedPoseDistance(currentFrame, oldFrame) : null
      if (poseDifference && poseDifference.confidence >= 0.5) {
        features.push({
          measurementKey: `personal_pose_${phase.name}`,
          label: 'Normalized body-pose similarity',
          userValue: 'Current swing',
          referenceValue: 'Previous swing',
          difference: `${Math.round(100 * Math.exp(-poseDifference.distance * 2.8))}% similarity`,
          status: 'within-range',
          confidence: poseDifference.confidence,
        })
      }
    }

    const hasTimingReference = features.some((feature) => feature.referenceValue !== 'No licensed range')
    const hasPersonal = features.some((feature) => feature.measurementKey.startsWith('personal_pose_'))
    const referenceKind = hasTimingReference ? 'golfdb-timing-range' : hasPersonal ? 'personal-baseline' : 'none'
    const comparedFeatures = features.filter((feature) => feature.status !== 'no-coverage' && feature.status !== 'low-confidence')
    return {
      phase: phase.name,
      status: comparedFeatures.length > 0 ? (comparedFeatures.length === features.length ? 'compared' : 'partial') : features.length > 0 ? 'partial' : 'unavailable',
      referenceKind,
      confidence: features.length > 0 ? mean(features.map((feature) => feature.confidence)) : 0,
      features,
      note: referenceNote(referenceKind, cameraView),
    }
  })
}

export function confidenceWeightedPoseDistance(a: PoseFrame, b: PoseFrame): { distance: number; confidence: number } | null {
  const aHip = midpoint(a.landmarks[LANDMARK.leftHip], a.landmarks[LANDMARK.rightHip])
  const bHip = midpoint(b.landmarks[LANDMARK.leftHip], b.landmarks[LANDMARK.rightHip])
  const aShoulder = midpoint(a.landmarks[LANDMARK.leftShoulder], a.landmarks[LANDMARK.rightShoulder])
  const bShoulder = midpoint(b.landmarks[LANDMARK.leftShoulder], b.landmarks[LANDMARK.rightShoulder])
  const aScale = Math.max(distance(aHip, aShoulder), 1e-6)
  const bScale = Math.max(distance(bHip, bShoulder), 1e-6)
  let weightedDistance = 0
  let weightTotal = 0
  for (const index of JOINTS) {
    const pa = a.landmarks[index]
    const pb = b.landmarks[index]
    const weight = Math.min(pa.visibility, pb.visibility)
    if (weight < 0.45) continue
    const dx = (pa.x - aHip.x) / aScale - (pb.x - bHip.x) / bScale
    const dy = (pa.y - aHip.y) / aScale - (pb.y - bHip.y) / bScale
    weightedDistance += Math.hypot(dx, dy) * weight
    weightTotal += weight
  }
  if (weightTotal < 4) return null
  return { distance: weightedDistance / weightTotal, confidence: clamp(weightTotal / JOINTS.length) }
}

function differenceText(measurement: Measurement, comparison: Comparison | undefined): string {
  if (!comparison?.reference) return 'Not compared—reference has no matching biomechanical feature'
  if (comparison.status === 'within-range') return 'Inside the central successful timing band'
  const amount = Math.abs(comparison.deviation ?? 0)
  return `${amount.toFixed(measurement.unit === 'ms' ? 0 : 1)} ${unitLabel(measurement.unit)} ${comparison.status === 'below-range' ? 'below' : 'above'} the central band`
}

function referenceNote(kind: PhaseComparison['referenceKind'], view: CameraView): string {
  if (view === 'unknown') return 'Camera view is unknown, so camera-specific reference matching is withheld.'
  if (kind === 'golfdb-timing-range') return 'GolfDB contributes event timing only; it does not provide biomechanical joint-angle ranges.'
  if (kind === 'personal-baseline') return 'Pose difference is against your previous swing from the same camera view, not a professional reference.'
  return 'No licensed pose reference covers this phase yet. User measurements remain visible but are not graded against a professional pose.'
}

function formatMeasurement(measurement: Measurement): string {
  if (measurement.value === null) return 'Unavailable'
  const precision = measurement.unit === 'ms' ? 0 : 1
  return `${measurement.value.toFixed(precision)} ${unitLabel(measurement.unit)}`.trim()
}

function unitLabel(unit: Measurement['unit']): string {
  if (unit === 'x') return ':1'
  if (unit === 'normalized') return ''
  return unit
}
