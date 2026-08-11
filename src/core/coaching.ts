import type { Finding, Measurement, QualityReport, Strength } from '../domain/types'

export interface CoachPayload {
  instruction: string
  guardrails: string[]
  evidence: Array<{
    id: string
    finding: string
    observation: string
    why: string
    likelyCause: string
    phase: string
    priority: string
    confidence: number
    workOn: string
    drill: string
    measurements: Finding['evidence']
  }>
  unavailableMeasurements: Array<{ label: string; reason: string }>
  quality: { score: number; cameraView: string; guidance: string[] }
  overallSummary: string
  strengths: Array<{ title: string; summary: string; confidence: number; evidence: Strength['evidence'] }>
}

export function buildCoachPayload(findings: Finding[], measurements: Measurement[], quality: QualityReport, strengths: Strength[] = [], overallSummary = ''): CoachPayload {
  return {
    instruction: 'Explain the ranked findings in plain golf-coaching language. Preserve the provided values, phases, priority, and uncertainty. Recommend only the supplied drill for each finding.',
    guardrails: [
      'Never create a measurement, threshold, diagnosis, ball-flight claim, or causal claim that is absent from the evidence.',
      'Say when a value is projected, monocular, heuristic, or lacks reference coverage.',
      'Return at most three issues in the supplied order.',
      'Do not convert a low-confidence indication into a fact.',
    ],
    evidence: findings.map((finding) => ({
      id: finding.id,
      finding: finding.title,
      observation: finding.summary,
      why: finding.why,
      likelyCause: finding.likelyCause ?? 'No single cause was validated.',
      phase: finding.phase,
      priority: finding.priority,
      confidence: finding.confidence,
      workOn: finding.workOn,
      drill: finding.drill,
      measurements: finding.evidence,
    })),
    unavailableMeasurements: measurements
      .filter((measurement) => measurement.reliability === 'unavailable')
      .map((measurement) => ({ label: measurement.label, reason: measurement.limitation ?? 'Not observable' })),
    quality: { score: quality.score, cameraView: quality.cameraView, guidance: quality.guidance },
    overallSummary,
    strengths: strengths.map((strength) => ({ title: strength.title, summary: strength.summary, confidence: strength.confidence, evidence: strength.evidence })),
  }
}
