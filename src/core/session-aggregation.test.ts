import { describe, expect, it } from 'vitest'
import { PHASE_NAMES, type AnalysisResult, type CameraView, type Finding, type Measurement, type SessionVideoObservation } from '../domain/types'
import { buildAnalysisSession, sessionIdentity } from './session-aggregation'

function finding(id = 'posture', confidence = .8, evidenceCount = 1): Finding {
  return {
    id, title: 'Posture pattern', summary: 'Supported posture change.', why: 'It can reduce delivery space.', where: 'Downswing → Impact', phase: 'Downswing',
    priority: 'high', confidence, frameMs: 620, workOn: 'Maintain hip depth.', drill: 'Chair drill.',
    evidence: Array.from({ length: evidenceCount }, () => ({ measurementKey: 'pelvis_depth_change', measured: '0.3', reference: 'rule threshold', confidence })),
  }
}

function measurement(key: string, confidence: number, reliability: Measurement['reliability'] = 'available'): Measurement {
  return { key, label: key, phase: 'Impact', value: reliability === 'unavailable' ? null : .3, unit: 'normalized', confidence, reliability, frameMs: 620, observedFrom: 'test', supportedViews: ['face-on', 'down-the-line'] }
}

function analysis(id: string, view: CameraView, options: { confidence?: number; cameraConfidence?: number; findings?: Finding[]; measurements?: Measurement[]; timingShift?: number } = {}): AnalysisResult {
  const timingShift = options.timingShift ?? 0
  return {
    schemaVersion: 2, id, createdAt: '2026-08-11T00:00:00.000Z', source: 'measured',
    video: { name: `${id}.mp4`, sizeBytes: 1000, durationMs: 1200, width: 1080, height: 1920, orientation: 'vertical', fps: 60, fpsSource: 'container' },
    quality: { suitable: true, score: .85, cameraView: view, cameraConfidence: options.cameraConfidence ?? .9, factors: [], guidance: [] },
    phases: PHASE_NAMES.map((name, index) => ({ name, startMs: index * 100, endMs: (index + 1) * 100, anchorMs: 100 + index * 100 + timingShift, confidence: .85, detection: ['Address', 'Top', 'Impact', 'Finish'].includes(name) ? 'kinematic' : 'interpolated' })),
    poseFrames: [], measurements: options.measurements ?? [], comparisons: [], findings: options.findings ?? [finding('posture', options.confidence ?? .8)], strengths: [],
    similarity: { available: false, score: null, referenceCount: 0, method: 'unavailable', note: '' }, globalConfidence: .82, referenceLabel: 'test', warnings: [],
  }
}

function observation(result: AnalysisResult, lastModified: number): SessionVideoObservation {
  return { id: `obs-${result.id}`, fileName: result.video.name, lastModified, metadata: result.video, status: 'analyzed', analysisId: result.id }
}

describe('cross-video evidence aggregation', () => {
  it('recognizes a plausible same-swing multi-view pair without averaging measurements', () => {
    const face = analysis('face', 'face-on', { measurements: [measurement('head_movement', .88), measurement('shared', .72)] })
    const dtl = analysis('dtl', 'down-the-line', { measurements: [measurement('pelvis_depth_change', .9), measurement('shared', .91)] })
    const session = buildAnalysisSession('session', [observation(face, 1_000_000), observation(dtl, 1_030_000)], [face, dtl])
    expect(session.relations[0].kind).toBe('same-swing-likely')
    expect(session.findings[0].supports).toHaveLength(2)
    expect(session.findings[0].aggregationNote).toContain('not averaged')
    const shared = session.bestMeasurements.find((item) => item.measurement.key === 'shared')!
    expect(shared.analysisId).toBe('dtl')
    expect(shared.measurement.value).toBe(.3)
  })

  it('treats same-view files as independent swings and reports persistence', () => {
    const first = analysis('first', 'down-the-line')
    const second = analysis('second', 'down-the-line')
    const session = buildAnalysisSession('session', [observation(first, 1), observation(second, 2)], [first, second])
    expect(session.relations[0].kind).toBe('different-swings-likely')
    expect(session.findings[0].swingCount).toBe(2)
    expect(session.findings[0].aggregationNote).toContain('Repeated across 2')
  })

  it('does not claim synchronization for unsupported or incompatible camera evidence', () => {
    const supported = analysis('supported', 'down-the-line')
    const unknown = analysis('unknown', 'face-on', { cameraConfidence: .4 })
    const session = buildAnalysisSession('session', [observation(supported, 1), observation(unknown, 2)], [supported, unknown])
    expect(session.relations[0].kind).toBe('uncertain')
    expect(session.warnings.some((warning) => warning.includes('could not be matched'))).toBe(true)
  })

  it('never boosts a finding merely because an unrelated file was uploaded', () => {
    const supported = analysis('supported', 'down-the-line', { findings: [finding('posture', .8)] })
    const unrelated = analysis('unrelated', 'down-the-line', { findings: [finding('tempo', .75)] })
    const session = buildAnalysisSession('session', [observation(supported, 1), observation(unrelated, 2)], [supported, unrelated])
    expect(session.findings.find((item) => item.id === 'posture')?.confidence).toBe(.8)
  })

  it('does not double-count duplicate evidence and cannot promote weak evidence to high confidence', () => {
    const face = analysis('face', 'face-on', { findings: [finding('posture', .62, 3)] })
    const dtl = analysis('dtl', 'down-the-line', { findings: [finding('posture', .62, 3)] })
    const session = buildAnalysisSession('session', [observation(face, 1000), observation(dtl, 1010)], [face, dtl])
    expect(session.findings[0].supports).toHaveLength(2)
    expect(session.findings[0].confidence).toBeLessThan(.78)
  })

  it('keeps a failed video from blocking successful independent analyses', () => {
    const firstSuccess = analysis('success-face', 'face-on')
    const secondSuccess = analysis('success-dtl', 'down-the-line')
    const failed: SessionVideoObservation = { id: 'failed', fileName: 'broken.mov', lastModified: 2, status: 'failed', error: 'Codec unsupported' }
    const session = buildAnalysisSession('session', [observation(firstSuccess, 1), observation(secondSuccess, 1), failed], [firstSuccess, secondSuccess])
    expect(session.analyses).toHaveLength(2)
    expect(session.findings).toHaveLength(1)
    expect(session.warnings.some((warning) => warning.includes('failed independently'))).toBe(true)
  })

  it('withholds unavailable measurements from best-evidence selection', () => {
    const result = analysis('one', 'face-on', { measurements: [measurement('wrist_position', .95, 'unavailable'), measurement('head_movement', .8)] })
    const session = buildAnalysisSession('session', [observation(result, 1)], [result])
    expect(session.bestMeasurements.map((item) => item.measurement.key)).toEqual(['head_movement'])
  })

  it('creates the same stable session identity regardless of upload order', async () => {
    expect(await sessionIdentity(['b', 'a', 'a'])).toBe(await sessionIdentity(['a', 'b']))
  })
})
