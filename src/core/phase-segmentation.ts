import { LANDMARK } from '../domain/landmarks'
import { PHASE_NAMES, type PhaseName, type PhaseSegment, type PoseFrame } from '../domain/types'
import { clamp, distance, mean, midpoint, percentile } from './geometry'

interface Anchor {
  timeMs: number
  confidence: number
  detection: 'kinematic' | 'interpolated'
}

export function segmentSwing(frames: PoseFrame[], durationMs: number): PhaseSegment[] {
  if (frames.length < 12) return proportionalFallback(durationMs)
  const signal = motionSignal(frames)
  const threshold = percentile(signal.map((entry) => entry.speed), 0.68)
  const active = signal.filter((entry) => entry.speed >= threshold * 0.42)
  const provisionalStartIndex = Math.max(0, (active[0]?.index ?? 1) - 2)
  const rawFinishIndex = Math.min(frames.length - 1, (active.at(-1)?.index ?? frames.length - 2) + 2)
  const broadTopIndex = findTopIndex(frames, provisionalStartIndex, rawFinishIndex)
  const provisionalAddressIndex = findAddressIndex(frames, signal, broadTopIndex, provisionalStartIndex)
  const topSearchStart = Math.min(rawFinishIndex - 2, provisionalAddressIndex + Math.max(1, Math.floor((rawFinishIndex - provisionalAddressIndex) * 0.12)))
  const topSearchEnd = Math.max(topSearchStart + 1, provisionalAddressIndex + Math.floor((rawFinishIndex - provisionalAddressIndex) * 0.72))
  const topIndex = findRefinedTop(frames, provisionalAddressIndex, topSearchStart, Math.min(rawFinishIndex - 1, topSearchEnd))
  const startIndex = findAddressIndex(frames, signal, topIndex, provisionalAddressIndex)
  const impactSearchStart = Math.min(rawFinishIndex - 1, topIndex + 1)
  const impactSearchEnd = Math.max(impactSearchStart, indexAtOrBefore(frames, topIndex, Math.min(frames[rawFinishIndex].timeMs, frames[topIndex].timeMs + 1_600)))
  const impactIndex = argMin(frames, impactSearchStart, impactSearchEnd, (frame) => impactScore(frame, frames[startIndex]))
  const finishIndex = findFinishIndex(frames, signal, impactIndex, rawFinishIndex, threshold * 0.42)
  const address = anchor(frames[startIndex], addressConfidence(frames, signal, startIndex, topIndex))
  const top = anchor(frames[topIndex], prominence(signal, topIndex))
  const impact = anchor(frames[impactIndex], prominence(signal, impactIndex))
  const finish = anchor(frames[finishIndex], prominence(signal, finishIndex))
  const anchors = new Map<PhaseName, Anchor>([
    ['Address', address],
    ['Takeaway', interpolate(address, top, 0.28)],
    ['Backswing', interpolate(address, top, 0.68)],
    ['Top', top],
    ['Transition', interpolate(top, impact, 0.2)],
    ['Downswing', interpolate(top, impact, 0.62)],
    ['Impact', impact],
    ['Follow-through', interpolate(impact, finish, 0.48)],
    ['Finish', finish],
  ])

  return PHASE_NAMES.map((name, index) => {
    const current = anchors.get(name)!
    const previous = index === 0 ? 0 : (anchors.get(PHASE_NAMES[index - 1])!.timeMs + current.timeMs) / 2
    const next = index === PHASE_NAMES.length - 1 ? durationMs : (current.timeMs + anchors.get(PHASE_NAMES[index + 1])!.timeMs) / 2
    return { name, startMs: previous, endMs: next, anchorMs: current.timeMs, confidence: current.confidence, detection: current.detection }
  })
}

function findRefinedTop(frames: PoseFrame[], addressIndex: number, start: number, end: number): number {
  for (let index = start; index <= end; index += 1) {
    const scale = Math.max(torsoScale(frames[index]), 1e-6)
    const localStart = indexAtOrAfter(frames, addressIndex, frames[index].timeMs - 400)
    const localEnd = indexAtOrBefore(frames, index, frames[index].timeMs + 400)
    const currentHeight = handHeight(frames[index])
    if (currentHeight > Math.min(...frames.slice(localStart, localEnd + 1).map(handHeight)) + scale * 0.03) continue
    const afterEnd = indexAtOrBefore(frames, index, frames[index].timeMs + 800)
    const ascent = Math.max(...frames.slice(addressIndex, index).map((frame) => handHeight(frame) - currentHeight), 0) / scale
    const descent = Math.max(...frames.slice(index + 1, afterEnd + 1).map((frame) => handHeight(frame) - currentHeight), 0) / scale
    if (ascent >= 0.25 && descent >= 0.35) return index
  }
  return argMin(frames, start, end, handHeight)
}

/**
 * Finds a completed backswing rather than merely the highest hands in an
 * arbitrary percentage of the clip. A candidate must be preceded by a
 * meaningful upward hand excursion and followed by a meaningful downswing.
 * This prevents a long address/waggle section from truncating the Top search.
 */
function findTopIndex(frames: PoseFrame[], fallbackStart: number, fallbackEnd: number): number {
  let bestIndex = -1
  let bestScore = 0
  const latestCandidate = Math.min(frames.length - 3, fallbackEnd - 2)
  for (let index = 1; index <= latestCandidate; index += 1) {
    const current = topPoint(frames[index])
    if (current.visibility < 0.35) continue
    const hip = midpoint(frames[index].landmarks[LANDMARK.leftHip], frames[index].landmarks[LANDMARK.rightHip])
    const hands = handPoint(frames[index])
    // A golf backswing top has the hands above the pelvis. Without this
    // anatomical sanity check, bending to place or retrieve a ball can create
    // the first large elbow excursion and be mistaken for a complete swing.
    if (hands.visibility < 0.35 || hands.y >= hip.y) continue
    const beforeStart = indexAtOrAfter(frames, 0, frames[index].timeMs - 2_000)
    const afterEnd = indexAtOrBefore(frames, index, frames[index].timeMs + 1_600)
    if (beforeStart >= index || afterEnd <= index) continue
    const scale = Math.max(torsoScale(frames[index]), 1e-6)
    const localStart = indexAtOrAfter(frames, beforeStart, frames[index].timeMs - 250)
    const localEnd = indexAtOrBefore(frames, index, frames[index].timeMs + 250)
    const localMinimum = Math.min(...frames.slice(localStart, localEnd + 1).map(topHeight))
    if (current.y > localMinimum + scale * 0.08) continue
    const ascent = Math.max(...frames.slice(beforeStart, index).map((frame) => topHeight(frame) - current.y), 0) / scale
    const descent = Math.max(...frames.slice(index + 1, afterEnd + 1).map((frame) => topHeight(frame) - current.y), 0) / scale
    if (ascent < 0.24 || descent < 0.24) continue
    const score = Math.min(ascent, descent) * current.visibility
    // The first complete, full-size excursion is the backswing Top. Later
    // high hands belong to follow-through and must not replace it.
    if (ascent >= 0.45 && descent >= 0.55) return index
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  if (bestIndex >= 0) return bestIndex
  const start = Math.max(1, Math.min(frames.length - 3, fallbackStart))
  const end = Math.max(start + 1, Math.min(frames.length - 2, fallbackEnd))
  return argMin(frames, start, end, handHeight)
}

function findFinishIndex(
  frames: PoseFrame[],
  signal: Array<{ index: number; speed: number }>,
  impactIndex: number,
  rawFinishIndex: number,
  activeThreshold: number,
): number {
  const latest = indexAtOrBefore(frames, impactIndex, frames[impactIndex].timeMs + 2_500)
  const localActive = signal.filter((entry) => entry.index > impactIndex && entry.index <= latest && entry.speed >= activeThreshold)
  return Math.min(frames.length - 1, Math.max(impactIndex + 1, Math.min(rawFinishIndex, (localActive.at(-1)?.index ?? latest) + 2)))
}

function motionSignal(frames: PoseFrame[]): Array<{ index: number; speed: number }> {
  const result = [{ index: 0, speed: 0 }]
  for (let index = 1; index < frames.length; index += 1) {
    const before = midpoint(frames[index - 1].landmarks[LANDMARK.leftWrist], frames[index - 1].landmarks[LANDMARK.rightWrist])
    const current = midpoint(frames[index].landmarks[LANDMARK.leftWrist], frames[index].landmarks[LANDMARK.rightWrist])
    const wristVisibility = Math.min(before.visibility, current.visibility)
    const elapsed = Math.max((frames[index].timeMs - frames[index - 1].timeMs) / 1000, 1 / 240)
    const scale = Math.max((torsoScale(frames[index - 1]) + torsoScale(frames[index])) / 2, 1e-6)
    result.push({ index, speed: wristVisibility >= 0.58 ? distance(before, current) / scale / elapsed : 0 })
  }
  return result
}

function findAddressIndex(frames: PoseFrame[], signal: Array<{ index: number; speed: number }>, topIndex: number, fallback: number): number {
  if (topIndex < 3) return fallback
  const speedScale = Math.max(percentile(signal.map((entry) => entry.speed), 0.9), 0.03)
  const addressHeightFloor = percentile(frames.slice(0, topIndex).map(handHeight), 0.62)
  for (let index = topIndex - 2; index >= 0; index -= 1) {
    if (handHeight(frames[index]) < addressHeightFloor) continue
    const previousSpeed = mean(signal
      .filter((entry) => entry.index <= index && frames[entry.index].timeMs >= frames[index].timeMs - 300)
      .map((entry) => entry.speed))
    if (previousSpeed > speedScale * 0.32) continue
    const endIndex = indexAtOrBefore(frames, index, Math.min(frames[topIndex].timeMs, frames[index].timeMs + 750))
    const baseline = handPoint(frames[index])
    const scale = Math.max(torsoScale(frames[index]), 1e-6)
    const departure = Math.max(...frames.slice(index + 1, endIndex + 1).map((frame) => distance(baseline, handPoint(frame)) / scale), 0)
    if (departure >= 0.1) return index
  }
  return fallback
}

function addressConfidence(frames: PoseFrame[], signal: Array<{ index: number; speed: number }>, index: number, topIndex: number): number {
  const speedScale = Math.max(percentile(signal.map((entry) => entry.speed), 0.9), 0.03)
  const previousSpeed = mean(signal
    .filter((entry) => entry.index <= index && frames[entry.index].timeMs >= frames[index].timeMs - 300)
    .map((entry) => entry.speed))
  const stability = clamp(1 - previousSpeed / Math.max(speedScale * 0.32, 1e-6))
  const excursion = distance(handPoint(frames[index]), handPoint(frames[topIndex])) / Math.max(torsoScale(frames[index]), 1e-6)
  return clamp(0.68 + stability * 0.18 + Math.min(excursion / 1.5, 1) * 0.1)
}

function indexAtOrBefore(frames: PoseFrame[], startIndex: number, timeMs: number): number {
  let result = startIndex
  for (let index = startIndex + 1; index < frames.length && frames[index].timeMs <= timeMs; index += 1) result = index
  return result
}

function indexAtOrAfter(frames: PoseFrame[], startIndex: number, timeMs: number): number {
  let result = startIndex
  while (result < frames.length - 1 && frames[result].timeMs < timeMs) result += 1
  return result
}

function handPoint(frame: PoseFrame) {
  return midpoint(frame.landmarks[LANDMARK.leftWrist], frame.landmarks[LANDMARK.rightWrist])
}

function topPoint(frame: PoseFrame) {
  // Elbows stay substantially more visible than wrists when the hands pass
  // behind the head, and provide a stable 2D proxy for backswing completion.
  return midpoint(frame.landmarks[LANDMARK.leftElbow], frame.landmarks[LANDMARK.rightElbow])
}

function torsoScale(frame: PoseFrame): number {
  return distance(
    midpoint(frame.landmarks[LANDMARK.leftShoulder], frame.landmarks[LANDMARK.rightShoulder]),
    midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip]),
  )
}

function handHeight(frame: PoseFrame): number {
  return midpoint(frame.landmarks[LANDMARK.leftWrist], frame.landmarks[LANDMARK.rightWrist]).y
}

function topHeight(frame: PoseFrame): number {
  return topPoint(frame).y
}

function impactScore(frame: PoseFrame, address: PoseFrame): number {
  const hand = midpoint(frame.landmarks[LANDMARK.leftWrist], frame.landmarks[LANDMARK.rightWrist])
  const addressHand = midpoint(address.landmarks[LANDMARK.leftWrist], address.landmarks[LANDMARK.rightWrist])
  const hip = midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip])
  return distance(hand, addressHand) + Math.abs(hand.y - hip.y) * 0.25
}

function argMin(frames: PoseFrame[], start: number, end: number, selector: (frame: PoseFrame) => number): number {
  let best = start
  let bestValue = Number.POSITIVE_INFINITY
  for (let index = start; index <= end; index += 1) {
    const value = selector(frames[index])
    if (value < bestValue) {
      bestValue = value
      best = index
    }
  }
  return best
}

function prominence(signal: Array<{ speed: number }>, index: number): number {
  const speeds = signal.map((entry) => entry.speed)
  const scale = Math.max(percentile(speeds, 0.9), 1e-6)
  const local = mean(signal.slice(Math.max(0, index - 2), index + 3).map((entry) => entry.speed))
  return clamp(0.5 + Math.min(local / scale, 1) * 0.28)
}

function anchor(frame: PoseFrame, confidence: number): Anchor {
  return { timeMs: frame.timeMs, confidence: clamp(confidence * frame.meanVisibility), detection: 'kinematic' }
}

function interpolate(a: Anchor, b: Anchor, ratio: number): Anchor {
  return {
    timeMs: a.timeMs + (b.timeMs - a.timeMs) * ratio,
    confidence: Math.min(a.confidence, b.confidence) * 0.72,
    detection: 'interpolated',
  }
}

function proportionalFallback(durationMs: number): PhaseSegment[] {
  const ratios = [0.08, 0.18, 0.34, 0.46, 0.51, 0.62, 0.7, 0.82, 0.94]
  return PHASE_NAMES.map((name, index) => {
    const anchorMs = durationMs * ratios[index]
    const previous = index === 0 ? 0 : durationMs * (ratios[index - 1] + ratios[index]) / 2
    const next = index === ratios.length - 1 ? durationMs : durationMs * (ratios[index] + ratios[index + 1]) / 2
    return { name, startMs: previous, endMs: next, anchorMs, confidence: 0.2, detection: 'interpolated' }
  })
}
