import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { writeIfMissing, cursorWrap, checkAiFiles } from '../skills/installer.js';

const tmpDir = path.join(os.tmpdir(), 'airtable-test-' + Date.now());

beforeEach(() => fs.mkdirSync(tmpDir, { recursive: true }));
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

describe('writeIfMissing', () => {
  it('writes a new file and returns true', async () => {
    const file = path.join(tmpDir, 'skill.md');
    const wrote = await writeIfMissing(file, 'content', false);
    expect(wrote).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('content');
  });

  it('does not overwrite existing file when force=false, returns false', async () => {
    const file = path.join(tmpDir, 'skill.md');
    fs.writeFileSync(file, 'original');
    const wrote = await writeIfMissing(file, 'new content', false);
    expect(wrote).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('original');
  });

  it('overwrites existing file when force=true, returns true', async () => {
    const file = path.join(tmpDir, 'skill.md');
    fs.writeFileSync(file, 'original');
    const wrote = await writeIfMissing(file, 'new content', true);
    expect(wrote).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('new content');
  });
});

describe('cursorWrap', () => {
  it('wraps content with YAML frontmatter and glob', () => {
    const result = cursorWrap('body text', 'My description');
    expect(result).toMatch(/^---\n/);
    expect(result).toContain('description: "My description"');
    expect(result).toContain('globs: ["**/*.formula"]');
    expect(result).toContain('body text');
  });
});

describe('checkAiFiles', () => {
  it('returns "missing" for all when no files exist', async () => {
    const result = await checkAiFiles('windsurf', tmpDir);
    expect(result.skills).toBe('missing');
    expect(result.rules).toBe('missing');
  });

  it('returns "ok" for present files', async () => {
    const skillPath = path.join(tmpDir, '.windsurf', 'skills', 'airtable-formula.md');
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, 'skill');
    const result = await checkAiFiles('windsurf', tmpDir);
    expect(result.skills).toBe('ok');
  });
});
