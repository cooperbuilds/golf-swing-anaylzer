import { ArrowRight, CalendarDays, ChartNoAxesCombined, Layers3, Trash2 } from 'lucide-react'
import { isAnalysisSession, type HistoryEntry } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

interface HistoryViewProps {
  history: HistoryEntry[]
  onOpen: (result: HistoryEntry) => void
  onDelete: (entry: HistoryEntry) => void
}

export function HistoryView({ history, onOpen, onDelete }: HistoryViewProps) {
  return (
    <main className="history-shell">
      <div className="history-hero"><span className="eyebrow eyebrow--accent"><span /> Progress without a vanity score</span><h1>Your analysis history</h1><p>Single-video history remains compatible; new sessions preserve every individual video analysis and the combined evidence.</p></div>
      {history.length === 0 ? <div className="empty-history panel"><ChartNoAxesCombined size={36} /><h2>No analyses saved yet</h2><p>Your completed sessions will stay in this browser.</p></div> : (
        <div className="history-list">
          {history.map((item, index) => {
            const session = isAnalysisSession(item)
            const name = session ? `${item.analyses.length} video session` : item.video.name
            const detail = session ? `${item.observations.filter((observation) => observation.status === 'failed').length} failed · ${item.relations.length} pair assessments` : `${item.quality.cameraView} · ${(item.video.durationMs / 1000).toFixed(1)}s`
            return <article className="history-item panel" key={item.id}>
              <button className="history-item__main" type="button" onClick={() => onOpen(item)}>
                <span className="history-index">{session ? <Layers3 size={18} /> : String(history.length - index).padStart(2, '0')}</span>
                <span className="history-name"><small><CalendarDays size={13} /> {new Date(item.createdAt).toLocaleString()}</small><strong>{name}</strong><em>{detail}</em></span>
                <span className="history-priorities"><small>Priorities</small><strong>{item.findings.length ? item.findings.map((finding) => finding.title).join(' · ') : 'No high-confidence finding'}</strong></span>
                <ConfidenceBadge value={item.globalConfidence} /><ArrowRight size={18} />
              </button>
              <button type="button" className="history-delete" onClick={() => onDelete(item)} aria-label={`Delete ${name}`}><Trash2 size={16} /></button>
            </article>
          })}
        </div>
      )}
    </main>
  )
}
