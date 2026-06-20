import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, resolvePolicy, isDeleting } from '../../src/sync/policy.js';

describe('policy.resolvePolicy', () => {
  it('defaults to overlay when nothing specified', () => {
    assert.deepEqual(resolvePolicy(undefined, undefined, 'X'), { extras: 'keep', conflicts: 'source-wins' });
  });
  it('uses the global preset for non-overridden tables', () => {
    assert.deepEqual(resolvePolicy('mirror', { Games: 'preserve' }, 'Offers'), { extras: 'remove', conflicts: 'source-wins' });
  });
  it('per-table override wins over global', () => {
    assert.deepEqual(resolvePolicy('mirror', { Games: 'preserve' }, 'Games'), { extras: 'keep', conflicts: 'dest-wins' });
  });
  it('unknown preset falls back to overlay (safe)', () => {
    assert.deepEqual(resolvePolicy('bogus', undefined, 'X'), PRESETS.overlay);
  });
});

describe('policy.isDeleting', () => {
  it('false when global+overrides all keep', () => {
    assert.equal(isDeleting('overlay', { Games: 'preserve' }), false);
  });
  it('true when global mirror', () => {
    assert.equal(isDeleting('mirror', undefined), true);
  });
  it('true when an override mirrors even if global keeps', () => {
    assert.equal(isDeleting('overlay', { Games: 'mirror' }), true);
  });
});
