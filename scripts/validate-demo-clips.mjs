import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rawDir = 'raw';
const outDir = 'demo-clips';
mkdirSync(outDir, { recursive: true });

function probe(path) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate,codec_name,pix_fmt:format=duration',
    '-of', 'json', path,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function frameRate(value) {
  if (!value || typeof value !== 'string') return 0;
  const [a, b = '1'] = value.split('/').map(Number);
  return b ? a / b : 0;
}

if (!existsSync(rawDir)) throw new Error('raw/ metadata is missing.');
const metadataFiles = readdirSync(rawDir).filter((name) => /^\d{2}-.+\.json$/.test(name)).sort();
if (!metadataFiles.length) throw new Error('No clip metadata found for validation.');

const results = [];
let failed = false;
for (const metadataFile of metadataFiles) {
  const metadata = JSON.parse(readFileSync(join(rawDir, metadataFile), 'utf8'));
  const path = join(outDir, metadata.filename);
  const errors = [];
  if (!existsSync(path)) {
    errors.push('missing file');
  } else if (statSync(path).size <= 0) {
    errors.push('zero-byte file');
  }
  let info = null;
  if (!errors.length) {
    try {
      info = probe(path);
      const stream = info.streams?.[0] ?? {};
      const duration = Number(info.format?.duration ?? 0);
      const fps = frameRate(stream.avg_frame_rate || stream.r_frame_rate);
      if (stream.codec_name !== 'h264') errors.push(`codec ${stream.codec_name}, expected h264`);
      if (stream.width !== 1920) errors.push(`width ${stream.width}, expected 1920`);
      if (stream.height !== 1080) errors.push(`height ${stream.height}, expected 1080`);
      if (stream.pix_fmt !== 'yuv420p') errors.push(`pixel format ${stream.pix_fmt}, expected yuv420p`);
      if (fps < 29.5 || fps > 30.5) errors.push(`fps ${fps.toFixed(3)}, expected ~30`);
      if (duration < Number(metadata.minDurationSec)) errors.push(`duration ${duration.toFixed(2)}s below ${metadata.minDurationSec}s minimum`);
      if (duration > Number(metadata.maxDurationSec)) errors.push(`duration ${duration.toFixed(2)}s above ${metadata.maxDurationSec}s maximum`);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (errors.length) failed = true;
  results.push({ filename: metadata.filename, errors, probe: info });
}

writeFileSync(join(outDir, 'validation.json'), `${JSON.stringify({ valid: !failed, results }, null, 2)}\n`, 'utf8');
if (failed) {
  for (const result of results.filter((item) => item.errors.length)) console.error(`${result.filename}: ${result.errors.join('; ')}`);
  process.exit(1);
}
console.log(`Validated ${results.length} clip(s): H.264, 1920x1080, ~30fps, yuv420p, duration bounds, decodable.`);
