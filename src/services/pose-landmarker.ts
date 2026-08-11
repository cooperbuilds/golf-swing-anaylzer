import type { Point3D, PoseFrame } from '../domain/types'
import { mean } from '../core/geometry'
import { seekVideo } from './video-reader'

const DEFAULT_MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task'
const DEFAULT_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm'

type PoseModule = typeof import('@mediapipe/tasks-vision')
type PoseLandmarker = Awaited<ReturnType<PoseModule['PoseLandmarker']['createFromOptions']>>

let landmarkerPromise: Promise<PoseLandmarker> | null = null

export async function detectPoseFrames(
  video: HTMLVideoElement,
  durationMs: number,
  onProgress: (completed: number, total: number) => void,
): Promise<PoseFrame[]> {
  const landmarker = await getLandmarker()
  const targetRate = durationMs <= 12_000 ? 15 : 10
  const total = Math.max(36, Math.min(480, Math.round(durationMs / 1000 * targetRate)))
  const frames: PoseFrame[] = []
  for (let index = 0; index < total; index += 1) {
    const timeMs = Math.min(durationMs - 2, durationMs * index / Math.max(total - 1, 1))
    await seekVideo(video, timeMs)
    const result = landmarker.detectForVideo(video, timeMs)
    const landmarks = result.landmarks[0]
    if (landmarks?.length === 33) {
      const points = landmarks.map(toPoint)
      const world = result.worldLandmarks[0]?.length === 33 ? result.worldLandmarks[0].map(toPoint) : undefined
      frames.push({ frameIndex: index, timeMs, landmarks: points, worldLandmarks: world, meanVisibility: mean(points.map((point) => point.visibility)) })
    }
    onProgress(index + 1, total)
    if (index % 8 === 0) await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  }
  return frames
}
async function getLandmarker(): Promise<PoseLandmarker> {
  if (!landmarkerPromise) landmarkerPromise = createLandmarker()
  return landmarkerPromise
}

async function createLandmarker(): Promise<PoseLandmarker> {
  const module = await import('@mediapipe/tasks-vision')
  const wasmRoot = import.meta.env.VITE_MEDIAPIPE_WASM_URL ?? DEFAULT_WASM
  const modelAssetPath = import.meta.env.VITE_POSE_MODEL_URL ?? DEFAULT_MODEL
  const vision = await module.FilesetResolver.forVisionTasks(wasmRoot)
  const shared = {
    runningMode: 'VIDEO' as const,
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false,
  }
  try {
    return await module.PoseLandmarker.createFromOptions(vision, { ...shared, baseOptions: { modelAssetPath, delegate: 'GPU' } })
  } catch {
    return module.PoseLandmarker.createFromOptions(vision, { ...shared, baseOptions: { modelAssetPath, delegate: 'CPU' } })
  }
}

function toPoint(point: { x: number; y: number; z: number; visibility?: number }): Point3D {
  return { x: point.x, y: point.y, z: point.z, visibility: point.visibility ?? 0.5 }
}
