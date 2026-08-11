# DHU-Golf/detect audit

Audited commit: `0cba693cd4b5172a613048691a106a5f1b4a1235` (2022-10-17).

## Reused ideas

- SwingNet / CBAM-SwingNet event landmarks for phase-aware analysis.
- VideoPose3D camera-coordinate normalization concepts.
- PoseFormer as an optional future 2D-to-3D lifting adapter.
- DTW alignment of normalized pose sequences.
- The `badframe` idea: retain the aligned frame with the largest stable deviation so a finding can jump to evidence.
- Separate raw video, pose points, phase labels, grades, and visual output.

## Replaced components

- Hard-coded `PROJECT_ROOT` paths and shell-script orchestration.
- Python 3.8, PyTorch 1.7, CUDA 11, Detectron2, and PyQt5 runtime lock-in.
- Single PE4 “perfect swing” comparison.
- Whole-skeleton Euclidean distance presented without observability or confidence.
- Start/end thresholding with a fixed `0.15` displacement cutoff.
- Silent exception handling around missing model weights and corrupt frames.

## Baseline verification

- All Python sources compile under the available Python 3.13 interpreter (one invalid-escape warning in the legacy GUI).
- The documented GUI entry point fails immediately because `cv2` is absent and the pinned dependency stack is not compatible with the available runtime.
- VideoPose3D and PoseFormer require external checkpoints not included in the repository.
- The repository has no top-level license file. The nested GolfDB README states CC BY-NC 4.0 for that code; bundled video/data rights must be reviewed separately.

The new app uses adapters and versioned schemas so event, pose, reference, or coaching providers can be upgraded independently.
