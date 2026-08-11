import { useState } from 'react'
import { AlertTriangle, ArrowLeft, Camera, CheckCircle2, Layers3, MapPin, Video } from 'lucide-react'
import type { AnalysisSession, SessionFindingSupport } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'
import { AnalysisWorkspace } from './AnalysisWorkspace'

interface SessionWorkspaceProps {
  session: AnalysisSession
  videoUrls: Record<string, string>
  onBack: () => void
}

export function SessionWorkspace({ session, videoUrls, onBack }: SessionWorkspaceProps) {
  const [activeAnalysisId, setActiveAnalysisId] = useState(session.analyses[0]?.id ?? '')
  const [seekRequest, setSeekRequest] = useState<{ analysisId: string; timeMs: number; findingId?: string; token: number }>()
  const active = session.analyses.find((analysis) => analysis.id === activeAnalysisId) ?? session.analyses[0]

  const openSupport = (support: SessionFindingSupport, findingId: string) => {
    setActiveAnalysisId(support.analysisId)
    setSeekRequest({ analysisId: support.analysisId, timeMs: support.frameMs, findingId, token: Date.now() })
  }

  return (
    <main className="session-shell">
      <section className="session-header panel">
        <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} /> New session</button>
        <div><span className="eyebrow">Combined session analysis</span><h1>{session.analyses.length} usable video{session.analyses.length === 1 ? '' : 's'}</h1><p>{session.overallSummary}</p></div>
        <ConfidenceBadge value={session.globalConfidence} />
      </section>

      <section className="session-flow" aria-label="Analysis workflow"><span className="is-complete">Upload videos</span><span>→</span><span className="is-complete">Review videos</span><span>→</span><span className="is-complete">Individual analysis</span><span>→</span><span className="is-active">Combined session</span></section>

      <section className="session-priorities panel">
        <div className="panel-heading"><div><span className="eyebrow">Cross-video evidence</span><h2>Session priorities</h2></div><span className="priority-count">{session.findings.length}/3</span></div>
        {session.findings.length === 0 ? <div className="no-findings"><CheckCircle2 size={28} /><h3>No forced session diagnosis</h3><p>No repeated or independently supported issue passed the existing gates.</p></div> : (
          <div className="session-finding-grid">
            {session.findings.map((finding, index) => (
              <article key={finding.id} className="session-finding-card">
                <div className="session-finding-card__heading"><span>{String(index + 1).padStart(2, '0')}</span><div><small>{finding.priority} priority</small><h3>{finding.title}</h3></div><ConfidenceBadge value={finding.confidence} compact /></div>
                <p>{finding.summary}</p><small className="session-note">{finding.aggregationNote}</small>
                <div className="session-supports"><strong>Supporting video and frame</strong>{finding.supports.map((support) => <button type="button" key={support.analysisId} onClick={() => openSupport(support, finding.id)}><Video size={15} /><span><b>{support.videoName}</b><small>{support.cameraView} · {support.phase} · {(support.frameMs / 1000).toFixed(2)}s</small></span><MapPin size={14} /></button>)}</div>
                <div className="drill"><span>Practice drill</span><p>{finding.drill}</p></div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="session-observations panel">
        <div className="panel-heading"><div><span className="eyebrow">Video observations</span><h2>Choose an individual analysis</h2></div><Layers3 size={20} /></div>
        <div className="session-video-tabs">
          {session.analyses.map((analysis) => <button type="button" className={analysis.id === active?.id ? 'is-active' : ''} key={analysis.id} onClick={() => setActiveAnalysisId(analysis.id)}><Camera size={16} /><span><strong>{analysis.video.name}</strong><small>{analysis.quality.cameraView} · {analysis.quality.suitable ? 'suitable' : 'review'} · {analysis.findings.length} priorities</small></span></button>)}
          {session.observations.filter((item) => item.status === 'failed').map((item) => <div className="session-video-failed" key={item.id}><AlertTriangle size={16} /><span><strong>{item.fileName}</strong><small>{item.error}</small></span></div>)}
        </div>
        <div className="session-relations">{session.relations.map((relation) => {
          const first = session.observations.find((item) => item.id === relation.firstObservationId)
          const second = session.observations.find((item) => item.id === relation.secondObservationId)
          return <p key={`${relation.firstObservationId}:${relation.secondObservationId}`}><strong>{first?.fileName} ↔ {second?.fileName}</strong><span>{relation.kind.replaceAll('-', ' ')} · {relation.reason}</span></p>
        })}</div>
      </section>

      {active ? <AnalysisWorkspace key={active.id} analysis={active} videoUrl={videoUrls[active.id] ?? null} onBack={onBack} seekRequest={seekRequest?.analysisId === active.id ? seekRequest : undefined} embedded /> : null}

      <section className="warnings-panel session-warnings"><span>Session limits</span>{session.warnings.map((warning) => <p key={warning}>{warning}</p>)}</section>
    </main>
  )
}
