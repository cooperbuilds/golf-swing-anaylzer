import { ArrowRight, Dumbbell, MapPin, Target } from 'lucide-react'
import type { CoachNarrative, Finding } from '../domain/types'
import { ConfidenceBadge } from './ConfidenceBadge'

interface IssuePanelProps {
  findings: Finding[]
  coachNarrative?: CoachNarrative
  selectedId: string | null
  onSelect: (finding: Finding) => void
}

export function IssuePanel({ findings, coachNarrative, selectedId, onSelect }: IssuePanelProps) {
  const narrative = coachNarrative ?? {
    mode: 'deterministic-fallback' as const,
    overview: findings.length > 0 ? `Start with ${findings[0].title.toLowerCase()}.` : 'No evidence-backed priority was found.',
    issueNotes: {},
    note: 'This cached analysis uses deterministic coaching.',
  }
  return (
    <aside className="issues-panel panel">
      <div className="panel-heading">
        <div><span className="eyebrow">Coach's read</span><h2>Your priorities</h2></div>
        <span className="priority-count">{findings.length}/3</span>
      </div>
      <div className="coach-overview">
        <span>{narrative.mode === 'ai' ? 'AI coach' : 'Evidence coach'}</span>
        <p>{narrative.overview}</p>
        <small>{narrative.note}</small>
      </div>
      {findings.length === 0 ? (
        <div className="no-findings"><Target size={28} /><h3>No forced diagnosis</h3><p>No deviation passed both the confidence and materiality gates. That is more useful than inventing three faults.</p></div>
      ) : (
        <div className="issue-list">
          {findings.map((finding, index) => (
            <article key={finding.id} className={selectedId === finding.id ? 'issue-card is-selected' : 'issue-card'}>
              <button type="button" className="issue-card__main" onClick={() => onSelect(finding)}>
                <div className="issue-card__number">{String(index + 1).padStart(2, '0')}</div>
                <div className="issue-card__content">
                  <div className="issue-card__meta"><span className={`priority priority--${finding.priority}`}>{finding.priority}</span><ConfidenceBadge value={finding.confidence} compact /></div>
                  <h3>{finding.title}</h3>
                  <p>{finding.summary}</p>
                  <span className="issue-location"><MapPin size={13} /> {finding.where}</span>
                </div>
                <ArrowRight size={18} className="issue-card__arrow" />
              </button>
              {selectedId === finding.id ? (
                <div className="issue-detail">
                  <dl><div><dt>What we found</dt><dd>{finding.summary}</dd></div><div><dt>Likely cause</dt><dd>{finding.likelyCause ?? 'The stored analysis did not preserve a causal interpretation.'}</dd></div><div><dt>Why it matters</dt><dd>{finding.why}</dd></div><div><dt>What to change</dt><dd>{finding.workOn}</dd></div></dl>
                  {narrative.issueNotes[finding.id] ? <p className="coach-note">{narrative.issueNotes[finding.id]}</p> : null}
                  <div className="drill"><span><Dumbbell size={16} /> Practice drill</span><p>{finding.drill}</p></div>
                  <div className="evidence-line"><strong>Evidence</strong>{finding.evidence.map((item) => <span key={item.measurementKey}>{item.measured} · {item.reference}</span>)}</div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </aside>
  )
}
