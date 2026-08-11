import type { VideoMetadata } from '../domain/types'
import type { PixelQuality } from '../core/video-quality'
import { clamp, mean } from '../core/geometry'

export interface LoadedVideo {
  element: HTMLVideoElement
  objectUrl: string
  metadata: VideoMetadata
}

export async function loadVideo(file: File): Promise<LoadedVideo> {
  const objectUrl = URL.createObjectURL(file)
  const element = document.createElement('video')
  element.preload = 'auto'
  element.muted = true
  element.playsInline = true
  element.src = objectUrl
  try {
    await once(element, 'loadedmetadata', 15_000)
    const width = element.videoWidth
    const height = element.videoHeight
    return {
      element,
      objectUrl,
      metadata: {
        name: file.name,
        sizeBytes: file.size,
        durationMs: element.duration * 1000,
        width,
        height,
        orientation: width === height ? 'square' : width > height ? 'horizontal' : 'vertical',
        fps: null,
        fpsSource: 'unavailable',
      },
    }
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

export async function inspectVideoMetadata(file: File): Promise<VideoMetadata> {
  const loaded = await loadVideo(file)
  URL.revokeObjectURL(loaded.objectUrl)
  return loaded.metadata
}

export async function samplePixelQuality(video: HTMLVideoElement, durationMs: number): Promise<PixelQuality> {
  const canvas = document.createElement('canvas')
  canvas.width = 160
  canvas.height = Math.max(90, Math.round(160 * video.videoHeight / Math.max(video.videoWidth, 1)))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return { brightness: 0.5, contrast: 0, sharpness: 0 }
  const brightness: number[] = []
  const contrast: number[] = []
  const sharpness: number[] = []
  const sampleCount = 12
  for (let index = 0; index < sampleCount; index += 1) {
    await seekVideo(video, durationMs * (index + 0.5) / sampleCount)
    context.drawImage(video, 0, 0, canvas.width, canvas.height)
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    const luminance = new Float32Array(canvas.width * canvas.height)
    let sum = 0
    for (let p = 0, offset = 0; p < luminance.length; p += 1, offset += 4) {
      const value = (pixels[offset] * 0.2126 + pixels[offset + 1] * 0.7152 + pixels[offset + 2] * 0.0722) / 255
      luminance[p] = value
      sum += value
    }
    const average = sum / luminance.length
    let variance = 0
    let edgeEnergy = 0
    for (let y = 1; y < canvas.height - 1; y += 1) {
      for (let x = 1; x < canvas.width - 1; x += 1) {
        const p = y * canvas.width + x
        variance += (luminance[p] - average) ** 2
        const laplacian = 4 * luminance[p] - luminance[p - 1] - luminance[p + 1] - luminance[p - canvas.width] - luminance[p + canvas.width]
        edgeEnergy += laplacian ** 2
      }
    }
    brightness.push(average)
    contrast.push(Math.sqrt(variance / luminance.length))
    sharpness.push(edgeEnergy / luminance.length)
  }
  return { brightness: mean(brightness), contrast: mean(contrast), sharpness: mean(sharpness) }
}

export async function seekVideo(video: HTMLVideoElement, timeMs: number): Promise<void> {
  const target = clamp(timeMs / 1000, 0, Math.max(video.duration - 0.002, 0))
  if (Math.abs(video.currentTime - target) < 0.001 && video.readyState >= 2) return
  const pending = once(video, 'seeked', 8_000)
  video.currentTime = target
  await pending
}

function once(element: HTMLMediaElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Video ${event} timed out. The file may use an unsupported codec.`))
    }, timeoutMs)
    const onEvent = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(element.error?.message ?? 'The browser could not decode this video.'))
    }
    const cleanup = () => {
      window.clearTimeout(timeout)
      element.removeEventListener(event, onEvent)
      element.removeEventListener('error', onError)
    }
    element.addEventListener(event, onEvent, { once: true })
    element.addEventListener('error', onError, { once: true })
  })
}
