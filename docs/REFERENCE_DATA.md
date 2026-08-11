# Reference data policy

The application separates reference metadata, derived features, and source video.

- `golfdb-reference-catalog.json` contains 1,400 GolfDB records with player, camera view, club, event anchors, and normalized timing features.
- It contains no source URLs and no video bytes. Source IDs are one-way hashed.
- Only timing measurements are eligible for comparison. The UI returns `no-coverage` for body angles, club position, and other metrics that the catalog does not contain.
- GolfDB does not provide a handedness field. The catalog therefore makes no right/left-handed claim and the current comparison never stratifies by handedness. A licensed corpus with explicit handedness labels is required before enabling that filter.
- GolfDB's repository states CC BY-NC 4.0 for its code. Its clips originate from YouTube. This catalog is therefore marked for noncommercial research, and commercial deployments must perform an independent rights review.
- Future licensed corpora can be added by producing the same `ReferenceRange` schema. The comparison engine does not depend on GolfDB-specific fields.

## Investigated additions

- **CaddieSet (CVPR Workshops 2025)** reports 924 swings, joint information, ball information, and 15 interpretable swing metrics. The paper is public, but a sufficiently clear distributable dataset license and stable official data package were not verified, so no CaddieSet records are bundled.
- **ClubheadDB** reports 10,180 hand-annotated down-the-line frames and publishes its package under CC BY-NC 4.0. Its reconstruction process downloads public YouTube and Reddit media. The analyzer does not download or redistribute those images; it only documents the dataset as a possible noncommercial training source after an independent rights review.
- No rights-cleared professional pose-exemplar corpus is bundled. The Pro Comparison interface uses GolfDB timing ranges and, when available, the golfer's own previous swing from the same camera view. Those are labeled separately.

References: [GolfDB](https://github.com/wmcnally/golfdb), [CaddieSet paper](https://openaccess.thecvf.com/content/CVPR2025W/CVSPORTS/html/Jung_CaddieSet_A_Golf_Swing_Dataset_with_Human_Joint_Features_and_CVPRW_2025_paper.html), [ClubheadDB package](https://pypi.org/project/clubhead-db/).

This conservative split is intentional: a public URL is not proof that a video may be redistributed or used commercially.
