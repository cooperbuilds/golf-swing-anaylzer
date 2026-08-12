import type { CameraView, EvidenceGateDiagnostic, EvidenceMeasurementDiagnostic, EvidencePhaseDiagnostic, Measurement, PhaseName, PhaseSegment } from '../domain/types'

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
    minimumMeasurementConfidence: 0.62, minimumSamples: 3, minimumTemporalCoverage: 1,
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
    requiredPhases: ['Address', 'Impact'], minimumPhaseConfidence: 0.58, requireKinematicPhases: true,
    requiredLandmarks: ['nose', 'left shoulder', 'right shoulder', 'left hip', 'right hip'],
    conclusionBoundary: 'Supports 2D head translation only; rotation and a causal contact claim remain unobserved.',
  },
  'finish-balance': {
    id: 'finish-balance', measurementKeys: ['finish_balance'], supportedViews: ['face-on'],
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
  return evaluateEvidenceRule(contract, measurements, phases, view).passed
}

export function evaluateEvidenceRule(
  contract: EvidenceRuleContract,
  measurements: Map<string, Measurement>,
  phases: PhaseSegment[],
  view: CameraView,
): {
  passed: boolean
  gates: EvidenceGateDiagnostic[]
  measurements: EvidenceMeasurementDiagnostic[]
  phases: EvidencePhaseDiagnostic[]
} {
  const gates: EvidenceGateDiagnostic[] = []
  const measurementDiagnostics: EvidenceMeasurementDiagnostic[] = []
  const phaseDiagnostics: EvidencePhaseDiagnostic[] = []
  const cameraPassed = view !== 'unknown' && contract.supportedViews.includes(view)
  gates.push({
    id: 'camera',
    label: 'Camera compatibility',
    passed: cameraPassed,
    actual: view,
    required: contract.supportedViews.join(' or '),
    reason: cameraPassed ? `The ${view} view is supported.` : view === 'unknown' ? 'Camera view confidence did not clear the known-view gate.' : `The ${view} view is not supported by this rule.`,
  })
  for (const key of contract.measurementKeys) {
    const measurement = measurements.get(key)
    const support = measurement?.support
    const exists = Boolean(measurement)
    const hasValue = measurement?.value !== null && measurement?.value !== undefined
    const available = measurement?.reliability === 'available'
    const confidencePassed = (measurement?.confidence ?? 0) >= contract.minimumMeasurementConfidence
    const viewPassed = !measurement?.supportedViews || (view !== 'unknown' && measurement.supportedViews.includes(view))
    const samplesPassed = support ? support.sampleCount >= contract.minimumSamples : contract.minimumSamples <= 1
    const coveragePassed = support ? support.temporalCoverage >= contract.minimumTemporalCoverage : contract.minimumTemporalCoverage <= 0
    const visibilityPassed = support ? support.landmarkVisibility >= contract.minimumMeasurementConfidence : contract.minimumSamples <= 1
    measurementDiagnostics.push({
      key,
      label: measurement?.label ?? key,
      value: measurement?.value ?? null,
      unit: measurement?.unit ?? 'status',
      reliability: measurement?.reliability ?? 'unavailable',
      confidence: measurement?.confidence ?? 0,
      requiredConfidence: contract.minimumMeasurementConfidence,
      sampleCount: support?.sampleCount ?? null,
      requiredSamples: contract.minimumSamples,
      temporalCoverage: support?.temporalCoverage ?? null,
      requiredTemporalCoverage: contract.minimumTemporalCoverage,
      landmarkVisibility: support?.landmarkVisibility ?? null,
      requiredLandmarkVisibility: contract.minimumMeasurementConfidence,
    })
    gates.push(
      { id: `measurement:${key}:present`, label: `${key} available`, passed: exists && hasValue && available, actual: !exists ? 'missing' : measurement!.reliability, required: 'available with a numeric value', reason: !exists ? 'The measurement was never produced.' : !hasValue ? measurement!.limitation ?? 'The measurement has no numeric value.' : available ? 'The measurement is available.' : measurement!.limitation ?? `Measurement reliability is ${measurement!.reliability}.` },
      { id: `measurement:${key}:confidence`, label: `${key} confidence`, passed: confidencePassed, actual: formatNumber(measurement?.confidence), required: `>= ${contract.minimumMeasurementConfidence.toFixed(2)}`, reason: confidencePassed ? 'Measurement confidence passed.' : `Measurement confidence ${formatNumber(measurement?.confidence)} is below ${contract.minimumMeasurementConfidence.toFixed(2)}.` },
      { id: `measurement:${key}:view`, label: `${key} view support`, passed: viewPassed, actual: view, required: measurement?.supportedViews?.join(' or ') ?? 'any known supported view', reason: viewPassed ? 'The measurement supports this view.' : 'The measurement contract does not support the detected camera view.' },
      { id: `measurement:${key}:samples`, label: `${key} sample count`, passed: samplesPassed, actual: support ? String(support.sampleCount) : 'not recorded', required: `>= ${contract.minimumSamples}`, reason: samplesPassed ? 'Sample count passed.' : `Only ${support?.sampleCount ?? 0} supporting samples were available.` },
      { id: `measurement:${key}:coverage`, label: `${key} temporal coverage`, passed: coveragePassed, actual: formatNumber(support?.temporalCoverage), required: `>= ${contract.minimumTemporalCoverage.toFixed(2)}`, reason: coveragePassed ? 'Temporal coverage passed.' : `Temporal coverage ${formatNumber(support?.temporalCoverage)} is below ${contract.minimumTemporalCoverage.toFixed(2)}.` },
      { id: `measurement:${key}:visibility`, label: `${key} landmark visibility`, passed: visibilityPassed, actual: formatNumber(support?.landmarkVisibility), required: `>= ${contract.minimumMeasurementConfidence.toFixed(2)}`, reason: visibilityPassed ? 'Landmark visibility passed.' : `Landmark visibility ${formatNumber(support?.landmarkVisibility)} is below ${contract.minimumMeasurementConfidence.toFixed(2)}.` },
    )
  }
  for (const name of contract.requiredPhases) {
    const phase = phases.find((item) => item.name === name)
    const confidencePassed = Boolean(phase && phase.confidence >= contract.minimumPhaseConfidence)
    const detectionPassed = Boolean(phase && (!contract.requireKinematicPhases || phase.detection === 'kinematic'))
    const passed = confidencePassed && detectionPassed
    phaseDiagnostics.push({
      phase: name,
      present: Boolean(phase),
      confidence: phase?.confidence ?? null,
      requiredConfidence: contract.minimumPhaseConfidence,
      detection: phase?.detection ?? null,
      requiredDetection: contract.requireKinematicPhases ? 'kinematic' : 'any',
      passed,
    })
    gates.push({
      id: `phase:${name}`,
      label: `${name} phase`,
      passed,
      actual: phase ? `${phase.detection} at ${phase.confidence.toFixed(2)}` : 'missing',
      required: `${contract.requireKinematicPhases ? 'kinematic' : 'any'} at >= ${contract.minimumPhaseConfidence.toFixed(2)}`,
      reason: !phase ? `${name} was not produced.` : !confidencePassed ? `${name} confidence ${phase.confidence.toFixed(2)} is below ${contract.minimumPhaseConfidence.toFixed(2)}.` : !detectionPassed ? `${name} was interpolated rather than detected kinematically.` : `${name} phase evidence passed.`,
    })
  }
  return { passed: gates.every((gate) => gate.passed), gates, measurements: measurementDiagnostics, phases: phaseDiagnostics }
}

function formatNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'not recorded' : value.toFixed(3)
}
