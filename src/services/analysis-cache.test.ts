import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalysisResult, AnalysisSession } from '../domain/types'

const storage = vi.hoisted(() => new Map<string, unknown>())

vi.mock('idb-keyval', () => ({
  get: async (key: string) => storage.get(key),
  set: async (key: string, value: unknown) => { storage.set(key, value) },
  del: async (key: string) => { storage.delete(key) },
}))

import { cacheAnalysis, fileFingerprint, listHistory, listHistoryEntries, readCachedAnalysis, readCachedSession, removeAnalysis, removeHistoryEntry, saveAnalysis, saveSession } from './analysis-cache'

function analysis(id: string): AnalysisResult {
  return {
    id, schemaVersion: 2, createdAt: id === 'first' ? '2026-08-10T00:00:00.000Z' : '2026-08-11T00:00:00.000Z', measurements: [], findings: [], strengths: [],
  } as unknown as AnalysisResult
}

function session(id: string): AnalysisSession {
  return { schemaVersion: 1, id, createdAt: '2026-08-12T00:00:00.000Z', observations: [], analyses: [analysis('nested')], relations: [], findings: [], bestMeasurements: [], overallSummary: '', globalConfidence: .8, warnings: [] }
}

describe('analysis history readiness', () => {
  beforeEach(() => storage.clear())

  it('saves, restores, orders, and removes cached analyses', async () => {
    await saveAnalysis(analysis('first'))
    await saveAnalysis(analysis('second'))
    expect((await listHistory()).map((item) => item.id)).toEqual(['second', 'first'])
    expect((await readCachedAnalysis('first'))?.id).toBe('first')
    await removeAnalysis('first')
    expect(await readCachedAnalysis('first')).toBeUndefined()
    expect((await listHistory()).map((item) => item.id)).toEqual(['second'])
  })

  it('saves and restores a multi-video session while retaining legacy single-video history', async () => {
    await saveAnalysis(analysis('legacy'))
    await saveSession(session('multi'))
    expect((await readCachedSession('multi'))?.analyses[0].id).toBe('nested')
    const entries = await listHistoryEntries()
    expect(entries.map((item) => item.id)).toEqual(['multi', 'legacy'])
    await removeHistoryEntry(entries[0])
    expect(await readCachedSession('multi')).toBeUndefined()
    expect((await listHistoryEntries()).map((item) => item.id)).toEqual(['legacy'])
  })

  it('uses stable video content identity across file renames', async () => {
    const first = new File(['same-video-bytes'], 'first.mp4', { type: 'video/mp4', lastModified: 1 })
    const renamed = new File(['same-video-bytes'], 'renamed.mp4', { type: 'video/mp4', lastModified: 9 })
    expect(await fileFingerprint(first)).toBe(await fileFingerprint(renamed))
  })

  it('reuses an individual cached analysis without creating a separate history entry', async () => {
    await cacheAnalysis(analysis('cached-video'))
    expect((await readCachedAnalysis('cached-video'))?.id).toBe('cached-video')
    expect(await listHistory()).toEqual([])
  })
})
