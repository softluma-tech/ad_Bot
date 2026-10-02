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

test('pause delays the next slot for every caller', async () => {
  const gate = createThrottle(1);
  await gate();
  gate.pause(80);
  const start = Date.now();
  await gate();
  assert.ok(Date.now() - start >= 70, `expected >=70ms, got ${Date.now() - start}`);
});

test('pause never shortens an already queued wait', async () => {
  const gate = createThrottle(200);
  await gate();
  const start = Date.now();
  await gate();
  gate.pause(5);
  const afterPause = Date.now() - start;
  assert.ok(afterPause >= 190, `expected >=190ms, got ${afterPause}`);
});

test('setInterval changes pacing and getInterval reports it', async () => {
  const gate = createThrottle(1);
  assert.equal(gate.getInterval(), 1);
  gate.setInterval(60);
  assert.equal(gate.getInterval(), 60);
  await gate();
  const start = Date.now();
  await gate();
  assert.ok(Date.now() - start >= 50, `expected >=50ms, got ${Date.now() - start}`);
});