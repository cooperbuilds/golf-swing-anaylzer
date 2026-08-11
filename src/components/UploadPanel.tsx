import { useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, Camera, Check, Film, LoaderCircle, Play, ShieldCheck, UploadCloud, X } from 'lucide-react'
import { isAnalysisSession, type HistoryEntry, type SelectedVideo } from '../domain/types'

interface UploadPanelProps {
  onFiles: (files: File[]) => void
  selected: SelectedVideo[]
  onRemove: (id: string) => void
  onAnalyze: () => void
  recent: HistoryEntry[]
  onOpenRecent: (result: HistoryEntry) => void
}

export function UploadPanel({ onFiles, selected, onRemove, onAnalyze, recent, onOpenRecent }: UploadPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const accept = (files?: FileList | null) => {
    if (files?.length) onFiles([...files])
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    accept(event.dataTransfer.files)
  }
  const pending = selected.some((item) => item.status === 'inspecting' || item.status === 'analyzing')
  const analyzable = selected.some((item) => item.status === 'ready' || item.status === 'cached')

  return (
    <main className="landing-shell">
      <section className="landing-copy">
        <span className="eyebrow eyebrow--accent"><span /> Evidence-first swing analysis</span>
        <h1>Your swings.<br /><em>Read clearly.</em></h1>
        <p>Upload one or several phone videos. Each swing is validated independently; compatible views contribute their best supported evidence without being averaged into fake 3D data.</p>
        <div className="trust-row">
          <span><ShieldCheck size={17} /> No invented angles</span>
          <span><Camera size={17} /> Camera-aware confidence</span>
          <span><Check size={17} /> Evidence-driven priorities</span>
        </div>
      </section>

      <section className={`upload-card ${dragging ? 'is-dragging' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={drop}>
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm" multiple hidden onChange={(event) => { accept(event.target.files); event.target.value = '' }} />
        <button type="button" className="upload-target" onClick={() => inputRef.current?.click()}>
          <span className="upload-target__icon"><UploadCloud size={27} /></span>
          <strong>Drop your swing videos here</strong>
          <span>or choose one or more files</span>
          <small>MP4, MOV, WebM · each video is checked independently</small>
        </button>

        {selected.length ? (
          <div className="video-review" aria-label="Selected videos">
            <div className="video-review__heading"><div><span className="eyebrow">Review videos</span><h2>{selected.length} selected</h2></div><small>Remove unusable or unrelated clips before analysis.</small></div>
            <div className="video-review__grid">
              {selected.map((item) => <VideoReviewCard key={item.id} item={item} onRemove={() => onRemove(item.id)} />)}
            </div>
            <button type="button" className="analyze-session-button" disabled={!analyzable || pending} onClick={onAnalyze}>
              {pending ? <LoaderCircle className="spin" size={18} /> : <Play size={18} fill="currentColor" />}
              {pending ? 'Checking videos…' : `Analyze ${selected.filter((item) => item.status !== 'failed').length} video${selected.filter((item) => item.status !== 'failed').length === 1 ? '' : 's'}`}
            </button>
          </div>
        ) : null}

        <div className="recording-guide">
          <div className="recording-guide__visual" aria-hidden="true"><span className="golfer-stick">◯<i /><b /></span><span className="guide-line" /><Camera size={22} /></div>
          <div><strong>For the clearest answer</strong><p>Use one complete swing per file. Keep head and feet visible and film chest-height, face-on or down-the-line.</p></div>
        </div>
      </section>

      <section className="how-it-works" aria-label="How analysis works">
        {[
          ['01', 'Upload videos', 'Choose one swing, complementary views, or several separate swings.'],
          ['02', 'Review and analyze', 'Every video gets its own quality, pose, phase, and evidence gates.'],
          ['03', 'Read the session', 'See individual results plus persistent or independently supported priorities.'],
        ].map(([number, title, copy]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{copy}</p></div></article>)}
      </section>

      {recent.length > 0 ? (
        <section className="recent-strip">
          <div><span className="eyebrow">Continue</span><h2>Recent analyses</h2></div>
          <div className="recent-strip__items">
            {recent.slice(0, 3).map((item) => {
              const session = isAnalysisSession(item)
              const name = session ? `${item.analyses.length} video session` : item.video.name
              const findings = item.findings.length
              return <button type="button" key={item.id} onClick={() => onOpenRecent(item)}><Film size={18} /><span><strong>{name}</strong><small>{new Date(item.createdAt).toLocaleDateString()} · {findings} priorities</small></span></button>
            })}
          </div>
        </section>
      ) : null}
    </main>
  )
}

function VideoReviewCard({ item, onRemove }: { item: SelectedVideo; onRemove: () => void }) {
  const metadata = item.metadata
  const statusLabel = item.status === 'failed' ? 'Cannot use'
    : item.status === 'cached' ? 'Cached analysis'
      : item.status === 'ready' ? 'Ready'
        : item.status === 'complete' ? 'Analyzed'
          : item.status === 'analyzing' ? 'Analyzing'
            : 'Inspecting'
  return (
    <article className={`video-review-card video-review-card--${item.status}`}>
      <div className="video-review-card__title"><Film size={18} /><strong title={item.file.name}>{item.file.name}</strong><button type="button" onClick={onRemove} aria-label={`Remove ${item.file.name}`}><X size={16} /></button></div>
      <dl>
        <div><dt>Duration</dt><dd>{metadata ? `${(metadata.durationMs / 1000).toFixed(1)}s` : '—'}</dd></div>
        <div><dt>Resolution</dt><dd>{metadata ? `${metadata.width}×${metadata.height}` : '—'}</dd></div>
        <div><dt>FPS</dt><dd>{metadata?.fps ? metadata.fps.toFixed(1) : 'Unavailable'}</dd></div>
        <div><dt>Size</dt><dd>{formatBytes(item.file.size)}</dd></div>
        <div><dt>View</dt><dd>{item.quality ? item.quality.cameraView : 'Pending pose analysis'}</dd></div>
        <div><dt>Quality</dt><dd>{item.quality ? (item.quality.suitable ? 'Suitable' : 'Review') : item.status === 'failed' ? 'Failed' : 'Pending'}</dd></div>
      </dl>
      <div className="video-review-card__status">{item.status === 'failed' ? <AlertTriangle size={15} /> : item.status === 'inspecting' || item.status === 'analyzing' ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}<span><strong>{statusLabel}</strong>{item.error ? <small>{item.error}</small> : item.quality?.guidance[0] ? <small>{item.quality.guidance[0]}</small> : null}</span></div>
    </article>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
