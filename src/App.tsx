import { useState } from 'react'
import { AnalysisWorkspace } from './components/AnalysisWorkspace'
import { Header } from './components/Header'
import { HistoryView } from './components/HistoryView'
import { ProgressPipeline } from './components/ProgressPipeline'
import { SessionWorkspace } from './components/SessionWorkspace'
import { UploadPanel } from './components/UploadPanel'
import { useAnalysis } from './hooks/useAnalysis'
import './App.css'

function App() {
  const [view, setView] = useState<'analyze' | 'history'>('analyze')
  const { analysis, session, history, selectedVideos, progress, error, isAnalyzing, videoUrls, addFiles, removeSelected, analyzeSelected, showEntry, deleteEntry, startNew } = useAnalysis()

  return (
    <div className="app-frame">
      <Header activeView={view} onViewChange={setView} />
      {error ? <div className="error-banner" role="alert"><strong>Analysis stopped</strong><span>{error}</span></div> : null}
      {isAnalyzing ? <main className="loading-shell"><ProgressPipeline progress={progress} /></main> : view === 'history' ? (
        <HistoryView history={history} onOpen={(item) => { showEntry(item); setView('analyze') }} onDelete={(entry) => void deleteEntry(entry)} />
      ) : session ? (
        <SessionWorkspace session={session} videoUrls={videoUrls} onBack={startNew} />
      ) : analysis ? (
        <AnalysisWorkspace analysis={analysis} videoUrl={null} onBack={startNew} />
      ) : (
        <UploadPanel onFiles={(files) => void addFiles(files)} selected={selectedVideos} onRemove={removeSelected} onAnalyze={() => void analyzeSelected()} recent={history} onOpenRecent={showEntry} />
      )}
      <footer><span>SwingLab</span><p>Evidence-first golf analysis · Educational feedback, not medical advice</p><p>Reference metadata: GolfDB / CC BY-NC research use</p></footer>
    </div>
  )
}

export default App
