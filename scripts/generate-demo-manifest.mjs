import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const rawDir = 'raw';
const outDir = 'demo-clips';
const manifestJson = 'capture-manifest.json';
const manifestMd = 'capture-manifest.md';

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
if (!sidecars.length) throw new Error('No generated clip sidecars were found.');

const clips = sidecars.map((sidecar) => {
  const capture = JSON.parse(readFileSync(join(rawDir, sidecar), 'utf8'));
  const outputPath = join(outDir, capture.filename);
  if (!existsSync(outputPath)) throw new Error(`Missing processed clip ${outputPath}.`);
  const info = probe(outputPath);
  const stream = info.streams?.[0] ?? {};
  const duration = Number(info.format?.duration ?? 0);
  return {
    filename: capture.filename,
    status: 'GENERATED',
    purpose: capture.purpose,
    durationSec: Number(duration.toFixed(3)),
    resolution: `${stream.width}x${stream.height}`,
    frameRate: stream.avg_frame_rate,
    codec: stream.codec_name,
    pixelFormat: stream.pix_fmt,
    bytes: statSync(outputPath).size,
    sourceCommit: capture.sourceCommit,
    fixture: capture.fixture,
    actionsShown: capture.actions,
    webmcpToolsInvoked: capture.webmcpTools,
    engineeringOperations: capture.engineering,
    benchmarkNumbersVisible: capture.benchmarkNumbers ?? [],
    generatedAutomatically: true,
    manualCaptureRequired: false,
    fakeOrSimulatedProductState: capture.fakeOrSimulatedProductState ?? 'NONE',
  };
});

const manualClip = {
  filename: '08-manual-chatgpt-webmcp.mp4',
  status: 'MANUAL_CAPTURE_REQUIRED',
  purpose: 'Optional real ChatGPT/WebMCP interface proof. Never generated or imitated by CI.',
  targetDurationSec: '10–15',
  generatedAutomatically: false,
  manualCaptureRequired: true,
  fakeOrSimulatedProductState: 'NONE',
  recipe: [
    'Open InfraTwin through the actual supported ChatGPT/WebMCP browsing environment.',
    'Select a link in InfraTwin.',
    'Prompt: “What am I looking at?” and capture the agent identifying the exact selected link.',
    'Prompt: “Add it to the maintenance plan.” and capture the visible InfraTwin ChangePlan update.',
    'Keep only a concise 10–15 second real authorized-interface shot.',
  ],
};

const totalCombinedRawDurationSec = Number(clips.reduce((sum, clip) => sum + clip.durationSec, 0).toFixed(3));
const manifest = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA ?? clips[0]?.sourceCommit ?? 'local',
  captureSet: process.env.CAPTURE_SET ?? 'all',
  format: { container: 'MP4', codec: 'H.264', width: 1920, height: 1080, fps: 30, pixelFormat: 'yuv420p', faststart: true, crf: 19, audio: false },
  clips,
  optionalManualClips: [manualClip],
  totalCombinedRawDurationSec,
  productStatePolicy: 'All shown engineering state is generated through real product interactions, deterministic analysis/optimization, and native WebMCP where listed. No fake product state is inserted.',
};

writeFileSync(manifestJson, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const lines = [
  '# InfraTwin demo capture manifest',
  '',
  `- Source commit: \`${manifest.sourceCommit}\``,
  `- Capture set: \`${manifest.captureSet}\``,
  `- Generated clips: **${clips.length}**`,
  `- Combined generated duration: **${totalCombinedRawDurationSec.toFixed(2)} s**`,
  '- Format: H.264 MP4, 1920×1080, 30 fps, yuv420p, faststart, CRF 19, silent',
  '- Fake/simulated product state: **NONE**',
  '',
];
for (const clip of clips) {
  lines.push(`## ${clip.filename}`, '', `**Purpose:** ${clip.purpose}`, '', `- Status: ${clip.status}`, `- Duration: ${clip.durationSec.toFixed(2)} s`, `- Resolution: ${clip.resolution}`, `- Fixture: ${clip.fixture}`, `- Source commit: \`${clip.sourceCommit}\``, `- Automatically generated: ${clip.generatedAutomatically ? 'yes' : 'no'}`, `- Fake/simulated product state: ${clip.fakeOrSimulatedProductState}`, `- WebMCP: ${clip.webmcpToolsInvoked.length ? clip.webmcpToolsInvoked.map((name) => `\`${name}\``).join(', ') : 'none'}`, `- Engineering: ${clip.engineeringOperations.join('; ')}`, `- Actions shown: ${clip.actionsShown.join('; ')}`, `- Benchmark numbers visible: ${clip.benchmarkNumbersVisible.length ? clip.benchmarkNumbersVisible.join('; ') : 'none'}`, '');
}
lines.push('## 08-manual-chatgpt-webmcp.mp4', '', '**Status: MANUAL_CAPTURE_REQUIRED**', '', 'CI intentionally does not imitate the ChatGPT interface. If this optional shot is wanted, record it from the real authorized ChatGPT/WebMCP environment:', '');
manualClip.recipe.forEach((step, index) => lines.push(`${index + 1}. ${step}`));
lines.push('', 'Target duration: 10–15 s.', '');
writeFileSync(manifestMd, `${lines.join('\n')}\n`, 'utf8');

console.log(`Wrote ${manifestJson} and ${manifestMd}; ${clips.length} generated clips total ${totalCombinedRawDurationSec.toFixed(2)} s.`);
