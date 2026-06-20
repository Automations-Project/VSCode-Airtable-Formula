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

import { validateFieldMappings } from '../../src/sync/policy.js';

describe('policy.validateFieldMappings', () => {
  const src = { tables: [{ id: 'tS', name: 'Offers', fields: [
    { id: 'fCode', name: 'Code', type: 'autoNumber' },
    { id: 'fLinks', name: 'Links', type: 'multipleRecordLinks' },
  ] }] };
  const dst = { tables: [{ id: 'tD', name: 'Offers', fields: [
    { id: 'dInject', name: 'InjectID', type: 'number' },
    { id: 'dFormula', name: 'PK', type: 'formula' },
  ] }] };

  it('resolves a valid computed-source → scalar-dest mapping to field ids', () => {
    const { errors, resolved } = validateFieldMappings(src, dst, { Offers: { Code: 'InjectID' } });
    assert.deepEqual(errors, []);
    assert.deepEqual(resolved, [{ table: 'Offers', srcFieldId: 'fCode', destFieldId: 'dInject', destType: 'number' }]);
  });
  it('FIELD_MAP_TABLE_MISSING when the table is absent in a base', () => {
    const { errors } = validateFieldMappings(src, dst, { Nope: { Code: 'InjectID' } });
    assert.equal(errors[0].code, 'FIELD_MAP_TABLE_MISSING');
  });
  it('FIELD_MAP_SOURCE_MISSING when source field absent', () => {
    const { errors } = validateFieldMappings(src, dst, { Offers: { Ghost: 'InjectID' } });
    assert.equal(errors[0].code, 'FIELD_MAP_SOURCE_MISSING');
  });
  it('FIELD_MAP_TARGET_MISSING when dest field absent', () => {
    const { errors } = validateFieldMappings(src, dst, { Offers: { Code: 'Ghost' } });
    assert.equal(errors[0].code, 'FIELD_MAP_TARGET_MISSING');
  });
  it('FIELD_MAP_TARGET_COMPUTED when dest field is a formula', () => {
    const { errors } = validateFieldMappings(src, dst, { Offers: { Code: 'PK' } });
    assert.equal(errors[0].code, 'FIELD_MAP_TARGET_COMPUTED');
  });
  it('FIELD_MAP_TYPE_INCOMPATIBLE when source is an array/link type', () => {
    const { errors } = validateFieldMappings(src, dst, { Offers: { Links: 'InjectID' } });
    assert.equal(errors[0].code, 'FIELD_MAP_TYPE_INCOMPATIBLE');
  });
  it('FIELD_MAP_TYPE_INCOMPATIBLE when source is multipleSelects', () => {
    const srcMulti = { tables: [{ id: 'tS', name: 'Offers', fields: [
      { id: 'fCode', name: 'Code', type: 'autoNumber' },
      { id: 'fMulti', name: 'Tags', type: 'multipleSelects' },
    ] }] };
    const { errors } = validateFieldMappings(srcMulti, dst, { Offers: { Tags: 'InjectID' } });
    assert.equal(errors[0].code, 'FIELD_MAP_TYPE_INCOMPATIBLE');
  });
  it('FIELD_MAP_COLLISION when two sources target the same dest field', () => {
    const src2 = { tables: [{ id: 'tS', name: 'Offers', fields: [
      { id: 'fa', name: 'A', type: 'text' }, { id: 'fb', name: 'B', type: 'text' },
    ] }] };
    const { errors } = validateFieldMappings(src2, dst, { Offers: { A: 'InjectID', B: 'InjectID' } });
    assert.ok(errors.some((e) => e.code === 'FIELD_MAP_COLLISION'));
  });
});
