import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rawDir = 'raw';
const outDir = 'demo-clips';
const frameDir = 'contact-sheets';
const keepRaw = (process.env.KEEP_RAW_WEBM ?? 'true').toLowerCase() === 'true';

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? 'unknown'}`);
}

if (!existsSync(rawDir)) throw new Error('raw/ does not exist; no Playwright recordings were produced.');
mkdirSync(outDir, { recursive: true });
mkdirSync(frameDir, { recursive: true });

const metadataFiles = readdirSync(rawDir).filter((name) => /^\d{2}-.+\.json$/.test(name)).sort();
if (!metadataFiles.length) throw new Error('No raw clip metadata files were produced.');

const generated = [];
for (const metadataFile of metadataFiles) {
  const metadata = JSON.parse(readFileSync(join(rawDir, metadataFile), 'utf8'));
  const rawPath = join(rawDir, metadata.rawFilename);
  const outputPath = join(outDir, metadata.filename);
  if (!existsSync(rawPath)) throw new Error(`Missing raw recording ${rawPath}.`);
  const seek = Math.max(0, Number(metadata.trimStartSec) + 0.08).toFixed(3);
  const duration = Math.max(0.1, Number(metadata.durationSec) - 0.08).toFixed(3);
  run('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-ss', seek, '-i', rawPath, '-t', duration,
    '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,fps=30',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    outputPath,
  ]);
  const midpoint = (Number(duration) / 2).toFixed(3);
  const framePath = join(frameDir, metadata.filename.replace(/\.mp4$/i, '.png'));
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', midpoint, '-i', outputPath, '-frames:v', '1', framePath]);
  generated.push(outputPath);
  if (!keepRaw) rmSync(rawPath);
}

if (generated.length) {
  const concatFile = join(outDir, 'preview-concat.txt');
  writeFileSync(concatFile, generated.map((path) => `file '${basename(path).replaceAll("'", "'\\''")}'`).join('\n') + '\n', 'utf8');
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', '-movflags', '+faststart', 'demo-preview.mp4']);
  rmSync(concatFile);
}

console.log(`Processed ${generated.length} clip(s). Raw WebM retention: ${keepRaw ? 'enabled' : 'disabled'}.`);
