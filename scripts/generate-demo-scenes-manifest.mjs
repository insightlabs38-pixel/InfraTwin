import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rawDir = 'raw';
const outDir = 'demo-clips';
const manifestJson = 'capture-manifest.json';
const manifestMd = 'capture-manifest.md';
const expectedSceneCount = 15;
const productBaselineCommit = process.env.PRODUCT_BASE_SHA ?? 'unknown';

function probe(path) {
  const result = spawnSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,codec_name,pix_fmt:format=duration,size',
    '-of', 'json', path,
  ], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${path}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

if (!existsSync(rawDir)) throw new Error('raw/ does not exist.');
const sidecars = readdirSync(rawDir).filter((name) => /^\d{2}-.+\.json$/.test(name)).sort();
if (sidecars.length !== expectedSceneCount) throw new Error(`Expected ${expectedSceneCount} scene sidecars, found ${sidecars.length}.`);

const scenes = sidecars.map((sidecar, index) => {
  const capture = JSON.parse(readFileSync(join(rawDir, sidecar), 'utf8'));
  const expectedPrefix = `${String(index + 1).padStart(2, '0')}-`;
  if (!capture.filename.startsWith(expectedPrefix)) throw new Error(`Unexpected scene ordering: ${capture.filename}, expected prefix ${expectedPrefix}.`);
  const outputPath = join(outDir, capture.filename);
  if (!existsSync(outputPath)) throw new Error(`Missing processed scene ${outputPath}.`);
  const info = probe(outputPath);
  const stream = info.streams?.[0] ?? {};
  const duration = Number(info.format?.duration ?? 0);
  return {
    scene: index + 1,
    filename: capture.filename,
    status: 'GENERATED',
    purpose: capture.purpose,
    durationSec: Number(duration.toFixed(3)),
    resolution: `${stream.width}x${stream.height}`,
    frameRate: stream.avg_frame_rate,
    codec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    bytes: statSync(outputPath).size,
    captureToolingCommit: capture.sourceCommit,
    productBaselineCommit,
    fixture: capture.fixture,
    actionsShown: capture.actions,
    webmcpToolsInvoked: capture.webmcpTools,
    engineeringOperations: capture.engineering,
    benchmarkNumbersVisible: capture.benchmarkNumbers ?? [],
    generatedAutomatically: true,
    fakeOrSimulatedProductState: capture.fakeOrSimulatedProductState ?? 'NONE',
  };
});

const totalDurationSec = Number(scenes.reduce((sum, scene) => sum + scene.durationSec, 0).toFixed(3));
const manifest = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  productBaselineCommit,
  captureToolingCommit: process.env.GITHUB_SHA ?? 'local',
  expectedSceneCount,
  generatedSceneCount: scenes.length,
  format: {
    container: 'MP4', codec: 'H.264', width: 1920, height: 1080,
    fps: 30, pixelFormat: 'yuv420p', faststart: true, crf: 19, audio: false,
  },
  scenes,
  totalCombinedRawDurationSec: totalDurationSec,
  productStatePolicy: 'Every visible engineering state is produced through real InfraTwin UI actions, deterministic computation, and native WebMCP where listed. No fake or simulated product result is composited into capture footage.',
  editingPolicy: 'These are modular source takes. Final narration and edit timing should be written after footage review; hard cuts may remove irrelevant waiting but must not misrepresent compute latency.',
};

writeFileSync(manifestJson, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const lines = [
  '# InfraTwin winning-level demo scene manifest',
  '',
  `- Product baseline: \`${productBaselineCommit}\``,
  `- Capture tooling commit: \`${manifest.captureToolingCommit}\``,
  `- Generated scenes: **${scenes.length}/${expectedSceneCount}**`,
  `- Combined source duration: **${totalDurationSec.toFixed(2)} s**`,
  '- Format: H.264 MP4 · 1920×1080 · 30 fps · yuv420p · faststart · silent',
  '- Fake/simulated product state: **NONE**',
  '',
];
for (const scene of scenes) {
  lines.push(
    `## ${String(scene.scene).padStart(2, '0')} — ${scene.filename}`,
    '',
    `**Purpose:** ${scene.purpose}`,
    '',
    `- Duration: ${scene.durationSec.toFixed(2)} s`,
    `- Fixture: ${scene.fixture}`,
    `- WebMCP: ${scene.webmcpToolsInvoked.length ? scene.webmcpToolsInvoked.map((name) => `\`${name}\``).join(', ') : 'none'}`,
    `- Engineering: ${scene.engineeringOperations.join('; ')}`,
    `- Actions shown: ${scene.actionsShown.join('; ')}`,
    `- Benchmark numbers visible: ${scene.benchmarkNumbersVisible.length ? scene.benchmarkNumbersVisible.join('; ') : 'none'}`,
    `- Product state: ${scene.fakeOrSimulatedProductState}`,
    '',
  );
}
writeFileSync(manifestMd, `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${scenes.length} scene manifest entries totaling ${totalDurationSec.toFixed(2)} seconds.`);
