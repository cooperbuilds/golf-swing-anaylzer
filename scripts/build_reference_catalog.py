"""Build a video-free GolfDB timing reference catalog.

This script reads the upstream GolfDB annotation MAT file. It writes only
metadata and derived, normalized event timing. It never copies or downloads a
source video. Run it from the repository root:

    .venv/Scripts/python scripts/build_reference_catalog.py --source path/to/golfDB.mat
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from scipy.io import loadmat


EVENT_NAMES = [
    "address",
    "toe_up",
    "mid_backswing",
    "top",
    "mid_downswing",
    "impact",
    "mid_follow_through",
    "finish",
]


def scalar(value: Any) -> Any:
    while isinstance(value, np.ndarray) and value.size == 1:
        value = value.reshape(-1)[0]
    return value.item() if isinstance(value, np.generic) else value


def text(value: Any) -> str:
    return str(scalar(value)).strip()


def timing_metrics(events: list[int]) -> dict[str, float]:
    anchors = events[1:-1]
    if len(anchors) != 8:
        return {}
    address, toe_up, _, top, mid_down, impact, _, finish = anchors
    total = max(finish - address, 1)
    downswing = max(impact - top, 1)
    return {
        "timing_takeaway_pct": round((toe_up - address) / total * 100, 4),
        "timing_backswing_pct": round((top - address) / total * 100, 4),
        "tempo_ratio": round((top - address) / downswing, 4),
        "timing_transition_pct": round((mid_down - top) / total * 100, 4),
        "timing_impact_pct": round((impact - address) / total * 100, 4),
        "timing_follow_through_pct": round((finish - impact) / total * 100, 4),
    }


def build(source: Path, catalog_path: Path, summary_path: Path) -> None:
    raw = loadmat(source)["golfDB"][0]
    catalog: list[dict[str, Any]] = []
    grouped: dict[tuple[str, str, str], dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

    for row in raw:
        fields = list(row)
        source_id = text(fields[1])
        events = [int(item) for item in np.asarray(fields[7]).reshape(-1)]
        metrics = timing_metrics(events)
        view = text(fields[5])
        club = text(fields[4]).lower()
        sex = "female" if text(fields[3]).lower().startswith("f") else "male"
        record = {
            "id": f"golfdb-{int(scalar(fields[0])):04d}",
            "sourceFingerprint": hashlib.sha256(source_id.encode("utf-8")).hexdigest()[:16],
            "player": text(fields[2]),
            "sex": sex,
            "club": club,
            "view": view,
            "slowMotion": bool(int(scalar(fields[6]))),
            "eventFrames": dict(zip(EVENT_NAMES, events[1:-1], strict=True)),
            "timing": metrics,
            "license": "CC-BY-NC-4.0 research use; source-video rights remain with uploaders",
            "videoStored": False,
            "eligibleMetrics": sorted(metrics),
        }
        catalog.append(record)
        for key, value in metrics.items():
            grouped[(view, club, sex)][key].append(value)
            grouped[(view, club, "mixed")][key].append(value)
            grouped[(view, "all", "mixed")][key].append(value)

    summaries: list[dict[str, Any]] = []
    units = {"tempo_ratio": "x"}
    for (view, club, sex), metrics in sorted(grouped.items()):
        for key, values in sorted(metrics.items()):
            if len(values) < 12:
                continue
            summaries.append({
                "metricKey": key,
                "phase": "Whole swing",
                "p10": round(float(np.percentile(values, 10)), 4),
                "median": round(float(np.percentile(values, 50)), 4),
                "p90": round(float(np.percentile(values, 90)), 4),
                "unit": units.get(key, "%"),
                "sampleCount": len(values),
                "view": view,
                "club": club,
                "sex": sex,
                "provenance": "GolfDB 1,400 professional swing annotations; normalized event timing only",
            })

    catalog_path.parent.mkdir(parents=True, exist_ok=True)
    catalog_path.write_text(json.dumps({
        "schemaVersion": 1,
        "source": "GolfDB (McNally et al., CVPR Workshops 2019)",
        "licenseNote": "No videos are stored. This derived catalog is intended for noncommercial research under the upstream CC BY-NC statement. Verify source-video rights before any commercial use.",
        "records": catalog,
    }, separators=(",", ":")), encoding="utf-8")
    summary_path.write_text(json.dumps({"schemaVersion": 1, "ranges": summaries}, indent=2), encoding="utf-8")
    print(f"Wrote {len(catalog)} video-free records and {len(summaries)} timing ranges")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--catalog", type=Path, default=Path("src/data/golfdb-reference-catalog.json"))
    parser.add_argument("--summary", type=Path, default=Path("src/data/golfdb-reference-summary.json"))
    args = parser.parse_args()
    build(args.source.resolve(), args.catalog, args.summary)


if __name__ == "__main__":
    main()
