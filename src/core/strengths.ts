import type { CameraView, Comparison, Measurement, PhaseSegment, Strength } from '../domain/types'
import { evidenceRulePasses, STRENGTH_RULE_CONTRACTS } from './evidence-rules'

export function identifyStrengths(measurements: Measurement[], comparisons: Comparison[], phases: PhaseSegment[] = [], cameraView: CameraView = 'unknown'): Strength[] {
  const byKey = new Map(measurements.map((measurement) => [measurement.key, measurement]))
  const comparisonByKey = new Map(comparisons.map((comparison) => [comparison.measurementKey, comparison]))
  const strengths: Strength[] = []
  const tempo = byKey.get('tempo_ratio')
  const tempoComparison = comparisonByKey.get('tempo_ratio')
  if (rulePasses('tempo-in-range', byKey, phases, cameraView) && tempoComparison?.status === 'within-range' && tempoComparison.reference) {
    strengths.push({
      id: 'tempo-in-range',
      title: 'Your measured tempo is inside the timing reference range',
      summary: `Your backswing-to-downswing ratio is ${tempo!.value!.toFixed(2)}:1, inside the central GolfDB timing band.`,
      why: 'This single swing provides no evidence that overall tempo needs to be your first change. Repeatability requires multiple swings and is not claimed here.',
      phase: 'Whole swing',
      confidence: combined(tempo!.confidence, tempoComparison.reference.sampleCount),
      frameMs: tempo!.frameMs ?? 0,
      evidence: [{ measurementKey: tempo!.key, measured: `${tempo!.value!.toFixed(2)}:1`, reference: `${tempoComparison.reference.p10.toFixed(2)}–${tempoComparison.reference.p90.toFixed(2)}:1 across ${tempoComparison.reference.sampleCount} matching clips`, confidence: tempo!.confidence }],
    })
  }

  const addressSpine = byKey.get('spine_angle_address')
  const impactSpine = byKey.get('spine_angle_impact')
  if (rulePasses('spine-retention', byKey, phases, cameraView)) {
    const change = Math.abs(impactSpine!.value! - addressSpine!.value!)
    if (change <= 9) strengths.push({
      id: 'spine-retention',
      title: 'Your projected torso angle changes little into impact',
      summary: `Your screen-space spine angle changes by ${change.toFixed(1)}° from address to impact.`,
      why: 'The measured torso line stays comparatively stable through the strike. This is a within-swing observation, not a claim that one address angle fits every golfer.',
      phase: 'Impact',
      confidence: Math.min(addressSpine!.confidence, impactSpine!.confidence, 0.76),
      frameMs: impactSpine!.frameMs ?? 0,
      evidence: [{ measurementKey: 'spine_angle_change', measured: `${change.toFixed(1)}° address-to-impact change`, reference: 'Compared with your own address posture; no professional angle range applied', confidence: Math.min(addressSpine!.confidence, impactSpine!.confidence) }],
    })
  }

  const balance = byKey.get('finish_balance')
  if (rulePasses('balanced-finish', byKey, phases, cameraView) && balance!.value! <= 0.22) strengths.push({
    id: 'balanced-finish',
    title: 'Your finish is visually centered',
    summary: `At finish, your pelvis is ${balance!.value!.toFixed(2)} stance widths from the visible foot center.`,
    why: 'The pose evidence shows a stable-looking finish position. Treat this as a visual balance indicator because pressure under each foot is not observable from video.',
    phase: 'Finish',
    confidence: Math.min(balance!.confidence, 0.78),
    frameMs: balance!.frameMs ?? 0,
    evidence: [{ measurementKey: balance!.key, measured: `${balance!.value!.toFixed(2)} stance widths`, reference: 'Within-swing visual stability screen; no force-plate claim', confidence: balance!.confidence }],
  })

  return strengths.toSorted((a, b) => b.confidence - a.confidence).slice(0, 3)
}

export function summarizeSwing(strengths: Strength[], findings: { title: string }[], confidence: number): string {
  if (findings.length === 0 && strengths.length === 0) return 'This recording did not provide enough stable evidence for a useful coaching conclusion. Improve the camera setup and try again.'
  if (findings.length === 0) return `${strengths[0]?.title ?? 'The measurable parts of this swing look stable'}. No issue passed the confidence and materiality gates, so the analyzer is not forcing a fault.`
  const lead = `Your first priority is ${findings[0].title.toLowerCase()}.`
  const positive = strengths[0] ? ` A useful foundation: ${strengths[0].title.toLowerCase()}.` : ''
  const caution = confidence < 0.58 ? ' Treat this as directional because the recording confidence is limited.' : ''
  return lead + positive + caution
}

function rulePasses(id: keyof typeof STRENGTH_RULE_CONTRACTS, measurements: Map<string, Measurement>, phases: PhaseSegment[], view: CameraView): boolean {
  return evidenceRulePasses(STRENGTH_RULE_CONTRACTS[id], measurements, phases, view)
}

function combined(confidence: number, sampleCount: number): number {
  return Math.min(1, confidence * 0.8 + Math.min(sampleCount / 400, 1) * 0.2)
}
