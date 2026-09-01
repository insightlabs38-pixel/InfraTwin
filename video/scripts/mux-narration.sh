#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIDEO="$ROOT/output/InfraTwin-final-demo-no-audio.mp4"
AUDIO="${1:-$ROOT/public/narration.wav}"
OUT="${2:-$ROOT/output/InfraTwin-final-demo.mp4}"
if [[ ! -f "$AUDIO" ]]; then
  echo "Narration file not found: $AUDIO" >&2
  echo "Usage: $0 /path/to/narration.wav [output.mp4]" >&2
  exit 2
fi
ffmpeg -hide_banner -loglevel error -y \
  -i "$VIDEO" -i "$AUDIO" \
  -filter_complex "[1:a]apad=pad_dur=160,aresample=48000[a]" \
  -map 0:v:0 -map "[a]" -shortest \
  -c:v copy -c:a aac -b:a 192k -movflags +faststart "$OUT"
ffprobe -v error -show_entries format=duration:stream=codec_name,codec_type,sample_rate,channels -of json "$OUT"
echo "Wrote $OUT"
