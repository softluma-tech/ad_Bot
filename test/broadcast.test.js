const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../src/config');
const { extractPayload, sendPayload, buildTargetQuery, targetLabel, MEDIA_LABELS } = require('../src/bot/broadcast');

test('extracts photo using the largest file_id', () => {
  const payload = extractPayload({ photo: [{ file_id: 'a' }, { file_id: 'b' }] });
  assert.equal(payload.type, 'photo');
  assert.equal(payload.fileId, 'b');
});

test('truncates long captions to 1024 chars + ellipsis', () => {
  const payload = extractPayload({ photo: [{ file_id: 'a' }], caption: 'x'.repeat(2000) });
  assert.equal(payload.caption.length, 1025);
  assert.ok(payload.caption.endsWith('…'));
});

test('extracts plain text messages', () => {
  assert.deepEqual(extractPayload({ text: 'hello' }), { type: 'text', text: 'hello' });
});

test('extracts video, sticker and video_note', () => {
  assert.equal(extractPayload({ video: { file_id: 'v' } }).type, 'video');
  assert.equal(extractPayload({ sticker: { file_id: 's' } }).type, 'sticker');
  assert.equal(extractPayload({ video_note: { file_id: 'vn' } }).type, 'video_note');
});

test('returns null for unsupported messages', () => {
  assert.equal(extractPayload({ location: {} }), null);
  assert.equal(extractPayload({}), null);
});

test('MEDIA_LABELS covers every extractable type', () => {
  const types = ['photo', 'video', 'animation', 'audio', 'document', 'voice', 'video_note', 'sticker', 'text'];
  for (const type of types) assert.ok(MEDIA_LABELS[type]);
});

test('sendPayload retries caption without HTML on parse error', async () => {
  const calls = [];
  const telegram = {
    sendPhoto: async (chatId, fileId, extra) => {
      calls.push(extra);
      const err = new Error('bad entities');
      err.response = { error_code: 400, description: "can't parse entities" };
      if (extra.parse_mode) throw err;
      return { ok: true };
    },
  };
  const res = await sendPayload(telegram, 1, { type: 'photo', fileId: 'f', caption: '<b>hi</b>' });
  assert.deepEqual(res, { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].caption, 'hi');
  assert.equal(calls[1].parse_mode, undefined);
});

test('sendPayload rethrows non-parse errors', async () => {
  const telegram = {
    sendPhoto: async () => {
      const err = new Error('gone');
      err.response = { error_code: 403 };
      throw err;
    },
  };
  await assert.rejects(
    sendPayload(telegram, 1, { type: 'photo', fileId: 'f', caption: '<b>hi</b>' }),
    (err) => err.response.error_code === 403,
  );
});

test("buildTargetQuery('all') excludes admins and blocked users", () => {
  const query = buildTargetQuery('all');
  assert.deepEqual(query.userId, { $nin: config.adminIds });
  assert.deepEqual(query.isBlocked, { $ne: true });
  assert.equal('inChannel' in query, false);
});

test("buildTargetQuery('nonChannel') targets verified non-members only", () => {
  const query = buildTargetQuery('nonChannel');
  assert.deepEqual(query.userId, { $nin: config.adminIds });
  assert.deepEqual(query.isBlocked, { $ne: true });
  assert.equal(query.inChannel, false);
});

test('buildTargetQuery defaults to all users for unknown/missing target', () => {
  for (const target of [undefined, null, '', 'everyone', 'channel']) {
    assert.equal('inChannel' in buildTargetQuery(target), false);
  }
});

test('targetLabel distinguishes the two targets', () => {
  assert.ok(targetLabel('nonChannel').includes('NOT in the channel'));
  assert.ok(!targetLabel('all').includes('NOT in the channel'));
  assert.ok(targetLabel('all').includes('All users'));
});