# Multi-video analysis sessions

SwingLab treats every uploaded file as an independent observation first:

`video → decode/quality → pose → phases → measurements → references → deterministic findings`

Only completed per-video results enter session aggregation. A failed or unsuitable file remains visible with its reason and cannot block usable files.

## Relationship classification

Each usable pair is classified as:

- `same-swing-likely`: complementary supported views, similar normalized nine-phase timing, similar duration, and capture timestamps within two minutes;
- `different-swings-likely`: two distinct files from the same supported camera view; or
- `uncertain`: an unsupported view or insufficient timing/capture agreement.

This is deliberately conservative. `same-swing-likely` means the videos may provide complementary evidence; it does not mean frames are synchronized. Users should use one complete swing per file.

## Evidence aggregation

- Measurements are never averaged across videos. For each metric, the session selects the highest-confidence `available` observation and records its source video and camera view.
- Unavailable and low-confidence measurements cannot become available through aggregation.
- A finding can receive a small, capped confidence increase only when the same deterministic finding already exists in another independently analyzed swing or in complementary supported views of a likely matching swing.
- Duplicate evidence inside one analysis and repeated upload identities are not counted as independent support.
- A base confidence below `0.70` remains below the application's high-confidence boundary after aggregation.
- Session priorities are re-ranked from existing per-video findings and may contain zero to three items. The session layer cannot create a new diagnosis.

Face-on and down-the-line observations remain view-specific. Multiple 2D videos do not provide true 3D biomechanics, club-face angle, force, pressure, or synchronized multi-camera reconstruction.

## Cache and history

Video cache identity hashes sampled file content, size, and media type rather than the filename, so renaming the same file does not force pose inference to run again. The legacy fingerprint remains a read fallback for existing browser caches.

New session records contain their observations, individual analyses, pair classifications, selected measurements, combined findings, and source-frame links. Existing schema-1/schema-2 single-video history continues to load alongside session history.
