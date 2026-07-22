import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MockClient } from './helpers/mock-client.js';

describe('MockClient', () => {
  it('createTable spawns the 6 default fields (Name primary first); createField appends; deleteField removes', async () => {
    const c = new MockClient();
    const { tableId } = await c.createTable('appD', 'Offers');
    const raw = await c.getApplicationData('appD');
    const t = raw.data.tableSchemas.find((x) => x.id === tableId);
    assert.equal(t.columns.length, 6);
    assert.equal(t.columns[0].id, t.primaryColumnId);
    assert.equal(t.columns[0].name, 'Name');
    assert.equal(t.columns[0].type, 'text');
    await c.createField('appD', tableId, { name: 'Score', type: 'number' });
    assert.equal((await c.getApplicationData('appD')).data.tableSchemas[0].columns.length, 7);
    const notes = t.columns.find((x) => x.name === 'Notes');
    await c.deleteField('appD', notes.id, 'Notes');
    assert.equal((await c.getApplicationData('appD')).data.tableSchemas[0].columns.some((x) => x.name === 'Notes'), false);
    assert.ok(c.calls.some((k) => k.startsWith('createField')));
  });
});
