import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import * as path from 'node:path';

const require_ = createRequire(import.meta.url);
const VENDOR = path.join(__dirname, '..', 'vendor');

const BeautifierV2 = require_(path.join(VENDOR, 'formula-beautifier-v2.js'));
const MinifierV2 = require_(path.join(VENDOR, 'formula-minifier-v2.js'));
const BeautifierV1 = require_(path.join(VENDOR, 'formula-beautifier.js'));
const MinifierV1 = require_(path.join(VENDOR, 'formula-minifier.js'));

/** Compare ignoring only whitespace — casing and token content must survive. */
const squash = (s: string) => s.replace(/\s+/g, '');

describe('v2 tokenizer is case-insensitive (formulas must not lose function names)', () => {
  // Airtable function names are case-insensitive. The v2 tokenizers matched
  // /[A-Z_]/ with no /i flag, so lowercase characters fell through to the
  // operator catch-all and were DELETED. The output still parsed, so the
  // try/catch never fired and format-on-save wrote the corrupted text to disk.
  const cases = [
    'lower({Email})',
    'IF({A},lower({B}),0)',
    'if({A},1,0)',
    'If({A},1,0)',
    'UPPER({Name})',
    'concatenate({A},{B})',
  ];

  for (const src of cases) {
    it(`beautify preserves every token of ${src}`, () => {
      const out = new BeautifierV2().beautify(src);
      expect(squash(out)).toBe(squash(src));
    });

    it(`minify preserves every token of ${src}`, () => {
      const out = new MinifierV2().minify(src);
      expect(squash(out)).toBe(squash(src));
    });
  }

  it('does not rewrite the casing the user typed', () => {
    expect(new BeautifierV2().beautify('lower({A})')).toContain('lower');
    expect(new MinifierV2().minify('If({A},1,0)')).toContain('If');
  });
});

describe('v1 tokenizer always advances (unrecognized char must not hang)', () => {
  // The identifier fallback was the only branch with no unconditional advance:
  // a character matched by no branch matched zero chars, left `i` unmoved, and
  // spun the outer loop allocating until V8 aborted — killing the extension
  // host. It now throws, so the callers' existing try/catch returns the
  // original text instead.
  const hostile = ['IF({A};1)', 'IF({A}%1)', 'IF({A}[1])', 'IF({A}“1”)'];

  for (const src of hostile) {
    it(`v1 beautify terminates on ${JSON.stringify(src)}`, () => {
      // Either it formats or it throws — the one unacceptable outcome is hanging.
      let settled = false;
      try {
        new BeautifierV1().beautify(src);
        settled = true;
      } catch {
        settled = true;
      }
      expect(settled).toBe(true);
    });

    it(`v1 minify terminates on ${JSON.stringify(src)}`, () => {
      let settled = false;
      try {
        new MinifierV1().minify(src);
        settled = true;
      } catch {
        settled = true;
      }
      expect(settled).toBe(true);
    });
  }
});
