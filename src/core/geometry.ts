import type { Point3D, PoseFrame } from '../domain/types'

const EPSILON = 1e-8

export function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value))
}
export function midpoint(a: Point3D, b: Point3D): Point3D {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: Math.min(a.visibility, b.visibility),
  }
}

export function distance(a: Point3D, b: Point3D, dimensions: 2 | 3 = 2): number {
  const dz = dimensions === 3 ? (a.z - b.z) ** 2 : 0
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + dz)
}

export function angle(a: Point3D, vertex: Point3D, c: Point3D, dimensions: 2 | 3 = 2): number {
  const av = [a.x - vertex.x, a.y - vertex.y, dimensions === 3 ? a.z - vertex.z : 0]
  const cv = [c.x - vertex.x, c.y - vertex.y, dimensions === 3 ? c.z - vertex.z : 0]
  const dot = av[0] * cv[0] + av[1] * cv[1] + av[2] * cv[2]
  const magA = Math.sqrt(av[0] ** 2 + av[1] ** 2 + av[2] ** 2)
  const magC = Math.sqrt(cv[0] ** 2 + cv[1] ** 2 + cv[2] ** 2)
  if (magA < EPSILON || magC < EPSILON) return Number.NaN
  return (Math.acos(clamp(dot / (magA * magC), -1, 1)) * 180) / Math.PI
}

export function lineAngle(a: Point3D, b: Point3D): number {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI
}

export function horizontalPlaneAngle(a: Point3D, b: Point3D): number {
  return (Math.atan2(b.z - a.z, b.x - a.x) * 180) / Math.PI
}

export function torsoLength(frame: PoseFrame, leftShoulder: number, rightShoulder: number, leftHip: number, rightHip: number): number {
  const shoulder = midpoint(frame.landmarks[leftShoulder], frame.landmarks[rightShoulder])
  const hip = midpoint(frame.landmarks[leftHip], frame.landmarks[rightHip])
  return Math.max(distance(shoulder, hip), EPSILON)
}

export function mean(values: number[]): number {
  if (values.length === 0) return Number.NaN
  return values.reduce((total, value) => total + value, 0) / values.length
}

export function median(values: number[]): number {
  if (values.length === 0) return Number.NaN
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return Number.NaN
  const sorted = values.toSorted((a, b) => a - b)
  const index = clamp(p) * (sorted.length - 1)
  const lower = Math.floor(index)
  const upper = Math.ceil(index)
  if (lower === upper) return sorted[lower]
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)
}

export function nearestFrame(frames: PoseFrame[], timeMs: number): PoseFrame | undefined {
  let best: PoseFrame | undefined
  let bestDistance = Number.POSITIVE_INFINITY
  for (const frame of frames) {
    const delta = Math.abs(frame.timeMs - timeMs)
    if (delta < bestDistance) {
      best = frame
      bestDistance = delta
    }
  }
  return best
}

export function confidenceLevel(score: number): 'high' | 'medium' | 'low' {
  if (score >= 0.78) return 'high'
  if (score >= 0.52) return 'medium'
  return 'low'
}

export function formatTimestamp(timeMs: number): string {
  const totalSeconds = Math.max(0, timeMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(1).padStart(4, '0')
  return `${minutes}:${seconds}`
}
