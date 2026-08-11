import { LANDMARK } from '../domain/landmarks'
import type { CameraView, PoseFrame, QualityFactor, QualityReport, VideoMetadata } from '../domain/types'
import { clamp, distance, mean, midpoint } from './geometry'

export interface PixelQuality {
  brightness: number
  contrast: number
  sharpness: number
}

export function evaluateVideoQuality(
  video: VideoMetadata,
  pixels: PixelQuality,
  poseFrames: PoseFrame[],
): QualityReport {
  const { view, confidence: cameraConfidence } = inferCameraView(poseFrames)
  const visibility = poseFrames.length > 0 ? mean(poseFrames.map((frame) => frame.meanVisibility)) : 0
  const expectedSamples = Math.max(24, Math.min(480, Math.round(video.durationMs / 1000) * 12))
  const coverage = clamp(poseFrames.length / expectedSamples)
  const occlusion = jointVisibilityCoverage(poseFrames)
  const framing = framingQuality(poseFrames)
  const stability = framingStability(poseFrames)
  const factors: QualityFactor[] = [
    {
      key: 'resolution',
      label: 'Resolution',
      score: clamp(Math.min(video.width, video.height) / 720),
      message: `${video.width} × ${video.height} ${video.orientation}`,
    },
    {
      key: 'duration',
      label: 'Clip length',
      score: video.durationMs >= 1500 && video.durationMs <= 30_000 ? 1 : video.durationMs <= 60_000 ? 0.55 : 0.2,
      message: `${(video.durationMs / 1000).toFixed(1)}s${video.fps ? ` · ${video.fps.toFixed(0)} fps` : ' · frame rate unavailable'}`,
    },
    {
      key: 'brightness',
      label: 'Exposure',
      score: exposureScore(pixels.brightness, pixels.contrast),
      message: pixels.brightness < 0.2 ? 'Too dark' : pixels.brightness > 0.9 ? 'Highlights clipped' : 'Usable exposure',
    },
    {
      key: 'sharpness',
      label: 'Sharpness',
      score: clamp(pixels.sharpness / 0.08),
      message: pixels.sharpness >= 0.06 ? 'Edges remain distinct' : 'Motion blur or soft focus detected',
    },
    {
      key: 'visibility',
      label: 'Golfer visibility',
      score: clamp(visibility * 0.75 + coverage * 0.25),
      message: poseFrames.length === 0 ? 'No complete golfer pose detected' : `${Math.round(visibility * 100)}% average landmark confidence`,
    },
    {
      key: 'camera',
      label: 'Camera view',
      score: view === 'unknown' ? 0.35 : cameraConfidence,
      message: view === 'unknown' ? 'Could not distinguish face-on from down-the-line' : `${view} · ${Math.round(cameraConfidence * 100)}% confidence`,
    },
    { key: 'occlusion', label: 'Joint occlusion', score: occlusion, message: occlusion >= 0.78 ? 'Core joints stay visible' : `${Math.round((1 - occlusion) * 100)}% of core-joint samples are obscured` },
    { key: 'framing', label: 'Golfer framing', score: framing, message: framing >= 0.72 ? 'Head, hands, and feet fit the frame' : 'Golfer is too small, cropped, or close to an edge' },
    { key: 'stability', label: 'Camera stability', score: stability, message: stability >= 0.7 ? 'Framing scale stays stable' : 'Zoom or camera movement may affect position measurements' },
    { key: 'frame-rate', label: 'Frame timing', score: video.fps === null ? 0.62 : video.fps >= 30 ? 1 : video.fps >= 24 ? 0.72 : 0.4, message: video.fps === null ? 'Container FPS unavailable; using media timestamps' : `${video.fps.toFixed(0)} fps source` },
    { key: 'swing-coverage', label: 'Complete swing', score: coverage, message: coverage >= 0.8 ? 'Pose detected across the clip' : 'Pose drops out during part of the swing' },
  ]
  const score = mean(factors.map((factor) => factor.score))
  const guidance: string[] = []
  if (factors[0].score < 0.65) guidance.push('Record at 720p or higher so joints remain visible throughout the swing.')
  if (factors[2].score < 0.55) guidance.push('Move into even light with the golfer brighter than the background.')
  if (factors[3].score < 0.55) guidance.push('Use more light or a faster shutter to reduce motion blur around the hands.')
  if (factors[4].score < 0.6) guidance.push('Keep the full body—from head to both feet—inside the frame.')
  if (view === 'unknown') guidance.push('Place the camera either square to the chest (face-on) or on the hand line (down-the-line).')
  if (video.durationMs > 30_000) guidance.push('Trim the clip to one swing with a short pause before address and after finish.')
  if (occlusion < 0.72) guidance.push('Move the camera so both elbows, wrists, knees, and feet remain visible; avoid filming through a golf bag or another person.')
  if (framing < 0.68) guidance.push('Place the phone about 3–5 metres away and frame from just above the head to below both feet, leaving room for the full club arc.')
  if (stability < 0.65) guidance.push('Use a tripod or prop the phone on a fixed surface; avoid handheld panning or digital zoom during the swing.')
  if (coverage < 0.72) guidance.push('Include one short pause at address and hold the finish so the complete motion can be segmented.')
  if (video.fps !== null && video.fps < 30) guidance.push('Record at 60 fps when available; 30 fps is usable, but higher frame rates improve transition and impact timing.')

  return { suitable: score >= 0.58 && factors[4].score >= 0.48, score, cameraView: view, cameraConfidence, factors, guidance }
}

function jointVisibilityCoverage(frames: PoseFrame[]): number {
  if (frames.length === 0) return 0
  const joints = [LANDMARK.nose, LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftElbow, LANDMARK.rightElbow, LANDMARK.leftWrist, LANDMARK.rightWrist, LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftKnee, LANDMARK.rightKnee, LANDMARK.leftAnkle, LANDMARK.rightAnkle]
  let visible = 0
  let total = 0
  for (const frame of frames) for (const joint of joints) { visible += frame.landmarks[joint].visibility >= 0.55 ? 1 : 0; total += 1 }
  return visible / Math.max(total, 1)
}

function framingQuality(frames: PoseFrame[]): number {
  if (frames.length === 0) return 0
  const scores: number[] = []
  const joints = [LANDMARK.nose, LANDMARK.leftWrist, LANDMARK.rightWrist, LANDMARK.leftAnkle, LANDMARK.rightAnkle]
  for (const frame of frames) {
    const points = joints.map((index) => frame.landmarks[index]).filter((point) => point.visibility >= 0.5)
    if (points.length < 4) { scores.push(0.25); continue }
    const minX = Math.min(...points.map((point) => point.x)); const maxX = Math.max(...points.map((point) => point.x))
    const minY = Math.min(...points.map((point) => point.y)); const maxY = Math.max(...points.map((point) => point.y))
    const margins = Math.min(minX, 1 - maxX, minY, 1 - maxY)
    const bodyHeight = maxY - minY
    const marginScore = clamp(margins / 0.035)
    const sizeScore = bodyHeight < 0.42 ? clamp(bodyHeight / 0.42) : bodyHeight > 0.94 ? clamp((1 - bodyHeight) / 0.06) : 1
    scores.push(marginScore * 0.55 + sizeScore * 0.45)
  }
  return mean(scores)
}

function framingStability(frames: PoseFrame[]): number {
  if (frames.length < 6) return 0.35
  const scales = frames.map((frame) => distance(midpoint(frame.landmarks[LANDMARK.leftShoulder], frame.landmarks[LANDMARK.rightShoulder]), midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip])))
  const average = mean(scales)
  const variation = mean(scales.map((scale) => Math.abs(scale - average))) / Math.max(average, 1e-6)
  return clamp(1 - variation / 0.22)
}

export function inferCameraView(frames: PoseFrame[]): { view: CameraView; confidence: number } {
  if (frames.length < 5) return { view: 'unknown', confidence: 0.2 }
  const ratios: number[] = []
  for (const frame of frames) {
    const leftShoulder = frame.landmarks[LANDMARK.leftShoulder]
    const rightShoulder = frame.landmarks[LANDMARK.rightShoulder]
    const leftHip = frame.landmarks[LANDMARK.leftHip]
    const rightHip = frame.landmarks[LANDMARK.rightHip]
    if (Math.min(leftShoulder.visibility, rightShoulder.visibility, leftHip.visibility, rightHip.visibility) < 0.55) continue
    const torso = distance(midpoint(leftShoulder, rightShoulder), midpoint(leftHip, rightHip))
    ratios.push(distance(leftShoulder, rightShoulder) / Math.max(torso, 1e-6))
  }
  if (ratios.length < 5) return { view: 'unknown', confidence: 0.25 }
  const ratio = mean(ratios)
  if (ratio >= 0.72) return { view: 'face-on', confidence: clamp(0.55 + (ratio - 0.72) * 0.9) }
  if (ratio <= 0.56) return { view: 'down-the-line', confidence: clamp(0.55 + (0.56 - ratio) * 1.4) }
  return { view: 'unknown', confidence: 0.35 }
}

function exposureScore(brightness: number, contrast: number): number {
  const brightnessScore = 1 - Math.min(Math.abs(brightness - 0.55) / 0.55, 1)
  const contrastScore = clamp(contrast / 0.18)
  return brightnessScore * 0.65 + contrastScore * 0.35
}
