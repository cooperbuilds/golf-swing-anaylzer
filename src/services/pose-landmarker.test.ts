// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  let lastTimestamp = -1
  return {
    setOptions: vi.fn(async () => { lastTimestamp = -1 }),
    detectForVideo: vi.fn((_video: HTMLVideoElement, timestamp: number) => {
      if (timestamp <= lastTimestamp) throw new Error('Input timestamp must be monotonically increasing')
      lastTimestamp = timestamp
      return { landmarks: [], worldLandmarks: [] }
    }),
    createFromOptions: vi.fn(),
    forVisionTasks: vi.fn(async () => ({})),
  }
})

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks: mocks.forVisionTasks },
  PoseLandmarker: { createFromOptions: mocks.createFromOptions },
}))
vi.mock('./video-reader', () => ({ seekVideo: vi.fn(async () => undefined) }))

import { detectPoseFrames } from './pose-landmarker'

describe('pose landmarker video boundaries', () => {
  beforeAll(() => {
    mocks.createFromOptions.mockResolvedValue({ setOptions: mocks.setOptions, detectForVideo: mocks.detectForVideo })
  })

  it('resets MediaPipe VIDEO mode before timestamps restart for the next file', async () => {
    const video = {} as HTMLVideoElement
    await expect(detectPoseFrames(video, 1000, () => undefined)).resolves.toEqual([])
    await expect(detectPoseFrames(video, 1000, () => undefined)).resolves.toEqual([])
    expect(mocks.setOptions).toHaveBeenCalledTimes(2)
    expect(mocks.detectForVideo).toHaveBeenCalledTimes(72)
  })
})
