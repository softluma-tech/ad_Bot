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

async function notifyFor({ adminIds, from, total, cid, isReturning = false, isInChannel = null }) {
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
    notifyAdmins(tg, ${JSON.stringify(from)}, ${total}, ${JSON.stringify(cid)}, ${isReturning}, ${isInChannel})
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
  const msgs = await notifyFor({ adminIds: '1,2', from, total: 10, cid: 'cid_123', isInChannel: null });
  assert.equal(msgs.length, 2);
  assert.deepEqual(msgs.map((m) => m.chatId), [1, 2]);
  assert.ok(msgs.every((m) => m.text.includes('New user joined!')));
  assert.ok(msgs.every((m) => m.text.includes('<b>Total users: 10</b>')));
  assert.ok(msgs.every((m) => m.text.includes('Cid: <b>cid_123</b>')));
  assert.equal(msgs[0].parseMode, 'HTML');
});

test('notifyAdmins links the name to the user chat', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1', from, total: 10, cid: null, isInChannel: null });
  assert.ok(msgs[0].text.includes('<a href="tg://user?id=5">'));
});

test('notifyAdmins includes In Channel yes', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1', from, total: 10, cid: null, isInChannel: true });
  assert.ok(msgs[0].text.includes('In Channel: <b>Yes</b>'));
});

test('notifyAdmins includes In Channel no', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1', from, total: 10, cid: null, isInChannel: false });
  assert.ok(msgs[0].text.includes('In Channel: <b>No</b>'));
});

test('notifyAdmins omits In Channel row when status is unknown', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1', from, total: 10, cid: null, isInChannel: null });
  assert.ok(!msgs[0].text.includes('In Channel:'));
});

test('notifyAdmins tags returning users as old user', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: 'L', username: 'ada' };
  const msgs = await notifyFor({ adminIds: '1', from, total: 15, cid: 'cid_999', isReturning: true, isInChannel: false });
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].text.includes('Old user returned!'));
  assert.ok(!msgs[0].text.includes('New user joined!'));
  assert.ok(msgs[0].text.includes('Cid: <b>cid_999</b>'));
  assert.ok(msgs[0].text.includes('<b>Total users: 15</b>'));
  assert.ok(msgs[0].text.includes('In Channel: <b>No</b>'));
});

test('notifyAdmins omits cid row when no cid provided', async () => {
  const from = { id: 5, first_name: 'Ada', last_name: '', username: null };
  const msgs = await notifyFor({ adminIds: '1', from, total: 3, cid: null, isReturning: false, isInChannel: null });
  assert.equal(msgs.length, 1);
  assert.ok(msgs[0].text.includes('New user joined!'));
  assert.ok(!msgs[0].text.includes('Cid:'));
});

function checkFor(handler) {
  const env = {
    PATH: process.env.PATH,
    BOT_TOKEN: '123:abc',
    MONGO_URI: 'mongodb://127.0.0.1:27017/test',
    ADMIN_IDS: '1',
  };
  const script = `
    const { isUserInChannel } = require(${JSON.stringify(HELPERS)});
    isUserInChannel({ getChatMember: async () => { ${handler} } }, 42, { quiet: true })
      .then((r) => process.stdout.write(JSON.stringify({
        isInChannel: r.isInChannel,
        ok: r.ok,
        rateLimited: r.rateLimited,
        fatal: r.fatal,
        retryAfter: r.retryAfter,
      })))
      .catch((e) => { console.error(e); process.exit(1); });
  `;
  const res = spawnSync(process.execPath, ['-e', script], { env, encoding: 'utf8' });
  if (res.status !== 0) throw new Error(res.stderr);
  return JSON.parse(res.stdout);
}

test('isUserInChannel treats member statuses as joined', () => {
  const r = checkFor("return { status: 'member' };");
  assert.deepEqual(r, { isInChannel: true, ok: true, rateLimited: false, fatal: false, retryAfter: 0 });
});

test('isUserInChannel treats left status as a definitive non-member', () => {
  const r = checkFor("return { status: 'left' };");
  assert.equal(r.ok, true);
  assert.equal(r.isInChannel, false);
  assert.equal(r.fatal, false);
});

test('isUserInChannel surfaces retry_after on 429 instead of hiding it', () => {
  const r = checkFor(
    "const e = new Error('429'); e.response = { error_code: 429, description: 'Too Many Requests', parameters: { retry_after: 7 } }; throw e;",
  );
  assert.equal(r.ok, false);
  assert.equal(r.rateLimited, true);
  assert.equal(r.retryAfter, 7);
});

test('isUserInChannel flags 403 as fatal (bot cannot read the channel)', () => {
  const r = checkFor(
    "const e = new Error('403'); e.response = { error_code: 403, description: 'Forbidden: bot is not a participant' }; throw e;",
  );
  assert.equal(r.ok, false);
  assert.equal(r.fatal, true);
  assert.equal(r.rateLimited, false);
});

test('isUserInChannel treats user-not-found as a definitive non-member', () => {
  const r = checkFor(
    "const e = new Error('400'); e.response = { error_code: 400, description: 'Bad Request: user not found' }; throw e;",
  );
  assert.equal(r.ok, true);
  assert.equal(r.isInChannel, false);
  assert.equal(r.fatal, false);
});

test('isUserInChannel reports unknown errors as unverifiable but not fatal', () => {
  const r = checkFor(
    "const e = new Error('500'); e.response = { error_code: 500, description: 'Internal Server Error' }; throw e;",
  );
  assert.equal(r.ok, false);
  assert.equal(r.fatal, false);
  assert.equal(r.rateLimited, false);
});