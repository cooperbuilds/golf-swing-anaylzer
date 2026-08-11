import type { CameraView, Measurement, PhaseName, PhaseSegment } from '../domain/types'

export interface EvidenceRuleContract {
  id: string
  measurementKeys: string[]
  supportedViews: Exclude<CameraView, 'unknown'>[]
  minimumMeasurementConfidence: number
  minimumSamples: number
  minimumTemporalCoverage: number
  requiredPhases: PhaseName[]
  minimumPhaseConfidence: number
  requireKinematicPhases: boolean
  requiredLandmarks: string[]
  conclusionBoundary: string
}

export const FINDING_RULE_CONTRACTS: Record<string, EvidenceRuleContract> = {
  'tempo-outlier': {
    id: 'tempo-outlier', measurementKeys: ['tempo_ratio'], supportedViews: ['face-on', 'down-the-line'],
    minimumMeasurementConfidence: 0.64, minimumSamples: 3, minimumTemporalCoverage: 1,
    requiredPhases: ['Address', 'Top', 'Impact'], minimumPhaseConfidence: 0.62, requireKinematicPhases: true,
    requiredLandmarks: ['left wrist', 'right wrist', 'left hip', 'right hip'],
    conclusionBoundary: 'Supports an out-of-band timing observation, not a club-path or contact diagnosis.',
  },
  'pelvis-depth': {
    id: 'pelvis-depth', measurementKeys: ['pelvis_depth_change'], supportedViews: ['down-the-line'],
    minimumMeasurementConfidence: 0.62, minimumSamples: 2, minimumTemporalCoverage: 1,
    requiredPhases: ['Address', 'Impact'], minimumPhaseConfidence: 0.62, requireKinematicPhases: true,
    requiredLandmarks: ['left hip', 'right hip', 'left shoulder', 'right shoulder'],
    conclusionBoundary: 'Supports projected pelvis-depth change only; it does not prove early extension or its cause.',
  },
  'head-movement': {
    id: 'head-movement', measurementKeys: ['head_movement'], supportedViews: ['face-on', 'down-the-line'],
    minimumMeasurementConfidence: 0.62, minimumSamples: 12, minimumTemporalCoverage: 0.75,
    requiredPhases: ['Address', 'Finish'], minimumPhaseConfidence: 0.58, requireKinematicPhases: true,
    requiredLandmarks: ['nose', 'left shoulder', 'right shoulder', 'left hip', 'right hip'],
    conclusionBoundary: 'Supports 2D head translation only; rotation and a causal contact claim remain unobserved.',
  },
  'finish-balance': {
    id: 'finish-balance', measurementKeys: ['finish_balance'], supportedViews: ['face-on', 'down-the-line'],
    minimumMeasurementConfidence: 0.64, minimumSamples: 1, minimumTemporalCoverage: 1,
    requiredPhases: ['Finish'], minimumPhaseConfidence: 0.62, requireKinematicPhases: true,
    requiredLandmarks: ['left hip', 'right hip', 'left foot', 'right foot'],
    conclusionBoundary: 'Supports a centered-finish pose observation; pressure and dynamic balance are not observable.',
  },
  'sequence-order': {
    id: 'sequence-order', measurementKeys: ['sequence_gap'], supportedViews: ['face-on', 'down-the-line'],
    minimumMeasurementConfidence: 0.62, minimumSamples: 6, minimumTemporalCoverage: 0.68,
    requiredPhases: ['Top', 'Impact'], minimumPhaseConfidence: 0.62, requireKinematicPhases: true,
    requiredLandmarks: ['left shoulder', 'right shoulder', 'left hip', 'right hip'],
    conclusionBoundary: 'Supports a monocular peak-speed order indicator, not a lab-grade kinematic sequence.',
  },
}

export const STRENGTH_RULE_CONTRACTS: Record<string, EvidenceRuleContract> = {
  'tempo-in-range': { ...FINDING_RULE_CONTRACTS['tempo-outlier'], id: 'tempo-in-range' },
  'spine-retention': {
    id: 'spine-retention', measurementKeys: ['spine_angle_address', 'spine_angle_impact'], supportedViews: ['face-on', 'down-the-line'],
    minimumMeasurementConfidence: 0.64, minimumSamples: 1, minimumTemporalCoverage: 1,
    requiredPhases: ['Address', 'Impact'], minimumPhaseConfidence: 0.62, requireKinematicPhases: true,
    requiredLandmarks: ['left shoulder', 'right shoulder', 'left hip', 'right hip'],
    conclusionBoundary: 'Supports small projected torso-angle change, not a universal posture judgment.',
  },
  'balanced-finish': { ...FINDING_RULE_CONTRACTS['finish-balance'], id: 'balanced-finish' },
}

export function evidenceRulePasses(
  contract: EvidenceRuleContract,
  measurements: Map<string, Measurement>,
  phases: PhaseSegment[],
  view: CameraView,
): boolean {
  if (view === 'unknown' || !contract.supportedViews.includes(view)) return false
  for (const key of contract.measurementKeys) {
    const measurement = measurements.get(key)
    if (!measurement || measurement.value === null || measurement.reliability !== 'available') return false
    if (measurement.confidence < contract.minimumMeasurementConfidence) return false
    if (measurement.supportedViews && !measurement.supportedViews.includes(view)) return false
    if (measurement.support) {
      if (measurement.support.sampleCount < contract.minimumSamples) return false
      if (measurement.support.temporalCoverage < contract.minimumTemporalCoverage) return false
      if (measurement.support.landmarkVisibility < contract.minimumMeasurementConfidence) return false
    } else if (contract.minimumSamples > 1) return false
  }
  return contract.requiredPhases.every((name) => {
    const phase = phases.find((item) => item.name === name)
    return Boolean(phase
      && phase.confidence >= contract.minimumPhaseConfidence
      && (!contract.requireKinematicPhases || phase.detection === 'kinematic'))
  })
}
