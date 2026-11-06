// node --test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { checkBundleSize } from './check-bundle-size.mjs';

function dist(files) {
  const dir = mkdtempSync(join(tmpdir(), 'bundle-'));
  mkdirSync(join(dir, 'assets'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}
const big = 'x'.repeat(50_000) + Math.random();   // gzips to a few hundred bytes; the random tail keeps runs distinct

test('record writes the baseline from the current build', () => {
  const d = dist({ 'assets/main.js': big, 'assets/vendor.js': big, 'index.css': 'body{}' });
  const baseline = join(d, 'baseline.json');
  const r = checkBundleSize({ distDir: d, baselinePath: baseline, record: true });
  assert.equal(r.ok, true);
  const b = JSON.parse(readFileSync(baseline, 'utf8'));
  assert.equal(b.gzipJsBytes, r.gzipBytes);
  assert.equal(b.toleranceBytes, 1024);
});

test('passes when the bundle is equal or smaller', () => {
  const d = dist({ 'assets/main.js': big });
  const baseline = join(d, 'baseline.json');
  checkBundleSize({ distDir: d, baselinePath: baseline, record: true });
  writeFileSync(join(d, 'assets/main.js'), 'y'.repeat(1000));
  assert.equal(checkBundleSize({ distDir: d, baselinePath: baseline, record: false }).ok, true);
});

test('fails when the bundle grows past the tolerance', () => {
  const d = dist({ 'assets/main.js': big });
  const baseline = join(d, 'baseline.json');
  checkBundleSize({ distDir: d, baselinePath: baseline, record: true });
  writeFileSync(join(d, 'assets/extra.js'), Array.from({ length: 20_000 }, () => Math.random().toString(36)).join(''));
  const r = checkBundleSize({ distDir: d, baselinePath: baseline, record: false });
  assert.equal(r.ok, false);
  assert.match(r.message, /pnpm bundle:record/);
});

test('fails closed when the baseline is missing', () => {
  const d = dist({ 'assets/main.js': big });
  const r = checkBundleSize({ distDir: d, baselinePath: join(d, 'nope.json'), record: false });
  assert.equal(r.ok, false);
});

test('fails closed when the dist has no JavaScript', () => {
  const d = dist({ 'index.css': 'body{}' });
  const baseline = join(d, 'baseline.json');
  assert.throws(() => checkBundleSize({ distDir: d, baselinePath: baseline, record: true }), /no \.js/i);
});
