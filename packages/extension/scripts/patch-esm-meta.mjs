/**
 * Post-build patch for prettier v3 (pure ESM) bundled into the CJS extension.
 *
 * Problem: tsup/esbuild compiles ESM `import.meta` as `var import_meta = {}`
 * in CJS output. prettier/index.mjs calls `createRequire(import.meta.url)` at
 * the top level, so `createRequire(undefined)` throws at extension load time,
 * crashing the extension before activate() is ever reached.
 *
 * Fix: replace the empty `import_meta` stub with one that has a valid `.url`
 * pointing to the bundle file itself. `require2` (the result of createRequire)
 * is dead code in the bundle — it's defined but never called — so the exact URL
 * doesn't matter; we just need createRequire to not throw.
 */
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const bundlePath = join(__dir, '..', 'dist', 'extension.js');

let src = readFileSync(bundlePath, 'utf8');

const oldMeta = 'var import_meta = {};';
const newMeta = 'var import_meta = { url: require("url").pathToFileURL(__filename).href };';

const count = (src.match(/var import_meta = \{\};/g) ?? []).length;
if (count === 0) {
  console.log('[patch-esm-meta] No patch needed.');
  process.exit(0);
}

src = src.replaceAll(oldMeta, newMeta);
writeFileSync(bundlePath, src, 'utf8');
console.log(`[patch-esm-meta] Patched ${count} import_meta stub(s) in dist/extension.js`);
