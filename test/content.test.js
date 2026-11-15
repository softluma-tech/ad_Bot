const test = require('node:test');
const assert = require('node:assert/strict');

const Content = require('../src/models/Content');
const { DEFAULT_VIP_URL } = Content;

test('content schema stores an optional voice file id', () => {
  const path = Content.schema.path('voiceFileId');
  assert.ok(path);
  assert.equal(path.instance, 'String');
  assert.equal(path.defaultValue, '');
});

test('content schema defaults the VIP link to the free VIP bot', () => {
  const path = Content.schema.path('vipUrl');
  assert.ok(path);
  assert.equal(path.instance, 'String');
  assert.equal(path.defaultValue, DEFAULT_VIP_URL);
  assert.equal(DEFAULT_VIP_URL, 'https://t.me/Bfssfreevipbot');
});
