import { classOf } from '../../src/sync/compare.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('classOf maps order keys to best-effort, sections to not-synced, rest to drift', () => {
  assert.equal(classOf('type'), 'drift');
  assert.equal(classOf('choices'), 'drift');
  assert.equal(classOf('fieldOrder'), 'best-effort');
  assert.equal(classOf('viewOrder'), 'best-effort');
  assert.equal(classOf('columnOrder'), 'best-effort');
  assert.equal(classOf('sortOrder'), 'best-effort');
  assert.equal(classOf('sections'), 'not-synced');
  assert.equal(classOf('somethingElse'), 'drift'); // default
});
