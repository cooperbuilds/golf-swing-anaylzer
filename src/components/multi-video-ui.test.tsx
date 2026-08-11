// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { AnalysisResult, AnalysisSession, SelectedVideo } from '../domain/types'

vi.mock('./AnalysisWorkspace', () => ({
  AnalysisWorkspace: ({ analysis, seekRequest }: { analysis: AnalysisResult; seekRequest?: { timeMs: number } }) => <div data-testid="analysis-workspace" data-analysis-id={analysis.id} data-seek-ms={seekRequest?.timeMs ?? ''} />,
}))

import { SessionWorkspace } from './SessionWorkspace'
import { UploadPanel } from './UploadPanel'

const metadata = { name: 'swing.mp4', sizeBytes: 100, durationMs: 1200, width: 1080, height: 1920, orientation: 'vertical' as const, fps: null, fpsSource: 'unavailable' as const }

function selected(id: string, name: string, status: SelectedVideo['status'], error?: string): SelectedVideo {
  return { id, file: new File(['video'], name, { type: 'video/mp4' }), metadata: { ...metadata, name }, status, error }
}

function result(id: string, name: string): AnalysisResult {
  return {
    id, schemaVersion: 2, createdAt: '2026-08-11T00:00:00.000Z', video: { ...metadata, name }, quality: { cameraView: id === 'face' ? 'face-on' : 'down-the-line', cameraConfidence: .9, suitable: true, score: .8, factors: [], guidance: [] }, findings: [], globalConfidence: .8,
  } as unknown as AnalysisResult
}

describe('multi-video user flow', () => {
  it('passes every selected video to the review workflow', () => {
    const onFiles = vi.fn()
    const { container } = render(<UploadPanel onFiles={onFiles} selected={[]} onRemove={() => undefined} onAnalyze={() => undefined} recent={[]} onOpenRecent={() => undefined} />)
    const files = [new File(['a'], 'face.mp4', { type: 'video/mp4' }), new File(['b'], 'dtl.webm', { type: 'video/webm' })]
    fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } })
    expect(onFiles).toHaveBeenCalledWith(files)
  })

  it('shows independent validation and permits removing one failed file', () => {
    const onRemove = vi.fn()
    render(<UploadPanel onFiles={() => undefined} selected={[selected('ok', 'good.mp4', 'ready'), selected('bad', 'broken.mov', 'failed', 'Unsupported codec')]} onRemove={onRemove} onAnalyze={() => undefined} recent={[]} onOpenRecent={() => undefined} />)
    expect(screen.getByText('good.mp4')).toBeTruthy()
    expect(screen.getByText('Cannot use')).toBeTruthy()
    expect(screen.getByText('Unsupported codec')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Remove broken.mov' }))
    expect(onRemove).toHaveBeenCalledWith('bad')
  })

  it('switches to the exact supporting video and frame when session evidence is clicked', () => {
    const face = result('face', 'face.mp4')
    const dtl = result('dtl', 'dtl.mp4')
    const session = {
      schemaVersion: 1, id: 'session', createdAt: '2026-08-11T00:00:00.000Z', analyses: [face, dtl], globalConfidence: .8, overallSummary: 'Combined summary', bestMeasurements: [], warnings: [], relations: [],
      observations: [{ id: 'face-observation', fileName: 'face.mp4', lastModified: 1, metadata: face.video, status: 'analyzed', analysisId: 'face' }, { id: 'dtl-observation', fileName: 'dtl.mp4', lastModified: 1, metadata: dtl.video, status: 'analyzed', analysisId: 'dtl' }],
      findings: [{ id: 'posture', title: 'Posture pattern', summary: 'Supported.', why: 'Why', where: 'Impact', phase: 'Impact', priority: 'high', confidence: .84, frameMs: 640, workOn: 'Rotate', drill: 'Chair drill', evidence: [], swingCount: 1, videoCount: 1, aggregationNote: 'DTL support', supports: [{ analysisId: 'dtl', observationId: 'dtl-observation', videoName: 'dtl.mp4', cameraView: 'down-the-line', phase: 'Impact', frameMs: 640, confidence: .84, evidence: [] }] }],
    } satisfies AnalysisSession
    render(<SessionWorkspace session={session} videoUrls={{}} onBack={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /dtl\.mp4.*impact/i }))
    expect(screen.getByTestId('analysis-workspace').getAttribute('data-analysis-id')).toBe('dtl')
    expect(screen.getByTestId('analysis-workspace').getAttribute('data-seek-ms')).toBe('640')
  })
})
