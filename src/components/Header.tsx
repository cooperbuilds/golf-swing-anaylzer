import { Activity, CircleHelp, History, LockKeyhole } from 'lucide-react'

interface HeaderProps {
  activeView: 'analyze' | 'history'
  onViewChange: (view: 'analyze' | 'history') => void
}
export function Header({ activeView, onViewChange }: HeaderProps) {
  return (
    <header className="app-header">
      <button className="brand" type="button" onClick={() => onViewChange('analyze')} aria-label="SwingLab home">
        <span className="brand__mark"><Activity size={19} strokeWidth={2.4} /></span>
        <span>Swing<span>Lab</span></span>
      </button>
      <nav className="main-nav" aria-label="Primary navigation">
        <button className={activeView === 'analyze' ? 'is-active' : ''} type="button" onClick={() => onViewChange('analyze')}>Analyze</button>
        <button className={activeView === 'history' ? 'is-active' : ''} type="button" onClick={() => onViewChange('history')}><History size={15} /> History</button>
      </nav>
      <div className="header-meta">
        <span><LockKeyhole size={14} /> On-device pose</span>
        <button className="icon-button" type="button" aria-label="Help"><CircleHelp size={18} /></button>
      </div>
    </header>
  )
}
