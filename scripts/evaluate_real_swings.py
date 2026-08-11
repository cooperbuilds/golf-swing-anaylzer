"""Repeatable observability/segmentation evaluation on real swing videos.

This harness does not grade swing faults without coach labels. It measures the
boundaries that can be checked automatically: decode, pose coverage, landmark
visibility, image quality, camera-view support, and ordered phase anchors.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python
from mediapipe.tasks.python import vision


def evaluate(video_path: Path, landmarker: vision.PoseLandmarker, samples: int, timestamp_offset: int = 0) -> dict[str, object]:
    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        return {"file": video_path.name, "decode_error": "Video could not be opened", "automatic_gate": "review"}
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration = frame_count / fps if fps > 0 else 0
    indices = np.linspace(0, max(frame_count - 1, 0), min(samples, max(frame_count, 1)), dtype=int)
    poses: list[dict[str, object]] = []
    brightness: list[float] = []
    sharpness: list[float] = []
    for sample_index, frame_index in enumerate(indices):
        capture.set(cv2.CAP_PROP_POS_FRAMES, int(frame_index))
        ok, bgr = capture.read()
        if not ok:
            continue
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        brightness.append(float(gray.mean() / 255))
        sharpness.append(float(cv2.Laplacian(gray, cv2.CV_64F).var()))
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
        timestamp = int(frame_index / max(fps, 1) * 1000)
        result = landmarker.detect_for_video(image, timestamp_offset + timestamp)
        if not result.pose_landmarks:
            continue
        landmarks = result.pose_landmarks[0]
        poses.append({
            "time_ms": timestamp,
            "sample_index": sample_index,
            "points": [[float(point.x), float(point.y), float(point.visibility or 0)] for point in landmarks],
            "visibility": float(np.mean([point.visibility or 0 for point in landmarks])),
        })
    capture.release()
    view, view_confidence = infer_view(poses)
    anchors = segment_anchors(poses, int(duration * 1000))
    pose_coverage = len(poses) / max(len(indices), 1)
    mean_visibility = float(np.mean([pose["visibility"] for pose in poses])) if poses else 0
    return {
        "file": video_path.name,
        "width": width,
        "height": height,
        "fps": round(fps, 2),
        "duration_s": round(duration, 2),
        "samples": len(indices),
        "poses": len(poses),
        "pose_coverage": round(pose_coverage, 3),
        "mean_visibility": round(mean_visibility, 3),
        "mean_brightness": round(float(np.mean(brightness)) if brightness else 0, 3),
        "mean_laplacian_variance": round(float(np.mean(sharpness)) if sharpness else 0, 1),
        "camera_view": view,
        "camera_confidence": round(view_confidence, 3),
        "ordered_phase_anchors": anchors is not None,
        "anchor_times_ms": anchors,
        "automatic_gate": "pass" if pose_coverage >= 0.8 and mean_visibility >= 0.62 and anchors else "review",
    }


def infer_view(poses: list[dict[str, object]]) -> tuple[str, float]:
    ratios: list[float] = []
    for pose in poses:
        points = pose["points"]
        left_shoulder, right_shoulder, left_hip, right_hip = (points[index] for index in (11, 12, 23, 24))
        if min(left_shoulder[2], right_shoulder[2], left_hip[2], right_hip[2]) < 0.55:
            continue
        shoulder_width = np.hypot(left_shoulder[0] - right_shoulder[0], left_shoulder[1] - right_shoulder[1])
        shoulder_mid = ((left_shoulder[0] + right_shoulder[0]) / 2, (left_shoulder[1] + right_shoulder[1]) / 2)
        hip_mid = ((left_hip[0] + right_hip[0]) / 2, (left_hip[1] + right_hip[1]) / 2)
        torso = max(float(np.hypot(shoulder_mid[0] - hip_mid[0], shoulder_mid[1] - hip_mid[1])), 1e-6)
        ratios.append(float(shoulder_width / torso))
    if len(ratios) < 5:
        return "unknown", 0.25
    ratio = float(np.mean(ratios))
    if ratio >= 0.72:
        return "face-on", min(1, 0.55 + (ratio - 0.72) * 0.9)
    if ratio <= 0.56:
        return "down-the-line", min(1, 0.55 + (0.56 - ratio) * 1.4)
    return "unknown", 0.35


def segment_anchors(poses: list[dict[str, object]], duration_ms: int) -> dict[str, int] | None:
    if len(poses) < 12:
        return None
    hands = np.array([[(pose["points"][15][0] + pose["points"][16][0]) / 2, (pose["points"][15][1] + pose["points"][16][1]) / 2] for pose in poses])
    times = np.array([pose["time_ms"] for pose in poses])
    elapsed = np.maximum(np.diff(times) / 1000, 1 / 240)
    torso_scales = np.array([torso_scale(pose) for pose in poses])
    wrist_visibility = np.array([min(pose["points"][15][2], pose["points"][16][2]) for pose in poses])
    elbows = np.array([[((pose["points"][13][0] + pose["points"][14][0]) / 2), ((pose["points"][13][1] + pose["points"][14][1]) / 2)] for pose in poses])
    elbow_visibility = np.array([min(pose["points"][13][2], pose["points"][14][2]) for pose in poses])
    top_points = elbows
    top_visibility = elbow_visibility
    scales = np.maximum((torso_scales[:-1] + torso_scales[1:]) / 2, 1e-6)
    interval_speed = np.linalg.norm(np.diff(hands, axis=0), axis=1) / scales / elapsed
    interval_speed[np.minimum(wrist_visibility[:-1], wrist_visibility[1:]) < .58] = 0
    speeds = np.concatenate([[0], interval_speed])
    threshold = np.percentile(speeds, 68)
    active = np.where(speeds >= threshold * 0.42)[0]
    provisional_start = max(0, int(active[0] if active.size else 1) - 2)
    raw_finish = min(len(poses) - 1, int(active[-1] if active.size else len(poses) - 2) + 2)
    broad_top = find_top_index(top_points, times, top_visibility, torso_scales, provisional_start, raw_finish)
    provisional_address = find_address_index(hands, times, speeds, torso_scales, broad_top, provisional_start)
    top_start = min(raw_finish - 2, provisional_address + max(1, int((raw_finish - provisional_address) * .12)))
    top_end = max(top_start + 1, provisional_address + int((raw_finish - provisional_address) * .72))
    top_end = min(raw_finish - 1, top_end)
    top = find_refined_top(hands, times, torso_scales, provisional_address, top_start, top_end)
    start = find_address_index(hands, times, speeds, torso_scales, top, provisional_address)
    impact_start = min(raw_finish - 1, top + 1)
    impact_end = max(impact_start, int(np.searchsorted(times, min(times[raw_finish], times[top] + 1600), side="right") - 1))
    impact_end = min(impact_end, raw_finish)
    address_hand = hands[start]
    scores = []
    for index in range(impact_start, impact_end + 1):
        points = poses[index]["points"]
        hip_y = (points[23][1] + points[24][1]) / 2
        scores.append(float(np.linalg.norm(hands[index] - address_hand) + abs(hands[index, 1] - hip_y) * 0.25))
    impact = impact_start + int(np.argmin(scores))
    latest_finish = min(len(poses) - 1, int(np.searchsorted(times, times[impact] + 2500, side="right") - 1))
    local_active = active[(active > impact) & (active <= latest_finish)]
    finish = min(len(poses) - 1, max(impact + 1, min(raw_finish, int(local_active[-1] if local_active.size else latest_finish) + 2)))
    names = ["Address", "Takeaway", "Backswing", "Top", "Transition", "Downswing", "Impact", "Follow-through", "Finish"]
    address_time, top_time, impact_time, finish_time = (float(times[index]) for index in (start, top, impact, finish))
    anchor_times = [address_time, address_time + (top_time - address_time) * .28, address_time + (top_time - address_time) * .68, top_time, top_time + (impact_time - top_time) * .2, top_time + (impact_time - top_time) * .62, impact_time, impact_time + (finish_time - impact_time) * .48, finish_time]
    if any(anchor_times[index] <= anchor_times[index - 1] for index in range(1, len(anchor_times))):
        return None
    anchors = {name: int(value) for name, value in zip(names, anchor_times, strict=True)}
    return anchors if anchors["Finish"] <= duration_ms + 100 else None


def find_refined_top(hands: np.ndarray, times: np.ndarray, scales: np.ndarray, address: int, start: int, end: int) -> int:
    for index in range(start, end + 1):
        local_start = max(address, int(np.searchsorted(times, times[index] - 400, side="left")))
        local_end = min(len(hands) - 1, int(np.searchsorted(times, times[index] + 400, side="right") - 1))
        current_height = hands[index, 1]
        if current_height > float(np.min(hands[local_start:local_end + 1, 1])) + scales[index] * .03:
            continue
        after_end = min(len(hands) - 1, int(np.searchsorted(times, times[index] + 800, side="right") - 1))
        ascent = max(float(np.max(hands[address:index, 1] - current_height) / scales[index]), 0) if index > address else 0
        descent = max(float(np.max(hands[index + 1:after_end + 1, 1] - current_height) / scales[index]), 0) if after_end > index else 0
        if ascent >= .25 and descent >= .35:
            return index
    return start + int(np.argmin(hands[start:end + 1, 1]))


def find_top_index(hands: np.ndarray, times: np.ndarray, visibility: np.ndarray, scales: np.ndarray, fallback_start: int, fallback_end: int) -> int:
    best_index = -1
    best_score = 0.0
    latest_candidate = min(len(hands) - 3, fallback_end - 2)
    for index in range(1, latest_candidate + 1):
        if visibility[index] < .35:
            continue
        before_start = int(np.searchsorted(times, times[index] - 2000, side="left"))
        after_end = min(len(hands) - 1, int(np.searchsorted(times, times[index] + 1600, side="right") - 1))
        if before_start >= index or after_end <= index:
            continue
        local_start = int(np.searchsorted(times, times[index] - 250, side="left"))
        local_end = min(len(hands) - 1, int(np.searchsorted(times, times[index] + 250, side="right") - 1))
        if hands[index, 1] > float(np.min(hands[local_start:local_end + 1, 1])) + scales[index] * .08:
            continue
        ascent = max(float(np.max(hands[before_start:index, 1] - hands[index, 1]) / scales[index]), 0)
        descent = max(float(np.max(hands[index + 1:after_end + 1, 1] - hands[index, 1]) / scales[index]), 0)
        if ascent < .24 or descent < .24:
            continue
        score = min(ascent, descent) * visibility[index]
        if ascent >= .45 and descent >= .55:
            return index
        if score > best_score:
            best_score = score
            best_index = index
    if best_index >= 0:
        return best_index
    start = max(1, min(len(hands) - 3, fallback_start))
    end = max(start + 1, min(len(hands) - 2, fallback_end))
    return start + int(np.argmin(hands[start:end + 1, 1]))


def torso_scale(pose: dict[str, object]) -> float:
    points = pose["points"]
    shoulders = np.mean(np.array([points[11][:2], points[12][:2]], dtype=float), axis=0)
    hips = np.mean(np.array([points[23][:2], points[24][:2]], dtype=float), axis=0)
    return max(float(np.linalg.norm(shoulders - hips)), 1e-6)


def find_address_index(hands: np.ndarray, times: np.ndarray, speeds: np.ndarray, scales: np.ndarray, top: int, fallback: int) -> int:
    if top < 3:
        return fallback
    speed_scale = max(float(np.percentile(speeds, 90)), .03)
    address_height_floor = float(np.percentile(hands[:top, 1], 62))
    for index in range(top - 2, -1, -1):
        if hands[index, 1] < address_height_floor:
            continue
        previous = speeds[(times >= times[index] - 300) & (times <= times[index])]
        if previous.size and float(previous.mean()) > speed_scale * .32:
            continue
        end = min(top, int(np.searchsorted(times, min(times[top], times[index] + 750), side="right") - 1))
        departure = max((float(np.linalg.norm(hands[next_index] - hands[index]) / scales[index]) for next_index in range(index + 1, end + 1)), default=0)
        if departure >= .1:
            return index
    return fallback


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", type=Path)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    options = vision.PoseLandmarkerOptions(
        base_options=python.BaseOptions(model_asset_path=str(args.model.resolve())),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        results = [evaluate(path.resolve(), landmarker, args.samples, index * 1_000_000) for index, path in enumerate(args.videos)]
    report = {"schemaVersion": 1, "cases": results, "passed": sum(case["automatic_gate"] == "pass" for case in results), "total": len(results), "limitations": ["No swing fault is scored without an independent coach label.", "This Python harness mirrors observability and phase heuristics; browser rendering is verified separately."]}
    rendered = json.dumps(report, indent=2)
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered)


if __name__ == "__main__":
    main()
