import { mean } from '../core/geometry'
import { dynamicTimeWarping, poseSequence } from '../core/dtw'
import { extractMeasurements } from '../core/feature-extraction'
import { rankFindings } from '../core/issue-ranking'
import { buildPhaseComparisons } from '../core/phase-reference'
import { segmentSwing } from '../core/phase-segmentation'
import { compareToReferences, referenceCoverage } from '../core/reference-comparison'
import { evaluateVideoQuality } from '../core/video-quality'
import { identifyStrengths, summarizeSwing } from '../core/strengths'
import type { AnalysisProgress, AnalysisResult } from '../domain/types'
import { detectPoseFrames } from './pose-landmarker'
import { createCoachNarrative } from './ai-coach'
import { clubMeasurements, trackClub } from './club-tracker'
import { loadVideo, samplePixelQuality } from './video-reader'

export async function analyzeSwing(
  file: File,
  fingerprint: string,
  onProgress: (progress: AnalysisProgress) => void,
  previous?: AnalysisResult,
): Promise<AnalysisResult> {
  onProgress({ stage: 'quality', percent: 3, message: 'Reading video metadata and image quality' })
  const loaded = await loadVideo(file)
  try {
    const pixelQuality = await samplePixelQuality(loaded.element, loaded.metadata.durationMs)
    onProgress({ stage: 'pose', percent: 10, message: 'Loading the on-device pose model' })
    const poseFrames = await detectPoseFrames(loaded.element, loaded.metadata.durationMs, (completed, total) => {
      onProgress({ stage: 'pose', percent: 10 + Math.round(completed / total * 53), message: `Tracking body landmarks · ${completed}/${total}` })
    })
    const quality = evaluateVideoQuality(loaded.metadata, pixelQuality, poseFrames)
    onProgress({ stage: 'phases', percent: 68, message: 'Finding address, top, impact, and finish' })
    const phases = segmentSwing(poseFrames, loaded.metadata.durationMs)
    onProgress({ stage: 'measurements', percent: 72, message: 'Checking whether the shaft is visible enough to track' })
    const clubTracking = await trackClub(loaded.element, poseFrames)
    onProgress({ stage: 'measurements', percent: 78, message: 'Calculating only observable biomechanics' })
    const measurements = [...extractMeasurements(poseFrames, phases, quality.cameraView, quality.cameraConfidence), ...clubMeasurements(clubTracking, phases, quality.cameraView)]
    onProgress({ stage: 'comparison', percent: 84, message: 'Comparing phase timing with licensed reference metadata' })
    const comparisonView = quality.cameraConfidence >= 0.58 ? quality.cameraView : 'unknown'
    const comparisons = compareToReferences(measurements, comparisonView)
    const coverage = referenceCoverage(measurements, comparisons)
    onProgress({ stage: 'coaching', percent: 92, message: 'Ranking the highest-confidence coaching priorities' })
    const findings = quality.suitable ? rankFindings(measurements, comparisons, phases, comparisonView) : []
    const poseConfidence = poseFrames.length > 0 ? mean(poseFrames.map((frame) => frame.meanVisibility)) : 0
    const phaseConfidence = mean(phases.map((phase) => phase.confidence))
    const measurementConfidence = mean(measurements.filter((measurement) => measurement.value !== null).map((measurement) => measurement.confidence)) || 0
    const referenceScore = coverage.total === 0 ? 0 : coverage.covered / coverage.total
    const globalConfidence = mean([quality.score, poseConfidence, phaseConfidence, measurementConfidence, quality.cameraConfidence, referenceScore])
    const strengths = quality.suitable ? identifyStrengths(measurements, comparisons, phases, comparisonView) : []
    const overallSummary = summarizeSwing(strengths, findings, globalConfidence)
    const phaseComparisons = buildPhaseComparisons(measurements, comparisons, phases, poseFrames, comparisonView, previous)
    const coachNarrative = await createCoachNarrative(findings, measurements, quality, strengths, overallSummary)
    const similarity = comparePrevious(poseFrames, previous)
    const warnings = [
      ...(loaded.metadata.fps === null ? ['The browser could not read container frame rate; analysis uses media timestamps and does not assume 30 fps.'] : []),
      ...(quality.cameraView === 'unknown' ? ['Camera-specific rotation and early-extension measurements were withheld.'] : []),
      ...(coverage.covered < coverage.total ? [`Reference coverage is ${coverage.covered}/${coverage.total} observable metrics; uncovered metrics are not judged against professional ranges.`] : []),
      ...(clubTracking.status !== 'available' ? [clubTracking.note] : []),
      ...(findings.length === 0 ? ['No issue crossed both the confidence and materiality gates. Review available measurements rather than forcing a diagnosis.'] : []),
    ]
    const result: AnalysisResult = {
      schemaVersion: 2,
      id: fingerprint,
      createdAt: new Date().toISOString(),
      source: 'measured',
      video: loaded.metadata,
      quality,
      phases,
      poseFrames,
      measurements,
      comparisons,
      findings,
      strengths,
      overallSummary,
      phaseComparisons,
      clubTracking,
      coachNarrative,
      similarity,
      progressDelta: compareProgress(findings, measurements, quality.score, previous),
      globalConfidence,
      referenceLabel: `GolfDB timing reference · up to ${coverage.sampleCount.toLocaleString()} matching clips`,
      warnings,
    }
    onProgress({ stage: 'complete', percent: 100, message: 'Analysis ready' })
    return result
  } finally {
    URL.revokeObjectURL(loaded.objectUrl)
  }
}

function compareProgress(
  findings: AnalysisResult['findings'],
  measurements: AnalysisResult['measurements'],
  qualityScore: number,
  previous?: AnalysisResult,
): AnalysisResult['progressDelta'] {
  if (!previous) return undefined
  const currentById = new Map(findings.map((finding) => [finding.id, finding.title]))
  const previousById = new Map(previous.findings.map((finding) => [finding.id, finding.title]))
  const comparableQuality = qualityScore >= 0.58 && qualityScore >= previous.quality.score - 0.1
  const persistent = [...currentById.keys()].filter((id) => previousById.has(id)).map((id) => currentById.get(id)!)
  const newIssues = [...currentById.keys()].filter((id) => !previousById.has(id)).map((id) => currentById.get(id)!)
  const improving = comparableQuality
    ? [...previousById.keys()].filter((id) => !currentById.has(id)).map((id) => previousById.get(id)!)
    : []
  const currentTempo = measurements.find((item) => item.key === 'tempo_ratio')?.value
  const previousTempo = previous.measurements.find((item) => item.key === 'tempo_ratio')?.value
  const tempoChange = currentTempo !== null && currentTempo !== undefined && previousTempo !== null && previousTempo !== undefined
    ? currentTempo - previousTempo
    : null
  return { comparedWith: previous.id, improving, persistent, newIssues, tempoChange, comparableQuality }
}

function comparePrevious(poseFrames: AnalysisResult['poseFrames'], previous?: AnalysisResult): AnalysisResult['similarity'] {
  if (!previous || previous.poseFrames.length < 12 || poseFrames.length < 12) {
    return { available: false, score: null, referenceCount: 0, method: 'unavailable', note: 'Upload another swing to unlock previous-versus-current DTW similarity.' }
  }
  const result = dynamicTimeWarping(poseSequence(poseFrames), poseSequence(previous.poseFrames))
  if (!result) return { available: false, score: null, referenceCount: 0, method: 'unavailable', note: 'The pose sequences could not be aligned.' }
  const score = Math.max(0, 100 * Math.exp(-result.normalizedDistance * 3.2))
  return { available: true, score, referenceCount: 1, method: 'phase-normalized-dtw', note: 'Similarity compares normalized 2D joint paths; it is not an overall swing score.' }
}
