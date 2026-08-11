import { confidenceLevel } from '../core/geometry'

interface ConfidenceBadgeProps {
  value: number
  compact?: boolean
}
export function ConfidenceBadge({ value, compact = false }: ConfidenceBadgeProps) {
  const level = confidenceLevel(value)
  return (
    <span className={`confidence confidence--${level}`} title={`${Math.round(value * 100)}% confidence`}>
      <span className="confidence__dot" aria-hidden="true" />
      {compact ? `${Math.round(value * 100)}%` : `${level} · ${Math.round(value * 100)}%`}
    </span>
  )
}
