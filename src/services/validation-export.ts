import { DRILL_CATALOG } from '../core/drill-catalog'
import { FINDING_RULE_CONTRACTS, STRENGTH_RULE_CONTRACTS } from '../core/evidence-rules'
import type { AnalysisResult } from '../domain/types'

export function buildValidationCase(analysis: AnalysisResult) {
  const measurements = new Map(analysis.measurements.map((item) => [item.key, item]))
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    releaseStatus: 'not-yet-coach-validated',
    videoId: analysis.id,
    videoName: analysis.video.name,
    cameraView: analysis.quality.cameraView,
    cameraConfidence: analysis.quality.cameraConfidence,
    globalConfidence: analysis.globalConfidence,
    quality: {
      suitable: analysis.quality.suitable,
      score: analysis.quality.score,
      factors: analysis.quality.factors,
    },
    phases: analysis.phases.map((phase) => ({ name: phase.name, anchorMs: phase.anchorMs, confidence: phase.confidence, detection: phase.detection })),
    topIssues: analysis.findings.map((finding, index) => {
      const contract = FINDING_RULE_CONTRACTS[finding.id]
      const drill = Object.values(DRILL_CATALOG).find((item) => item.issueId === finding.id && item.drill === finding.drill)
      return {
        rank: index + 1,
        ...finding,
        validationStatus: 'not-yet-coach-validated',
        ruleContract: contract,
        measurementSupport: contract?.measurementKeys.map((key) => measurements.get(key)).filter(Boolean) ?? [],
        drillMapping: drill,
      }
    }),
    strengths: (analysis.strengths ?? []).map((strength) => ({
      ...strength,
      validationStatus: 'not-yet-coach-validated',
      ruleContract: STRENGTH_RULE_CONTRACTS[strength.id],
      measurementSupport: STRENGTH_RULE_CONTRACTS[strength.id]?.measurementKeys.map((key) => measurements.get(key)).filter(Boolean) ?? [],
    })),
    withheld: analysis.measurements
      .filter((measurement) => measurement.reliability === 'unavailable')
      .map((measurement) => ({ key: measurement.key, label: measurement.label, reason: measurement.limitation ?? 'Evidence requirements were not met.' })),
  }
}

export function downloadValidationCase(analysis: AnalysisResult): void {
  const blob = new Blob([JSON.stringify(buildValidationCase(analysis), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safeName(analysis.video.name)}-analyzer-validation.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeName(value: string): string {
  return value.replace(/\.[^.]+$/, '').replaceAll(/[^a-zA-Z0-9_-]/g, '-').replaceAll(/-+/g, '-').replace(/^-|-$/g, '') || 'swing'
}
