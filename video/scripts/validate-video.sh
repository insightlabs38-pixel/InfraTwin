#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VIDEO="${1:-$ROOT/output/InfraTwin-final-demo.mp4}"
python - "$VIDEO" <<'PY'
import json, subprocess, sys
path = sys.argv[1]
result = subprocess.run([
    'ffprobe','-v','error',
    '-show_entries','format=duration,size:stream=codec_name,codec_type,width,height,pix_fmt,avg_frame_rate,sample_rate,channels',
    '-of','json', path
], capture_output=True, text=True, check=True)
data = json.loads(result.stdout)
video = next(stream for stream in data['streams'] if stream['codec_type'] == 'video')
audio = next((stream for stream in data['streams'] if stream['codec_type'] == 'audio'), None)
duration = float(data['format']['duration'])
num, den = video['avg_frame_rate'].split('/')
fps = float(num) / float(den)
errors = []
if video['codec_name'] != 'h264': errors.append('video codec != h264')
if (video.get('width'), video.get('height')) != (1920, 1080): errors.append('resolution != 1920x1080')
if video.get('pix_fmt') != 'yuv420p': errors.append('pixel format != yuv420p')
if not (29.5 <= fps <= 30.5): errors.append(f'fps {fps} not ~30')
if duration >= 180: errors.append(f'duration {duration:.3f} >= 180 sec')
if duration > 165: errors.append(f'duration {duration:.3f} > target hard gate 165 sec')
if audio is None: errors.append('audio stream missing')
if audio and audio.get('codec_name') != 'aac': errors.append('audio codec != aac')
print(json.dumps({
    'video': path,
    'duration': duration,
    'video_stream': video,
    'audio_stream': audio,
    'valid': not errors,
    'errors': errors,
}, indent=2))
if errors:
    raise SystemExit(1)
PY
