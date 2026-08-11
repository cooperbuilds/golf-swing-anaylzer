# SwingLab — Golf Swing Analyzer

SwingLab is a browser-first golf swing analyzer built from the strongest ideas in [DHU-Golf/detect](https://github.com/DHU-Golf/detect) without inheriting its hard-coded desktop pipeline.

The product flow is:

`videos → per-video quality/view check → independent pose + phase analysis → compatible cross-video evidence → strengths + ranked priorities → evidence-bound coaching`

## Run it

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` and upload one or several swing videos. The first analysis downloads the MediaPipe Lite pose model. Set these variables to self-host the assets:

```text
VITE_POSE_MODEL_URL=/models/pose_landmarker_lite.task
VITE_MEDIAPIPE_WASM_URL=/wasm
```

Validation:

```powershell
npm run check
npm run test:validation
```

## Optional AI coaching endpoint

Measurements, comparisons, ranking, and drills are always deterministic. To add model-written phrasing, set `VITE_COACH_ENDPOINT` to a protected server endpoint. Never expose an AI provider key in a Vite/browser environment variable. The endpoint receives the guarded payload from `src/core/coaching.ts` and returns:

```json
{"overview":"...","issues":[{"id":"existing-finding-id","explanation":"..."}]}
```

Invalid, timed-out, or unavailable responses fall back to deterministic coaching without interrupting analysis.

## What is implemented

- MP4/MOV/WebM upload with vertical and horizontal layouts.
- Multi-file selection and review with independent decode/quality status, removal before analysis, per-video processing state, and partial success when one file fails.
- Time-based sampling, so 30/60/120/240 FPS footage is not interpreted as if it were 30 FPS.
- Exposure, sharpness, framing, occlusion, camera stability, full-swing coverage, resolution, frame timing, and camera-view checks with practical recording guidance.
- GPU-first MediaPipe Pose Landmarker with CPU fallback and 33 body landmarks.
- Address, takeaway, backswing, top, transition, downswing, impact, follow-through, and finish timeline.
- Projected spine angle, hip bend, knee flex, world-landmark rotation indicators, head movement, hand path, tempo, sequencing, balance, and early-extension screening where observable.
- A local contrast-line shaft tracker anchored at the detected grip. Shaft angle, an approximate clubhead proxy, and a projected down-the-line path axis are exposed only after temporal coverage and confidence gates pass.
- Explicitly withheld wrist-hinge, club-face, shaft, swing-plane, side-specific arm, or camera-specific values when evidence is insufficient.
- A video-free 1,400-record GolfDB metadata catalog and 192 derived timing ranges.
- Deterministic comparison, positive movement identification, likely-cause language bounded by co-occurring measurements, and top-three materiality/confidence ranking.
- A simple coaching result: overall summary, top priorities, what is working well, drills, phase-attached evidence, and expandable raw measurements.
- Phase-by-phase `USER → REFERENCE → DIFFERENCE` views. GolfDB supplies timing ranges; a same-view previous swing supplies a personal normalized-pose baseline. Unsupported professional pose comparisons remain visibly unavailable.
- Findings that jump to evidence frames, body/club overlays, frame scrubbing, cached analyses, schema-v1 migration, and previous/current DTW similarity.
- Multi-video sessions that preserve each source analysis, classify pairings as likely same-swing, likely different swings, or uncertain, and let session findings jump to the exact supporting video/frame.
- Stable sampled-content video identities, per-video cache reuse, session history, and backward-compatible loading of existing single-video history.
- A protected AI-coach endpoint contract with strict response validation and deterministic fallback.
- Rule-specific evidence gates and a compact validation-record export for blinded coach review.

## Accuracy boundary

This is an evidence-first implementation, not a launch-monitor replacement. MediaPipe world depth is monocular and therefore capped in confidence. The club tracker is an experimental 2D visual tracker, not a launch-monitor or club-face detector. The bundled professional reference data supports timing comparison only; body-angle comparisons return `no-coverage` until a licensed pose-derived corpus is supplied.

Multiple views are not fused into 3D. The session layer selects the strongest already-valid observation for a metric and never averages incompatible camera measurements. A likely same-swing classification uses normalized phase timing, complementary camera views, duration, and capture timestamps; it is a plausibility assessment, not synchronization. See [multi-video sessions](docs/MULTI_VIDEO_SESSIONS.md).

See [upstream audit](docs/UPSTREAM_AUDIT.md), [reference data policy](docs/REFERENCE_DATA.md), [real-swing evaluation workflow](docs/EVALUATION.md), and the current [coaching validation report](docs/VALIDATION_REPORT.md).

## Real-swing observability check

With the local evaluation environment installed:

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_real_swings.py <video1> <video2> --model .cache\pose_landmarker_lite.task --samples 24
```

This checks pose/phase observability only. A coaching claim is not considered validated until it passes the independent coach-review workflow in `docs/VALIDATION_REPORT.md`.

For the most reliable first test, upload one trimmed MP4, MOV, or WebM containing one complete swing, a short still setup, and a held finish. Keep the full golfer visible from a fixed face-on or down-the-line camera. Multiple rehearsal swings in one clip are intentionally outside the current segmentation guarantee.
