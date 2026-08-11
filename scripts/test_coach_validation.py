from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.coach_validation import BLIND_FIELDS, prepare, read_csv, reveal, score, write_csv


class CoachValidationWorkflowTests(unittest.TestCase):
    def test_blind_review_must_be_complete_before_reveal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "swing.mp4"; video.write_bytes(b"private test swing")
            manifest, blind = prepare([video], root / "study")
            analyzer = root / "swing-analyzer-validation.json"
            analyzer.write_text(json.dumps({"videoName": "swing.mp4", "topIssues": [], "strengths": []}), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "conclusions remain sealed"):
                reveal(manifest, blind, [analyzer], root / "reconciliation.csv")
            self.assertFalse(any("analyzer" in field for field in read_csv(blind)[0]))

    def test_completed_review_scores_supported_priority_and_drill(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            video = root / "swing.mp4"; video.write_bytes(b"private test swing")
            manifest, blind = prepare([video], root / "study")
            blind_rows = read_csv(blind)
            blind_rows[0].update({"coach_id": "coach-a", "coach_issue_1": "tempo", "coach_phase_1": "Transition", "independent_review_complete": "yes", "blind_review_completed_at": "2026-08-10T00:00:00Z"})
            write_csv(blind, BLIND_FIELDS, blind_rows)
            analyzer = root / "swing-analyzer-validation.json"
            analyzer.write_text(json.dumps({
                "videoName": "swing.mp4", "cameraView": "face-on", "cameraConfidence": .9, "globalConfidence": .8,
                "topIssues": [{"id": "tempo-outlier", "title": "Tempo outside range", "confidence": .8, "priority": "medium", "phase": "Transition", "evidence": [{"measured": "1.8:1"}], "drill": "Count cadence", "drillMapping": {"relationship": "Targets cadence"}}],
                "strengths": [],
            }), encoding="utf-8")
            reconciliation = root / "reconciliation.csv"
            reveal(manifest, blind, [analyzer], reconciliation)
            rows = read_csv(reconciliation)
            rows[0].update({
                "analyzer_issue_1_detection": "supported", "analyzer_issue_1_priority": "top-three-worthy",
                "analyzer_issue_1_timing": "correct", "analyzer_issue_1_agreement": "agree",
                "analyzer_issue_1_drill_verdict": "targets-movement", "clarity_score_1_to_5": "5",
                "actionability_score_1_to_5": "4", "reconciliation_complete": "yes",
            })
            write_csv(reconciliation, list(rows[0]), rows)
            result = score(reconciliation)
            self.assertEqual(result["top_priority_precision"], 1)
            self.assertEqual(result["drill_usefulness"], 1)
            self.assertEqual(result["release_gate"], "insufficient-sample")


if __name__ == "__main__":
    unittest.main()
