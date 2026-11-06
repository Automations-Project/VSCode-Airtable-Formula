import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const dir = path.resolve(__dirname, '../skills/airtable-formula');
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? '';

describe('airtable-formula skill folder', () => {
  it('has standard frontmatter with the version placeholder', () => {
    expect(frontmatter).toMatch(/^name: airtable-formula$/m);
    expect(frontmatter).toMatch(/^license: MIT$/m);
    expect(frontmatter).toMatch(/^metadata:\n(?:  .+\n)*  version: 0\.0\.0-dev$/m);
    const description = frontmatter.match(/^description: >-\n((?:  .+\n?)+)/m)?.[1] ?? '';
    expect(description.trim().length).toBeGreaterThan(80);
    expect(description.trim().length).toBeLessThanOrEqual(1024);
    for (const word of ['Airtable', 'formula', '.formula', 'MCP']) expect(description).toContain(word);
  });

  it('references every file in references/ and nothing else', () => {
    const refs = fs.readdirSync(path.join(dir, 'references')).sort();
    expect(refs).toEqual(['functions.md', 'mcp-tools.md', 'rules.md', 'workflows.md']);
    for (const f of refs) expect(skill).toContain(`references/${f}`);
  });

  it('keeps the canonical tool-count line in mcp-tools.md', () => {
    const guide = fs.readFileSync(path.join(dir, 'references/mcp-tools.md'), 'utf8');
    expect(guide).toMatch(/\*\*Tools\*\*:\s*\d+ tools across \d+ categories/);
  });
});
