import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AirtableClient } from '../src/client.js';

// Minimal mock auth that records calls and returns configurable responses
function createMockAuth(responses = {}) {
  const calls = [];
  const defaultResponse = {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '{}',
  };

  return {
    calls,
    getSecretSocketId: () => 'socTEST123',
    get(url, appId) {
      calls.push({ method: 'GET', url, appId });
      return responses.get?.(url) || { ...defaultResponse };
    },
    postForm(url, params, appId) {
      calls.push({ method: 'POST', url, params, appId, type: 'form' });
      return responses.postForm?.(url, params) || { ...defaultResponse };
    },
    postJSON(url, body, appId) {
      calls.push({ method: 'POST', url, body, appId, type: 'json' });
      return responses.postJSON?.(url, body) || { ...defaultResponse };
    },
  };
}

// Sample schema data matching Airtable's response shape
const MOCK_SCHEMA = {
  data: {
    tableSchemas: [
      {
        id: 'tblAAA',
        name: 'Tasks',
        columns: [
          { id: 'fld111', name: 'Name', type: 'text', typeOptions: {} },
          { id: 'fld222', name: 'Status', type: 'singleSelect', typeOptions: {} },
          { id: 'fld333', name: 'Formula', type: 'formula', typeOptions: { formulaText: '1+1' } },
        ],
        views: [
          { id: 'viw001', name: 'Grid view', type: 'grid' },
        ],
      },
      {
        id: 'tblBBB',
        name: 'Projects',
        columns: [
          { id: 'fld444', name: 'Project Name', type: 'text', typeOptions: {} },
        ],
        views: [],
      },
    ],
  },
};

describe('AirtableClient', () => {
  let mockAuth;
  let client;

  beforeEach(() => {
    mockAuth = createMockAuth({
      get: (url) => {
        if (url.includes('/read') || url.includes('getApplicationScaffoldingData')) {
          return {
            ok: true,
            status: 200,
            json: async () => MOCK_SCHEMA,
            text: async () => JSON.stringify(MOCK_SCHEMA),
          };
        }
        return { ok: true, status: 200, json: async () => ({}), text: async () => '{}' };
      },
    });
    client = new AirtableClient(mockAuth);
  });

  describe('resolveTable', () => {
    it('resolves table by ID', async () => {
      const table = await client.resolveTable('appXXX', 'tblAAA');
      assert.equal(table.id, 'tblAAA');
      assert.equal(table.name, 'Tasks');
    });

    it('resolves table by name', async () => {
      const table = await client.resolveTable('appXXX', 'Projects');
      assert.equal(table.id, 'tblBBB');
    });

    it('throws for unknown table', async () => {
      await assert.rejects(
        () => client.resolveTable('appXXX', 'Nonexistent'),
        { message: /Table "Nonexistent" not found/ },
      );
    });

    it('includes available tables in error message', async () => {
      await assert.rejects(
        () => client.resolveTable('appXXX', 'nope'),
        { message: /Tasks.*Projects/ },
      );
    });
  });

  describe('resolveField', () => {
    it('resolves field by ID and returns table context', async () => {
      const { field, table } = await client.resolveField('appXXX', 'fld222');
      assert.equal(field.id, 'fld222');
      assert.equal(field.name, 'Status');
      assert.equal(table.id, 'tblAAA');
    });

    it('finds field across tables', async () => {
      const { field, table } = await client.resolveField('appXXX', 'fld444');
      assert.equal(field.name, 'Project Name');
      assert.equal(table.id, 'tblBBB');
    });

    it('throws for unknown field', async () => {
      await assert.rejects(
        () => client.resolveField('appXXX', 'fldNOPE'),
        { message: /Field "fldNOPE" not found/ },
      );
    });
  });

  describe('deleteField safety guard', () => {
    it('refuses if expectedName does not match actual name', async () => {
      mockAuth.postForm = () => ({ ok: true, status: 200, json: async () => ({}) });

      await assert.rejects(
        () => client.deleteField('appXXX', 'fld222', 'WrongName'),
        { message: /Safety check failed.*"Status".*"WrongName"/ },
      );

      // Verify no POST was made (safety check prevented it)
      const postCalls = mockAuth.calls.filter(c => c.method === 'POST');
      assert.equal(postCalls.length, 0);
    });

    it('proceeds when expectedName matches and no deps', async () => {
      mockAuth.postForm = () => ({
        ok: true,
        status: 200,
        json: async () => ({ msg: 'SUCCESS', data: { actionId: 'actXXX' } }),
        text: async () => '{"msg":"SUCCESS"}',
      });

      const result = await client.deleteField('appXXX', 'fld222', 'Status');
      assert.equal(result.deleted, true);
      assert.equal(result.name, 'Status');
    });

    it('returns dependency info when deps found and force=false', async () => {
      let callCount = 0;
      mockAuth.postForm = () => {
        callCount++;
        // First call (checkSchemaDependencies) returns 422
        return {
          ok: false,
          status: 422,
          json: async () => ({
            error: {
              type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED',
              details: { applicationDependencyGraphEdgesBySourceObjectId: { fld222: [] } },
            },
          }),
          text: async () => 'dependency error',
        };
      };

      const result = await client.deleteField('appXXX', 'fld222', 'Status');
      assert.equal(result.deleted, false);
      assert.equal(result.hasDependencies, true);
      assert.equal(callCount, 1); // Only the check call, no force
    });

    it('force-deletes when deps found and force=true', async () => {
      let callCount = 0;
      mockAuth.postForm = () => {
        callCount++;
        if (callCount === 1) {
          // First call returns dependency error
          return {
            ok: false,
            status: 422,
            json: async () => ({
              error: {
                type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED',
                details: {},
              },
            }),
            text: async () => 'deps',
          };
        }
        // Second call succeeds
        return {
          ok: true,
          status: 200,
          json: async () => ({ msg: 'SUCCESS', data: { actionId: 'actXXX' } }),
          text: async () => '{"msg":"SUCCESS"}',
        };
      };

      const result = await client.deleteField('appXXX', 'fld222', 'Status', { force: true });
      assert.equal(result.deleted, true);
      assert.equal(result.forced, true);
      assert.equal(callCount, 2);
    });
  });

  describe('correct endpoints (verified against captured traffic)', () => {
    // Helper: override postForm while still tracking calls
    function trackingPostForm(fn) {
      mockAuth.postForm = (url, params, appId) => {
        mockAuth.calls.push({ method: 'POST', url, params, appId, type: 'form' });
        return fn(url, params, appId);
      };
    }

    it('renameField uses /updateName not /rename', async () => {
      trackingPostForm(() => ({
        ok: true, status: 200, json: async () => ({ msg: 'SUCCESS' }), text: async () => '{}',
      }));

      await client.renameField('appXXX', 'fld111', 'New Name');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/updateName'), `Expected /updateName, got ${postCall.url}`);
      assert.ok(!postCall.url.includes('/rename'), 'Should not use /rename');
    });

    it('deleteField uses /destroy not /delete', async () => {
      trackingPostForm(() => ({
        ok: true, status: 200,
        json: async () => ({ msg: 'SUCCESS' }),
        text: async () => '{}',
      }));

      await client.deleteField('appXXX', 'fld222', 'Status');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/destroy'), `Expected /destroy, got ${postCall.url}`);
      assert.ok(!postCall.url.includes('/delete'), 'Should not use /delete');
    });

    it('updateFieldConfig sends flat payload (not wrapped in config)', async () => {
      trackingPostForm(() => ({
        ok: true, status: 200, json: async () => ({ msg: 'SUCCESS' }), text: async () => '{}',
      }));

      await client.updateFieldConfig('appXXX', 'fld333', {
        type: 'formula',
        typeOptions: { formulaText: '2+2' },
      });

      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.type, 'formula');
      assert.deepEqual(decoded.typeOptions, { formulaText: '2+2' });
      assert.equal(decoded.config, undefined, 'Should NOT have config wrapper');
    });

    it('createField wraps in config (create is different from update)', async () => {
      trackingPostForm(() => ({
        ok: true, status: 200, json: async () => ({}), text: async () => '{}',
      }));

      await client.createField('appXXX', 'tblAAA', {
        name: 'Test',
        type: 'formula',
        typeOptions: { formulaText: '1+1' },
      });

      const postCall = mockAuth.calls.find(c => c.method === 'POST' && c.url.includes('/create'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.ok(decoded.config, 'Create should have config wrapper');
      assert.equal(decoded.config.type, 'formula');
    });

    it('includes secretSocketId in mutation params', async () => {
      trackingPostForm(() => ({
        ok: true, status: 200, json: async () => ({}), text: async () => '{}',
      }));

      await client.renameField('appXXX', 'fld111', 'NewName');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.equal(postCall.params.secretSocketId, 'socTEST123');
    });
  });

  describe('caching', () => {
    it('caches getApplicationData on second call', async () => {
      await client.getApplicationData('appXXX');
      await client.getApplicationData('appXXX');
      const getCalls = mockAuth.calls.filter(c => c.method === 'GET');
      assert.equal(getCalls.length, 1);
    });

    it('invalidates cache after createField', async () => {
      mockAuth.postForm = () => ({
        ok: true, status: 200, json: async () => ({}), text: async () => '{}',
      });

      await client.getApplicationData('appXXX');
      await client.createField('appXXX', 'tblAAA', { name: 'New', type: 'text' });
      await client.getApplicationData('appXXX');
      const getCalls = mockAuth.calls.filter(c => c.method === 'GET');
      assert.equal(getCalls.length, 2);
    });

    it('invalidates cache after renameField', async () => {
      mockAuth.postForm = () => ({
        ok: true, status: 200, json: async () => ({}), text: async () => '{}',
      });

      await client.getApplicationData('appXXX');
      await client.renameField('appXXX', 'fld111', 'New Name');
      await client.getApplicationData('appXXX');
      const getCalls = mockAuth.calls.filter(c => c.method === 'GET');
      assert.equal(getCalls.length, 2);
    });
  });

  describe('getScaffoldingData', () => {
    it('uses correct URL with appId (no hardcoded ID)', async () => {
      await client.getScaffoldingData('appMYAPP');
      const call = mockAuth.calls.find(c => c.url.includes('Scaffolding'));
      assert.ok(call.url.includes('appMYAPP'));
      assert.ok(!call.url.includes('appGPLAKpvUTgTRsx'), 'should not contain hardcoded appId');
    });
  });

  describe('validateFormula', () => {
    it('returns valid result for good formula', async () => {
      mockAuth.postForm = () => ({
        ok: true,
        status: 200,
        json: async () => ({ msg: 'SUCCESS', data: { pass: true, resultType: 'text' } }),
        text: async () => '{}',
      });

      const result = await client.validateFormula('appXXX', 'tblAAA', "'hello'");
      assert.equal(result.valid, true);
      assert.equal(result.resultType, 'text');
    });

    it('returns invalid result for bad formula', async () => {
      mockAuth.postForm = () => ({
        ok: false,
        status: 422,
        json: async () => ({ error: { type: 'FAILED_STATE_CHECK' } }),
        text: async () => '{}',
      });

      const result = await client.validateFormula('appXXX', 'tblAAA', '');
      assert.equal(result.valid, false);
      assert.equal(result.error, 'FAILED_STATE_CHECK');
    });
  });

  describe('view operations (verified against captured traffic)', () => {
    function trackingPostForm(fn) {
      mockAuth.postForm = (url, params, appId) => {
        mockAuth.calls.push({ method: 'POST', url, params, appId, type: 'form' });
        return fn(url, params, appId);
      };
    }

    const successRes = () => ({
      ok: true, status: 200,
      json: async () => ({ msg: 'SUCCESS', data: null }),
      text: async () => '{}',
    });

    it('renameView uses /updateName with origin field', async () => {
      trackingPostForm(successRes);

      await client.renameView('appXXX', 'viw001', 'New View Name');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/updateName'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.name, 'New View Name');
      assert.equal(decoded.origin, 'viewName');
    });

    it('deleteView uses /destroy with empty payload', async () => {
      trackingPostForm(successRes);

      await client.deleteView('appXXX', 'viw001');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/destroy'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.deepEqual(decoded, {});
    });

    it('duplicateView uses copyMode "duplicate"', async () => {
      trackingPostForm(successRes);

      await client.duplicateView('appXXX', 'tblAAA', 'viw001', 'Copy of Grid');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/create'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.copyMode, 'duplicate');
      assert.equal(decoded.copyFromViewId, 'viw001');
      assert.equal(decoded.name, 'Copy of Grid');
    });

    it('updateViewDescription sends description payload', async () => {
      trackingPostForm(successRes);

      await client.updateViewDescription('appXXX', 'viw001', 'My description');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/updateDescription'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.description, 'My description');
    });

    it('reorderViewFields uses updateMultipleViewConfigs with field index map', async () => {
      trackingPostForm(successRes);

      const order = { fld111: 0, fld222: 1, fld333: 2 };
      await client.reorderViewFields('appXXX', 'viw001', order);
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/updateMultipleViewConfigs'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.deepEqual(decoded.targetOverallColumnIndicesById, order);
    });

    it('createView uses copyMode "new" when copyFromViewId provided', async () => {
      trackingPostForm(successRes);

      await client.createView('appXXX', 'tblAAA', {
        name: 'Calendar',
        type: 'calendar',
        copyFromViewId: 'viw001',
      });
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.copyMode, 'new');
      assert.equal(decoded.type, 'calendar');
    });

    it('createView auto-resolves copyFromViewId when not provided', async () => {
      trackingPostForm(successRes);

      await client.createView('appXXX', 'tblAAA', { name: 'Fresh Grid' });
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      // Auto-resolved from first view in mock schema (viw001)
      assert.equal(decoded.copyFromViewId, 'viw001');
      assert.equal(decoded.copyMode, 'new');
    });
  });

  describe('field type normalization (verified against 2026-04-17 capture)', () => {
    function trackingPostForm(fn) {
      mockAuth.postForm = (url, params, appId) => {
        mockAuth.calls.push({ method: 'POST', url, params, appId, type: 'form' });
        return fn(url, params, appId);
      };
    }
    const successRes = () => ({
      ok: true, status: 200, json: async () => ({}), text: async () => '{}',
    });

    it('createField maps fieldType "url" to type "text" + validatorName "url"', async () => {
      trackingPostForm(successRes);

      await client.createField('appXXX', 'tblAAA', { name: 'Homepage', type: 'url' });

      const postCall = mockAuth.calls.find(c => c.url.includes('/create'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.config.type, 'text');
      assert.equal(decoded.config.typeOptions.validatorName, 'url');
    });

    it('createField maps "email" and "phoneNumber" to text + validatorName', async () => {
      trackingPostForm(successRes);
      await client.createField('appXXX', 'tblAAA', { name: 'Email', type: 'email' });
      await client.createField('appXXX', 'tblAAA', { name: 'Phone', type: 'phone' });

      const creates = mockAuth.calls.filter(c => c.url.includes('/create'));
      const emailPayload = JSON.parse(creates[0].params.stringifiedObjectParams);
      const phonePayload = JSON.parse(creates[1].params.stringifiedObjectParams);
      assert.equal(emailPayload.config.typeOptions.validatorName, 'email');
      assert.equal(phonePayload.config.typeOptions.validatorName, 'phoneNumber');
    });

    it('createField maps "dateTime" to type "date" with isDateTime:true and flat-string formats', async () => {
      trackingPostForm(successRes);
      await client.createField('appXXX', 'tblAAA', {
        name: 'Timestamp',
        type: 'dateTime',
        typeOptions: { dateFormat: 'iso', timeFormat: '24hour', timeZone: 'UTC' },
      });

      const postCall = mockAuth.calls.find(c => c.url.includes('/create'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.config.type, 'date');
      assert.equal(decoded.config.typeOptions.isDateTime, true);
      assert.equal(decoded.config.typeOptions.dateFormat, 'iso');
      assert.equal(decoded.config.typeOptions.timeFormat, '24hour');
      assert.equal(decoded.config.typeOptions.timeZone, 'UTC');
    });

    it('createField flattens { name: "iso" } format objects to plain strings', async () => {
      trackingPostForm(successRes);
      await client.createField('appXXX', 'tblAAA', {
        name: 'Timestamp',
        type: 'dateTime',
        typeOptions: { dateFormat: { name: 'iso' }, timeFormat: { name: '24hour' } },
      });

      const postCall = mockAuth.calls.find(c => c.url.includes('/create'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.config.typeOptions.dateFormat, 'iso');
      assert.equal(decoded.config.typeOptions.timeFormat, '24hour');
    });

    it('updateFieldConfig also normalizes dateTime', async () => {
      trackingPostForm(successRes);
      await client.updateFieldConfig('appXXX', 'fld333', {
        type: 'dateTime',
        typeOptions: {},
      });

      const postCall = mockAuth.calls.find(c => c.url.includes('/updateConfig'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.type, 'date');
      assert.equal(decoded.typeOptions.isDateTime, true);
    });

    it('createField passes through canonical types without mangling', async () => {
      trackingPostForm(successRes);
      await client.createField('appXXX', 'tblAAA', { name: 'Count', type: 'number', typeOptions: { format: 'integer' } });

      const postCall = mockAuth.calls.find(c => c.url.includes('/create'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.config.type, 'number');
      assert.deepEqual(decoded.config.typeOptions, { format: 'integer' });
    });
  });

  describe('filter operator normalization (verified against 2026-04-17 capture)', () => {
    function trackingPostForm(fn) {
      mockAuth.postForm = (url, params, appId) => {
        mockAuth.calls.push({ method: 'POST', url, params, appId, type: 'form' });
        return fn(url, params, appId);
      };
    }
    const successRes = () => ({
      ok: true, status: 200, json: async () => ({ msg: 'SUCCESS', data: null }), text: async () => '{}',
    });

    it('translates "is" → "=" for leaf filters', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', {
        filterSet: [{ columnId: 'fld111', operator: 'is', value: 'Prime' }],
        conjunction: 'and',
      });

      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.filters.filterSet[0].operator, '=');
      assert.equal(decoded.filters.filterSet[0].value, 'Prime');
    });

    it('translates "isNot" → "!="', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', {
        filterSet: [{ columnId: 'fld111', operator: 'isNot', value: 'x' }],
        conjunction: 'and',
      });
      const decoded = JSON.parse(mockAuth.calls.find(c => c.method === 'POST').params.stringifiedObjectParams);
      assert.equal(decoded.filters.filterSet[0].operator, '!=');
    });

    it('collapses "isAnyOf" with single-element array to "=" + scalar value', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', {
        filterSet: [{ columnId: 'fld222', operator: 'isAnyOf', value: ['selABC'] }],
        conjunction: 'and',
      });
      const decoded = JSON.parse(mockAuth.calls.find(c => c.method === 'POST').params.stringifiedObjectParams);
      assert.equal(decoded.filters.filterSet[0].operator, '=');
      assert.equal(decoded.filters.filterSet[0].value, 'selABC');
    });

    it('leaves "isAnyOf" with multi-value array alone', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', {
        filterSet: [{ columnId: 'fld222', operator: 'isAnyOf', value: ['selA', 'selB'] }],
        conjunction: 'and',
      });
      const decoded = JSON.parse(mockAuth.calls.find(c => c.method === 'POST').params.stringifiedObjectParams);
      assert.equal(decoded.filters.filterSet[0].operator, 'isAnyOf');
      assert.deepEqual(decoded.filters.filterSet[0].value, ['selA', 'selB']);
    });

    it('auto-injects flt-prefixed id on filters missing one', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', {
        filterSet: [{ columnId: 'fld111', operator: 'contains', value: 'hi' }],
        conjunction: 'and',
      });
      const decoded = JSON.parse(mockAuth.calls.find(c => c.method === 'POST').params.stringifiedObjectParams);
      const injected = decoded.filters.filterSet[0].id;
      assert.match(injected, /^flt[A-Za-z0-9]{14}$/);
    });

    it('passes filters:null through to clear all filters', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', null);
      const decoded = JSON.parse(mockAuth.calls.find(c => c.method === 'POST').params.stringifiedObjectParams);
      assert.equal(decoded.filters, null);
    });

    it('normalizes operators inside nested groups', async () => {
      trackingPostForm(successRes);

      await client.updateViewFilters('appXXX', 'viw001', {
        filterSet: [{
          type: 'nested',
          conjunction: 'or',
          filterSet: [{ columnId: 'fld111', operator: 'is', value: 'x' }],
        }],
        conjunction: 'and',
      });
      const decoded = JSON.parse(mockAuth.calls.find(c => c.method === 'POST').params.stringifiedObjectParams);
      assert.equal(decoded.filters.filterSet[0].type, 'nested');
      assert.equal(decoded.filters.filterSet[0].filterSet[0].operator, '=');
    });
  });

  describe('table operations (verified against 2026-04-17 capture)', () => {
    function trackingPostForm(fn) {
      mockAuth.postForm = (url, params, appId) => {
        mockAuth.calls.push({ method: 'POST', url, params, appId, type: 'form' });
        return fn(url, params, appId);
      };
    }
    const successRes = () => ({
      ok: true, status: 200, json: async () => ({ msg: 'SUCCESS', data: null }), text: async () => '{}',
    });

    it('createTable POSTs to /v0.3/table/{newId}/create with applicationId + name', async () => {
      trackingPostForm(successRes);

      const result = await client.createTable('appXXX', 'My New Table');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.match(postCall.url, /\/v0\.3\/table\/tbl[A-Za-z0-9]{14}\/create$/);
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.applicationId, 'appXXX');
      assert.equal(decoded.name, 'My New Table');
      assert.match(result.tableId, /^tbl[A-Za-z0-9]{14}$/);
    });

    it('renameTable POSTs to /table/{id}/updateName with { name }', async () => {
      trackingPostForm(successRes);

      await client.renameTable('appXXX', 'tblAAA', 'Renamed Tasks');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/updateName'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.equal(decoded.name, 'Renamed Tasks');
    });

    it('renameTable no-ops when the name already matches', async () => {
      trackingPostForm(successRes);

      const result = await client.renameTable('appXXX', 'tblAAA', 'Tasks');
      assert.match(result.message, /already has this name/);
      assert.equal(mockAuth.calls.filter(c => c.method === 'POST').length, 0);
    });

    it('deleteTable POSTs to /table/{id}/destroy with empty {} and returns deleted:true', async () => {
      trackingPostForm(successRes);

      const result = await client.deleteTable('appXXX', 'tblAAA', 'Tasks');
      const postCall = mockAuth.calls.find(c => c.method === 'POST');
      assert.ok(postCall.url.includes('/destroy'));
      const decoded = JSON.parse(postCall.params.stringifiedObjectParams);
      assert.deepEqual(decoded, {});
      assert.equal(result.deleted, true);
      assert.equal(result.tableId, 'tblAAA');
    });

    it('deleteTable refuses when expectedName does not match actual', async () => {
      trackingPostForm(successRes);

      await assert.rejects(
        () => client.deleteTable('appXXX', 'tblAAA', 'WrongName'),
        { message: /Safety check failed.*"Tasks".*"WrongName"/ },
      );
      assert.equal(mockAuth.calls.filter(c => c.method === 'POST').length, 0);
    });

    it('deleteTable throws a helpful error for unknown table IDs', async () => {
      await assert.rejects(
        () => client.deleteTable('appXXX', 'tblNOPE', 'Tasks'),
        { message: /Table "tblNOPE" not found/ },
      );
    });
  });

  describe('getView', () => {
    it('returns view configuration extracted from base schema', async () => {
      // Inject a view with filters/sorts into the mock schema
      mockAuth = createMockAuth({
        get: () => ({
          ok: true, status: 200,
          json: async () => ({
            data: {
              tableSchemas: [{
                id: 'tblAAA', name: 'Tasks',
                columns: [{ id: 'fld111', name: 'Name', type: 'text' }],
                views: [{
                  id: 'viw001',
                  name: 'Grid view',
                  type: 'grid',
                  filters: { filterSet: [{ id: 'flt1', columnId: 'fld111', operator: '=', value: 'x' }], conjunction: 'and' },
                  sorts: [{ id: 'srt1', columnId: 'fld111', ascending: true }],
                  groupLevels: [],
                  description: 'Primary view',
                }],
              }],
            },
          }),
          text: async () => '{}',
        }),
      });
      client = new AirtableClient(mockAuth);

      const result = await client.getView('appXXX', 'viw001');
      assert.equal(result.id, 'viw001');
      assert.equal(result.name, 'Grid view');
      assert.equal(result.tableId, 'tblAAA');
      assert.equal(result.filters.conjunction, 'and');
      assert.equal(result.filters.filterSet[0].operator, '=');
      assert.equal(result.description, 'Primary view');
    });

    it('throws for unknown viewId', async () => {
      await assert.rejects(
        () => client.getView('appXXX', 'viwNOPE'),
        { message: /View "viwNOPE" not found/ },
      );
    });
  });

  describe('deleteField dependency summarization', () => {
    it('summarizes the dependency graph into compact categorized lists', async () => {
      mockAuth.postForm = () => ({
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            type: 'SCHEMA_DEPENDENCIES_VALIDATION_FAILED',
            details: {
              applicationDependencyGraphEdgesBySourceObjectId: {
                fld222: [
                  { targetObjectId: 'viw001', dependencyType: 'viewGroup' },
                  { targetObjectId: 'viw002', dependencyType: 'viewSort' },
                  { targetObjectId: 'viw003', dependencyType: 'viewFilter' },
                  { targetObjectId: 'fld444', dependencyType: 'fieldReference' },
                ],
              },
            },
          },
        }),
        text: async () => 'deps',
      });

      const result = await client.deleteField('appXXX', 'fld222', 'Status');
      assert.equal(result.hasDependencies, true);
      assert.equal(result.dependencies.edgeCount, 4);
      assert.equal(result.dependencies.viewGroupings.length, 1);
      assert.equal(result.dependencies.viewSorts.length, 1);
      assert.equal(result.dependencies.viewFilters.length, 1);
      assert.equal(result.dependencies.fields.length, 1);
      // Raw graph remains available for debug mode consumers
      assert.ok(result.rawDependencyGraph);
    });
  });
});
