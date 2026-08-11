import type { PoseFrame } from '../domain/types'
import { LANDMARK } from '../domain/landmarks'
import { distance, midpoint } from './geometry'

export interface DtwResult {
  normalizedDistance: number
  path: Array<[number, number]>
}
export function dynamicTimeWarping(a: number[][], b: number[][]): DtwResult | null {
  if (a.length === 0 || b.length === 0) return null
  const rows = a.length + 1
  const columns = b.length + 1
  const cost = Array.from({ length: rows }, () => new Float64Array(columns).fill(Number.POSITIVE_INFINITY))
  cost[0][0] = 0

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const local = vectorDistance(a[i - 1], b[j - 1])
      cost[i][j] = local + Math.min(cost[i - 1][j], cost[i][j - 1], cost[i - 1][j - 1])
    }
  }

  const path: Array<[number, number]> = []
  let i = a.length
  let j = b.length
  while (i > 0 && j > 0) {
    path.push([i - 1, j - 1])
    const diagonal = cost[i - 1][j - 1]
    const up = cost[i - 1][j]
    const left = cost[i][j - 1]
    if (diagonal <= up && diagonal <= left) {
      i -= 1
      j -= 1
    } else if (up < left) {
      i -= 1
    } else {
      j -= 1
    }
  }
  path.reverse()
  return { normalizedDistance: cost[a.length][b.length] / Math.max(path.length, 1), path }
}

export function poseSequence(frames: PoseFrame[]): number[][] {
  return frames.map((frame) => {
    const hip = midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip])
    const shoulder = midpoint(frame.landmarks[LANDMARK.leftShoulder], frame.landmarks[LANDMARK.rightShoulder])
    const scale = Math.max(distance(hip, shoulder), 1e-6)
    return [
      LANDMARK.leftShoulder,
      LANDMARK.rightShoulder,
      LANDMARK.leftElbow,
      LANDMARK.rightElbow,
      LANDMARK.leftWrist,
      LANDMARK.rightWrist,
      LANDMARK.leftHip,
      LANDMARK.rightHip,
      LANDMARK.leftKnee,
      LANDMARK.rightKnee,
      LANDMARK.leftAnkle,
      LANDMARK.rightAnkle,
    ].flatMap((index) => {
      const point = frame.landmarks[index]
      return [(point.x - hip.x) / scale, (point.y - hip.y) / scale]
    })
  })
}

function vectorDistance(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let sum = 0
  for (let index = 0; index < length; index += 1) sum += (a[index] - b[index]) ** 2
  return Math.sqrt(sum / Math.max(length, 1))
}
