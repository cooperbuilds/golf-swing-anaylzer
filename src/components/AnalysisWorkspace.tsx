import { useEffect, useState } from 'react'
import { ArrowLeft, Database, Download, Gauge, RotateCcw } from 'lucide-react'
import type { AnalysisResult, Finding } from '../domain/types'
import { confidenceLevel } from '../core/geometry'
import { downloadValidationCase } from '../services/validation-export'
import { ConfidenceBadge } from './ConfidenceBadge'
import { IssuePanel } from './IssuePanel'
import { KeyframeStrip } from './KeyframeStrip'
import { MeasurementsPanel } from './MeasurementsPanel'
import { PhaseTimeline } from './PhaseTimeline'
import { ProgressComparison } from './ProgressComparison'
import { ProComparison } from './ProComparison'
import { QualityPanel } from './QualityPanel'
import { StrengthsPanel } from './StrengthsPanel'
import { SwingSummary } from './SwingSummary'
import { VideoStage } from './VideoStage'

interface AnalysisWorkspaceProps {
  analysis: AnalysisResult
  previous?: AnalysisResult
  videoUrl: string | null
  onBack: () => void
  embedded?: boolean
  seekRequest?: { analysisId: string; timeMs: number; findingId?: string; token: number }
}

export function AnalysisWorkspace({ analysis, previous, videoUrl, onBack, embedded = false, seekRequest }: AnalysisWorkspaceProps) {
  const firstFinding = analysis.findings[0]
  const [currentMs, setCurrentMs] = useState(firstFinding?.frameMs ?? analysis.phases[0]?.anchorMs ?? 0)
  const [selectedId, setSelectedId] = useState<string | null>(firstFinding?.id ?? null)
  const confidence = confidenceLevel(analysis.globalConfidence)
  const visibleMeasurements = analysis.measurements.filter((item) => item.value !== null).length
  useEffect(() => {
    if (!seekRequest || seekRequest.analysisId !== analysis.id) return
    setCurrentMs(seekRequest.timeMs)
    setSelectedId(seekRequest.findingId ?? null)
  }, [analysis.id, seekRequest])
  const selectFinding = (finding: Finding) => {
    setSelectedId((current) => current === finding.id ? null : finding.id)
    setCurrentMs(finding.frameMs)
  }

  return (
    <main className="analysis-shell">
      <div className={`analysis-titlebar ${embedded ? 'analysis-titlebar--embedded' : ''}`}>
        <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={17} /> New swing</button>
        <div className="analysis-title">
          <span className="eyebrow">Swing analysis · {new Date(analysis.createdAt).toLocaleDateString()}</span>
          <h1>{analysis.video.name}</h1>
        </div>
        <button type="button" className="back-button" onClick={() => downloadValidationCase(analysis)} title="Download a compact analyzer record for blinded coach validation"><Download size={17} /> Validation record</button>
        <div className="analysis-summary">
          <div><Gauge size={17} /><span><small>Evidence confidence</small><strong className={`text-${confidence}`}>{confidence}</strong></span></div>
          <div><Database size={17} /><span><small>Reference</small><strong>{analysis.referenceLabel}</strong></span></div>
        </div>
      </div>

      <div className="analysis-kpis">
        <span><b>{analysis.findings.length}</b> priorities</span>
        <span><b>{visibleMeasurements}</b> measurements</span>
        <span><b>9</b> swing phases</span>
        <span><b>{analysis.similarity.score === null ? '—' : Math.round(analysis.similarity.score)}</b> previous similarity <small>not a score</small></span>
        <ConfidenceBadge value={analysis.globalConfidence} />
      </div>

      <SwingSummary analysis={analysis} />

      <div className="analysis-grid">
        <VideoStage analysis={analysis} videoUrl={videoUrl} seekMs={currentMs} onTime={setCurrentMs} />
        <IssuePanel findings={analysis.findings} coachNarrative={analysis.coachNarrative} selectedId={selectedId} onSelect={selectFinding} />
      </div>
      <StrengthsPanel strengths={analysis.strengths ?? []} onSeek={setCurrentMs} />
      <PhaseTimeline phases={analysis.phases} findings={analysis.findings} durationMs={analysis.video.durationMs} currentMs={currentMs} onSeek={setCurrentMs} />
      <KeyframeStrip phases={analysis.phases} poseFrames={analysis.poseFrames} currentMs={currentMs} onSeek={setCurrentMs} />
      <ProComparison analysis={analysis} previous={previous} onSeek={setCurrentMs} />
      <ProgressComparison analysis={analysis} />

      <div className="analysis-lower-grid">
        <MeasurementsPanel analysis={analysis} />
        <QualityPanel analysis={analysis} />
      </div>

      <section className="warnings-panel">
        <span><RotateCcw size={16} /> Analysis limits</span>
        {analysis.warnings.map((warning) => <p key={warning}>{warning}</p>)}
      </section>
    </main>
  )
}
