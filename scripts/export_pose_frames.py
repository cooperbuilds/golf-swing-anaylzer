"""Export MediaPipe pose frames for the TypeScript evidence-pipeline evaluator.

This is a local diagnostic bridge, not a second coaching implementation. It
matches the browser sampling schedule and leaves phase segmentation,
measurement extraction, comparisons, and diagnosis to the production TS code.
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


def sample_count(duration_ms: float) -> int:
    target_rate = 15 if duration_ms <= 12_000 else 10
    return max(36, min(480, round(duration_ms / 1000 * target_rate)))


def point(value: object) -> dict[str, float]:
    return {
        "x": float(value.x),
        "y": float(value.y),
        "z": float(value.z),
        "visibility": float(value.visibility or 0.5),
    }


def pixel_quality(bgr: np.ndarray) -> tuple[float, float, float]:
    height = max(90, round(160 * bgr.shape[0] / max(bgr.shape[1], 1)))
    resized = cv2.resize(bgr, (160, height), interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB).astype(np.float32) / 255
    luminance = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    average = float(np.mean(luminance))
    contrast = float(np.std(luminance))
    center = luminance[1:-1, 1:-1]
    laplacian = (
        4 * center
        - luminance[1:-1, :-2]
        - luminance[1:-1, 2:]
        - luminance[:-2, 1:-1]
        - luminance[2:, 1:-1]
    )
    sharpness = float(np.sum(laplacian**2) / luminance.size)
    return average, contrast, sharpness


def export_video(
    path: Path,
    landmarker: vision.PoseLandmarker,
    timestamp_offset: int,
) -> dict[str, object]:
    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise RuntimeError(f"Could not decode {path}")
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    duration_ms = frame_count / max(fps, 1) * 1000
    total = sample_count(duration_ms)
    times = np.linspace(0, max(duration_ms - 2, 0), total)
    frames: list[dict[str, object]] = []
    qualities: list[tuple[float, float, float]] = []
    quality_times = np.linspace(duration_ms / 24, duration_ms * 23 / 24, 12)
    quality_index = 0
    try:
        for frame_index, time_ms in enumerate(times):
            capture.set(cv2.CAP_PROP_POS_MSEC, float(time_ms))
            ok, bgr = capture.read()
            if not ok:
                continue
            while quality_index < len(quality_times) and time_ms >= quality_times[quality_index]:
                qualities.append(pixel_quality(bgr))
                quality_index += 1
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
            timestamp = timestamp_offset + round(float(time_ms))
            result = landmarker.detect_for_video(image, timestamp)
            if not result.pose_landmarks:
                continue
            landmarks = result.pose_landmarks[0]
            if len(landmarks) != 33:
                continue
            world = result.pose_world_landmarks[0] if result.pose_world_landmarks else None
            points = [point(value) for value in landmarks]
            frames.append({
                "frameIndex": frame_index,
                "timeMs": float(time_ms),
                "landmarks": points,
                "worldLandmarks": [point(value) for value in world] if world and len(world) == 33 else None,
                "meanVisibility": float(np.mean([value["visibility"] for value in points])),
            })
    finally:
        capture.release()
    while len(qualities) < 12 and frames:
        qualities.append((0.5, 0.18, 0.08))
    means = np.mean(np.array(qualities), axis=0) if qualities else np.array([0.5, 0.0, 0.0])
    return {
        "path": str(path),
        "metadata": {
            "name": path.name,
            "sizeBytes": path.stat().st_size,
            "durationMs": duration_ms,
            "width": width,
            "height": height,
            "orientation": "square" if width == height else "horizontal" if width > height else "vertical",
            "fps": fps or None,
            "fpsSource": "container" if fps else "unavailable",
        },
        "pixelQuality": {
            "brightness": float(means[0]),
            "contrast": float(means[1]),
            "sharpness": float(means[2]),
        },
        "requestedSamples": total,
        "poseFrames": frames,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
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
        videos = [
            export_video(path.resolve(), landmarker, index * 1_000_000)
            for index, path in enumerate(args.videos)
        ]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps({"schemaVersion": 1, "videos": videos}), encoding="utf-8")
    print(json.dumps([
        {
            "file": video["metadata"]["name"],
            "requestedSamples": video["requestedSamples"],
            "poseFrames": len(video["poseFrames"]),
        }
        for video in videos
    ], indent=2))


if __name__ == "__main__":
    main()
