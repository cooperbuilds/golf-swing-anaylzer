# Coaching validation report

Status: **NOT YET VALIDATED for golf-coaching accuracy**

This report separates technical observability from independent coaching agreement. No coach scores or diagnostic ground truth have been fabricated.

## Current evidence

| Metric | Result | Meaning |
|---|---:|---|
| Real swings processed | 6 | Existing local DHU-Golf clips; usable for private technical evaluation, not diagnostic ground truth |
| Camera views | 4 down-the-line, 2 face-on | Automatic estimates; one face-on result had only 0.559 confidence |
| Decode success | 6/6 | Proven on this small set |
| Pose coverage | 100% of 113–120 sampled frames on all 6 | Proven only for the sampled frames |
| Mean pose visibility | 0.779–0.908 | Proven on these clips |
| Ordered nine-phase anchors | 6/6 | Address/Top/Impact anchors were spot-checked on the clips that exposed the regression; full semantic accuracy is **NOT YET VALIDATED** |
| Coach-verified phase segmentation | **NOT YET VALIDATED** | No coach-labeled event frames exist |
| High-confidence findings | **NOT YET VALIDATED** | No blinded coach reconciliation exists |
| False positives | **NOT YET VALIDATED** | Requires supported/unsupported coach verdicts |
| Coach agreement | **NOT YET VALIDATED** | No independent coach reviews supplied |
| Top-priority precision | **NOT YET VALIDATED** | Release target is at least 0.80 |
| Clarity score | **NOT YET VALIDATED** | Release target is median at least 4/5 |
| Actionability score | **NOT YET VALIDATED** | Release target is median at least 4/5 |
| Drill usefulness | **NOT YET VALIDATED** | Requires coach judgment that the drill targets the validated movement |
| Strength precision | **NOT YET VALIDATED** | Strengths require the same independent support verdict as faults |

## Blinded coach workflow

1. Prepare a private case manifest and a blind worksheet. Videos are hashed and referenced in place; they are not copied:

```powershell
.\.venv\Scripts\python.exe scripts\coach_validation.py prepare <video1> <video2> --output-dir validation\study-001
```

2. Give the coach only the videos and `coach_review_blind.csv`. The coach records camera view, recording variation, up to three independently observed issues and phases, then sets `independent_review_complete=yes` and a completion timestamp. Do not provide the application, screenshots, or analyzer export yet.
3. Analyze each video in SwingLab and click **Validation record**. Keep those JSON files away from the coach until step 2 is complete.
4. Reveal the comparison. The command refuses to proceed while any blind review is incomplete:

```powershell
.\.venv\Scripts\python.exe scripts\coach_validation.py reveal `
  --manifest validation\study-001\case_manifest.private.json `
  --blind-review validation\study-001\coach_review_blind.csv `
  --analyzer-records <downloaded-record-directory> `
  --output validation\study-001\reconciliation.csv
```

5. For each analyzer priority, record detection support, top-three importance, phase accuracy, drill relationship, agreement, and one disagreement category. Score clarity and actionability from 1–5. Complete strength verdicts separately. For a second coach, use a separate blind worksheet and reconciliation so neither coach sees the other's conclusions.
6. Calculate metrics. `--reconciliation` accepts one or more independently completed files:

```powershell
.\.venv\Scripts\python.exe scripts\coach_validation.py score `
  --reconciliation validation\study-001\reconciliation.csv `
  --output validation\study-001\metrics.json
```

Empty or unresolved judgments remain `NOT YET VALIDATED` rather than becoming zeroes or inferred agreement.

## False-positive rule audit

All finding rules now require an `available` measurement, a compatible known camera view, explicit landmark support, phase confidence, and temporal coverage. The final list is evidence-driven and may contain zero, one, two, or three findings.

| Rule | Required evidence | View | Temporal/phase gate | Supported conclusion | Explicit boundary |
|---|---|---|---|---|---|
| Tempo outlier | Both wrists and hips through Address, Top, Impact; GolfDB timing range | Face-on or DTL | Three kinematic anchors, each ≥0.62 confidence | Timing ratio is outside the catalog band | Does not establish club path, contact, or that tempo is the coach's first priority |
| Pelvis depth | Shoulders and hips in world landmarks at Address and Impact | DTL only | Both kinematic anchors ≥0.62; high landmark/view confidence | Projected pelvis depth changed by the screen threshold | Does not prove early extension or its cause; diagnostic confidence is capped |
| Head movement | Nose plus torso scale | Face-on or DTL | At least 12 samples and ≥75% temporal coverage | Large 2D translation occurred | Does not measure rotation or prove a contact consequence |
| Finish position | Both hips and both feet | Face-on or DTL | Kinematic Finish ≥0.62 | Pelvis is off-center relative to visible stance | Does not measure pressure or dynamic balance |
| Sequence order | Both shoulders and hips in world landmarks | Face-on or DTL | At least 6 frames, ≥68% Top-to-Impact coverage, both anchors ≥0.62 | Estimated peak-speed order | Does not establish 3D kinematic sequence or club path |

The previous `0.48` issue-entry threshold was inconsistent with the measurement contract's `0.62` “available” threshold. It was removed. Findings now require the rule-specific contract and a final confidence of at least `0.58`.

## Address-at-zero investigation

The four `Address = 0 ms` results were not accepted as valid. Coarse 24-frame sampling made the behavior more frequent, but production logic had the same underlying weakness: the first wrist-speed threshold crossing was treated as swing onset. A setup waggle or ordinary pre-shot movement could therefore make the first decoded frame the Address anchor and truncate the percentage-based Top search window.

Segmentation now normalizes motion by torso size, ignores very low-visibility wrist motion, finds the last stable address-like frame before a complete swing excursion, and then refines Top as the first local hand-height peak followed by a downswing. Impact is searched only after that Top and Finish is bounded to the same swing window. At 113–120 samples per clip, none of the six Address anchors is 0 ms. The long-setup regression clip moved from `Address 0 / false Top 4.58 s` to approximately `Address 4.41 s / Top 5.04 s / Impact 5.40 s`; those frames were visually spot-checked.

This demonstrates correction of the observed regression, not coach-validated event detection. Clips should contain one complete swing. Multiple rehearsal swings or multiple full swings can still make the event sequence ambiguous and should be trimmed or rejected for review.

## Strength audit

- Tempo strength says only that this swing's measured ratio is within the timing catalog. It no longer claims repeatability from one swing.
- Torso-angle strength reports the measured address-to-impact screen-space change and explicitly avoids a universal posture claim.
- Finish strength reports pelvis offset from the visible stance and explicitly avoids a force/pressure claim.
- The former pelvis-before-shoulders “strength” was removed because an order observation without a validated successful range is not enough to call the movement good.
- No generic compliment is emitted. Every retained strength includes its measured value, comparison boundary, confidence, rule contract, and support data in the validation export.

## Drill audit

The deterministic catalog records `ISSUE → MOVEMENT → DESIRED CHANGE → DRILL → RELATIONSHIP`. Finding generation obtains drill text from this catalog, and a test fails if a finding rule has no explicit movement relationship. This proves internal traceability, not real-world drill effectiveness; coach-rated drill usefulness remains **NOT YET VALIDATED**.

## Disagreement classification

The reconciliation worksheet permits only these primary categories:

- analyzer incorrect;
- coach interpretation differs;
- insufficient evidence;
- camera limitation;
- measurement limitation;
- analyzer correctly withheld information;
- ambiguous swing.

These categories are diagnostic inputs. They must not be used to tune blindly for agreement.

## Release gate

### Proven

- Six videos decode and provide sampled pose coverage.
- Low-confidence camera views suppress camera-specific comparisons.
- Rules enforce view, reliability, phase-confidence, sample-count, and temporal-coverage requirements.
- Zero findings is a valid output; the UI does not pad to three.
- Analyzer exports omit video and full pose frames.
- The reveal workflow blocks analyzer exposure until blind review completion.
- AI remains outside diagnosis and cannot add findings.

### Partially validated

- Camera-view estimation, phase ordering, and the corrected Address/Top regression on six limited clips.
- Measurement stability through synthetic tests and conservative confidence caps.
- Drill-to-movement traceability inside deterministic rules.

### Not yet validated

- Whether an experienced coach agrees with any top priority.
- Finding precision, priority ordering, phase accuracy, clarity, actionability, drill usefulness, missed-issue rate, and strength precision.
- Coverage across body types, skill levels, lighting, swing speeds, clubs, handedness, and high-frame-rate recordings.

### Unsupported

- Club-face angle, dynamic loft, true 3D club path, force/pressure, medical conclusions, or causal claims unsupported by measured evidence.

The coaching system must not be called validated until at least 20 completed swing reviews show zero unsupported high-confidence findings, at least 80% top-priority precision, at least 80% drill-to-movement usefulness, and median clarity/actionability scores of at least 4/5.

## Highest-impact next improvement

Collect a consented, rights-cleared set of at least 20–30 varied swings and have two experienced coaches complete the blinded workflow. Review the top-priority disagreements first. Tighten or withhold rules when disagreement traces to evidence, camera, or measurement limitations; do not tune rules merely to imitate one coach's style.
