const test = require('node:test');
const assert = require('node:assert/strict');
const { createMetaAdmin } = require('../src/bot/metaAdmin');

function fixture() {
  let state;
  const settings = { metaPixelId: '123456789', metaAccessToken: 'hidden-token-123', enabled: true };
  const messages = [];
  const saves = [];
  let deleted = 0;
  const ctx = {
    from: { id: 42 }, chat: { id: 42, type: 'private' },
    answerCbQuery: async () => {}, deleteMessage: async () => { deleted++; },
  };
  const admin = createMetaAdmin({
    getSettings: async () => settings,
    saveSettings: async (data, id) => { saves.push({ data, id }); },
    isAdmin: (id) => id === 42,
    reply: async (_ctx, text) => { messages.push(text); },
    getState: () => state, setState: (_id, value) => { state = value; }, clearState: () => { state = null; },
  });
  return { admin, ctx, messages, saves, getDeleted: () => deleted };
}

test('Meta panel displays Pixel ID and masks the stored token', async () => {
  const f = fixture();
  await f.admin.show(f.ctx);
  assert.match(f.messages[0], /123456789/);
  assert.match(f.messages[0], /configured/);
  assert.ok(!f.messages[0].includes('hidden-token-123'));
});

test('only authorized private-chat admins can change Meta credentials', async () => {
  for (const override of [{ from: { id: 999 } }, { chat: { id: -10, type: 'group' } }]) {
    const f = fixture();
    await f.admin.callback({ ...f.ctx, ...override }, 'meta:pause');
    assert.equal(f.saves.length, 0);
  }
});

test('token input is deleted, persisted and never echoed', async () => {
  const f = fixture();
  await f.admin.callback(f.ctx, 'meta:token');
  assert.equal(await f.admin.text(f.ctx, 'new-secret-token'), true);
  assert.equal(f.getDeleted(), 1);
  assert.deepEqual(f.saves, [{ data: { accessToken: 'new-secret-token' }, id: 42 }]);
  assert.ok(f.messages.every((message) => !message.includes('new-secret-token')));
});

test('Pixel IDs are validated and test mode can be turned off', async () => {
  const f = fixture();
  await f.admin.callback(f.ctx, 'meta:pixel');
  await f.admin.text(f.ctx, 'invalid');
  assert.equal(f.saves.length, 0);
  await f.admin.text(f.ctx, '987654321');
  assert.deepEqual(f.saves[0].data, { pixelId: '987654321' });
  await f.admin.callback(f.ctx, 'meta:test');
  await f.admin.text(f.ctx, 'OFF');
  assert.deepEqual(f.saves[1].data, { testEventCode: '' });
  await f.admin.callback(f.ctx, 'meta:pause');
  assert.deepEqual(f.saves[2].data, { enabled: false });
});
