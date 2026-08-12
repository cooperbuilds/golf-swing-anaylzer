import { LANDMARK } from '../domain/landmarks'
import type { CameraView, Handedness, Measurement, PhaseName, PhaseSegment, PoseFrame, Reliability } from '../domain/types'
import { angle, clamp, distance, horizontalPlaneAngle, lineAngle, mean, midpoint, nearestFrame, torsoLength } from './geometry'

const REQUIRED_VISIBILITY = 0.58

export function extractMeasurements(
  frames: PoseFrame[],
  phases: PhaseSegment[],
  cameraView: CameraView,
  cameraConfidence: number,
  handedness: Handedness = 'unknown',
): Measurement[] {
  const address = phaseFrame(frames, phases, 'Address')
  const top = phaseFrame(frames, phases, 'Top')
  const impact = phaseFrame(frames, phases, 'Impact')
  const finish = phaseFrame(frames, phases, 'Finish')
  if (!address || !top || !impact || !finish) return unavailableSet('Pose frames were not available at the required swing phases.')

  const measurements: Measurement[] = []
  for (const [phase, frame] of [['Address', address], ['Top', top], ['Impact', impact]] as const) {
    measurements.push(spineAngle(frame, phase, cameraView))
    measurements.push(hipBend(frame, phase))
    measurements.push(kneeFlex(frame, phase))
  }
  measurements.push(rotationDelta(address, top, 'shoulder_turn', 'Shoulder turn', 'Top', cameraView, cameraConfidence, LANDMARK.leftShoulder, LANDMARK.rightShoulder))
  measurements.push(rotationDelta(address, top, 'hip_turn', 'Hip turn', 'Top', cameraView, cameraConfidence, LANDMARK.leftHip, LANDMARK.rightHip))
  measurements.push(rotationDelta(top, impact, 'pelvis_rotation', 'Pelvis rotation through impact', 'Impact', cameraView, cameraConfidence, LANDMARK.leftHip, LANDMARK.rightHip))
  measurements.push(headMovement(frames, address, impact))
  measurements.push(handPath(frames, address, finish))
  measurements.push(tempo(phases))
  measurements.push(...phaseTiming(phases))
  measurements.push(sequencing(frames, phases))
  measurements.push(balance(finish, cameraView))
  measurements.push(earlyExtension(address, impact, cameraView, cameraConfidence))
  measurements.push(armAngle(top, handedness, 'lead'))
  measurements.push(armAngle(impact, handedness, 'trail'))
  measurements.push(unavailable('wrist_position', 'Wrist position', 'Top', 'Pose Landmarker does not estimate wrist hinge or club-face orientation reliably.'))
  return measurements
}

function spineAngle(frame: PoseFrame, phase: PhaseName, view: CameraView): Measurement {
  const key = `spine_angle_${phaseKey(phase)}`
  const points = [LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftHip, LANDMARK.rightHip]
  const confidence = visibility(frame, points) * (view === 'unknown' ? 0.55 : 0.9)
  if (confidence < 0.42) return unavailable(key, 'Projected spine angle', phase, 'Torso landmarks or camera view are not reliable enough.', confidence)
  const shoulder = midpoint(frame.landmarks[LANDMARK.leftShoulder], frame.landmarks[LANDMARK.rightShoulder])
  const hip = midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip])
  const value = Math.abs(Math.abs(lineAngle(hip, shoulder)) - 90)
  return measured(key, 'Projected spine angle', phase, value, 'deg', confidence, frame.timeMs, '2D shoulder-to-hip axis', view === 'unknown' ? 'Camera view is uncertain; this is a projected screen-space angle.' : undefined, support(1, 1, visibility(frame, points)))
}

function hipBend(frame: PoseFrame, phase: PhaseName): Measurement {
  const indices = [LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftKnee, LANDMARK.rightKnee]
  const confidence = visibility(frame, indices) * 0.88
  const key = `hip_bend_${phaseKey(phase)}`
  if (confidence < REQUIRED_VISIBILITY) return unavailable(key, 'Projected hip bend', phase, 'Shoulders, pelvis, or knees are not visible enough.', confidence)
  const shoulder = midpoint(frame.landmarks[LANDMARK.leftShoulder], frame.landmarks[LANDMARK.rightShoulder])
  const hip = midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip])
  const knee = midpoint(frame.landmarks[LANDMARK.leftKnee], frame.landmarks[LANDMARK.rightKnee])
  return measured(key, 'Projected hip bend', phase, 180 - angle(shoulder, hip, knee), 'deg', confidence, frame.timeMs, '2D shoulder-center, hip-center, and knee-center angle', 'This is a screen-space posture indicator, not a 3D pelvic-tilt measurement.')
}

function kneeFlex(frame: PoseFrame, phase: PhaseName): Measurement {
  const indices = [LANDMARK.leftHip, LANDMARK.leftKnee, LANDMARK.leftAnkle, LANDMARK.rightHip, LANDMARK.rightKnee, LANDMARK.rightAnkle]
  const confidence = visibility(frame, indices)
  const key = `knee_flex_${phaseKey(phase)}`
  if (confidence < REQUIRED_VISIBILITY) return unavailable(key, 'Average knee flex', phase, 'One or both legs are occluded.', confidence)
  const left = 180 - angle(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.leftKnee], frame.landmarks[LANDMARK.leftAnkle])
  const right = 180 - angle(frame.landmarks[LANDMARK.rightHip], frame.landmarks[LANDMARK.rightKnee], frame.landmarks[LANDMARK.rightAnkle])
  return measured(key, 'Average knee flex', phase, mean([left, right]), 'deg', confidence, frame.timeMs, '2D hip-knee-ankle angles')
}

function rotationDelta(
  before: PoseFrame,
  after: PoseFrame,
  key: string,
  label: string,
  phase: PhaseName,
  view: CameraView,
  cameraConfidence: number,
  leftIndex: number,
  rightIndex: number,
): Measurement {
  const confidence = Math.min(visibility(before, [leftIndex, rightIndex]), visibility(after, [leftIndex, rightIndex]), cameraConfidence)
  if (!before.worldLandmarks || !after.worldLandmarks || confidence < 0.62 || view === 'unknown') {
    return unavailable(key, label, phase, 'Reliable axial rotation needs visible world landmarks and a known camera view.', confidence)
  }
  const initial = horizontalPlaneAngle(before.worldLandmarks[leftIndex], before.worldLandmarks[rightIndex])
  const final = horizontalPlaneAngle(after.worldLandmarks[leftIndex], after.worldLandmarks[rightIndex])
  return measured(key, label, phase, angularDifference(initial, final), 'deg', confidence * 0.82, after.timeMs, 'MediaPipe world-landmark horizontal plane', 'Monocular world depth is estimated, so rotation confidence is capped.')
}

function headMovement(frames: PoseFrame[], address: PoseFrame, impact: PoseFrame): Measurement {
  const baseline = address.landmarks[LANDMARK.nose]
  const scale = torsoLength(address, LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftHip, LANDMARK.rightHip)
  const window = frames.filter((frame) => frame.timeMs >= address.timeMs && frame.timeMs <= impact.timeMs)
  const valid = window.filter((frame) => frame.landmarks[LANDMARK.nose].visibility >= REQUIRED_VISIBILITY)
  const temporalCoverage = valid.length / Math.max(window.length, 1)
  const confidence = temporalCoverage * mean(valid.map((frame) => frame.landmarks[LANDMARK.nose].visibility))
  if (confidence < 0.5) return unavailable('head_movement', 'Head movement through impact', 'Whole swing', 'The head is occluded for too much of the address-to-impact window.', confidence)
  let maximum = 0
  let frameMs = address.timeMs
  for (const frame of valid) {
    const movement = distance(baseline, frame.landmarks[LANDMARK.nose]) / scale
    if (movement > maximum) {
      maximum = movement
      frameMs = frame.timeMs
    }
  }
  return measured('head_movement', 'Maximum head movement through impact', 'Whole swing', maximum, 'torso-lengths', confidence, frameMs, 'Address-to-impact 2D nose displacement normalized by torso length', 'Follow-through and post-swing motion are excluded so they cannot create this finding.', support(valid.length, temporalCoverage, mean(valid.map((frame) => frame.landmarks[LANDMARK.nose].visibility))))
}

function handPath(frames: PoseFrame[], address: PoseFrame, finish: PoseFrame): Measurement {
  const scale = torsoLength(address, LANDMARK.leftShoulder, LANDMARK.rightShoulder, LANDMARK.leftHip, LANDMARK.rightHip)
  const window = frames.filter((frame) => frame.timeMs >= address.timeMs && frame.timeMs <= finish.timeMs)
  const path: number[] = []
  for (let index = 1; index < window.length; index += 1) {
    const a = midpoint(window[index - 1].landmarks[LANDMARK.leftWrist], window[index - 1].landmarks[LANDMARK.rightWrist])
    const b = midpoint(window[index].landmarks[LANDMARK.leftWrist], window[index].landmarks[LANDMARK.rightWrist])
    path.push(distance(a, b) / scale)
  }
  const confidence = mean(window.map((frame) => Math.min(frame.landmarks[LANDMARK.leftWrist].visibility, frame.landmarks[LANDMARK.rightWrist].visibility)))
  if (confidence < 0.52) return unavailable('hand_path', 'Hand-path length', 'Whole swing', 'The hands are occluded or blurred in too many frames.', confidence)
  return measured('hand_path', 'Normalized hand-path length', 'Whole swing', path.reduce((total, value) => total + value, 0), 'torso-lengths', confidence, null, 'Address-to-finish 2D wrist-center trajectory normalized by torso length')
}

function tempo(phases: PhaseSegment[]): Measurement {
  const address = phase(phases, 'Address').anchorMs
  const top = phase(phases, 'Top').anchorMs
  const impact = phase(phases, 'Impact').anchorMs
  const backswing = top - address
  const downswing = impact - top
  const confidence = Math.min(phase(phases, 'Address').confidence, phase(phases, 'Top').confidence, phase(phases, 'Impact').confidence)
  if (backswing <= 0 || downswing <= 0) return unavailable('tempo_ratio', 'Backswing : downswing tempo', 'Whole swing', 'Phase order was not stable enough to calculate tempo.', confidence)
  return measured('tempo_ratio', 'Backswing : downswing tempo', 'Whole swing', backswing / downswing, 'x', confidence, impact, 'Kinematically detected address, top, and impact timestamps', undefined, support(3, 1, confidence))
}

function phaseTiming(phases: PhaseSegment[]): Measurement[] {
  const address = phase(phases, 'Address').anchorMs
  const takeaway = phase(phases, 'Takeaway').anchorMs
  const top = phase(phases, 'Top').anchorMs
  const transition = phase(phases, 'Transition').anchorMs
  const impact = phase(phases, 'Impact').anchorMs
  const finish = phase(phases, 'Finish').anchorMs
  const total = Math.max(finish - address, 1)
  const confidence = Math.min(...['Address', 'Top', 'Impact', 'Finish'].map((name) => phase(phases, name as PhaseName).confidence))
  const values: Array<[string, string, number]> = [
    ['timing_takeaway_pct', 'Takeaway timing', (takeaway - address) / total * 100],
    ['timing_backswing_pct', 'Backswing timing', (top - address) / total * 100],
    ['timing_transition_pct', 'Transition timing', (transition - top) / total * 100],
    ['timing_impact_pct', 'Impact timing', (impact - address) / total * 100],
    ['timing_follow_through_pct', 'Follow-through timing', (finish - impact) / total * 100],
  ]
  return values.map(([key, label, value]) => measured(key, label, 'Whole swing', value, '%', confidence, null, 'Phase anchor timing normalized to address-to-finish duration', undefined, support(4, 1, confidence)))
}

function sequencing(frames: PoseFrame[], phases: PhaseSegment[]): Measurement {
  const top = phase(phases, 'Top').anchorMs
  const impact = phase(phases, 'Impact').anchorMs
  const indices = [LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftShoulder, LANDMARK.rightShoulder]
  const window = frames.filter((frame) => frame.timeMs >= top && frame.timeMs <= impact && frame.worldLandmarks
    && Math.min(...indices.map((index) => frame.worldLandmarks![index]?.visibility ?? 0)) >= 0.62)
  const temporalCoverage = window.length > 1 ? (window.at(-1)!.timeMs - window[0].timeMs) / Math.max(impact - top, 1) : 0
  if (window.length < 6 || temporalCoverage < 0.68) return unavailable('sequence_gap', 'Pelvis-to-shoulder peak sequence', 'Downswing', 'Not enough visible world-landmark coverage exists during the downswing.')
  const hipAngles = window.map((frame) => horizontalPlaneAngle(frame.worldLandmarks![LANDMARK.leftHip], frame.worldLandmarks![LANDMARK.rightHip]))
  const shoulderAngles = window.map((frame) => horizontalPlaneAngle(frame.worldLandmarks![LANDMARK.leftShoulder], frame.worldLandmarks![LANDMARK.rightShoulder]))
  const hipPeak = peakVelocity(window, hipAngles)
  const shoulderPeak = peakVelocity(window, shoulderAngles)
  const landmarkVisibility = mean(window.flatMap((frame) => indices.map((index) => frame.worldLandmarks![index].visibility)))
  const gap = shoulderPeak.timeMs - hipPeak.timeMs
  const robustOrderMargin = hipPeak.earliestPlausibleMs - shoulderPeak.latestPlausibleMs
  const peakSeparation = gap < -40 ? clamp(robustOrderMargin / 40) : 1
  const confidence = Math.min(landmarkVisibility, temporalCoverage) * 0.72 * peakSeparation
  const limitation = peakSeparation < 1
    ? 'The shoulder and pelvis peak-speed windows overlap, so their order is not stable enough for a coaching conclusion.'
    : 'Depth is model-estimated; use this as a sequencing indicator, not a lab-grade measurement.'
  return measured('sequence_gap', 'Pelvis-to-shoulder peak sequence', 'Downswing', gap, 'ms', confidence, shoulderPeak.timeMs, 'Peak angular velocities from monocular world landmarks', limitation, support(window.length, temporalCoverage, landmarkVisibility))
}

function balance(frame: PoseFrame, view: CameraView): Measurement {
  const hip = midpoint(frame.landmarks[LANDMARK.leftHip], frame.landmarks[LANDMARK.rightHip])
  const leftFoot = frame.landmarks[LANDMARK.leftFoot]
  const rightFoot = frame.landmarks[LANDMARK.rightFoot]
  const stance = Math.max(distance(leftFoot, rightFoot), 1e-6)
  const center = midpoint(leftFoot, rightFoot)
  const confidence = visibility(frame, [LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftFoot, LANDMARK.rightFoot])
  if (view !== 'face-on') return unavailable('finish_balance', 'Finish balance', 'Finish', 'A centered-over-stance finish screen requires a face-on view.', confidence)
  if (confidence < REQUIRED_VISIBILITY) return unavailable('finish_balance', 'Finish balance', 'Finish', 'Feet or pelvis are not fully visible.', confidence)
  return measured('finish_balance', 'Pelvis offset from stance center', 'Finish', Math.abs(hip.x - center.x) / stance, 'normalized', confidence, frame.timeMs, '2D pelvis position relative to visible stance width', undefined, support(1, 1, confidence))
}

function earlyExtension(address: PoseFrame, impact: PoseFrame, view: CameraView, cameraConfidence: number): Measurement {
  const indices = [LANDMARK.leftHip, LANDMARK.rightHip, LANDMARK.leftShoulder, LANDMARK.rightShoulder]
  const landmarkVisibility = address.worldLandmarks && impact.worldLandmarks
    ? Math.min(...[address, impact].flatMap((frame) => indices.map((index) => frame.worldLandmarks![index]?.visibility ?? 0)))
    : 0
  const confidence = Math.min(landmarkVisibility, cameraConfidence) * 0.72
  if (view !== 'down-the-line' || !address.worldLandmarks || !impact.worldLandmarks || confidence < 0.5) {
    return unavailable('pelvis_depth_change', 'Pelvis depth change', 'Impact', 'Early-extension screening requires a confident down-the-line view and stable world landmarks.', confidence)
  }
  const addressHip = midpoint(address.worldLandmarks[LANDMARK.leftHip], address.worldLandmarks[LANDMARK.rightHip])
  const impactHip = midpoint(impact.worldLandmarks[LANDMARK.leftHip], impact.worldLandmarks[LANDMARK.rightHip])
  const addressShoulder = midpoint(address.worldLandmarks[LANDMARK.leftShoulder], address.worldLandmarks[LANDMARK.rightShoulder])
  const scale = Math.max(distance(addressHip, addressShoulder, 3), 1e-6)
  return measured('pelvis_depth_change', 'Pelvis depth change', 'Impact', (impactHip.z - addressHip.z) / scale, 'torso-lengths', confidence, impact.timeMs, 'World-landmark pelvis depth normalized by torso length', 'This is a monocular pelvis-depth indicator, not a diagnosis of early extension or a direct measurement of distance to the ball.', support(2, 1, landmarkVisibility))
}

function armAngle(frame: PoseFrame, handedness: Handedness, side: 'lead' | 'trail'): Measurement {
  if (handedness === 'unknown') return unavailable(`${side}_arm`, side === 'lead' ? 'Lead-arm straightness' : 'Trail-elbow flex', side === 'lead' ? 'Top' : 'Impact', 'Handedness could not be inferred safely. Select it in a future profile to enable side-specific measurements.')
  const isLeft = side === 'lead' ? handedness === 'right' : handedness === 'left'
  const shoulder = isLeft ? LANDMARK.leftShoulder : LANDMARK.rightShoulder
  const elbow = isLeft ? LANDMARK.leftElbow : LANDMARK.rightElbow
  const wrist = isLeft ? LANDMARK.leftWrist : LANDMARK.rightWrist
  const confidence = visibility(frame, [shoulder, elbow, wrist])
  if (confidence < REQUIRED_VISIBILITY) return unavailable(`${side}_arm`, side === 'lead' ? 'Lead-arm straightness' : 'Trail-elbow flex', side === 'lead' ? 'Top' : 'Impact', 'The relevant arm is occluded.', confidence)
  const elbowAngle = angle(frame.landmarks[shoulder], frame.landmarks[elbow], frame.landmarks[wrist])
  return measured(`${side}_arm`, side === 'lead' ? 'Lead-arm straightness' : 'Trail-elbow flex', side === 'lead' ? 'Top' : 'Impact', side === 'lead' ? elbowAngle : 180 - elbowAngle, 'deg', confidence, frame.timeMs, '2D shoulder-elbow-wrist angle')
}

function visibility(frame: PoseFrame, indices: number[]): number {
  return mean(indices.map((index) => frame.landmarks[index]?.visibility ?? 0))
}

function phaseFrame(frames: PoseFrame[], phases: PhaseSegment[], name: PhaseName): PoseFrame | undefined {
  return nearestFrame(frames, phase(phases, name).anchorMs)
}

function phase(phases: PhaseSegment[], name: PhaseName): PhaseSegment {
  return phases.find((item) => item.name === name) ?? phases[0]
}

function peakVelocity(frames: PoseFrame[], values: number[]): { timeMs: number; earliestPlausibleMs: number; latestPlausibleMs: number } {
  const speeds = values.map((value, index) => {
    if (index === 0) return 0
    const elapsed = Math.max(frames[index].timeMs - frames[index - 1].timeMs, 1)
    return Math.abs(angularDifference(values[index - 1], value)) / elapsed
  })
  let peak = 0
  let peakIndex = 0
  for (let index = 1; index < speeds.length; index += 1) {
    const speed = speeds[index]
    if (speed > peak) {
      peak = speed
      peakIndex = index
    }
  }
  const plausible = speeds.flatMap((speed, index) => speed >= peak * 0.85 ? [frames[index].timeMs] : [])
  return {
    timeMs: frames[peakIndex].timeMs,
    earliestPlausibleMs: Math.min(...plausible, frames[peakIndex].timeMs),
    latestPlausibleMs: Math.max(...plausible, frames[peakIndex].timeMs),
  }
}

function angularDifference(a: number, b: number): number {
  return Math.abs((((b - a) % 360) + 540) % 360 - 180)
}

function measured(
  key: string,
  label: string,
  phaseName: PhaseName | 'Whole swing',
  value: number,
  unit: Measurement['unit'],
  confidence: number,
  frameMs: number | null,
  observedFrom: string,
  limitation?: string,
  evidenceSupport?: Measurement['support'],
): Measurement {
  const reliability: Reliability = confidence >= 0.62 ? 'available' : confidence >= 0.4 ? 'low-confidence' : 'unavailable'
  return { key, label, phase: phaseName, value: Number.isFinite(value) ? value : null, unit, confidence: clamp(confidence), reliability, frameMs, observedFrom, limitation, support: evidenceSupport, ...measurementContract(key) }
}

function support(sampleCount: number, temporalCoverage: number, landmarkVisibility: number): NonNullable<Measurement['support']> {
  return { sampleCount, temporalCoverage: clamp(temporalCoverage), landmarkVisibility: clamp(landmarkVisibility) }
}

function unavailable(key: string, label: string, phaseName: PhaseName | 'Whole swing', limitation: string, confidence = 0): Measurement {
  return { key, label, phase: phaseName, value: null, unit: 'status', confidence: clamp(confidence), reliability: 'unavailable', frameMs: null, observedFrom: 'Not observable from this footage', limitation, ...measurementContract(key) }
}

function unavailableSet(reason: string): Measurement[] {
  return [unavailable('pose_measurements', 'Biomechanical measurements', 'Whole swing', reason)]
}

function phaseKey(phaseName: PhaseName): string {
  return phaseName.toLowerCase().replaceAll('-', '_').replaceAll(' ', '_')
}

function measurementContract(key: string): Pick<Measurement, 'sourceKind' | 'supportedViews' | 'validityRequirements'> {
  if (key.startsWith('timing_') || key === 'tempo_ratio') {
    return { sourceKind: 'phase-timing', supportedViews: ['face-on', 'down-the-line'], validityRequirements: ['Stable address, top, impact, and finish anchors', 'One complete swing in the clip'] }
  }
  if (['shoulder_turn', 'hip_turn', 'pelvis_rotation', 'sequence_gap', 'pelvis_depth_change'].includes(key)) {
    return {
      sourceKind: 'pose-world',
      supportedViews: key === 'pelvis_depth_change' ? ['down-the-line'] : ['face-on', 'down-the-line'],
      validityRequirements: ['Known compatible camera view', 'Visible torso landmarks', 'Stable MediaPipe world landmarks'],
    }
  }
  if (['shaft_position', 'swing_plane', 'wrist_position'].includes(key)) {
    return { sourceKind: key === 'wrist_position' ? 'pose-2d' : 'club-tracker', supportedViews: ['face-on', 'down-the-line'], validityRequirements: ['A validated club/hand detector', 'Low motion blur', 'Club visible through the relevant phase'] }
  }
  if (key === 'finish_balance') {
    return { sourceKind: 'pose-2d', supportedViews: ['face-on'], validityRequirements: ['Confident face-on camera view', 'Both feet and pelvis visible at finish', 'Stable camera framing'] }
  }
  return { sourceKind: 'pose-2d', supportedViews: ['face-on', 'down-the-line'], validityRequirements: ['Relevant joints visible', 'Full golfer remains in frame', 'Stable camera framing'] }
}
