import { describe, expect, it } from 'vitest'
import { PHASE_NAMES, type Measurement, type PhaseSegment } from '../domain/types'
import { diagnoseFindings } from './issue-ranking'
import { compareToReferences } from './reference-comparison'

function phases(confidence = .8): PhaseSegment[] {
  return PHASE_NAMES.map((name, index) => ({
    name,
    startMs: index * 100,
    endMs: (index + 1) * 100,
    anchorMs: index * 100 + 50,
    confidence,
    detection: ['Address', 'Top', 'Impact', 'Finish'].includes(name) ? 'kinematic' : 'interpolated',
  }))
}

function measurement(key: string, value: number, confidence = .9): Measurement {
  return {
    key,
    label: key,
    phase: 'Whole swing',
    value,
    unit: key === 'sequence_gap' ? 'ms' : key === 'finish_balance' ? 'normalized' : key === 'tempo_ratio' ? 'x' : 'torso-lengths',
    confidence,
    reliability: confidence >= .62 ? 'available' : 'low-confidence',
    frameMs: 650,
    observedFrom: 'test',
    supportedViews: key === 'pelvis_depth_change' ? ['down-the-line'] : key === 'finish_balance' ? ['face-on'] : ['face-on', 'down-the-line'],
    support: { sampleCount: key === 'tempo_ratio' ? 3 : key === 'pelvis_depth_change' ? 2 : key === 'finish_balance' ? 1 : 20, temporalCoverage: 1, landmarkVisibility: .9 },
  }
}

describe('finding evidence diagnostics', () => {
  it('evaluates every rule and reports the exact failed confidence gate', () => {
    const tempo = measurement('tempo_ratio', 2.2, .61)
    const result = diagnoseFindings([tempo], compareToReferences([tempo], 'face-on'), phases(), 'face-on')
    expect(result.diagnostics).toHaveLength(5)
    const diagnostic = result.diagnostics.find((item) => item.issueId === 'tempo-outlier')!
    expect(diagnostic.status).toBe('not-generated')
    expect(diagnostic.reason).toContain('reliability is low-confidence')
    expect(diagnostic.gates.find((gate) => gate.id === 'measurement:tempo_ratio:confidence')).toMatchObject({ passed: false, required: '>= 0.62' })
  })

  it('distinguishes a valid but immaterial candidate from a rule that was never generated', () => {
    const head = measurement('head_movement', .4)
    const result = diagnoseFindings([head], [], phases(), 'face-on')
    const diagnostic = result.diagnostics.find((item) => item.issueId === 'head-movement')!
    expect(diagnostic.status).toBe('withheld')
    expect(diagnostic.evidencePassed).toBe(true)
    expect(diagnostic.materialityPassed).toBe(false)
    expect(diagnostic.materialityScore).toBeCloseTo(.4 / .45)
    expect(diagnostic.provisionalFinding?.id).toBe('head-movement')
  })

  it('accepts available timing evidence at the shared 0.62 measurement and phase contract', () => {
    const tempo = measurement('tempo_ratio', 2.2, .63)
    const result = diagnoseFindings([tempo], compareToReferences([tempo], 'face-on'), phases(), 'face-on')
    expect(result.findings.map((item) => item.id)).toEqual(['tempo-outlier'])
    expect(result.diagnostics.find((item) => item.issueId === 'tempo-outlier')).toMatchObject({ status: 'passed', evidencePassed: true })
  })

  it('keeps face-on-only finish evidence unavailable from down-the-line footage', () => {
    const finish = measurement('finish_balance', .8)
    const result = diagnoseFindings([finish], [], phases(), 'down-the-line')
    const diagnostic = result.diagnostics.find((item) => item.issueId === 'finish-balance')!
    expect(diagnostic.status).toBe('not-generated')
    expect(diagnostic.actualCamera).toBe('down-the-line')
    expect(diagnostic.requiredCameras).toEqual(['face-on'])
    expect(diagnostic.reason).toContain('not supported')
  })
})
