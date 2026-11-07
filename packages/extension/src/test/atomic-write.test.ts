import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { withFileLock, writeTextAtomic } from '../auto-config/atomic-write.js';

describe('withFileLock', () => {
  const tick = () => new Promise(r => setTimeout(r, 5));

  it('runs calls with one key one at a time, in order; a failure does not stop the next', async () => {
    const log: string[] = [];
    const step = (name: string, fail = false) => async () => {
      log.push(`${name} start`);
      await tick();
      log.push(`${name} end`);
      if (fail) throw new Error(name);
      return name;
    };
    const results = await Promise.allSettled([withFileLock('k', step('a')), withFileLock('k', step('b', true)), withFileLock('k', step('c'))]);
    expect(log).toEqual(['a start', 'a end', 'b start', 'b end', 'c start', 'c end']);
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
  });

  it('runs calls with different keys at once', async () => {
    const log: string[] = [];
    const step = (name: string) => async () => { log.push(`${name} start`); await tick(); log.push(`${name} end`); };
    await Promise.all([withFileLock('x', step('x')), withFileLock('y', step('y'))]);
    expect(log.slice(0, 2).sort()).toEqual(['x start', 'y start']);
  });
});

// H10 — writeTextAtomic uses unique tmp paths
describe('writeTextAtomic', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'airtable-atomic-'));
  });
  afterEach(() => {
    fs.rmSync(sandbox, { recursive: true, force: true });
  });

  it('writes a fresh file', async () => {
    const target = path.join(sandbox, 'config.json');
    await writeTextAtomic(target, JSON.stringify({ foo: 'bar' }));
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ foo: 'bar' });
  });

  it('overwrites an existing file atomically', async () => {
    const target = path.join(sandbox, 'config.json');
    fs.writeFileSync(target, '{"old": true}');
    await writeTextAtomic(target, JSON.stringify({ new: true }));
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toEqual({ new: true });
  });

  it('concurrent writes never corrupt the target with interleaved output', async () => {
    const target = path.join(sandbox, 'config.json');
    // Before the H10 fix the two writes would share the same `.tmp` suffix and one could truncate
    // the other's output. With unique tmp paths that can no longer happen.
    //
    // On Windows, concurrent rename() onto the same target can fail with EPERM (one wins, the loser
    // sees "file in use"). That is a Windows limitation, not an H10 regression; we verify "target
    // ends up with ONE writer's payload, never a corrupted blob" via allSettled, not Promise.all.
    const results = await Promise.allSettled([
      writeTextAtomic(target, JSON.stringify({ writer: 'a' })),
      writeTextAtomic(target, JSON.stringify({ writer: 'b' })),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);

    const final = JSON.parse(fs.readFileSync(target, 'utf8'));
    expect(['a', 'b']).toContain(final.writer);

    // The loser must clean up its tmp on failure.
    expect(fs.readdirSync(sandbox).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('cleans up the tmp file when the rename fails', async () => {
    // A non-empty directory at the target name makes rename(tmp, target) fail.
    const target = path.join(sandbox, 'target');
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, 'sentinel'), 'x');

    await expect(writeTextAtomic(target, '{}')).rejects.toThrow();

    expect(fs.readdirSync(sandbox).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('creates the file with mode 0600 on POSIX', async () => {
    if (process.platform === 'win32') return;
    const target = path.join(sandbox, 'config.json');
    await writeTextAtomic(target, '{}\n');
    expect(fs.statSync(target).mode & 0o777).toBe(0o600);
  });
});
