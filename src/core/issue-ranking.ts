import type {
  CameraView,
  Comparison,
  EvidenceRuleDiagnostic,
  Finding,
  Measurement,
  PhaseName,
  PhaseSegment,
  Priority,
} from '../domain/types'
import { drillFor } from './drill-catalog'
import { evaluateEvidenceRule, FINDING_RULE_CONTRACTS, type EvidenceRuleContract } from './evidence-rules'
import { clamp } from './geometry'

const MINIMUM_FINDING_CONFIDENCE = 0.58

interface Candidate {
  finding: Finding
  rankScore: number
  diagnosticIndex: number
}

interface Materiality {
  value: number | null
  unit: EvidenceRuleDiagnostic['materialityUnit']
  threshold: number | null
  score: number
  direction: string
  reason: string
}

interface RuleEvaluation {
  id: keyof typeof FINDING_RULE_CONTRACTS
  title: string
  contract: EvidenceRuleContract
  evidence: ReturnType<typeof evaluateEvidenceRule>
  materiality: Materiality
  comparisonStatus: EvidenceRuleDiagnostic['comparisonStatus']
  candidateConfidence: number | null
  provisionalFinding?: Finding
  severity: number
}

export function rankFindings(
  measurements: Measurement[],
  comparisons: Comparison[],
  phases: PhaseSegment[] = [],
  cameraView: CameraView = 'unknown',
): Finding[] {
  return diagnoseFindings(measurements, comparisons, phases, cameraView).findings
}

export function diagnoseFindings(
  measurements: Measurement[],
  comparisons: Comparison[],
  phases: PhaseSegment[] = [],
  cameraView: CameraView = 'unknown',
  qualitySuitable = true,
): { findings: Finding[]; diagnostics: EvidenceRuleDiagnostic[] } {
  const byKey = new Map(measurements.map((measurement) => [measurement.key, measurement]))
  const comparisonByKey = new Map(comparisons.map((comparison) => [comparison.measurementKey, comparison]))
  const evaluations: RuleEvaluation[] = []

  const tempo = byKey.get('tempo_ratio')
  const tempoComparison = comparisonByKey.get('tempo_ratio')
  const tempoStatus = tempoComparison?.status
  const tempoReference = tempoComparison?.reference
  const tempoOutlier = tempoStatus === 'below-range' || tempoStatus === 'above-range'
  const tempoDirection = tempoStatus ?? 'missing'
  const tempoThreshold = tempoStatus === 'below-range' ? tempoReference?.p10 ?? null : tempoStatus === 'above-range' ? tempoReference?.p90 ?? null : null
  const tempoScore = tempo?.value !== null && tempo?.value !== undefined && tempoThreshold
    ? tempoStatus === 'below-range' ? tempoThreshold / Math.max(tempo.value, 1e-6) : tempoStatus === 'above-range' ? tempo.value / Math.max(tempoThreshold, 1e-6) : 0
    : 0
  const tempoConfidence = tempo && tempoReference ? combinedConfidence(tempo, tempoReference.sampleCount) : null
  evaluations.push(makeEvaluation(
    'tempo-outlier',
    'Tempo outside the central timing reference band',
    byKey,
    phases,
    cameraView,
    {
      value: tempo?.value ?? null,
      unit: 'reference-band',
      threshold: tempoThreshold,
      score: tempoOutlier ? tempoScore : 0,
      direction: tempoDirection,
      reason: !tempoReference ? 'No licensed timing reference matched this camera view.' : tempoOutlier ? `Tempo is ${tempoStatus}.` : `Tempo comparison is ${tempoStatus ?? 'missing'}, so no outlier was generated.`,
    },
    tempoComparison?.status ?? 'missing',
    tempoConfidence,
    tempoOutlier && tempo && tempoReference ? tempoFinding(tempo, tempoComparison!) : undefined,
    1,
  ))

  const pelvis = byKey.get('pelvis_depth_change')
  const pelvisValue = Math.abs(pelvis?.value ?? 0)
  evaluations.push(makeEvaluation(
    'pelvis-depth',
    'Projected pelvis depth changes sharply into impact',
    byKey,
    phases,
    cameraView,
    thresholdMateriality(pelvis?.value ?? null, 'torso-lengths', 0.18, pelvisValue / 0.18, 'absolute-depth-change'),
    'not-required',
    pelvis ? Math.min(pelvis.confidence, 0.62) : null,
    pelvis?.value !== null && pelvis?.value !== undefined ? pelvisFinding(pelvis, measurements) : undefined,
    0.88,
  ))

  const head = byKey.get('head_movement')
  const headValue = head?.value ?? 0
  evaluations.push(makeEvaluation(
    'head-movement',
    'Large head displacement through impact',
    byKey,
    phases,
    cameraView,
    thresholdMateriality(head?.value ?? null, 'torso-lengths', 0.45, headValue / 0.45, 'magnitude'),
    'not-required',
    head ? Math.min(head.confidence, 0.7) : null,
    head?.value !== null && head?.value !== undefined ? headFinding(head, phases, measurements) : undefined,
    0.64,
  ))

  const balance = byKey.get('finish_balance')
  const balanceValue = balance?.value ?? 0
  evaluations.push(makeEvaluation(
    'finish-balance',
    'Finish is not centered over the stance',
    byKey,
    phases,
    cameraView,
    thresholdMateriality(balance?.value ?? null, 'normalized', 0.35, balanceValue / 0.35, 'magnitude'),
    'not-required',
    balance ? Math.min(balance.confidence, 0.76) : null,
    balance?.value !== null && balance?.value !== undefined ? balanceFinding(balance, measurements) : undefined,
    0.58,
  ))

  const sequence = byKey.get('sequence_gap')
  const sequenceValue = sequence?.value ?? 0
  evaluations.push(makeEvaluation(
    'sequence-order',
    'Upper body appears to peak before the pelvis',
    byKey,
    phases,
    cameraView,
    thresholdMateriality(sequence?.value ?? null, 'ms', -40, Math.max(0, -sequenceValue / 40), sequenceValue < 0 ? 'upper-body-first' : 'pelvis-first-or-simultaneous'),
    'not-required',
    sequence ? Math.min(sequence.confidence, 0.62) : null,
    sequence?.value !== null && sequence?.value !== undefined ? sequenceFinding(sequence) : undefined,
    0.6,
  ))

  const diagnostics = evaluations.map((evaluation): EvidenceRuleDiagnostic => {
    const materialityPassed = evaluation.materiality.score >= 1
    const confidencePassed = (evaluation.candidateConfidence ?? 0) >= MINIMUM_FINDING_CONFIDENCE
    const evidencePassed = evaluation.evidence.passed
    const candidateReady = Boolean(evaluation.provisionalFinding && evidencePassed && materialityPassed && confidencePassed && qualitySuitable)
    const firstFailedEvidence = evaluation.evidence.gates.find((gate) => !gate.passed)
    const reason = !qualitySuitable
      ? 'Video quality did not pass the analysis-suitability gate.'
      : !evidencePassed
        ? firstFailedEvidence?.reason ?? 'The evidence contract failed.'
        : !evaluation.provisionalFinding
          ? evaluation.materiality.reason
          : !materialityPassed
            ? `Materiality score ${evaluation.materiality.score.toFixed(2)} is below 1.00; measured ${formatValue(evaluation.materiality.value)} versus threshold ${formatValue(evaluation.materiality.threshold)}.`
            : !confidencePassed
              ? `Candidate confidence ${formatValue(evaluation.candidateConfidence)} is below ${MINIMUM_FINDING_CONFIDENCE.toFixed(2)}.`
              : 'Candidate passed evidence, materiality, and confidence gates and is awaiting ranking.'
    const gates = [
      ...evaluation.evidence.gates,
      {
        id: 'materiality', label: 'Materiality', passed: materialityPassed,
        actual: evaluation.materiality.score.toFixed(2), required: '>= 1.00',
        reason: evaluation.materiality.reason,
      },
      {
        id: 'candidate-confidence', label: 'Candidate confidence', passed: confidencePassed,
        actual: formatValue(evaluation.candidateConfidence), required: `>= ${MINIMUM_FINDING_CONFIDENCE.toFixed(2)}`,
        reason: confidencePassed ? 'Candidate confidence passed.' : `Candidate confidence ${formatValue(evaluation.candidateConfidence)} is below ${MINIMUM_FINDING_CONFIDENCE.toFixed(2)}.`,
      },
      {
        id: 'quality', label: 'Video suitability', passed: qualitySuitable,
        actual: qualitySuitable ? 'suitable' : 'unsuitable', required: 'suitable',
        reason: qualitySuitable ? 'Video quality passed.' : 'Video quality did not pass the suitability gate.',
      },
    ]
    return {
      issueId: evaluation.id,
      title: evaluation.provisionalFinding?.title ?? evaluation.title,
      status: candidateReady ? 'withheld' : !evidencePassed || !evaluation.provisionalFinding ? 'not-generated' : 'withheld',
      evidencePassed,
      materialityPassed,
      confidencePassed,
      rank: null,
      reason,
      actualCamera: cameraView,
      requiredCameras: evaluation.contract.supportedViews,
      requiredLandmarks: evaluation.contract.requiredLandmarks,
      conclusionBoundary: evaluation.contract.conclusionBoundary,
      measurements: evaluation.evidence.measurements,
      phases: evaluation.evidence.phases,
      comparisonStatus: evaluation.comparisonStatus,
      materialityValue: evaluation.materiality.value,
      materialityUnit: evaluation.materiality.unit,
      materialityThreshold: evaluation.materiality.threshold,
      materialityScore: evaluation.materiality.score,
      requiredMaterialityScore: 1,
      direction: evaluation.materiality.direction,
      candidateConfidence: evaluation.candidateConfidence,
      requiredConfidence: MINIMUM_FINDING_CONFIDENCE,
      gates,
      provisionalFinding: evaluation.provisionalFinding,
    }
  })

  const candidates: Candidate[] = []
  evaluations.forEach((evaluation, diagnosticIndex) => {
    const diagnostic = diagnostics[diagnosticIndex]
    if (!evaluation.provisionalFinding || !diagnostic.evidencePassed || !diagnostic.materialityPassed || !diagnostic.confidencePassed || !qualitySuitable) return
    candidates.push({ finding: evaluation.provisionalFinding, rankScore: candidateScore(evaluation.provisionalFinding, evaluation.severity), diagnosticIndex })
  })
  const selected = candidates.toSorted((a, b) => b.rankScore - a.rankScore).slice(0, 3)
  selected.forEach((candidate, index) => {
    const diagnostic = diagnostics[candidate.diagnosticIndex]
    diagnostic.status = 'passed'
    diagnostic.rank = index + 1
    diagnostic.reason = `Passed all gates and ranked ${index + 1} of ${candidates.length} generated candidate${candidates.length === 1 ? '' : 's'}.`
    diagnostic.gates.push({ id: 'ranking', label: 'Top-three ranking', passed: true, actual: String(index + 1), required: '<= 3', reason: diagnostic.reason })
  })
  for (const candidate of candidates.filter((item) => !selected.includes(item))) {
    const diagnostic = diagnostics[candidate.diagnosticIndex]
    diagnostic.reason = 'Candidate passed its evidence gates but ranked below the top three.'
    diagnostic.gates.push({ id: 'ranking', label: 'Top-three ranking', passed: false, actual: '> 3', required: '<= 3', reason: diagnostic.reason })
  }
  return { findings: selected.map((candidate) => candidate.finding), diagnostics }
}

function makeEvaluation(
  id: keyof typeof FINDING_RULE_CONTRACTS,
  title: string,
  measurements: Map<string, Measurement>,
  phases: PhaseSegment[],
  cameraView: CameraView,
  materiality: Materiality,
  comparisonStatus: EvidenceRuleDiagnostic['comparisonStatus'],
  candidateConfidence: number | null,
  provisionalFinding: Finding | undefined,
  severity: number,
): RuleEvaluation {
  const contract = FINDING_RULE_CONTRACTS[id]
  return { id, title, contract, evidence: evaluateEvidenceRule(contract, measurements, phases, cameraView), materiality, comparisonStatus, candidateConfidence, provisionalFinding, severity }
}

function thresholdMateriality(value: number | null, unit: Materiality['unit'], threshold: number, score: number, direction: string): Materiality {
  return {
    value,
    unit,
    threshold,
    score: Number.isFinite(score) ? Math.max(0, score) : 0,
    direction,
    reason: value === null ? 'No numeric value was available for the materiality gate.' : `Measured ${formatValue(value)} ${unit}; threshold ${formatValue(threshold)} ${unit}; score ${Math.max(0, score).toFixed(2)} requires >= 1.00.`,
  }
}

function tempoFinding(tempo: Measurement, comparison: Comparison): Finding {
  const fastBackswing = comparison.status === 'below-range'
  const prescription = drillFor(fastBackswing ? 'tempo-outlier-fast' : 'tempo-outlier-slow')
  return {
    id: 'tempo-outlier',
    title: fastBackswing ? 'Backswing-to-downswing tempo is compressed' : 'Backswing-to-downswing tempo is stretched',
    summary: `Your measured tempo ratio is ${tempo.value!.toFixed(2)}:1, outside the central reference band.`,
    why: 'A large timing mismatch can make transition pressure and contact timing harder to repeat, even when positions look sound.',
    where: 'Backswing → impact', phase: 'Transition', priority: 'medium',
    confidence: combinedConfidence(tempo, comparison.reference!.sampleCount), frameMs: tempo.frameMs ?? 0,
    workOn: prescription.desiredChange,
    likelyCause: fastBackswing ? 'The measured backswing occupies too little time relative to the downswing; the evidence supports a rushed transition, not a club-path diagnosis.' : 'The measured pause is concentrated around the top; the evidence supports a cadence issue, not a positional fault.',
    drill: prescription.drill,
    evidence: [{ measurementKey: tempo.key, measured: `${tempo.value!.toFixed(2)}:1`, reference: `${comparison.reference!.p10.toFixed(2)}–${comparison.reference!.p90.toFixed(2)}:1 across ${comparison.reference!.sampleCount} matching GolfDB clips`, confidence: tempo.confidence }],
  }
}

function pelvisFinding(pelvis: Measurement, measurements: Measurement[]): Finding {
  const prescription = drillFor('pelvis-depth')
  return {
    id: 'pelvis-depth', title: 'Projected pelvis depth changes sharply into impact',
    summary: `The monocular pelvis-depth indicator changes by ${Math.abs(pelvis.value!).toFixed(2)} torso lengths from address to impact.`,
    why: 'This pattern can reduce room for the arms, but the current monocular screen does not prove early extension or predict contact by itself.',
    where: 'Early downswing → impact', phase: 'Downswing', priority: 'medium', confidence: Math.min(pelvis.confidence, 0.62), frameMs: pelvis.frameMs ?? 0,
    workOn: prescription.desiredChange, likelyCause: causeFrom(measurements, 'pelvis-depth'), drill: prescription.drill,
    evidence: [{ measurementKey: pelvis.key, measured: `${pelvis.value!.toFixed(2)} torso lengths`, reference: 'Conservative product screen; the current licensed catalog has no pelvis-depth reference coverage', confidence: pelvis.confidence }],
  }
}

function headFinding(head: Measurement, phases: PhaseSegment[], measurements: Measurement[]): Finding {
  const prescription = drillFor('head-movement')
  const headPhase = phaseAt(phases, head.frameMs)
  return {
    id: 'head-movement', title: 'Large head displacement through impact',
    summary: `From address through impact, your head travels ${head.value!.toFixed(2)} torso lengths at its widest point.`,
    why: 'Large translation before impact can move the low point and make centered contact less repeatable. Follow-through motion is excluded.',
    where: `${headPhase} · maximum measured displacement`, phase: headPhase, priority: 'medium', confidence: Math.min(head.confidence, 0.7), frameMs: head.frameMs ?? 0,
    workOn: prescription.desiredChange, likelyCause: causeFrom(measurements, 'head-movement'), drill: prescription.drill,
    evidence: [{ measurementKey: head.key, measured: `${head.value!.toFixed(2)} torso lengths`, reference: 'Conservative address-to-impact translation screen; no professional head-motion range is bundled', confidence: head.confidence }],
  }
}

function balanceFinding(balance: Measurement, measurements: Measurement[]): Finding {
  const prescription = drillFor('finish-balance')
  return {
    id: 'finish-balance', title: 'Finish is not centered over the stance',
    summary: `At finish, the pelvis is offset ${balance.value!.toFixed(2)} stance widths from the visible foot center.`,
    why: 'An off-center finish pose can be a downstream sign that motion was difficult to organize. Video cannot determine pressure transfer.',
    where: 'Follow-through → finish', phase: 'Finish', priority: 'medium', confidence: Math.min(balance.confidence, 0.76), frameMs: balance.frameMs ?? 0,
    workOn: prescription.desiredChange, likelyCause: causeFrom(measurements, 'finish-balance'), drill: prescription.drill,
    evidence: [{ measurementKey: balance.key, measured: `${balance.value!.toFixed(2)} stance widths`, reference: 'Conservative face-on stability screen; no bundled professional balance range', confidence: balance.confidence }],
  }
}

function sequenceFinding(sequence: Measurement): Finding {
  const prescription = drillFor('sequence-order')
  return {
    id: 'sequence-order', title: 'Upper body appears to peak before the pelvis',
    summary: `Estimated shoulder speed peaks ${Math.abs(sequence.value!).toFixed(0)} ms before pelvis speed.`,
    why: 'This measured order leaves less time for pelvis motion before peak upper-body speed. It does not establish club path from pose alone.',
    where: 'Transition → early downswing', phase: 'Transition', priority: 'medium', confidence: Math.min(sequence.confidence, 0.62), frameMs: sequence.frameMs ?? 0,
    workOn: prescription.desiredChange,
    likelyCause: 'The measured rotational-speed order shows the shoulders reaching peak speed first. The video cannot determine whether intent, pressure shift, or mobility produced that order.',
    drill: prescription.drill,
    evidence: [{ measurementKey: sequence.key, measured: `${sequence.value!.toFixed(0)} ms shoulder-minus-pelvis peak`, reference: 'Sequencing order heuristic; monocular depth caps confidence', confidence: sequence.confidence }],
  }
}

function causeFrom(measurements: Measurement[], finding: 'pelvis-depth' | 'head-movement' | 'finish-balance'): string {
  const tempo = measurements.find((item) => item.key === 'tempo_ratio')
  const sequence = measurements.find((item) => item.key === 'sequence_gap')
  if (tempo?.value !== null && tempo?.value !== undefined && tempo.confidence >= 0.58 && tempo.value < 2.4) return `Your measured ${tempo.value.toFixed(2)}:1 tempo shows a compressed transition that may contribute to this pattern. The camera cannot prove it is the only cause.`
  if (sequence?.value !== null && sequence?.value !== undefined && sequence.confidence >= 0.52 && sequence.value < -40) return `Shoulder speed peaks ${Math.abs(sequence.value).toFixed(0)} ms before pelvis speed in the measured downswing, which may contribute to this pattern. Monocular depth prevents a stronger causal claim.`
  const labels = { 'pelvis-depth': 'pelvis movement', 'head-movement': 'head translation', 'finish-balance': 'finish position' }
  return `The video confirms the ${labels[finding]} pattern, but it does not isolate a single cause. Use the drill as a movement test rather than assuming a diagnosis.`
}

function candidateScore(finding: Finding, severity: number): number {
  const priorityWeight: Record<Priority, number> = { high: 1, medium: 0.72, low: 0.45 }
  return priorityWeight[finding.priority] * finding.confidence * severity
}

function combinedConfidence(measurement: Measurement, sampleCount: number): number {
  return clamp(measurement.confidence * 0.78 + Math.min(sampleCount / 400, 1) * 0.22)
}

function phaseAt(phases: PhaseSegment[], timeMs: number | null): PhaseName {
  if (timeMs !== null) {
    const matching = phases.find((phase) => timeMs >= phase.startMs && timeMs <= phase.endMs)
    if (matching) return matching.name
  }
  return 'Downswing'
}

function formatValue(value: number | null): string {
  return value === null ? 'not available' : value.toFixed(3)
}
