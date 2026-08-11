import { LANDMARK } from '../domain/landmarks'
import type { CameraView, ClubTrackFrame, ClubTrackingResult, Measurement, PhaseName, PhaseSegment, PoseFrame } from '../domain/types'
import { clamp, mean, midpoint } from '../core/geometry'
import { seekVideo } from './video-reader'

const MAX_TRACK_FRAMES = 72
const MIN_FRAME_SCORE = 0.34

export async function trackClub(video: HTMLVideoElement, poseFrames: PoseFrame[]): Promise<ClubTrackingResult> {
  if (poseFrames.length < 18 || video.videoWidth < 320 || video.videoHeight < 320) return unavailable('The clip does not contain enough resolved pose frames for shaft-line tracking.')
  const scale = Math.min(1, 360 / Math.max(video.videoWidth, video.videoHeight))
  const width = Math.max(1, Math.round(video.videoWidth * scale))
  const height = Math.max(1, Math.round(video.videoHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return unavailable('The browser could not create a frame-analysis canvas.')
  const stride = Math.max(1, Math.ceil(poseFrames.length / MAX_TRACK_FRAMES))
  const sampled = poseFrames.filter((_, index) => index % stride === 0)
  const candidates: ClubTrackFrame[] = []

  for (const frame of sampled) {
    const left = frame.landmarks[LANDMARK.leftWrist]
    const right = frame.landmarks[LANDMARK.rightWrist]
    const wristConfidence = Math.min(left.visibility, right.visibility)
    if (wristConfidence < 0.55) continue
    await seekVideo(video, frame.timeMs)
    context.drawImage(video, 0, 0, width, height)
    const image = context.getImageData(0, 0, width, height)
    const grip = midpoint(left, right)
    const candidate = detectShaft(image, grip.x * width, grip.y * height, wristConfidence)
    if (candidate && candidate.confidence >= MIN_FRAME_SCORE) {
      candidates.push({
        timeMs: frame.timeMs,
        grip: { x: grip.x, y: grip.y },
        clubhead: { x: candidate.endX / width, y: candidate.endY / height },
        shaftAngleDeg: candidate.angleDeg,
        confidence: candidate.confidence,
      })
    }
  }

  const coverage = candidates.length / Math.max(sampled.length, 1)
  const confidence = summarizeClubConfidence(candidates, coverage)
  const status = confidence >= 0.72 && coverage >= 0.38 ? 'available' : confidence >= 0.42 ? 'low-confidence' : 'unavailable'
  return {
    status,
    confidence,
    method: 'contrast-line-tracker-v1',
    frames: status === 'unavailable' ? [] : candidates,
    coverage,
    note: status === 'available'
      ? 'A temporally covered shaft-line candidate was found. The endpoint is an approximate clubhead proxy, not a club-face measurement.'
      : "Club tracking wasn't reliable enough in this video to analyze club path. Use brighter light, less motion blur, and keep the entire club inside the frame.",
  }
}

export function clubMeasurements(result: ClubTrackingResult, phases: PhaseSegment[], cameraView: CameraView): Measurement[] {
  if (result.status !== 'available') return [withheld('shaft_position', 'Club / shaft position', 'Whole swing', result.note, result.confidence), withheld('swing_plane', 'Approximate swing plane', 'Whole swing', result.note, result.confidence)]
  const measurements: Measurement[] = []
  for (const phaseName of ['Address', 'Top', 'Impact'] as const) {
    const phase = phases.find((item) => item.name === phaseName)
    const frame = phase ? nearestClubFrame(result.frames, phase.anchorMs) : undefined
    if (!frame || frame.confidence < 0.58) {
      measurements.push(withheld(`shaft_angle_${phaseName.toLowerCase()}`, 'Shaft angle', phaseName, `No stable shaft line was found at ${phaseName.toLowerCase()}.`, frame?.confidence ?? 0))
      continue
    }
    measurements.push({
      key: `shaft_angle_${phaseName.toLowerCase()}`,
      label: 'Shaft angle to horizontal',
      phase: phaseName,
      value: frame.shaftAngleDeg,
      unit: 'deg',
      confidence: Math.min(frame.confidence, result.confidence, 0.78),
      reliability: frame.confidence >= 0.66 ? 'available' : 'low-confidence',
      frameMs: frame.timeMs,
      observedFrom: 'Local contrast-line shaft tracker anchored at the detected grip',
      limitation: 'The tracker estimates a visible shaft axis and endpoint; it does not measure club face, loft, or 3D delivery.',
      sourceKind: 'club-tracker',
      supportedViews: ['face-on', 'down-the-line'],
      validityRequirements: ['Both wrists visible', 'Low shaft motion blur', 'Entire shaft inside frame', 'Stable line detection across phases'],
    })
  }
  measurements.push(swingPlaneMeasurement(result, phases, cameraView))
  return measurements
}

export function summarizeClubConfidence(frames: ClubTrackFrame[], coverage: number): number {
  if (frames.length < 5) return 0
  const frameConfidence = mean(frames.map((frame) => frame.confidence))
  const lengths = frames.map((frame) => Math.hypot(frame.clubhead.x - frame.grip.x, frame.clubhead.y - frame.grip.y))
  const averageLength = mean(lengths)
  const lengthVariation = mean(lengths.map((length) => Math.abs(length - averageLength))) / Math.max(averageLength, 1e-6)
  const consistency = clamp(1 - lengthVariation / 0.65)
  return clamp((frameConfidence * 0.58 + coverage * 0.27 + consistency * 0.15) * 0.82)
}

function detectShaft(image: ImageData, gripX: number, gripY: number, wristConfidence: number): { endX: number; endY: number; angleDeg: number; confidence: number } | null {
  const { width, height, data } = image
  const maxLength = Math.min(Math.max(width, height) * 0.48, Math.hypot(width, height) * 0.42)
  const start = Math.max(7, Math.min(width, height) * 0.025)
  let best: { score: number; angle: number; length: number } | null = null
  for (let angle = 0; angle < 360; angle += 4) {
    const radians = angle * Math.PI / 180
    const dx = Math.cos(radians)
    const dy = Math.sin(radians)
    const px = -dy * 2
    const py = dx * 2
    let total = 0
    let hits = 0
    let samples = 0
    let lastStrong = start
    for (let length = start; length <= maxLength; length += 3) {
      const x = gripX + dx * length
      const y = gripY + dy * length
      if (x < 3 || y < 3 || x >= width - 3 || y >= height - 3) break
      const center = luminance(data, width, x, y)
      const sideA = luminance(data, width, x + px, y + py)
      const sideB = luminance(data, width, x - px, y - py)
      const contrast = Math.abs(center - (sideA + sideB) / 2) / 255
      const edge = Math.abs(sideA - sideB) / 255
      const evidence = Math.max(contrast, edge * 0.72)
      total += evidence
      if (evidence >= 0.075) { hits += 1; lastStrong = length }
      samples += 1
    }
    if (samples < 8) continue
    const continuity = hits / samples
    const reach = lastStrong / maxLength
    const score = total / samples * 2.6 + continuity * 0.48 + reach * 0.12
    if (!best || score > best.score) best = { score, angle, length: lastStrong }
  }
  if (!best || best.length < Math.min(width, height) * 0.1) return null
  const confidence = clamp((best.score - 0.18) / 0.46) * wristConfidence
  const radians = best.angle * Math.PI / 180
  const angleDeg = ((best.angle % 180) + 180) % 180
  return { endX: gripX + Math.cos(radians) * best.length, endY: gripY + Math.sin(radians) * best.length, angleDeg, confidence }
}

function luminance(data: Uint8ClampedArray, width: number, x: number, y: number): number {
  const index = (Math.round(y) * width + Math.round(x)) * 4
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722
}

function swingPlaneMeasurement(result: ClubTrackingResult, phases: PhaseSegment[], view: CameraView): Measurement {
  if (view !== 'down-the-line') return withheld('swing_plane', 'Approximate swing plane', 'Downswing', 'A projected swing-plane indicator is only supported for a down-the-line recording.', result.confidence)
  const top = phases.find((item) => item.name === 'Top')?.anchorMs ?? 0
  const impact = phases.find((item) => item.name === 'Impact')?.anchorMs ?? 0
  const points = result.frames.filter((frame) => frame.timeMs >= top && frame.timeMs <= impact && frame.confidence >= 0.58)
  if (points.length < 5) return withheld('swing_plane', 'Approximate swing plane', 'Downswing', 'Too few stable clubhead proxies were tracked from top to impact.', result.confidence)
  const xs = points.map((point) => point.clubhead.x)
  const ys = points.map((point) => point.clubhead.y)
  const meanX = mean(xs)
  const meanY = mean(ys)
  let xx = 0
  let xy = 0
  for (let index = 0; index < points.length; index += 1) { xx += (xs[index] - meanX) ** 2; xy += (xs[index] - meanX) * (ys[index] - meanY) }
  const angle = Math.abs(Math.atan2(xy, Math.max(xx, 1e-8)) * 180 / Math.PI)
  return {
    key: 'swing_plane', label: 'Projected clubhead-path axis', phase: 'Downswing', value: angle, unit: 'deg',
    confidence: Math.min(result.confidence * 0.82, 0.7), reliability: 'available', frameMs: points[Math.floor(points.length / 2)].timeMs,
    observedFrom: 'Principal 2D axis through confidence-gated clubhead proxy points',
    limitation: 'This is a screen-space path axis, not a 3D shaft plane or launch-monitor delivery measurement.', sourceKind: 'club-tracker', supportedViews: ['down-the-line'],
    validityRequirements: ['Confident down-the-line view', 'Stable shaft tracking from top to impact', 'Low motion blur', 'Entire club inside frame'],
  }
}

function withheld(key: string, label: string, phase: PhaseName | 'Whole swing', limitation: string, confidence: number): Measurement {
  return { key, label, phase, value: null, unit: 'status', confidence, reliability: 'unavailable', frameMs: null, observedFrom: 'Club tracker withheld this measurement', limitation, sourceKind: 'club-tracker', supportedViews: key === 'swing_plane' ? ['down-the-line'] : ['face-on', 'down-the-line'], validityRequirements: ['Visible shaft', 'Low motion blur', 'Stable temporal tracking'] }
}

function nearestClubFrame(frames: ClubTrackFrame[], timeMs: number): ClubTrackFrame | undefined {
  let best: ClubTrackFrame | undefined
  let delta = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    const next = Math.abs(frame.timeMs - timeMs)
    if (next < delta) { best = frame; delta = next }
  }
  return best
}

function unavailable(note: string): ClubTrackingResult {
  return { status: 'unavailable', confidence: 0, method: 'contrast-line-tracker-v1', frames: [], coverage: 0, note: `Club tracking wasn't reliable enough in this video to analyze club path. ${note}` }
}
