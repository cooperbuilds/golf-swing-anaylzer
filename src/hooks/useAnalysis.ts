import { useCallback, useEffect, useRef, useState } from 'react'
import { buildAnalysisSession, sessionIdentity } from '../core/session-aggregation'
import { isAnalysisSession, type AnalysisProgress, type AnalysisResult, type AnalysisSession, type HistoryEntry, type SelectedVideo, type SessionVideoObservation } from '../domain/types'
import { analyzeSwing } from '../services/analyzer'
import {
  cacheAnalysis,
  fileFingerprint,
  legacyFileFingerprint,
  listHistoryEntries,
  readCachedAnalysis,
  removeHistoryEntry,
  saveSession,
} from '../services/analysis-cache'
import { inspectVideoMetadata } from '../services/video-reader'

const IDLE_PROGRESS: AnalysisProgress = { stage: 'quality', percent: 0, message: 'Ready for swing videos' }
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm']

export function useAnalysis() {
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [session, setSession] = useState<AnalysisSession | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [selectedVideos, setSelectedVideos] = useState<SelectedVideo[]>([])
  const [progress, setProgress] = useState<AnalysisProgress>(IDLE_PROGRESS)
  const [error, setError] = useState<string | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({})
  const urlRefs = useRef(new Map<string, string>())

  const clearVideoUrls = useCallback(() => {
    for (const url of urlRefs.current.values()) URL.revokeObjectURL(url)
    urlRefs.current.clear()
    setVideoUrls({})
  }, [])

  useEffect(() => {
    void listHistoryEntries().then(setHistory)
    const urls = urlRefs.current
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url)
    }
  }, [])

  const addFiles = useCallback(async (files: File[]) => {
    setError(null)
    const accepted = files.filter(isSupportedVideo)
    const rejected = files.filter((file) => !isSupportedVideo(file))
    if (rejected.length) setError(`${rejected.length} file${rejected.length === 1 ? '' : 's'} skipped. Use MP4, MOV, or WebM.`)
    const existingKeys = new Set(selectedVideos.map((item) => `${item.file.name}:${item.file.size}:${item.file.lastModified}`))
    const additions = accepted
      .filter((file) => !existingKeys.has(`${file.name}:${file.size}:${file.lastModified}`))
      .map((file) => ({ id: crypto.randomUUID(), file, status: 'inspecting' as const }))
    if (!additions.length) return
    setSelectedVideos((current) => [...current, ...additions])
    const knownFingerprints = new Set(selectedVideos.flatMap((item) => item.fingerprint ? [item.fingerprint] : []))
    await Promise.all(additions.map(async (selected) => {
      try {
        const fingerprint = await fileFingerprint(selected.file)
        if (knownFingerprints.has(fingerprint)) {
          setSelectedVideos((current) => current.map((item) => item.id === selected.id ? { ...item, fingerprint, status: 'failed', error: 'This is the same video content as another selected file.' } : item))
          return
        }
        knownFingerprints.add(fingerprint)
        const legacyFingerprint = await legacyFileFingerprint(selected.file)
        const cachedAnalysis = await readCachedAnalysis(fingerprint) ?? await readCachedAnalysis(legacyFingerprint)
        const metadata = cachedAnalysis?.video ?? await inspectVideoMetadata(selected.file)
        setSelectedVideos((current) => current.map((item) => item.id === selected.id ? {
          ...item,
          fingerprint,
          metadata,
          cachedAnalysis: cachedAnalysis ? { ...cachedAnalysis, id: fingerprint } : undefined,
          quality: cachedAnalysis?.quality,
          status: cachedAnalysis ? 'cached' : 'ready',
        } : item))
      } catch (caught) {
        setSelectedVideos((current) => current.map((item) => item.id === selected.id ? {
          ...item,
          status: 'failed',
          error: caught instanceof Error ? caught.message : 'This video could not be inspected.',
        } : item))
      }
    }))
  }, [selectedVideos])

  const removeSelected = useCallback((id: string) => {
    setSelectedVideos((current) => current.filter((item) => item.id !== id))
  }, [])

  const analyzeSelected = useCallback(async () => {
    const usable = selectedVideos.filter((item) => item.status === 'ready' || item.status === 'cached')
    if (!usable.length) {
      setError('No selected video passed the decode check.')
      return
    }
    setError(null)
    setIsAnalyzing(true)
    setAnalysis(null)
    setSession(null)
    clearVideoUrls()
    const analyses: AnalysisResult[] = []
    const observations: SessionVideoObservation[] = selectedVideos.filter((item) => item.status === 'failed').map((item) => ({
      id: item.fingerprint ?? item.id,
      fileName: item.file.name,
      lastModified: item.file.lastModified,
      metadata: item.metadata,
      status: 'failed',
      error: item.error ?? 'This video could not be decoded.',
    }))
    try {
      for (let index = 0; index < usable.length; index += 1) {
        const selected = usable[index]
        const fingerprint = selected.fingerprint ?? await fileFingerprint(selected.file)
        setSelectedVideos((current) => current.map((item) => item.id === selected.id ? { ...item, status: 'analyzing' } : item))
        try {
          const result = selected.cachedAnalysis ?? await analyzeSwing(selected.file, fingerprint, (next) => {
            setProgress({
              ...next,
              percent: Math.round((index + next.percent / 100) / usable.length * 100),
              message: `${selected.file.name} · ${next.message}`,
            })
          })
          await cacheAnalysis(result)
          analyses.push(result)
          observations.push({
            id: fingerprint,
            fileName: selected.file.name,
            lastModified: selected.file.lastModified,
            metadata: result.video,
            status: 'analyzed',
            analysisId: result.id,
          })
          const url = URL.createObjectURL(selected.file)
          urlRefs.current.set(result.id, url)
          setSelectedVideos((current) => current.map((item) => item.id === selected.id ? { ...item, status: selected.cachedAnalysis ? 'cached' : 'complete', quality: result.quality } : item))
        } catch (caught) {
          const message = caught instanceof Error ? caught.message : 'Analysis failed unexpectedly.'
          observations.push({ id: fingerprint, fileName: selected.file.name, lastModified: selected.file.lastModified, metadata: selected.metadata, status: 'failed', error: message })
          setSelectedVideos((current) => current.map((item) => item.id === selected.id ? { ...item, status: 'failed', error: message } : item))
        }
      }
      if (!analyses.length) throw new Error('None of the selected videos produced a usable analysis.')
      const id = await sessionIdentity(selectedVideos.map((item) => item.fingerprint ?? item.id))
      const result = buildAnalysisSession(id, observations, analyses)
      await saveSession(result)
      setSession(result)
      setVideoUrls(Object.fromEntries(urlRefs.current))
      setHistory(await listHistoryEntries())
      setProgress({ stage: 'complete', percent: 100, message: 'Session analysis ready' })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Session analysis failed unexpectedly.')
    } finally {
      setIsAnalyzing(false)
    }
  }, [clearVideoUrls, selectedVideos])

  const showEntry = useCallback((entry: HistoryEntry) => {
    clearVideoUrls()
    if (isAnalysisSession(entry)) {
      setSession(entry)
      setAnalysis(null)
    } else {
      setAnalysis(entry)
      setSession(null)
    }
    setError(null)
  }, [clearVideoUrls])

  const deleteEntry = useCallback(async (entry: HistoryEntry) => {
    await removeHistoryEntry(entry)
    setHistory(await listHistoryEntries())
    if (isAnalysisSession(entry)) setSession((current) => current?.id === entry.id ? null : current)
    else setAnalysis((current) => current?.id === entry.id ? null : current)
  }, [])

  const startNew = useCallback(() => {
    clearVideoUrls()
    setAnalysis(null)
    setSession(null)
    setSelectedVideos([])
    setError(null)
  }, [clearVideoUrls])

  return {
    analysis,
    session,
    history,
    selectedVideos,
    progress,
    error,
    isAnalyzing,
    videoUrls,
    addFiles,
    removeSelected,
    analyzeSelected,
    showEntry,
    deleteEntry,
    startNew,
  }
}

function isSupportedVideo(file: File): boolean {
  const lower = file.name.toLowerCase()
  return file.type.startsWith('video/') && VIDEO_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
