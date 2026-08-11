"""Blinded coach-validation workflow for SwingLab analyzer records.

The coach completes an independent review before `reveal` will expose any
analyzer conclusion. Videos remain in place; this tool stores paths and hashes
but never copies or redistributes media.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import statistics
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

PHASES = "Address|Takeaway|Backswing|Top|Transition|Downswing|Impact|Follow-through|Finish"
DISAGREEMENTS = "analyzer_incorrect|coach_interpretation_differs|insufficient_evidence|camera_limitation|measurement_limitation|analyzer_correctly_withheld|ambiguous_swing"
MIN_RELEASE_SWINGS = 20
BLIND_FIELDS = [
    "video_id", "video_file", "coach_id", "camera_view", "lighting", "body_visibility",
    "swing_speed", "skill_level", "swing_characteristics",
    "coach_issue_1", "coach_phase_1", "coach_issue_2", "coach_phase_2", "coach_issue_3", "coach_phase_3",
    "coach_notes", "independent_review_complete", "blind_review_completed_at",
]


def prepare(videos: list[Path], output_dir: Path, force: bool = False) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path = output_dir / "case_manifest.private.json"
    blind_path = output_dir / "coach_review_blind.csv"
    for path in (manifest_path, blind_path):
        if path.exists() and not force:
            raise ValueError(f"Refusing to overwrite {path}; pass --force only when replacement is intentional.")
    cases = []
    names: set[str] = set()
    for source in videos:
        resolved = source.resolve()
        if not resolved.is_file():
            raise ValueError(f"Video does not exist: {source}")
        folded = resolved.name.casefold()
        if folded in names:
            raise ValueError(f"Duplicate video filename {resolved.name}; filenames must be unique for analyzer-record matching.")
        names.add(folded)
        cases.append({
            "video_id": file_id(resolved),
            "video_file": resolved.name,
            "video_path": str(resolved),
            "size_bytes": resolved.stat().st_size,
        })
    manifest = {
        "schemaVersion": 1,
        "createdAt": now(),
        "privacy": "Local/private study manifest. Do not publish paths or videos without permission.",
        "cases": cases,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    write_csv(blind_path, BLIND_FIELDS, [{"video_id": case["video_id"], "video_file": case["video_file"]} for case in cases])
    return manifest_path, blind_path


def reveal(manifest_path: Path, blind_path: Path, analyzer_sources: list[Path], output_path: Path) -> Path:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    blind_rows = read_csv(blind_path)
    blind_by_id = {row["video_id"]: row for row in blind_rows}
    for case in manifest["cases"]:
        row = blind_by_id.get(case["video_id"])
        if not row or row.get("independent_review_complete", "").strip().casefold() != "yes":
            raise ValueError(f"Blind review for {case['video_id']} is incomplete. Analyzer conclusions remain sealed.")
        if not row.get("blind_review_completed_at", "").strip():
            raise ValueError(f"Blind review for {case['video_id']} needs a completion timestamp before reveal.")

    records = load_analyzer_records(analyzer_sources)
    by_name: dict[str, dict[str, Any]] = {}
    for record in records:
        name = str(record.get("videoName", "")).casefold()
        if not name or name in by_name:
            raise ValueError("Analyzer records must contain unique videoName values.")
        by_name[name] = record

    rows: list[dict[str, Any]] = []
    fields = reconciliation_fields()
    for case in manifest["cases"]:
        blind = blind_by_id[case["video_id"]]
        analyzer = by_name.get(case["video_file"].casefold())
        if not analyzer:
            raise ValueError(f"No analyzer record matched {case['video_file']}.")
        row: dict[str, Any] = {field: blind.get(field, "") for field in BLIND_FIELDS}
        row.update({
            "analyzer_camera_view": analyzer.get("cameraView", ""),
            "analyzer_camera_confidence": analyzer.get("cameraConfidence", ""),
            "analyzer_global_confidence": analyzer.get("globalConfidence", ""),
            "analyzer_finding_count": len(analyzer.get("topIssues", [])),
            "analyzer_strength_count": len(analyzer.get("strengths", [])),
        })
        for rank in range(1, 4):
            issue = item_at(analyzer.get("topIssues", []), rank - 1)
            row.update(flatten_issue(issue, rank))
            strength = item_at(analyzer.get("strengths", []), rank - 1)
            row.update(flatten_strength(strength, rank))
        rows.append(row)
    write_csv(output_path, fields, rows)
    return output_path


def score(reconciliation_path: Path | list[Path]) -> dict[str, Any]:
    paths = reconciliation_path if isinstance(reconciliation_path, list) else [reconciliation_path]
    rows = [row for path in paths for row in read_csv(path)]
    findings = []
    strengths = []
    clarity: list[float] = []
    actionability: list[float] = []
    detection_case_results: list[bool] = []
    for row in rows:
        clarity_value = score_value(row.get("clarity_score_1_to_5", ""))
        actionability_value = score_value(row.get("actionability_score_1_to_5", ""))
        if clarity_value is not None: clarity.append(clarity_value)
        if actionability_value is not None: actionability.append(actionability_value)
        case_detection_verdicts: list[str] = []
        for rank in range(1, 4):
            if row.get(f"analyzer_issue_{rank}_title", ""):
                case_detection_verdicts.append(row.get(f"analyzer_issue_{rank}_detection", ""))
                findings.append({
                    "rank": rank,
                    "confidence": number(row.get(f"analyzer_issue_{rank}_confidence", "")),
                    "detection": row.get(f"analyzer_issue_{rank}_detection", ""),
                    "priority": row.get(f"analyzer_issue_{rank}_priority", ""),
                    "timing": row.get(f"analyzer_issue_{rank}_timing", ""),
                    "agreement": row.get(f"analyzer_issue_{rank}_agreement", ""),
                    "drill": row.get(f"analyzer_issue_{rank}_drill_verdict", ""),
                })
            if row.get(f"analyzer_strength_{rank}_title", ""):
                strengths.append(row.get(f"analyzer_strength_{rank}_verdict", ""))
        resolved_case = [value for value in case_detection_verdicts if value in {"supported", "unsupported"}]
        if resolved_case: detection_case_results.append("supported" in resolved_case)

    resolved = [item for item in findings if item["detection"] in {"supported", "unsupported"}]
    supported = [item for item in resolved if item["detection"] == "supported"]
    top_resolved = [item for item in resolved if item["rank"] == 1 and item["priority"] in {"top-three-worthy", "real-but-lower-priority", "not-present"}]
    high_confidence = [item for item in findings if item["confidence"] is not None and item["confidence"] >= 0.75]
    high_false = [item for item in high_confidence if item["detection"] == "unsupported"]
    phase_resolved = [item for item in findings if item["timing"] in {"correct", "incorrect"}]
    drill_resolved = [item for item in findings if item["drill"] in {"targets-movement", "weak-link", "does-not-target"}]
    agreement_resolved = [item for item in findings if item["agreement"] in {"agree", "partial", "disagree"}]
    strength_resolved = [value for value in strengths if value in {"supported", "unsupported"}]
    complete_cases = sum(row.get("reconciliation_complete", "").strip().casefold() == "yes" for row in rows)

    return {
        "schemaVersion": 1,
        "generatedAt": now(),
        "swings": len(rows),
        "completed_reconciliations": complete_cases,
        "high_confidence_findings": len(high_confidence),
        "false_positives": metric(len([item for item in resolved if item["detection"] == "unsupported"]), bool(resolved)),
        "unsupported_high_confidence_findings": metric(len(high_false), bool(resolved)),
        "finding_precision": ratio(len(supported), len(resolved)),
        "detection_success": ratio(sum(detection_case_results), len(detection_case_results)),
        "top_priority_precision": ratio(sum(item["detection"] == "supported" and item["priority"] == "top-three-worthy" for item in top_resolved), len(top_resolved)),
        "phase_accuracy": ratio(sum(item["timing"] == "correct" for item in phase_resolved), len(phase_resolved)),
        "coach_agreement": ratio(sum(item["agreement"] in {"agree", "partial"} for item in agreement_resolved), len(agreement_resolved)),
        "median_clarity_1_to_5": metric(statistics.median(clarity) if clarity else None, bool(clarity)),
        "median_actionability_1_to_5": metric(statistics.median(actionability) if actionability else None, bool(actionability)),
        "drill_usefulness": ratio(sum(item["drill"] == "targets-movement" for item in drill_resolved), len(drill_resolved)),
        "strength_precision": ratio(sum(value == "supported" for value in strength_resolved), len(strength_resolved)),
        "release_gate": release_gate(len(high_false), top_resolved, clarity, actionability, drill_resolved, complete_cases),
        "note": "NOT YET VALIDATED means no completed independent coach judgment was available for that metric.",
    }


def reconciliation_fields() -> list[str]:
    fields = BLIND_FIELDS + ["analyzer_camera_view", "analyzer_camera_confidence", "analyzer_global_confidence", "analyzer_finding_count", "analyzer_strength_count"]
    for rank in range(1, 4):
        prefix = f"analyzer_issue_{rank}"
        fields += [f"{prefix}_{name}" for name in ("id", "title", "confidence", "priority_label", "phase", "evidence", "drill_text", "drill_relationship")]
        fields += [f"{prefix}_{name}" for name in ("detection", "priority", "timing", "agreement", "drill_verdict", "disagreement_category", "review_notes")]
        strength = f"analyzer_strength_{rank}"
        fields += [f"{strength}_{name}" for name in ("title", "confidence", "evidence", "verdict", "review_notes")]
    fields += ["missed_important_issue", "missed_issue_description", "clarity_score_1_to_5", "actionability_score_1_to_5", "reconciliation_complete", "reconciliation_completed_at"]
    return list(dict.fromkeys(fields))


def flatten_issue(issue: dict[str, Any], rank: int) -> dict[str, Any]:
    prefix = f"analyzer_issue_{rank}"
    if not issue: return {}
    return {
        f"{prefix}_id": issue.get("id", ""), f"{prefix}_title": issue.get("title", ""),
        f"{prefix}_confidence": issue.get("confidence", ""), f"{prefix}_priority_label": issue.get("priority", ""),
        f"{prefix}_phase": issue.get("phase", ""), f"{prefix}_evidence": json.dumps(issue.get("evidence", []), separators=(",", ":")),
        f"{prefix}_drill_text": issue.get("drill", ""), f"{prefix}_drill_relationship": (issue.get("drillMapping") or {}).get("relationship", ""),
    }


def flatten_strength(strength: dict[str, Any], rank: int) -> dict[str, Any]:
    prefix = f"analyzer_strength_{rank}"
    if not strength: return {}
    return {f"{prefix}_title": strength.get("title", ""), f"{prefix}_confidence": strength.get("confidence", ""), f"{prefix}_evidence": json.dumps(strength.get("evidence", []), separators=(",", ":"))}


def load_analyzer_records(sources: list[Path]) -> list[dict[str, Any]]:
    paths: list[Path] = []
    for source in sources:
        paths.extend(sorted(source.glob("*-analyzer-validation.json")) if source.is_dir() else [source])
    records = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
    if not records: raise ValueError("No analyzer validation records were found.")
    return records


def file_id(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""): digest.update(chunk)
    return f"swing-{digest.hexdigest()[:16]}"


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as stream: return list(csv.DictReader(stream))


def write_csv(path: Path, fields: list[str], rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, extrasaction="ignore")
        writer.writeheader(); writer.writerows(rows)


def item_at(items: list[dict[str, Any]], index: int) -> dict[str, Any]: return items[index] if index < len(items) else {}
def now() -> str: return datetime.now(timezone.utc).isoformat()
def number(value: str) -> float | None:
    try: return float(value)
    except (TypeError, ValueError): return None
def score_value(value: str) -> float | None:
    parsed = number(value); return parsed if parsed is not None and 1 <= parsed <= 5 else None
def metric(value: Any, available: bool) -> Any: return value if available else "NOT YET VALIDATED"
def ratio(numerator: int, denominator: int) -> float | str: return round(numerator / denominator, 3) if denominator else "NOT YET VALIDATED"


def release_gate(high_false: int, top_resolved: list[dict[str, Any]], clarity: list[float], actionability: list[float], drills: list[dict[str, Any]], complete: int) -> str:
    if complete == 0 or not top_resolved or not clarity or not actionability: return "NOT YET VALIDATED"
    if complete < MIN_RELEASE_SWINGS or len(top_resolved) < MIN_RELEASE_SWINGS or len(clarity) < MIN_RELEASE_SWINGS or len(actionability) < MIN_RELEASE_SWINGS: return "insufficient-sample"
    precision = sum(item["detection"] == "supported" and item["priority"] == "top-three-worthy" for item in top_resolved) / len(top_resolved)
    drill_usefulness = sum(item["drill"] == "targets-movement" for item in drills) / len(drills) if drills else 0
    return "pass" if high_false == 0 and precision >= 0.8 and statistics.median(clarity) >= 4 and statistics.median(actionability) >= 4 and drill_usefulness >= 0.8 else "fail"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare_parser = sub.add_parser("prepare")
    prepare_parser.add_argument("videos", nargs="+", type=Path); prepare_parser.add_argument("--output-dir", type=Path, required=True); prepare_parser.add_argument("--force", action="store_true")
    reveal_parser = sub.add_parser("reveal")
    reveal_parser.add_argument("--manifest", type=Path, required=True); reveal_parser.add_argument("--blind-review", type=Path, required=True); reveal_parser.add_argument("--analyzer-records", nargs="+", type=Path, required=True); reveal_parser.add_argument("--output", type=Path, required=True)
    score_parser = sub.add_parser("score")
    score_parser.add_argument("--reconciliation", nargs="+", type=Path, required=True); score_parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        manifest, blind = prepare(args.videos, args.output_dir, args.force); print(json.dumps({"manifest": str(manifest), "blind_review": str(blind), "warning": "Do not provide analyzer records to the coach before the blind review is complete."}, indent=2))
    elif args.command == "reveal":
        print(reveal(args.manifest, args.blind_review, args.analyzer_records, args.output))
    else:
        result = score(args.reconciliation); rendered = json.dumps(result, indent=2)
        if args.output: args.output.write_text(rendered, encoding="utf-8")
        print(rendered)


if __name__ == "__main__": main()
