const test = require('node:test');
const assert = require('node:assert/strict');
const { createThrottle } = require('../src/bot/throttle');

test('first call returns immediately', async () => {
  const gate = createThrottle(10);
  const start = Date.now();
  await gate();
  assert.ok(Date.now() - start < 10);
});

test('paces consecutive calls to intervalMs', async () => {
  const gate = createThrottle(10);
  const start = Date.now();
  await gate();
  await gate();
  await gate();
  assert.ok(Date.now() - start >= 20, `expected >=20ms, got ${Date.now() - start}`);
});

test('zero interval never blocks', async () => {
  const gate = createThrottle(0);
  const start = Date.now();
  await gate();
  await gate();
  assert.ok(Date.now() - start < 10);
});