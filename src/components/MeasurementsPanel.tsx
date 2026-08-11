import { AlertCircle, Ban, CheckCircle2 } from 'lucide-react'
import type { AnalysisResult, Measurement } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

export function MeasurementsPanel({ analysis }: { analysis: AnalysisResult }) {
  const comparisonMap = new Map(analysis.comparisons.map((item) => [item.measurementKey, item]))
  const available = analysis.measurements.filter((item) => item.value !== null)
  const unavailable = analysis.measurements.filter((item) => item.value === null)
  return (
    <details className="measurements panel">
      <summary className="panel-heading">
        <div><span className="eyebrow">Evidence table</span><h2>Measured, compared, withheld</h2></div>
        <span className="muted">{available.length} available · {unavailable.length} withheld</span>
      </summary>
      <div className="measurement-table" role="table" aria-label="Swing measurements">
        <div className="measurement-row measurement-row--header" role="row"><span>Measurement</span><span>Phase</span><span>Observed</span><span>Reference</span><span>Confidence</span></div>
        {available.map((measurement) => {
          const comparison = comparisonMap.get(measurement.key)
          return <MeasurementRow key={`${measurement.key}-${measurement.phase}`} measurement={measurement} comparison={comparison} />
        })}
      </div>
      <details className="unavailable-list">
        <summary><Ban size={15} /> {unavailable.length} measurements not claimed from this video</summary>
        <div>{unavailable.map((item) => <p key={`${item.key}-${item.phase}`}><strong>{item.label}</strong><span>{item.limitation}</span></p>)}</div>
      </details>
    </details>
  )
}

function MeasurementRow({ measurement, comparison }: { measurement: Measurement; comparison: AnalysisResult['comparisons'][number] | undefined }) {
  const status = comparison?.status ?? 'no-coverage'
  const reference = comparison?.reference
  return (
    <div className="measurement-row" role="row">
      <span><strong>{measurement.label}</strong><small>{measurement.observedFrom}</small></span>
      <span>{measurement.phase}</span>
      <span className="measurement-value">{formatValue(measurement)}</span>
      <span className={`reference-status reference-status--${status}`}>
        {status === 'within-range' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
        {reference ? `${reference.p10.toFixed(1)}–${reference.p90.toFixed(1)} ${reference.unit}` : 'No coverage'}
      </span>
      <span><ConfidenceBadge value={measurement.confidence} compact /></span>
    </div>
  )
}

function formatValue(measurement: Measurement): string {
  if (measurement.value === null) return 'Unavailable'
  const precision = measurement.unit === 'ms' ? 0 : 2
  const suffix = measurement.unit === 'x' ? ':1' : measurement.unit === 'normalized' ? '' : ` ${measurement.unit}`
  return `${measurement.value.toFixed(precision)}${suffix}`
}
