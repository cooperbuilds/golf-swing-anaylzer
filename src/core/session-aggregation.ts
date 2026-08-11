import { mean } from './geometry'
import type {
  AnalysisResult,
  AnalysisSession,
  CameraView,
  SessionFinding,
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
  const findings = aggregateFindings(analyzedObservations, analysisById, relations, swingGroups)
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
  return { schemaVersion: 1, id, createdAt, observations, analyses, relations, findings, bestMeasurements, overallSummary, globalConfidence, warnings }
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
): SessionFinding[] {
  const observationByAnalysis = new Map(observations.map((item) => [item.analysisId, item]))
  const grouped = new Map<string, SessionFindingSupport[]>()
  for (const analysis of analysisById.values()) {
    const observation = observationByAnalysis.get(analysis.id)
    if (!observation) continue
    for (const finding of analysis.findings) {
      const support: SessionFindingSupport = {
        analysisId: analysis.id,
        observationId: observation.id,
        videoName: analysis.video.name,
        cameraView: supportedView(analysis),
        phase: finding.phase,
        frameMs: finding.frameMs,
        confidence: finding.confidence,
        evidence: finding.evidence,
      }
      grouped.set(finding.id, [...(grouped.get(finding.id) ?? []), support])
    }
  }
  const groupCount = new Set(swingGroups.values()).size || 1
  const results: Array<{ finding: SessionFinding; score: number }> = []
  for (const [id, supports] of grouped) {
    const uniqueSupports = [...new Map(supports.map((support) => [support.analysisId, support])).values()]
    const representativeAnalysis = analysisById.get(uniqueSupports.toSorted((a, b) => b.confidence - a.confidence)[0].analysisId)!
    const representative = representativeAnalysis.findings.find((finding) => finding.id === id)!
    const swingCount = new Set(uniqueSupports.map((support) => swingGroups.get(support.observationId))).size
    const complementary = hasComplementarySameSwingSupport(uniqueSupports, relations)
    const independentBoost = Math.min(Math.max(swingCount - 1, 0) * .06, .12)
    const complementaryBoost = complementary ? .05 : 0
    const baseConfidence = Math.max(...uniqueSupports.map((support) => support.confidence))
    const cap = baseConfidence < .7 ? .77 : .95
    const confidence = Math.min(cap, baseConfidence + independentBoost + complementaryBoost)
    const persistence = swingCount / groupCount
    const finding: SessionFinding = {
      ...representative,
      confidence,
      frameMs: uniqueSupports[0].frameMs,
      supports: uniqueSupports,
      swingCount,
      videoCount: uniqueSupports.length,
      aggregationNote: complementary
        ? 'Supported by complementary views of a plausibly matching swing; measurements were selected by view and were not averaged.'
        : swingCount > 1
          ? `Repeated across ${swingCount} independently analyzed swings.`
          : 'Supported by one independently analyzed video; no cross-video confidence boost was applied.',
    }
    results.push({ finding, score: PRIORITY_WEIGHT[finding.priority] + confidence + persistence * .45 })
  }
  return results.toSorted((a, b) => b.score - a.score).slice(0, 3).map((item) => item.finding)
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
