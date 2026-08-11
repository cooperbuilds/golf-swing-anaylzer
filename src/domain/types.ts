export const PHASE_NAMES = [
  'Address',
  'Takeaway',
  'Backswing',
  'Top',
  'Transition',
  'Downswing',
  'Impact',
  'Follow-through',
  'Finish',
] as const

export type PhaseName = (typeof PHASE_NAMES)[number]
export type CameraView = 'face-on' | 'down-the-line' | 'unknown'
export type Handedness = 'right' | 'left' | 'unknown'
export type Reliability = 'available' | 'low-confidence' | 'unavailable'
export type ConfidenceLevel = 'high' | 'medium' | 'low'
export type Priority = 'high' | 'medium' | 'low'
export type MeasurementSource = 'pose-2d' | 'pose-world' | 'phase-timing' | 'club-tracker'

export interface Point3D {
  x: number
  y: number
  z: number
  visibility: number
}

export interface PoseFrame {
  frameIndex: number
  timeMs: number
  landmarks: Point3D[]
  worldLandmarks?: Point3D[]
  meanVisibility: number
}

export interface VideoMetadata {
  name: string
  sizeBytes: number
  durationMs: number
  width: number
  height: number
  orientation: 'vertical' | 'horizontal' | 'square'
  fps: number | null
  fpsSource: 'container' | 'estimated' | 'unavailable'
}

export interface QualityFactor {
  key: 'resolution' | 'duration' | 'brightness' | 'sharpness' | 'visibility' | 'camera' | 'occlusion' | 'framing' | 'stability' | 'frame-rate' | 'swing-coverage'
  label: string
  score: number
  message: string
}

export interface QualityReport {
  suitable: boolean
  score: number
  cameraView: CameraView
  cameraConfidence: number
  factors: QualityFactor[]
  guidance: string[]
}

export interface PhaseSegment {
  name: PhaseName
  startMs: number
  endMs: number
  anchorMs: number
  confidence: number
  detection: 'kinematic' | 'interpolated'
}

export interface Measurement {
  key: string
  label: string
  phase: PhaseName | 'Whole swing'
  value: number | null
  unit: 'deg' | '%' | 'x' | 'ms' | 'torso-lengths' | 'normalized' | 'status'
  confidence: number
  reliability: Reliability
  frameMs: number | null
  observedFrom: string
  limitation?: string
  sourceKind?: MeasurementSource
  supportedViews?: CameraView[]
  validityRequirements?: string[]
  support?: {
    sampleCount: number
    temporalCoverage: number
    landmarkVisibility: number
  }
}

export interface ReferenceRange {
  metricKey: string
  phase: PhaseName | 'Whole swing'
  p10: number
  median: number
  p90: number
  unit: Measurement['unit']
  sampleCount: number
  view: CameraView
  club: string
  sex: 'female' | 'male' | 'mixed'
  provenance: string
}

export interface Comparison {
  measurementKey: string
  status: 'within-range' | 'below-range' | 'above-range' | 'no-coverage' | 'low-confidence'
  percentile: number | null
  deviation: number | null
  reference?: ReferenceRange
}

export interface Evidence {
  measurementKey: string
  measured: string
  reference: string
  confidence: number
}

export interface Finding {
  id: string
  title: string
  summary: string
  why: string
  where: string
  phase: PhaseName
  priority: Priority
  confidence: number
  frameMs: number
  workOn: string
  drill: string
  likelyCause?: string
  evidence: Evidence[]
}

export interface Strength {
  id: string
  title: string
  summary: string
  why: string
  phase: PhaseName | 'Whole swing'
  confidence: number
  frameMs: number
  evidence: Evidence[]
}

export interface PhaseFeatureDifference {
  measurementKey: string
  label: string
  userValue: string
  referenceValue: string
  difference: string
  status: Comparison['status']
  confidence: number
}

export interface PhaseComparison {
  phase: PhaseName
  status: 'compared' | 'partial' | 'unavailable'
  referenceKind: 'golfdb-timing-range' | 'licensed-pose-profile' | 'personal-baseline' | 'none'
  confidence: number
  features: PhaseFeatureDifference[]
  note: string
}

export interface ClubTrackFrame {
  timeMs: number
  grip: { x: number; y: number }
  clubhead: { x: number; y: number }
  shaftAngleDeg: number
  confidence: number
}

export interface ClubTrackingResult {
  status: 'available' | 'low-confidence' | 'unavailable'
  confidence: number
  method: 'contrast-line-tracker-v1'
  frames: ClubTrackFrame[]
  coverage: number
  note: string
}

export interface SimilarityResult {
  available: boolean
  score: number | null
  referenceCount: number
  method: 'phase-normalized-dtw' | 'unavailable'
  note: string
}

export interface CoachNarrative {
  mode: 'ai' | 'deterministic-fallback'
  overview: string
  issueNotes: Record<string, string>
  note: string
}

export interface AnalysisResult {
  schemaVersion: 1 | 2
  id: string
  createdAt: string
  source: 'measured' | 'guided-demo'
  video: VideoMetadata
  quality: QualityReport
  phases: PhaseSegment[]
  poseFrames: PoseFrame[]
  measurements: Measurement[]
  comparisons: Comparison[]
  findings: Finding[]
  strengths?: Strength[]
  overallSummary?: string
  phaseComparisons?: PhaseComparison[]
  clubTracking?: ClubTrackingResult
  coachNarrative?: CoachNarrative
  similarity: SimilarityResult
  progressDelta?: {
    comparedWith: string
    improving: string[]
    persistent: string[]
    newIssues: string[]
    tempoChange: number | null
    comparableQuality: boolean
  }
  globalConfidence: number
  referenceLabel: string
  warnings: string[]
}

export type SwingRelationKind = 'same-swing-likely' | 'different-swings-likely' | 'uncertain'

export interface SessionVideoObservation {
  id: string
  fileName: string
  lastModified: number
  metadata?: VideoMetadata
  status: 'analyzed' | 'failed'
  analysisId?: string
  error?: string
}

export interface SwingRelation {
  firstObservationId: string
  secondObservationId: string
  kind: SwingRelationKind
  confidence: number
  reason: string
}

export interface SessionFindingSupport {
  analysisId: string
  observationId: string
  videoName: string
  cameraView: CameraView
  phase: PhaseName
  frameMs: number
  confidence: number
  evidence: Evidence[]
}

export interface SessionFinding extends Finding {
  supports: SessionFindingSupport[]
  swingCount: number
  videoCount: number
  aggregationNote: string
}

export interface SessionMeasurement {
  measurement: Measurement
  analysisId: string
  observationId: string
  videoName: string
  cameraView: CameraView
  selectionReason: string
}

export interface AnalysisSession {
  schemaVersion: 1
  id: string
  createdAt: string
  observations: SessionVideoObservation[]
  analyses: AnalysisResult[]
  relations: SwingRelation[]
  findings: SessionFinding[]
  bestMeasurements: SessionMeasurement[]
  overallSummary: string
  globalConfidence: number
  warnings: string[]
}

export type HistoryEntry = AnalysisResult | AnalysisSession

export interface SelectedVideo {
  id: string
  file: File
  metadata?: VideoMetadata
  fingerprint?: string
  status: 'inspecting' | 'ready' | 'analyzing' | 'cached' | 'complete' | 'failed'
  error?: string
  quality?: QualityReport
  cachedAnalysis?: AnalysisResult
}

export function isAnalysisSession(value: HistoryEntry): value is AnalysisSession {
  return 'observations' in value && 'analyses' in value
}

export interface AnalysisProgress {
  stage: 'quality' | 'pose' | 'phases' | 'measurements' | 'comparison' | 'coaching' | 'complete'
  percent: number
  message: string
}
