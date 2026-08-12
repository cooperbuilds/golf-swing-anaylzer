import { mean } from './geometry'
import type {
  AnalysisResult,
  AnalysisSession,
  CameraView,
  SessionFinding,
  SessionEvidenceDiagnostic,
  SessionFindingSupport,
  SessionMeasurement,
  SessionVideoObservation,
  SwingRelation,
} from '../domain/types'

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 } as const

export async function sessionIdentity(fingerprints: string[]): Promise<string> {
  const bytes = new TextEncoder().encode([...new Set(fingerprints)].sort().join(':'))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return `session-${[...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')}`
}

export function buildAnalysisSession(
  id: string,
  observations: SessionVideoObservation[],
  analyses: AnalysisResult[],
  createdAt = new Date().toISOString(),
): AnalysisSession {
  const analyzedObservations = observations.filter((item) => item.status === 'analyzed' && item.analysisId)
  const analysisById = new Map(analyses.map((analysis) => [analysis.id, analysis]))
  const relations = classifyRelations(analyzedObservations, analysisById)
  const swingGroups = buildSwingGroups(analyzedObservations, relations)
  const aggregation = aggregateFindings(analyzedObservations, analysisById, relations, swingGroups)
  const findings = aggregation.findings
  const bestMeasurements = selectBestMeasurements(analyzedObservations, analysisById)
  const failed = observations.filter((item) => item.status === 'failed')
  const globalConfidence = analyses.length ? mean(analyses.map((analysis) => analysis.globalConfidence)) : 0
  const overallSummary = findings[0]
    ? `${findings[0].title} is the first session priority. It is supported by ${findings[0].videoCount} usable video${findings[0].videoCount === 1 ? '' : 's'} across ${findings[0].swingCount} inferred swing${findings[0].swingCount === 1 ? '' : 's'}.`
    : analyses.length
      ? 'No cross-video priority passed the existing evidence gates. Review each usable video independently.'
      : 'No uploaded video produced a usable analysis.'
  const warnings = [
    'Session aggregation selects validated per-video evidence; it does not reconstruct 3D motion or synchronize video frames.',
    ...(relations.some((item) => item.kind === 'uncertain') ? ['At least one video pairing could not be matched reliably and was not treated as synchronized.'] : []),
    ...(failed.length ? [`${failed.length} video${failed.length === 1 ? '' : 's'} failed independently and did not block the usable analyses.`] : []),
  ]
  return { schemaVersion: 1, id, createdAt, observations, analyses, relations, findings, evidenceDiagnostics: aggregation.diagnostics, bestMeasurements, overallSummary, globalConfidence, warnings }
}

export function classifyRelations(
  observations: SessionVideoObservation[],
  analysisById: Map<string, AnalysisResult>,
): SwingRelation[] {
  const relations: SwingRelation[] = []
  for (let firstIndex = 0; firstIndex < observations.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < observations.length; secondIndex += 1) {
      const first = observations[firstIndex]
      const second = observations[secondIndex]
      const firstAnalysis = analysisById.get(first.analysisId ?? '')
      const secondAnalysis = analysisById.get(second.analysisId ?? '')
      if (!firstAnalysis || !secondAnalysis) continue
      relations.push(classifyPair(first, second, firstAnalysis, secondAnalysis))
    }
  }
  return relations
}

function classifyPair(
  first: SessionVideoObservation,
  second: SessionVideoObservation,
  firstAnalysis: AnalysisResult,
  secondAnalysis: AnalysisResult,
): SwingRelation {
  const base = { firstObservationId: first.id, secondObservationId: second.id }
  const firstView = supportedView(firstAnalysis)
  const secondView = supportedView(secondAnalysis)
  if (firstView === 'unknown' || secondView === 'unknown') {
    return { ...base, kind: 'uncertain', confidence: .35, reason: 'At least one camera view is unsupported, so the videos are not synchronized or combined.' }
  }
  if (firstView === secondView) {
    return { ...base, kind: 'different-swings-likely', confidence: .72, reason: `Both videos are ${firstView}; they are analyzed as separate observations rather than assumed to be synchronized.` }
  }
  const timingDifference = phaseTimingDifference(firstAnalysis, secondAnalysis)
  const firstDuration = first.metadata?.durationMs ?? firstAnalysis.video.durationMs
  const secondDuration = second.metadata?.durationMs ?? secondAnalysis.video.durationMs
  const durationDifference = Math.abs(firstDuration - secondDuration) / Math.max(firstDuration, secondDuration, 1)
  const captureGap = Math.abs(first.lastModified - second.lastModified)
  if (timingDifference <= .075 && durationDifference <= .22 && captureGap <= 120_000) {
    return { ...base, kind: 'same-swing-likely', confidence: .76, reason: 'Complementary views have similar normalized phase timing and nearby capture timestamps. Measurements remain view-specific.' }
  }
  return {
    ...base,
    kind: 'uncertain',
    confidence: .42,
    reason: 'The views are complementary, but timing or capture metadata is not strong enough to claim they show the same swing.',
  }
}

function supportedView(analysis: AnalysisResult): CameraView {
  return analysis.quality.cameraConfidence >= .58 ? analysis.quality.cameraView : 'unknown'
}

function phaseTimingDifference(first: AnalysisResult, second: AnalysisResult): number {
  const signature = (analysis: AnalysisResult) => {
    const address = analysis.phases.find((phase) => phase.name === 'Address')?.anchorMs ?? 0
    const finish = analysis.phases.find((phase) => phase.name === 'Finish')?.anchorMs ?? analysis.video.durationMs
    const span = Math.max(finish - address, 1)
    return analysis.phases.map((phase) => (phase.anchorMs - address) / span)
  }
  const firstSignature = signature(first)
  const secondSignature = signature(second)
  return mean(firstSignature.map((value, index) => Math.abs(value - (secondSignature[index] ?? value))))
}

function buildSwingGroups(observations: SessionVideoObservation[], relations: SwingRelation[]): Map<string, number> {
  const parent = new Map(observations.map((item) => [item.id, item.id]))
  const root = (id: string): string => {
    const next = parent.get(id) ?? id
    if (next === id) return id
    const resolved = root(next)
    parent.set(id, resolved)
    return resolved
  }
  for (const relation of relations.filter((item) => item.kind === 'same-swing-likely')) {
    parent.set(root(relation.secondObservationId), root(relation.firstObservationId))
  }
  const groupIds = new Map<string, number>()
  const result = new Map<string, number>()
  for (const observation of observations) {
    const key = root(observation.id)
    if (!groupIds.has(key)) groupIds.set(key, groupIds.size)
    result.set(observation.id, groupIds.get(key)!)
  }
  return result
}

function aggregateFindings(
  observations: SessionVideoObservation[],
  analysisById: Map<string, AnalysisResult>,
  relations: SwingRelation[],
  swingGroups: Map<string, number>,
): { findings: SessionFinding[]; diagnostics: SessionEvidenceDiagnostic[] } {
  const observationByAnalysis = new Map(observations.map((item) => [item.analysisId, item]))
  type CandidateSupport = SessionFindingSupport & {
    direction: string
    issueId: string
    materialityScore: number
    individuallyPassed: boolean
    provisionalFinding: AnalysisResult['findings'][number]
  }
  const grouped = new Map<string, CandidateSupport[]>()
  const eligibleSwingGroups = new Map<string, Set<number>>()
  for (const analysis of analysisById.values()) {
    const observation = observationByAnalysis.get(analysis.id)
    if (!observation) continue
    if (analysis.evidenceDiagnostics?.length) {
      for (const diagnostic of analysis.evidenceDiagnostics) {
        if (diagnostic.evidencePassed) {
          const groups = eligibleSwingGroups.get(diagnostic.issueId) ?? new Set<number>()
          groups.add(swingGroups.get(observation.id) ?? -1)
          eligibleSwingGroups.set(diagnostic.issueId, groups)
        }
        const finding = diagnostic.provisionalFinding
        const directionCanSupportIssue = !['within-range', 'pelvis-first-or-simultaneous', 'missing', 'low-confidence', 'no-coverage'].includes(diagnostic.direction)
        if (!finding || !diagnostic.evidencePassed || !diagnostic.confidencePassed || !directionCanSupportIssue) continue
        const support: CandidateSupport = {
          analysisId: analysis.id,
          observationId: observation.id,
          videoName: analysis.video.name,
          cameraView: supportedView(analysis),
          phase: finding.phase,
          frameMs: finding.frameMs,
          confidence: diagnostic.candidateConfidence ?? finding.confidence,
          evidence: finding.evidence,
          direction: diagnostic.direction,
          issueId: diagnostic.issueId,
          materialityScore: diagnostic.materialityScore,
          individuallyPassed: diagnostic.status === 'passed',
          provisionalFinding: finding,
        }
        const key = `${diagnostic.issueId}:${diagnostic.direction}`
        grouped.set(key, [...(grouped.get(key) ?? []), support])
      }
      continue
    }
    for (const finding of analysis.findings) {
      const support: CandidateSupport = {
        analysisId: analysis.id,
        observationId: observation.id,
        videoName: analysis.video.name,
        cameraView: supportedView(analysis),
        phase: finding.phase,
        frameMs: finding.frameMs,
        confidence: finding.confidence,
        evidence: finding.evidence,
        direction: finding.title,
        issueId: finding.id,
        materialityScore: 1,
        individuallyPassed: true,
        provisionalFinding: finding,
      }
      const key = `${finding.id}:${finding.title}`
      grouped.set(key, [...(grouped.get(key) ?? []), support])
    }
  }
  const groupCount = new Set(swingGroups.values()).size || 1
  const results: Array<{ finding: SessionFinding; score: number }> = []
  const diagnostics: SessionEvidenceDiagnostic[] = []
  for (const supports of grouped.values()) {
    const allUniqueSupports = [...new Map(supports.map((support) => [support.analysisId, support])).values()]
    const representativeSupport = allUniqueSupports.toSorted((a, b) => b.confidence - a.confidence)[0]
    const representative = representativeSupport.provisionalFinding
    const uniqueSupports = allUniqueSupports.filter((support) => support.individuallyPassed || support.materialityScore >= .85)
    const swingCount = new Set(uniqueSupports.map((support) => swingGroups.get(support.observationId))).size
    const complementary = hasComplementarySameSwingSupport(uniqueSupports, relations)
    const eligibleCount = eligibleSwingGroups.get(representativeSupport.issueId)?.size ?? groupCount
    const persistence = swingCount / Math.max(eligibleCount, 1)
    const individuallyPassed = uniqueSupports.some((support) => support.individuallyPassed)
    const medianMateriality = median(uniqueSupports.length ? uniqueSupports.map((support) => support.materialityScore) : allUniqueSupports.map((support) => support.materialityScore))
    const persistentNearThreshold = !individuallyPassed && swingCount >= 3 && persistence >= .6 && medianMateriality >= .85
    if (!individuallyPassed && !persistentNearThreshold) {
      const reason = uniqueSupports.length === 0
        ? `No independently valid candidate reached the 0.85 near-threshold materiality floor; highest was ${Math.max(...allUniqueSupports.map((support) => support.materialityScore)).toFixed(2)}.`
        : swingCount < 3
          ? `Only ${swingCount} independent swing${swingCount === 1 ? '' : 's'} supported this direction; at least 3 are required.`
          : persistence < .6
            ? `Persistence ${persistence.toFixed(2)} is below 0.60.`
            : `Median materiality ${medianMateriality.toFixed(2)} is below 0.85.`
      diagnostics.push({
        issueId: representativeSupport.issueId, title: representative.title, direction: representativeSupport.direction, status: 'withheld', reason,
        eligibleSwingCount: eligibleCount, supportingSwingCount: swingCount, supportingVideoCount: uniqueSupports.length,
        persistence, requiredPersistence: .6, medianMateriality, requiredMedianMateriality: .85, confidence: null, confidenceCap: .77,
      })
      continue
    }
    const independentBoost = Math.min(Math.max(swingCount - 1, 0) * (persistentNearThreshold ? .04 : .06), persistentNearThreshold ? .1 : .12)
    const complementaryBoost = complementary ? .05 : 0
    const baseConfidence = persistentNearThreshold ? median(uniqueSupports.map((support) => support.confidence)) : Math.max(...uniqueSupports.map((support) => support.confidence))
    const cap = persistentNearThreshold ? .77 : baseConfidence < .7 ? .77 : .95
    const confidence = Math.min(cap, baseConfidence + independentBoost + complementaryBoost)
    const finding: SessionFinding = {
      ...representative,
      confidence,
      frameMs: representativeSupport.frameMs,
      supports: uniqueSupports,
      swingCount,
      videoCount: uniqueSupports.length,
      aggregationNote: persistentNearThreshold
        ? `Repeated near-threshold evidence across ${swingCount} independent swings (${Math.round(persistence * 100)}% of swings with a valid rule contract); median materiality ${medianMateriality.toFixed(2)}. Confidence boost is capped and uses only this rule's evidence.`
        : complementary
        ? 'Supported by complementary views of a plausibly matching swing; measurements were selected by view and were not averaged.'
        : swingCount > 1
          ? `Repeated across ${swingCount} independently analyzed swings.`
          : 'Supported by one independently analyzed video; no cross-video confidence boost was applied.',
    }
    diagnostics.push({
      issueId: representativeSupport.issueId, title: representative.title, direction: representativeSupport.direction, status: 'passed',
      reason: persistentNearThreshold ? finding.aggregationNote : individuallyPassed ? 'At least one video passed the individual finding gates.' : finding.aggregationNote,
      eligibleSwingCount: eligibleCount, supportingSwingCount: swingCount, supportingVideoCount: uniqueSupports.length,
      persistence, requiredPersistence: .6, medianMateriality, requiredMedianMateriality: .85, confidence, confidenceCap: cap,
    })
    results.push({ finding, score: PRIORITY_WEIGHT[finding.priority] + confidence + persistence * .45 })
  }
  const uniqueIssues = new Map<string, { finding: SessionFinding; score: number }>()
  for (const result of results.toSorted((a, b) => b.score - a.score)) {
    if (!uniqueIssues.has(result.finding.id)) uniqueIssues.set(result.finding.id, result)
  }
  return { findings: [...uniqueIssues.values()].slice(0, 3).map((item) => item.finding), diagnostics }
}

function hasComplementarySameSwingSupport(supports: SessionFindingSupport[], relations: SwingRelation[]): boolean {
  const ids = new Set(supports.map((support) => support.observationId))
  return relations.some((relation) => relation.kind === 'same-swing-likely'
    && ids.has(relation.firstObservationId)
    && ids.has(relation.secondObservationId)
    && supports.find((support) => support.observationId === relation.firstObservationId)?.cameraView
      !== supports.find((support) => support.observationId === relation.secondObservationId)?.cameraView)
}

function selectBestMeasurements(
  observations: SessionVideoObservation[],
  analysisById: Map<string, AnalysisResult>,
): SessionMeasurement[] {
  const candidates = new Map<string, SessionMeasurement[]>()
  for (const observation of observations) {
    const analysis = analysisById.get(observation.analysisId ?? '')
    if (!analysis) continue
    for (const measurement of analysis.measurements.filter((item) => item.reliability === 'available' && item.value !== null)) {
      const candidate: SessionMeasurement = {
        measurement,
        analysisId: analysis.id,
        observationId: observation.id,
        videoName: analysis.video.name,
        cameraView: supportedView(analysis),
        selectionReason: 'Highest-confidence available observation; values from other videos were not averaged.',
      }
      candidates.set(measurement.key, [...(candidates.get(measurement.key) ?? []), candidate])
    }
  }
  return [...candidates.values()].map((items) => items.toSorted((a, b) => b.measurement.confidence - a.measurement.confidence)[0])
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
