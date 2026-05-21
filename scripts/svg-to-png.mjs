import { chromium } from 'patchright-core';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const assetsDir = resolve(__dirname, '../packages/mcp-server/assets');

const targets = [
  { svg: 'banner.svg',       png: 'banner.png',       w: 900, h: 210 },
  { svg: 'architecture.svg', png: 'architecture.png', w: 900, h: 450 },
];

const browser = await chromium.launch({ headless: true });

for (const { svg, png, w, h } of targets) {
  const svgPath = resolve(assetsDir, svg);
  const pngPath = resolve(assetsDir, png);
  const svgContent = readFileSync(svgPath, 'utf8');
  const html = `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;overflow:hidden}</style></head><body>${svgContent}</body></html>`;

  const page = await browser.newPage();
  await page.setViewportSize({ width: w * 2, height: h * 2 });
  // deviceScaleFactor=2 gives retina-quality output at 2× the logical pixel size
  await page.emulateMedia({ colorScheme: 'dark' });
  const htmlScaled = html.replace('<body>', `<body style="transform-origin:top left;transform:scale(2)">`);
  await page.setContent(htmlScaled, { waitUntil: 'networkidle' });
  await page.screenshot({ path: pngPath, clip: { x: 0, y: 0, width: w * 2, height: h * 2 } });
  await page.close();
  console.log(`✓ ${png}`);
}

await browser.close();
