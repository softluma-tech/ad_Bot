const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const HELPERS = path.join(__dirname, '..', 'src', 'bot', 'helpers.js');

function isAdminFor(adminIds, id) {
  const env = {
    PATH: process.env.PATH,
    BOT_TOKEN: '123:abc',
    MONGO_URI: 'mongodb://127.0.0.1:27017/test',
    ADMIN_IDS: adminIds,
  };
  const script = `const { isAdmin } = require(${JSON.stringify(HELPERS)}); process.stdout.write(String(isAdmin(${JSON.stringify(String(id))})))`;
  const res = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout === 'true';
}

test('isAdmin true for listed ids', () => {
  assert.equal(isAdminFor('1,2', 2), true);
});

test('isAdmin false for unlisted ids', () => {
  assert.equal(isAdminFor('1,2', 99), false);
});

test('isAdmin matches numeric string ids', () => {
  assert.equal(isAdminFor('42', '42'), true);
});

async function notifyFor({ adminIds, from, total, cid, isReturning = false }) {
  const env = {
    PATH: process.env.PATH,
    BOT_TOKEN: '123:abc',
    MONGO_URI: 'mongodb://127.0.0.1:27017/test',
    ADMIN_IDS: adminIds,
  };
  const script = `
    const { notifyAdmins } = require(${JSON.stringify(HELPERS)});
    const tg = {
      sendMessage: async (chatId, text, extra) => {
        process.stdout.write(JSON.stringify({ chatId, text, parseMode: extra && extra.parse_mode }) + '\\n');
        return {};
      },
    };
    notifyAdmins(tg, ${JSON.stringify(from)}, ${total}, ${JSON.stringify(cid)}, ${isReturning})
      .then(() => process.exit(0))
      .catch((e) => { console.error(e); process.exit(1); });
  `;
  const res = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
  return res.stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('notifyAdmins sends to every admin and includes the cid', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1,2', from, total: 10, cid: 'cid_123' });
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map((m) => m.chatId), [1, 2]);
  assert.ok(msgs.every((m) => m.text.includes('New user joined!')));
  assert.ok(msgs.every((m) => m.text.includes('<b>Total users: 10</b>')));
  assert.ok(msgs.every((m) => m.text.includes('Cid: <b>cid_123</b>')));
  assert.equal(msgs[0].parseMode, 'HTML');
});

test('notifyAdmins tags returning users as old user', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1', from, total: 15, cid: 'cid_999', isReturning: true });
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].text.includes('Old user returned!'));
  assert.ok(!msgs[0].text.includes('New user joined!'));
  assert.ok(msgs[0].text.includes('Cid: <b>cid_999</b>'));
  assert.ok(msgs[0].text.includes('<b>Total users: 15</b>'));
});

test('notifyAdmins omits cid row when no cid provided', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: '', username: null };
  const msgs = await notifyFor({ adminIds: '1', from, total: 3, cid: null });
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].text.includes('New user joined!'));
  assert.ok(!msgs[0].text.includes('Cid:'));
});

test('notifyAdmins omits cid row when no cid provided', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: '', username: null };
  const msgs = await notifyFor({ adminIds: '1', from, total: 3, cid: null });
  assert.equal(msgs.length, 1);
  assert.ok(!msgs[0].text.includes('Cid:'));
});