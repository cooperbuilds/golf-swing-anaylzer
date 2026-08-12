// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PHASE_NAMES, type AnalysisResult, type VideoMetadata } from '../domain/types'

const mocks = vi.hoisted(() => ({
  analyzeSwing: vi.fn(),
  cacheAnalysis: vi.fn(async () => undefined),
  fileFingerprint: vi.fn(async (file: File) => `fingerprint:${file.name}`),
  legacyFileFingerprint: vi.fn(async (file: File) => `legacy:${file.name}`),
  listHistoryEntries: vi.fn(async () => []),
  readCachedAnalysis: vi.fn(async (_fingerprint: string) => undefined as AnalysisResult | undefined),
  removeHistoryEntry: vi.fn(async () => undefined),
  saveSession: vi.fn(async () => undefined),
  inspectVideoMetadata: vi.fn(),
}))

vi.mock('../services/analyzer', () => ({ analyzeSwing: mocks.analyzeSwing }))
vi.mock('../services/analysis-cache', () => ({
  cacheAnalysis: mocks.cacheAnalysis,
  fileFingerprint: mocks.fileFingerprint,
  legacyFileFingerprint: mocks.legacyFileFingerprint,
  listHistoryEntries: mocks.listHistoryEntries,
  readCachedAnalysis: mocks.readCachedAnalysis,
  removeHistoryEntry: mocks.removeHistoryEntry,
  saveSession: mocks.saveSession,
}))
vi.mock('../services/video-reader', () => ({ inspectVideoMetadata: mocks.inspectVideoMetadata }))

import { useAnalysis } from './useAnalysis'

function metadata(name: string): VideoMetadata {
  return { name, sizeBytes: 100, durationMs: 1200, width: 1080, height: 1920, orientation: 'vertical', fps: 60, fpsSource: 'container' }
}

function analysis(id: string, name: string): AnalysisResult {
  return {
    schemaVersion: 2,
    id,
    createdAt: '2026-08-12T00:00:00.000Z',
    source: 'measured',
    video: metadata(name),
    quality: { suitable: true, score: .8, cameraView: 'face-on', cameraConfidence: .9, factors: [], guidance: [] },
    phases: PHASE_NAMES.map((phase, index) => ({ name: phase, startMs: index * 100, endMs: (index + 1) * 100, anchorMs: index * 100, confidence: .8, detection: 'kinematic' })),
    poseFrames: [], measurements: [], comparisons: [], findings: [], strengths: [],
    similarity: { available: false, score: null, referenceCount: 0, method: 'unavailable', note: '' },
    globalConfidence: .8, referenceLabel: 'test', warnings: [],
  }
}

function videos(count = 7): File[] {
  return Array.from({ length: count }, (_, index) => new File([`video-${index}`], `swing-${index + 1}.mov`, { type: 'video/quicktime', lastModified: index + 1 }))
}

describe('multi-video analysis queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((file: File) => `blob:${file.name}`) })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
    mocks.inspectVideoMetadata.mockImplementation(async (file: File) => {
      await new Promise((resolve) => window.setTimeout(resolve, 8 - Number(file.name.match(/\d+/)?.[0] ?? 1)))
      return metadata(file.name)
    })
    mocks.analyzeSwing.mockImplementation(async (file: File, fingerprint: string) => analysis(fingerprint, file.name))
  })

  it('processes all seven files and passes every successful result to session aggregation', async () => {
    const { result } = renderHook(() => useAnalysis())
    await act(async () => { await result.current.addFiles(videos()) })
    expect(result.current.selectedVideos).toHaveLength(7)
    expect(result.current.selectedVideos.every((item) => item.status === 'ready')).toBe(true)

    await act(async () => { await result.current.analyzeSelected() })
    expect(mocks.analyzeSwing).toHaveBeenCalledTimes(7)
    expect(result.current.session?.analyses).toHaveLength(7)
    expect(result.current.session?.observations.filter((item) => item.status === 'analyzed')).toHaveLength(7)
    expect(new Set(result.current.session?.analyses.map((item) => item.video.name))).toEqual(new Set(videos().map((file) => file.name)))
  })

  it('keeps six successful results when one video analysis fails', async () => {
    mocks.analyzeSwing.mockImplementation(async (file: File, fingerprint: string) => {
      if (file.name === 'swing-4.mov') throw new Error('Decoder rejected swing-4.mov')
      return analysis(fingerprint, file.name)
    })
    const { result } = renderHook(() => useAnalysis())
    await act(async () => { await result.current.addFiles(videos()) })
    await act(async () => { await result.current.analyzeSelected() })

    expect(result.current.session?.analyses).toHaveLength(6)
    expect(result.current.session?.observations.find((item) => item.fileName === 'swing-4.mov')).toMatchObject({ status: 'failed', error: 'Decoder rejected swing-4.mov' })
  })

  it('keeps a cached analysis attached to its file while processing the other six', async () => {
    const cached = analysis('fingerprint:swing-3.mov', 'swing-3.mov')
    mocks.readCachedAnalysis.mockImplementation(async (fingerprint: string) => fingerprint === cached.id ? cached : undefined)
    const { result } = renderHook(() => useAnalysis())
    await act(async () => { await result.current.addFiles(videos()) })
    expect(result.current.selectedVideos.find((item) => item.file.name === 'swing-3.mov')).toMatchObject({ status: 'cached', cachedAnalysis: cached })

    await act(async () => { await result.current.analyzeSelected() })
    expect(mocks.analyzeSwing).toHaveBeenCalledTimes(6)
    expect(result.current.session?.analyses).toHaveLength(7)
    expect(result.current.session?.analyses.find((item) => item.id === cached.id)?.video.name).toBe('swing-3.mov')
  })
})
