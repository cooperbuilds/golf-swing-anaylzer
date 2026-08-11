import { del, get, set } from 'idb-keyval'
import { isAnalysisSession, type AnalysisResult, type AnalysisSession, type HistoryEntry } from '../domain/types'
import { migrateAnalysis, migrateSession } from './analysis-migration'

const HISTORY_KEY = 'swinglab:history:v1'
const CACHE_PREFIX = 'swinglab:analysis:v1:'
const SESSION_HISTORY_KEY = 'swinglab:session-history:v1'
const SESSION_CACHE_PREFIX = 'swinglab:session:v1:'
const MAX_HISTORY = 20

export async function fileFingerprint(file: File): Promise<string> {
  return fingerprint(file, `${file.size}:${file.type}`)
}

export async function legacyFileFingerprint(file: File): Promise<string> {
  return fingerprint(file, `${file.name}:${file.size}:${file.lastModified}:${file.type}`)
}

async function fingerprint(file: File, metadataValue: string): Promise<string> {
  const chunkSize = 1024 * 1024
  const middle = Math.max(0, Math.floor(file.size / 2 - chunkSize / 2))
  const slices = await Promise.all([
    file.slice(0, chunkSize).arrayBuffer(),
    file.slice(middle, middle + chunkSize).arrayBuffer(),
    file.slice(Math.max(0, file.size - chunkSize), file.size).arrayBuffer(),
  ])
  const metadata = new TextEncoder().encode(metadataValue)
  const totalLength = metadata.byteLength + slices.reduce((total, slice) => total + slice.byteLength, 0)
  const sample = new Uint8Array(totalLength)
  sample.set(metadata)
  let offset = metadata.byteLength
  for (const slice of slices) {
    sample.set(new Uint8Array(slice), offset)
    offset += slice.byteLength
  }
  const digest = await crypto.subtle.digest('SHA-256', sample)
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function readCachedAnalysis(fingerprint: string): Promise<AnalysisResult | undefined> {
  const result = await get<AnalysisResult>(CACHE_PREFIX + fingerprint)
  return result ? migrateAnalysis(result) : undefined
}

export async function saveAnalysis(result: AnalysisResult): Promise<void> {
  await set(CACHE_PREFIX + result.id, result)
  const history = await listHistory()
  const next = [result, ...history.filter((item) => item.id !== result.id)].slice(0, MAX_HISTORY)
  await set(HISTORY_KEY, next)
}

export async function cacheAnalysis(result: AnalysisResult): Promise<void> {
  await set(CACHE_PREFIX + result.id, result)
}

export async function listHistory(): Promise<AnalysisResult[]> {
  return ((await get<AnalysisResult[]>(HISTORY_KEY)) ?? []).map(migrateAnalysis)
}

export async function removeAnalysis(id: string): Promise<void> {
  await del(CACHE_PREFIX + id)
  const history = await listHistory()
  await set(HISTORY_KEY, history.filter((item) => item.id !== id))
}

export async function readCachedSession(id: string): Promise<AnalysisSession | undefined> {
  const session = await get<AnalysisSession>(SESSION_CACHE_PREFIX + id)
  return session ? migrateSession(session) : undefined
}

export async function saveSession(session: AnalysisSession): Promise<void> {
  await set(SESSION_CACHE_PREFIX + session.id, session)
  const history = await listSessionHistory()
  const next = [session, ...history.filter((item) => item.id !== session.id)].slice(0, MAX_HISTORY)
  await set(SESSION_HISTORY_KEY, next)
}

export async function listSessionHistory(): Promise<AnalysisSession[]> {
  return ((await get<AnalysisSession[]>(SESSION_HISTORY_KEY)) ?? []).map(migrateSession)
}

export async function listHistoryEntries(): Promise<HistoryEntry[]> {
  const entries: HistoryEntry[] = [...await listSessionHistory(), ...await listHistory()]
  return entries.toSorted((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_HISTORY)
}

export async function removeHistoryEntry(entry: HistoryEntry): Promise<void> {
  if (!isAnalysisSession(entry)) return removeAnalysis(entry.id)
  await del(SESSION_CACHE_PREFIX + entry.id)
  const history = await listSessionHistory()
  await set(SESSION_HISTORY_KEY, history.filter((item) => item.id !== entry.id))
}
