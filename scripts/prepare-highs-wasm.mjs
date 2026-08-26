import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const entry = fileURLToPath(import.meta.resolve('highs'));
const candidates = [
  join(dirname(entry), 'highs.wasm'),
  join(dirname(entry), 'build', 'highs.wasm'),
  join(dirname(dirname(entry)), 'build', 'highs.wasm'),
];
let source = null;
for (const candidate of candidates) {
  try { await stat(candidate); source = candidate; break; } catch {}
}
if (!source) throw new Error(`Could not locate highs.wasm near ${entry}`);
const targetDir = new URL('../apps/web/public/solver-assets/', import.meta.url);
await mkdir(targetDir, { recursive: true });
await copyFile(source, new URL('highs.wasm', targetDir));
console.log(`Prepared HiGHS WASM asset from ${source}`);
