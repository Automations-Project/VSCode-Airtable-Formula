import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// mcp-internal-airtable has no dist/ — it ships as ESM source (src/index.js).
// We resolve its package.json to find the package root, then copy src/ wholesale.
const pkgJsonPath = require.resolve('mcp-internal-airtable/package.json');
const pkgRoot     = path.dirname(pkgJsonPath);
const srcDir      = path.join(pkgRoot, 'src');
const destDir     = path.resolve(__dirname, '../packages/extension/dist/mcp');

async function copyDir(src, dest) {
  await fs.promises.mkdir(dest, { recursive: true });
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.promises.copyFile(srcPath, destPath);
    }
  }
}

await copyDir(srcDir, destDir);

console.log(`✓ MCP server copied: ${srcDir} → ${destDir}`);
