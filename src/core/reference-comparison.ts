import rawSummary from '../data/golfdb-reference-summary.json'
import type { CameraView, Comparison, Measurement, ReferenceRange } from '../domain/types'
import { clamp } from './geometry'

const ranges = rawSummary.ranges as ReferenceRange[]

export function compareToReferences(measurements: Measurement[], view: CameraView, club = 'all'): Comparison[] {
  return measurements.map((measurement) => {
    if (measurement.reliability === 'unavailable' || measurement.value === null) {
      return { measurementKey: measurement.key, status: 'low-confidence', percentile: null, deviation: null }
    }
    const reference = selectRange(measurement.key, view, club)
    if (!reference) return { measurementKey: measurement.key, status: 'no-coverage', percentile: null, deviation: null }
    if (measurement.confidence < 0.52) return { measurementKey: measurement.key, status: 'low-confidence', percentile: null, deviation: null, reference }
    const value = measurement.value
    const status = value < reference.p10 ? 'below-range' : value > reference.p90 ? 'above-range' : 'within-range'
    const deviation = value < reference.p10 ? value - reference.p10 : value > reference.p90 ? value - reference.p90 : 0
    return { measurementKey: measurement.key, status, percentile: estimatePercentile(value, reference), deviation, reference }
  })
}

export function referenceCoverage(measurements: Measurement[], comparisons: Comparison[]): { covered: number; total: number; sampleCount: number } {
  const eligible = measurements.filter((measurement) => measurement.value !== null && measurement.reliability !== 'unavailable')
  const covered = comparisons.filter((comparison) => comparison.reference).length
  const sampleCount = Math.max(0, ...comparisons.map((comparison) => comparison.reference?.sampleCount ?? 0))
  return { covered, total: eligible.length, sampleCount }
}

function selectRange(metricKey: string, view: CameraView, club: string): ReferenceRange | undefined {
  if (view === 'unknown') return undefined
  const candidates = ranges.filter((range) => range.metricKey === metricKey && range.sex === 'mixed')
  return candidates.find((range) => range.view === view && range.club === club)
    ?? candidates.find((range) => range.view === view && range.club === 'all')
    ?? candidates.find((range) => range.club === 'all')
}

function estimatePercentile(value: number, range: ReferenceRange): number {
  if (value <= range.p10) return clamp(10 * value / Math.max(range.p10, 1e-6), 0, 10)
  if (value <= range.median) return 10 + 40 * (value - range.p10) / Math.max(range.median - range.p10, 1e-6)
  if (value <= range.p90) return 50 + 40 * (value - range.median) / Math.max(range.p90 - range.median, 1e-6)
  return clamp(90 + 10 * (value - range.p90) / Math.max(Math.abs(range.p90), 1e-6), 90, 100)
}
