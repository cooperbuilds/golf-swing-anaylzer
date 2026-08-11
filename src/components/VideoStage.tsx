import { useEffect, useRef, useState } from 'react'
import { Maximize2, Pause, Play, ScanSearch } from 'lucide-react'
import { nearestFrame } from '../core/geometry'
import { POSE_CONNECTIONS } from '../domain/landmarks'
import type { AnalysisResult } from '../domain/types'

interface VideoStageProps {
  analysis: AnalysisResult
  videoUrl: string | null
  seekMs: number
  onTime: (timeMs: number) => void
}

export function VideoStage({ analysis, videoUrl, seekMs, onTime }: VideoStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [playing, setPlaying] = useState(false)
  const [overlay, setOverlay] = useState(true)

  useEffect(() => {
    const video = videoRef.current
    if (!video || Math.abs(video.currentTime * 1000 - seekMs) < 25) return
    video.currentTime = seekMs / 1000
  }, [seekMs])

  useEffect(() => {
    drawOverlay(canvasRef.current, videoRef.current, analysis, seekMs, overlay)
  }, [analysis, seekMs, overlay])

  const togglePlay = async () => {
    const video = videoRef.current
    if (!videoUrl || !video) return
    if (video.paused) await video.play()
    else video.pause()
  }

  return (
    <section className="video-stage panel">
      <div className="video-stage__canvas">
        {videoUrl ? (
          <video ref={videoRef} src={videoUrl} playsInline muted onTimeUpdate={(event) => onTime(event.currentTarget.currentTime * 1000)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        ) : (
          <div className="video-missing"><ScanSearch size={38} /><strong>Analysis restored from history</strong><p>Re-upload the same local file to restore video playback. Measurements remain cached.</p></div>
        )}
        <canvas ref={canvasRef} aria-label="Pose skeleton overlay" />
        <div className="video-stage__labels">
          <span>Original + pose</span><span>{analysis.quality.cameraView}</span>
        </div>
      </div>
      <div className="video-controls">
        <button type="button" className="play-button" onClick={togglePlay} aria-label={playing ? 'Pause video' : 'Play video'}>{playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button>
        <span className="video-time">{(seekMs / 1000).toFixed(2)}s</span>
        <input aria-label="Video position" type="range" min={0} max={analysis.video.durationMs} step={10} value={Math.min(seekMs, analysis.video.durationMs)} onChange={(event) => onTime(Number(event.target.value))} />
        <button type="button" className={overlay ? 'control-toggle is-active' : 'control-toggle'} onClick={() => setOverlay((value) => !value)}>Pose</button>
        <button type="button" className="icon-button" aria-label="Full screen" onClick={() => videoRef.current?.requestFullscreen()}><Maximize2 size={16} /></button>
      </div>
    </section>
  )
}

function drawOverlay(canvas: HTMLCanvasElement | null, video: HTMLVideoElement | null, analysis: AnalysisResult, timeMs: number, visible: boolean) {
  if (!canvas) return
  const width = video?.clientWidth || canvas.parentElement?.clientWidth || 900
  const height = video?.clientHeight || canvas.parentElement?.clientHeight || 540
  const ratio = window.devicePixelRatio || 1
  canvas.width = width * ratio
  canvas.height = height * ratio
  canvas.style.width = `${width}px`
  canvas.style.height = `${height}px`
  const context = canvas.getContext('2d')
  context?.scale(ratio, ratio)
  context?.clearRect(0, 0, width, height)
  if (!visible || !context) return
  const frame = nearestFrame(analysis.poseFrames, timeMs)
  if (!frame) return
  const sourceWidth = video?.videoWidth || analysis.video.width
  const sourceHeight = video?.videoHeight || analysis.video.height
  const fitScale = Math.min(width / Math.max(sourceWidth, 1), height / Math.max(sourceHeight, 1))
  const renderedWidth = sourceWidth * fitScale
  const renderedHeight = sourceHeight * fitScale
  const offsetX = (width - renderedWidth) / 2
  const offsetY = (height - renderedHeight) / 2
  const screenPoint = (point: { x: number; y: number }) => ({ x: offsetX + point.x * renderedWidth, y: offsetY + point.y * renderedHeight })
  context.lineCap = 'round'
  context.lineWidth = 2.3
  context.shadowColor = 'rgba(215, 255, 95, 0.45)'
  context.shadowBlur = 8
  for (const [from, to] of POSE_CONNECTIONS) {
    const a = frame.landmarks[from]
    const b = frame.landmarks[to]
    if (Math.min(a.visibility, b.visibility) < 0.45) continue
    const start = screenPoint(a)
    const end = screenPoint(b)
    context.strokeStyle = Math.min(a.visibility, b.visibility) > 0.75 ? '#d8ff63' : 'rgba(216,255,99,.48)'
    context.beginPath()
    context.moveTo(start.x, start.y)
    context.lineTo(end.x, end.y)
    context.stroke()
  }
  context.shadowBlur = 0
  for (const point of frame.landmarks) {
    if (point.visibility < 0.58) continue
    const screen = screenPoint(point)
    context.fillStyle = '#f5f3ec'
    context.beginPath()
    context.arc(screen.x, screen.y, 2.5, 0, Math.PI * 2)
    context.fill()
  }
  const clubFrame = analysis.clubTracking?.status === 'available' ? nearestClubFrame(analysis.clubTracking.frames, timeMs) : undefined
  if (clubFrame && Math.abs(clubFrame.timeMs - timeMs) < 140) {
    const grip = screenPoint(clubFrame.grip)
    const clubhead = screenPoint(clubFrame.clubhead)
    context.strokeStyle = '#66b7ff'
    context.lineWidth = 2
    context.beginPath()
    context.moveTo(grip.x, grip.y)
    context.lineTo(clubhead.x, clubhead.y)
    context.stroke()
    context.fillStyle = '#66b7ff'
    context.beginPath()
    context.arc(clubhead.x, clubhead.y, 4, 0, Math.PI * 2)
    context.fill()
  }
}

function nearestClubFrame(frames: NonNullable<AnalysisResult['clubTracking']>['frames'], timeMs: number) {
  let best = frames[0]
  let delta = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    const next = Math.abs(frame.timeMs - timeMs)
    if (next < delta) { best = frame; delta = next }
  }
  return best
}
