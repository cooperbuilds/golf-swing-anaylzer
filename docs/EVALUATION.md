# Real-swing evaluation workflow

Compilation and pose detection are necessary but not sufficient. Evaluation is split into two gates.

## Automatic observability gate

Run the same pose model across varied, rights-cleared swing clips and record decode success, pose coverage, landmark visibility, lighting, sharpness, camera-view support, and ordered phase anchors:

```powershell
.\.venv\Scripts\python.exe scripts\evaluate_real_swings.py <video1> <video2> --model .cache\pose_landmarker_lite.task --samples 24
```

A case passes automatically only when pose coverage is at least 80%, mean visibility is at least 0.62, and all nine phase anchors remain ordered. Passing this gate does not validate a coaching diagnosis.

## Coach-reviewed usefulness gate

Maintain a consented test set covering face-on/down-the-line views, handedness, clubs, body types, frame rates, lighting, and known faults. For each clip, two independent qualified coaches should record:

- whether each reported priority is supported, unsupported, or indeterminate;
- whether the highlighted phase/frame is correct within an agreed tolerance;
- whether the explanation is understandable without biomechanical jargon;
- whether the prescribed drill addresses the validated movement pattern;
- whether an important visible issue was missed.

Release acceptance requires zero unsupported high-confidence findings, at least 80% precision for the top priority, and median coach ratings of at least 4/5 for clarity and actionability. Recall is secondary: withholding a weak claim is preferred to inventing one.

The bundled upstream clips can exercise decoding and observability, but their rights and fault labels are not sufficient for product-level coaching validation. Do not use them as diagnostic ground truth.

Use the enforced blind/reveal workflow in [VALIDATION_REPORT.md](VALIDATION_REPORT.md). `scripts/coach_validation.py reveal` will not expose analyzer conclusions until each independent review is marked complete and timestamped.

## Current automatic results

Six existing real swing clips were sampled at up to 120 timestamps each using the MediaPipe Lite CPU model. All six decoded, produced poses at every sampled frame, and produced strictly ordered nine-phase anchors. Mean landmark visibility ranged from 0.779 to 0.908. Camera estimation identified four down-the-line and two face-on clips; one face-on estimate remained below the 0.58 compatibility gate, so camera-specific reference matching is withheld for that case.

The former `Address = 0 ms` result was investigated. It was partly exaggerated by 24-frame sampling but exposed a real onset bug when setup waggles occurred before takeaway. The corrected detector finds a stable address before a complete swing excursion, then refines Top and Impact inside that swing window. None of the six higher-rate runs now anchors Address at 0 ms, and the problem clips' key frames were visually spot-checked. These results validate observability, ordering, and this specific regression on a small set; they do not validate coach-level semantic phase accuracy, fault precision, body-type coverage, browser club tracking, or drill quality.
