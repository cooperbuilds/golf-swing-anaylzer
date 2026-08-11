import { describe, expect, it } from 'vitest'
import { LANDMARK } from '../domain/landmarks'
import { PHASE_NAMES, type AnalysisResult, type Measurement, type PhaseSegment, type Point3D, type PoseFrame } from '../domain/types'
import { DRILL_CATALOG } from './drill-catalog'
import { FINDING_RULE_CONTRACTS } from './evidence-rules'
import { dynamicTimeWarping } from './dtw'
import { extractMeasurements } from './feature-extraction'
import { rankFindings } from './issue-ranking'
import { buildPhaseComparisons, confidenceWeightedPoseDistance } from './phase-reference'
import { segmentSwing } from './phase-segmentation'
import { compareToReferences } from './reference-comparison'
import { identifyStrengths } from './strengths'
import { clubMeasurements, summarizeClubConfidence } from '../services/club-tracker'
import { buildValidationCase } from '../services/validation-export'

function point(x = 0.5, y = 0.5, z = 0, visibility = 0.95): Point3D {
  return { x, y, z, visibility }
}

function frame(index: number, total = 90): PoseFrame {
  const progress = index / (total - 1)
  const swing = Math.sin(progress * Math.PI)
  const landmarks = Array.from({ length: 33 }, () => point())
  landmarks[LANDMARK.nose] = point(0.5 + progress * 0.02, 0.18)
  landmarks[LANDMARK.leftShoulder] = point(0.42, 0.34, -.08 * swing)
  landmarks[LANDMARK.rightShoulder] = point(0.58, 0.34, .08 * swing)
  landmarks[LANDMARK.leftElbow] = point(0.39, 0.46)
  landmarks[LANDMARK.rightElbow] = point(0.61, 0.46)
  landmarks[LANDMARK.leftWrist] = point(0.47 - .2 * swing, 0.56 - .35 * swing)
  landmarks[LANDMARK.rightWrist] = point(0.53 - .2 * swing, 0.56 - .35 * swing)
  landmarks[LANDMARK.leftHip] = point(0.45, 0.57, -.05 * swing)
  landmarks[LANDMARK.rightHip] = point(0.55, 0.57, .05 * swing)
  landmarks[LANDMARK.leftKnee] = point(0.45, 0.73)
  landmarks[LANDMARK.rightKnee] = point(0.55, 0.73)
  landmarks[LANDMARK.leftAnkle] = point(0.43, 0.91)
  landmarks[LANDMARK.rightAnkle] = point(0.57, 0.91)
  landmarks[LANDMARK.leftFoot] = point(0.4, 0.95)
  landmarks[LANDMARK.rightFoot] = point(0.6, 0.95)
  return { frameIndex: index, timeMs: index * 33.333, landmarks, worldLandmarks: landmarks.map((item) => ({ ...item })), meanVisibility: 0.95 }
}

function validatedPhases(confidence = .8): PhaseSegment[] {
  return PHASE_NAMES.map((name, index) => ({ name, startMs: index * 100, endMs: (index + 1) * 100, anchorMs: index * 100 + 50, confidence, detection: ['Address', 'Top', 'Impact', 'Finish'].includes(name) ? 'kinematic' : 'interpolated' }))
}

function supportedMeasurement(key: string, value: number): Measurement {
  return { key, label: key, phase: 'Whole swing', value, unit: 'x', confidence: .9, reliability: 'available', frameMs: 650, observedFrom: 'test', supportedViews: ['face-on', 'down-the-line'], support: { sampleCount: 20, temporalCoverage: 1, landmarkVisibility: .9 } }
}

describe('deterministic swing core', () => {
  it('aligns sequences without mutating them', () => {
    const a = [[0], [1], [2], [3]]
    const b = [[0], [.8], [1.8], [3]]
    const result = dynamicTimeWarping(a, b)
    expect(result).not.toBeNull()
    expect(result!.normalizedDistance).toBeLessThan(.2)
    expect(a).toEqual([[0], [1], [2], [3]])
  })

  it('always returns the nine user-facing phases in order', () => {
    const frames = Array.from({ length: 90 }, (_, index) => frame(index))
    const phases = segmentSwing(frames, 3000)
    expect(phases).toHaveLength(9)
    expect(phases.map((item) => item.name)).toEqual(['Address', 'Takeaway', 'Backswing', 'Top', 'Transition', 'Downswing', 'Impact', 'Follow-through', 'Finish'])
    expect(phases.every((item, index) => index === 0 || item.anchorMs >= phases[index - 1].anchorMs)).toBe(true)
  })

  it('anchors Address to the last stable setup before a delayed swing', () => {
    const frames = Array.from({ length: 150 }, (_, index) => {
      const source = frame(Math.max(0, index - 60), 90)
      return { ...source, frameIndex: index, timeMs: index * 33.333 }
    })
    const phases = segmentSwing(frames, 5000)
    const address = phases.find((item) => item.name === 'Address')!
    const top = phases.find((item) => item.name === 'Top')!
    const impact = phases.find((item) => item.name === 'Impact')!
    expect(address.anchorMs).toBeGreaterThan(1500)
    expect(address.anchorMs).toBeLessThan(top.anchorMs)
    expect(top.anchorMs).toBeLessThan(impact.anchorMs)
  })

  it('withholds club, wrist, and handedness-dependent measurements', () => {
    const frames = Array.from({ length: 90 }, (_, index) => frame(index))
    const phases = segmentSwing(frames, 3000)
    const measurements = extractMeasurements(frames, phases, 'face-on', .9, 'unknown')
    expect(measurements.find((item) => item.key === 'wrist_position')?.reliability).toBe('unavailable')
    expect(measurements.find((item) => item.key === 'lead_arm')?.reliability).toBe('unavailable')
    const club = clubMeasurements({ status: 'unavailable', confidence: .2, method: 'contrast-line-tracker-v1', frames: [], coverage: 0, note: 'not stable' }, phases, 'down-the-line')
    expect(club.every((item) => item.reliability === 'unavailable')).toBe(true)
  })

  it('uses GolfDB only for metrics that exist in the catalog', () => {
    const measurements = [
      { key: 'tempo_ratio', label: 'Tempo', phase: 'Whole swing' as const, value: 3, unit: 'x' as const, confidence: .9, reliability: 'available' as const, frameMs: 1000, observedFrom: 'test' },
      { key: 'spine_angle', label: 'Spine', phase: 'Address' as const, value: 35, unit: 'deg' as const, confidence: .9, reliability: 'available' as const, frameMs: 0, observedFrom: 'test' },
    ]
    const comparisons = compareToReferences(measurements, 'down-the-line')
    expect(comparisons[0].reference?.sampleCount).toBeGreaterThan(100)
    expect(comparisons[1].status).toBe('no-coverage')
    expect(compareToReferences(measurements, 'unknown').every((item) => item.status === 'no-coverage')).toBe(true)
  })

  it('builds phase differences without inventing biomechanical reference ranges', () => {
    const frames = Array.from({ length: 90 }, (_, index) => frame(index))
    const phases = segmentSwing(frames, 3000)
    const measurements = extractMeasurements(frames, phases, 'down-the-line', .9)
    const comparisons = compareToReferences(measurements, 'down-the-line')
    const result = buildPhaseComparisons(measurements, comparisons, phases, frames, 'down-the-line')
    expect(result).toHaveLength(9)
    expect(result.find((item) => item.phase === 'Top')?.features.some((item) => item.referenceValue.includes('No licensed range'))).toBe(true)
    expect(result.find((item) => item.phase === 'Top')?.features.some((item) => item.measurementKey === 'timing_backswing_pct')).toBe(true)
  })

  it('confidence-weights normalized pose comparison and ignores an invisible outlier', () => {
    const a = frame(10)
    const b = frame(10)
    b.landmarks[LANDMARK.leftWrist] = point(5, 5, 0, .01)
    const result = confidenceWeightedPoseDistance(a, b)
    expect(result).not.toBeNull()
    expect(result!.distance).toBeLessThan(.02)
  })

  it('reports strengths only from observable evidence and keeps weak club tracks withheld', () => {
    const measurements = [supportedMeasurement('tempo_ratio', 3.2)]
    const comparisons = compareToReferences(measurements, 'down-the-line')
    expect(identifyStrengths(measurements, comparisons, validatedPhases(), 'down-the-line')[0]?.id).toBe('tempo-in-range')
    expect(summarizeClubConfidence([], 0)).toBe(0)
  })

  it('does not pad the top three and withholds findings when a rule contract is not met', () => {
    const phases = validatedPhases()
    const tempo = supportedMeasurement('tempo_ratio', 1)
    const comparisons = compareToReferences([tempo], 'down-the-line')
    expect(rankFindings([tempo], comparisons, phases, 'down-the-line')).toHaveLength(1)
    expect(rankFindings([{ ...tempo, reliability: 'low-confidence' }], comparisons, phases, 'down-the-line')).toEqual([])
    expect(rankFindings([tempo], comparisons, phases, 'unknown')).toEqual([])
    expect(rankFindings([], [], phases, 'down-the-line')).toEqual([])
  })

  it('requires temporal coverage and camera compatibility before material findings', () => {
    const phases = validatedPhases()
    const head = { ...supportedMeasurement('head_movement', .8), unit: 'torso-lengths' as const, support: { sampleCount: 20, temporalCoverage: .5, landmarkVisibility: .9 } }
    const pelvis = { ...supportedMeasurement('pelvis_depth_change', .3), unit: 'torso-lengths' as const, support: { sampleCount: 2, temporalCoverage: 1, landmarkVisibility: .9 } }
    expect(rankFindings([head], [], phases, 'face-on')).toEqual([])
    expect(rankFindings([pelvis], [], phases, 'face-on')).toEqual([])
  })

  it('maps every finding rule to a drill with an explicit movement relationship', () => {
    for (const issueId of Object.keys(FINDING_RULE_CONTRACTS)) {
      const mappings = Object.values(DRILL_CATALOG).filter((item) => item.issueId === issueId)
      expect(mappings.length).toBeGreaterThan(0)
      expect(mappings.every((item) => item.movement && item.desiredChange && item.relationship)).toBe(true)
    }
  })

  it('exports validation evidence without video bytes or full pose frames', () => {
    const analysis = {
      id: 'video-hash', video: { name: 'swing.mp4' }, globalConfidence: .7,
      quality: { cameraView: 'down-the-line', cameraConfidence: .8, suitable: true, score: .8, factors: [] },
      phases: validatedPhases(), measurements: [], findings: [], strengths: [], poseFrames: [frame(0)],
    } as unknown as AnalysisResult
    const exported = buildValidationCase(analysis)
    expect(exported.videoId).toBe('video-hash')
    expect(exported).not.toHaveProperty('poseFrames')
    expect(JSON.stringify(exported)).not.toContain('landmarks')
  })
})
