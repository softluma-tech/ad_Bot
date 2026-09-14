const test = require('node:test');
const assert = require('node:assert/strict');
const { setState, getState, clearState } = require('../src/bot/state');

test('setState/getState round trip', () => {
  setState(1, { action: 'setImage' });
  assert.deepEqual(getState(1), { action: 'setImage' });
});

test('clearState removes stored state', () => {
  setState(2, { action: 'x' });
  clearState(2);
  assert.equal(getState(2), null);
});

test('getState returns null for unknown chat', () => {
  assert.equal(getState(999999), null);
});

test('state expires after ttl', async () => {
  setState(3, { action: 'x' }, 5);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(getState(3), null);
});