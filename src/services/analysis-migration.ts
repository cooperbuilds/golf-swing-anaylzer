import type { AnalysisResult, AnalysisSession, Measurement } from '../domain/types'

export function migrateAnalysis(result: AnalysisResult): AnalysisResult {
  if (result.schemaVersion === 2) return result
  return {
    ...result,
    schemaVersion: 2,
    measurements: result.measurements.map(addMeasurementContract),
    findings: result.findings.map((finding) => ({
      ...finding,
      likelyCause: finding.likelyCause ?? 'This earlier analysis identified the movement pattern but did not store a validated causal link.',
    })),
    strengths: result.strengths ?? [],
    overallSummary: result.overallSummary ?? (result.findings[0]
      ? `Your first stored priority is ${result.findings[0].title.toLowerCase()}. Re-analyze the source video to add strengths, club tracking, and phase comparison.`
      : 'This earlier analysis did not store an overall coaching summary. Re-analyze the source video to use the expanded coaching model.'),
    phaseComparisons: result.phaseComparisons ?? [],
    clubTracking: result.clubTracking ?? {
      status: 'unavailable',
      confidence: 0,
      method: 'contrast-line-tracker-v1',
      frames: [],
      coverage: 0,
      note: 'Club tracking was not part of this stored analysis. Re-upload the source video to run it.',
    },
  }
}

export function migrateSession(session: AnalysisSession): AnalysisSession {
  return {
    ...session,
    analyses: session.analyses.map(migrateAnalysis),
    observations: session.observations ?? [],
    relations: session.relations ?? [],
    findings: session.findings ?? [],
    bestMeasurements: session.bestMeasurements ?? [],
    warnings: session.warnings ?? [],
  }
}

function addMeasurementContract(measurement: Measurement): Measurement {
  if (measurement.sourceKind && measurement.supportedViews && measurement.validityRequirements) return measurement
  const timing = measurement.key.startsWith('timing_') || measurement.key === 'tempo_ratio'
  const world = ['shoulder_turn', 'hip_turn', 'pelvis_rotation', 'sequence_gap', 'pelvis_depth_change'].includes(measurement.key)
  const club = measurement.key.includes('shaft') || measurement.key.includes('swing_plane')
  return {
    ...measurement,
    sourceKind: club ? 'club-tracker' : timing ? 'phase-timing' : world ? 'pose-world' : 'pose-2d',
    supportedViews: measurement.key === 'pelvis_depth_change' || measurement.key === 'swing_plane' ? ['down-the-line'] : ['face-on', 'down-the-line'],
    validityRequirements: timing
      ? ['Stable swing event anchors', 'One complete swing in the clip']
      : club
        ? ['Visible club', 'Low motion blur', 'Stable temporal tracking']
        : ['Relevant joints visible', 'Compatible camera view', 'Stable camera framing'],
  }
}
