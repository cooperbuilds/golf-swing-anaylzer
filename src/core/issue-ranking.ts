import type { CameraView, Comparison, Finding, Measurement, PhaseName, PhaseSegment, Priority } from '../domain/types'
import { drillFor } from './drill-catalog'
import { evidenceRulePasses, FINDING_RULE_CONTRACTS } from './evidence-rules'
import { clamp } from './geometry'

interface Candidate extends Finding {
  rankScore: number
}

export function rankFindings(measurements: Measurement[], comparisons: Comparison[], phases: PhaseSegment[] = [], cameraView: CameraView = 'unknown'): Finding[] {
  const byKey = new Map(measurements.map((measurement) => [measurement.key, measurement]))
  const comparisonByKey = new Map(comparisons.map((comparison) => [comparison.measurementKey, comparison]))
  const candidates: Candidate[] = []

  const tempo = byKey.get('tempo_ratio')
  const tempoComparison = comparisonByKey.get('tempo_ratio')
  if (rulePasses('tempo-outlier', byKey, phases, cameraView) && tempoComparison?.reference && ['below-range', 'above-range'].includes(tempoComparison.status)) {
    const fastBackswing = tempoComparison.status === 'below-range'
    const prescription = drillFor(fastBackswing ? 'tempo-outlier-fast' : 'tempo-outlier-slow')
    candidates.push(candidate({
      id: 'tempo-outlier',
      title: fastBackswing ? 'Backswing-to-downswing tempo is compressed' : 'Backswing-to-downswing tempo is stretched',
      summary: `Your measured tempo ratio is ${tempo!.value!.toFixed(2)}:1, outside the central reference band.`,
      why: 'A large timing mismatch can make transition pressure and contact timing harder to repeat, even when positions look sound.',
      where: 'Backswing → impact',
      phase: 'Transition',
      priority: 'medium',
      confidence: combinedConfidence(tempo!, tempoComparison.reference.sampleCount),
      frameMs: tempo!.frameMs ?? 0,
      workOn: prescription.desiredChange,
      likelyCause: fastBackswing ? 'The measured backswing occupies too little time relative to the downswing; the evidence supports a rushed transition, not a club-path diagnosis.' : 'The measured pause is concentrated around the top; the evidence supports a cadence issue, not a positional fault.',
      drill: prescription.drill,
      evidence: [{ measurementKey: 'tempo_ratio', measured: `${tempo!.value!.toFixed(2)}:1`, reference: `${tempoComparison.reference.p10.toFixed(2)}–${tempoComparison.reference.p90.toFixed(2)}:1 across ${tempoComparison.reference.sampleCount} matching GolfDB clips`, confidence: tempo!.confidence }],
    }, 1))
  }

  const pelvis = byKey.get('pelvis_depth_change')
  if (rulePasses('pelvis-depth', byKey, phases, cameraView) && Math.abs(pelvis!.value!) >= 0.18) {
    const prescription = drillFor('pelvis-depth')
    candidates.push(candidate({
      id: 'pelvis-depth',
      title: 'Projected pelvis depth changes sharply into impact',
      summary: `The monocular pelvis-depth indicator changes by ${Math.abs(pelvis!.value!).toFixed(2)} torso lengths from address to impact.`,
      why: 'This pattern can reduce room for the arms, but the current monocular screen does not prove early extension or predict contact by itself.',
      where: 'Early downswing → impact',
      phase: 'Downswing',
      priority: 'medium',
      confidence: Math.min(pelvis!.confidence, 0.62),
      frameMs: pelvis!.frameMs ?? 0,
      workOn: prescription.desiredChange,
      likelyCause: causeFrom(measurements, 'pelvis-depth'),
      drill: prescription.drill,
      evidence: [{ measurementKey: pelvis!.key, measured: `${pelvis!.value!.toFixed(2)} torso lengths`, reference: 'Conservative product screen; the current licensed catalog has no pelvis-depth reference coverage', confidence: pelvis!.confidence }],
    }, 0.88))
  }

  const head = byKey.get('head_movement')
  if (rulePasses('head-movement', byKey, phases, cameraView) && head!.value! >= 0.45) {
    const prescription = drillFor('head-movement')
    const headPhase = phaseAt(phases, head!.frameMs)
    candidates.push(candidate({
      id: 'head-movement',
      title: 'Large head displacement',
      summary: `Your head travels ${head!.value!.toFixed(2)} torso lengths at its widest point.`,
      why: 'Large translation can move the low point and make centered contact less repeatable. Some head rotation is normal; this finding concerns translation.',
      where: `${headPhase} · maximum measured displacement`,
      phase: headPhase,
      priority: 'medium',
      confidence: Math.min(head!.confidence, 0.7),
      frameMs: head!.frameMs ?? 0,
      workOn: prescription.desiredChange,
      likelyCause: causeFrom(measurements, 'head-movement'),
      drill: prescription.drill,
      evidence: [{ measurementKey: head!.key, measured: `${head!.value!.toFixed(2)} torso lengths`, reference: 'Large-motion screen only; no professional head-motion range is bundled', confidence: head!.confidence }],
    }, 0.64))
  }

  const balance = byKey.get('finish_balance')
  if (rulePasses('finish-balance', byKey, phases, cameraView) && balance!.value! >= 0.35) {
    const prescription = drillFor('finish-balance')
    candidates.push(candidate({
      id: 'finish-balance',
      title: 'Finish is not centered over the stance',
      summary: `At finish, the pelvis is offset ${balance!.value!.toFixed(2)} stance widths from the visible foot center.`,
      why: 'An off-center finish pose can be a downstream sign that motion was difficult to organize. Video cannot determine pressure transfer.',
      where: 'Follow-through → finish',
      phase: 'Finish',
      priority: 'medium',
      confidence: Math.min(balance!.confidence, 0.76),
      frameMs: balance!.frameMs ?? 0,
      workOn: prescription.desiredChange,
      likelyCause: causeFrom(measurements, 'finish-balance'),
      drill: prescription.drill,
      evidence: [{ measurementKey: balance!.key, measured: `${balance!.value!.toFixed(2)} stance widths`, reference: 'Conservative stability screen; no bundled professional balance range', confidence: balance!.confidence }],
    }, 0.58))
  }

  const sequence = byKey.get('sequence_gap')
  if (rulePasses('sequence-order', byKey, phases, cameraView) && sequence!.value! < -40) {
    const prescription = drillFor('sequence-order')
    candidates.push(candidate({
      id: 'sequence-order',
      title: 'Upper body appears to peak before the pelvis',
      summary: `Estimated shoulder speed peaks ${Math.abs(sequence!.value!).toFixed(0)} ms before pelvis speed.`,
      why: 'This measured order leaves less time for pelvis motion before peak upper-body speed. It does not establish club path from pose alone.',
      where: 'Transition → early downswing',
      phase: 'Transition',
      priority: 'medium',
      confidence: Math.min(sequence!.confidence, 0.62),
      frameMs: sequence!.frameMs ?? 0,
      workOn: prescription.desiredChange,
      likelyCause: 'The measured rotational-speed order shows the shoulders reaching peak speed first. The video cannot determine whether intent, pressure shift, or mobility produced that order.',
      drill: prescription.drill,
      evidence: [{ measurementKey: sequence!.key, measured: `${sequence!.value!.toFixed(0)} ms shoulder-minus-pelvis peak`, reference: 'Sequencing order heuristic; monocular depth caps confidence', confidence: sequence!.confidence }],
    }, 0.6))
  }

  const ranked = candidates
    .filter((item) => item.confidence >= 0.58)
    .toSorted((a, b) => b.rankScore - a.rankScore)
    .slice(0, 3)
  return ranked.map(({ rankScore: _rankScore, ...finding }) => finding)
}

function causeFrom(measurements: Measurement[], finding: 'pelvis-depth' | 'head-movement' | 'finish-balance'): string {
  const tempo = measurements.find((item) => item.key === 'tempo_ratio')
  const sequence = measurements.find((item) => item.key === 'sequence_gap')
  if (tempo?.value !== null && tempo?.value !== undefined && tempo.confidence >= 0.58 && tempo.value < 2.4) {
    return `Your measured ${tempo.value.toFixed(2)}:1 tempo shows a compressed transition that may contribute to this pattern. The camera cannot prove it is the only cause.`
  }
  if (sequence?.value !== null && sequence?.value !== undefined && sequence.confidence >= 0.52 && sequence.value < -40) {
    return `Shoulder speed peaks ${Math.abs(sequence.value).toFixed(0)} ms before pelvis speed in the measured downswing, which may contribute to this pattern. Monocular depth prevents a stronger causal claim.`
  }
  const labels = { 'pelvis-depth': 'pelvis movement', 'head-movement': 'head translation', 'finish-balance': 'finish position' }
  return `The video confirms the ${labels[finding]} pattern, but it does not isolate a single cause. Use the drill as a movement test rather than assuming a diagnosis.`
}

function candidate(finding: Finding, severity: number): Candidate {
  const priorityWeight: Record<Priority, number> = { high: 1, medium: 0.72, low: 0.45 }
  return { ...finding, rankScore: priorityWeight[finding.priority] * finding.confidence * severity }
}

function rulePasses(id: keyof typeof FINDING_RULE_CONTRACTS, measurements: Map<string, Measurement>, phases: PhaseSegment[], view: CameraView): boolean {
  return evidenceRulePasses(FINDING_RULE_CONTRACTS[id], measurements, phases, view)
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
