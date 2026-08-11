// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Finding } from '../domain/types'
import { createCoachNarrative } from '../services/ai-coach'
import { IssuePanel } from './IssuePanel'

const finding: Finding = {
  id: 'tempo-outlier',
  title: 'Tempo outside the reference range',
  priority: 'high',
  confidence: .84,
  frameMs: 2150,
  phase: 'Transition',
  where: 'Top → Impact',
  summary: 'The measured tempo ratio is outside the licensed timing range.',
  likelyCause: 'The phase timing shows a transition that is too abrupt.',
  why: 'An abrupt transition can make contact less repeatable.',
  workOn: 'Make the change of direction smoother.',
  drill: 'Count to the top, then swing through at half speed.',
  evidence: [{ measurementKey: 'tempo_ratio', measured: '1.8×', reference: '2.7–3.3×', confidence: .84 }],
}

describe('analysis-screen readiness', () => {
  it('supports zero findings without forcing a diagnosis', () => {
    render(<IssuePanel findings={[]} selectedId={null} onSelect={() => undefined} />)
    expect(screen.getByText('No forced diagnosis')).toBeTruthy()
    expect(screen.getByText('0/3')).toBeTruthy()
  })

  it('sends the selected evidence-backed finding to the video seek path', () => {
    const onSelect = vi.fn()
    render(<IssuePanel findings={[finding]} selectedId={null} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /tempo outside/i }))
    expect(onSelect).toHaveBeenCalledWith(finding)
  })

  it('returns usable deterministic coaching without an AI endpoint', async () => {
    const narrative = await createCoachNarrative([finding], [], {
      cameraView: 'down-the-line', cameraConfidence: .8, suitable: true, score: .8, factors: [], guidance: [],
    })
    expect(narrative.mode).toBe('deterministic-fallback')
    expect(narrative.overview).toContain('Start with')
  })
})
