#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIDEO="${1:-$ROOT/output/InfraTwin-final-demo.mp4}"
OUT="$ROOT/output/review-frames"
mkdir -p "$OUT"
for t in 5 14 22 34 50 67 78 102 118 128 142; do
  ffmpeg -hide_banner -loglevel error -y -ss "$t" -i "$VIDEO" -frames:v 1 "$OUT/$(printf '%03d' "$t")s.png"
done
# Extra QA frames covering title, performance, WebMCP crop, and final close.
for t in 1 93 124 152; do
  ffmpeg -hide_banner -loglevel error -y -ss "$t" -i "$VIDEO" -frames:v 1 "$OUT/extra-$(printf '%03d' "$t")s.png"
done
echo "Exported review frames to $OUT"
