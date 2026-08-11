import { buildCoachPayload } from '../core/coaching'
import type { CoachNarrative, Finding, Measurement, QualityReport, Strength } from '../domain/types'

interface CoachResponse {
  overview?: unknown
  issues?: unknown
}

export async function createCoachNarrative(
  findings: Finding[],
  measurements: Measurement[],
  quality: QualityReport,
  strengths: Strength[] = [],
  overallSummary = '',
): Promise<CoachNarrative> {
  const endpoint = import.meta.env.VITE_COACH_ENDPOINT?.trim()
  const fallback = deterministicFallback(findings)
  if (!endpoint || findings.length === 0) return fallback

  const payload = buildCoachPayload(findings, measurements, quality, strengths, overallSummary)
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!response.ok) return fallback
    return validateResponse(await response.json() as CoachResponse, findings, overallSummary || fallback.overview) ?? fallback
  } catch {
    return fallback
  } finally {
    window.clearTimeout(timeout)
  }
}

function validateResponse(response: CoachResponse, findings: Finding[], deterministicOverview: string): CoachNarrative | null {
  if (typeof response.overview !== 'string' || response.overview.length > 500 || !Array.isArray(response.issues)) return null
  const allowed = new Set(findings.map((finding) => finding.id))
  const allowedNumbers = new Set<string>([...(JSON.stringify(findings).match(/-?\d+(?:\.\d+)?/g) ?? []), '1', '2', '3'])
  const issueNotes: Record<string, string> = {}
  for (const issue of response.issues) {
    if (!isRecord(issue) || typeof issue.id !== 'string' || typeof issue.explanation !== 'string') return null
    if (!allowed.has(issue.id) || issue.explanation.length > 700) return null
    if ((issue.explanation.match(/-?\d+(?:\.\d+)?/g) ?? []).some((value) => !allowedNumbers.has(value))) return null
    issueNotes[issue.id] = issue.explanation
  }
  return {
    mode: 'ai',
    overview: deterministicOverview,
    issueNotes,
    note: 'AI wording is constrained to the deterministic findings shown with measured evidence below.',
  }
}

function deterministicFallback(findings: Finding[]): CoachNarrative {
  return {
    mode: 'deterministic-fallback',
    overview: findings.length > 0
      ? `Start with ${findings[0].title.toLowerCase()}. Work through these priorities in order and re-record from the same camera position.`
      : 'The evidence gates did not support a coaching priority for this recording.',
    issueNotes: {},
    note: 'Deterministic coaching is active. Configure a protected VITE_COACH_ENDPOINT to enable AI phrasing; never put an AI API key in the browser.',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
