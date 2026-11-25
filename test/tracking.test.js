const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAttributionRouter, parseAttribution, validSecret } = require('../src/tracking/attribution');
const { createSubscriptionService, canConfirmJoin, isMember } = require('../src/tracking/subscriptions');
const { createDeliveryService } = require('../src/tracking/delivery');

// Small in-memory repository for service-level behavior tests. Production uses
// MongoDB conditional updates and unique indexes, not these repository doubles.
function repository(initial = []) {
  const rows = initial.map((row) => ({ ...row }));
  function matches(row, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (key === '$or') return value.some((part) => matches(row, part));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        return Object.entries(value).every(([op, expected]) => {
          if (op === '$in') return expected.includes(row[key]);
          if (op === '$lte') return row[key] <= expected;
          throw new Error(`unsupported operator ${op}`);
        });
      }
      return value === null ? row[key] == null : String(row[key]) === String(value);
    });
  }
  async function update(filter, patch, options = {}) {
    let row = rows.find((item) => matches(item, filter));
    let inserted = false;
    if (!row && options.upsert) {
      row = { _id: rows.length + 1, ...filter, ...patch.$setOnInsert };
      rows.push(row);
      inserted = true;
    }
    if (!row) return null;
    Object.assign(row, patch.$set);
    for (const [key, value] of Object.entries(patch.$inc || {})) row[key] = (row[key] || 0) + value;
    for (const [key, value] of Object.entries(patch.$max || {})) if (!row[key] || row[key] < value) row[key] = value;
    if (inserted && row.eventId) Object.assign(row, { status: 'pending', attempts: 0, nextAttemptAt: new Date(0), lockedUntil: new Date(0) });
    return { ...row };
  }
  return {
    rows,
    findOne: async (filter) => { const row = rows.find((item) => matches(item, filter)); return row ? { ...row } : null; },
    findOneAndUpdate: update, updateOne: update,
  };
}

const capturedAt = new Date('2026-11-25T10:00:00.500Z');
const joinedAt = new Date('2026-11-25T10:01:00Z');
const config = { channelUsername: 'Target', channelId: '-100123', metaPixelId: 'pixel', metaAccessToken: 'secret', metaApiVersion: 'v25.0' };
function fixture(user = {}, records = {}) {
  const User = repository([{ userId: 1, acquisitionEligible: true, firstStartPayload: 'ref_abc', trackingInitialized: true, initialMembership: 'unknown', attributionId: 'abc', ...user }]);
  const Attribution = repository([{ trackingId: 'abc', telegramUserId: 1, capturedAt, fbp: 'browser', fbc: 'click', attribution: { cid: 'campaign' }, ...records }]);
  const ChannelJoin = repository();
  const Conversion = repository();
  return { User, Attribution, ChannelJoin, Conversion, ...createSubscriptionService({ User, Attribution, ChannelJoin, Conversion, config }) };
}

test('authentication and payload validation reject absent secrets, stale and invalid input', () => {
  assert.equal(validSecret('Bearer secret', 'secret'), true);
  assert.equal(validSecret('Bearer wrong', 'secret'), false);
  assert.equal(validSecret('Bearer ', ''), false);
  assert.equal(parseAttribution(null), null);
  assert.equal(parseAttribution({ version: 1, captured_at: 'bad' }), null);
  assert.equal(parseAttribution({ version: 1, captured_at: new Date(0).toISOString() }), null);
});

test('HTTP endpoint authenticates, stores before returning a Telegram-safe reference', async (t) => {
  let stored;
  const app = express();
  app.use('/api/attribution', createAttributionRouter({ secret: 'shared', Attribution: { create: async (data) => { stored = data; } } }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  const url = `http://127.0.0.1:${server.address().port}/api/attribution`;
  assert.equal((await globalThis.fetch(url, { method: 'POST' })).status, 401);
  const response = await globalThis.fetch(url, {
    method: 'POST', headers: { Authorization: 'Bearer shared', 'Content-Type': 'application/json' },
    body: JSON.stringify({ version: 1, captured_at: new Date().toISOString(), landing_url: 'https://landing.example', source: 'primary', attribution: { cid: 'campaign' }, client_ip_address: 'invalid' }),
  });
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.match(data.tracking_id, /^[A-Za-z0-9_-]{1,60}$/);
  assert.equal(stored.trackingId, data.tracking_id);
  assert.equal(stored.attribution.cid, 'campaign');
  assert.equal(stored.clientIpAddress, undefined);
});

test('old bot users and unproven existing members never queue Subscribe', async () => {
  for (const user of [{ acquisitionEligible: false }, { acquisitionEligible: undefined }, { initialMembership: 'existing' }, {}]) {
    const f = fixture(user);
    await f.observeMembership(1, { ok: true, isInChannel: true }, joinedAt);
    assert.equal(f.Conversion.rows.length, 0);
  }
});

test('failed initial membership is not treated as outside and later existing membership is excluded', async () => {
  const f = fixture();
  await f.observeMembership(1, { ok: false, isInChannel: false }, capturedAt);
  assert.equal(f.User.rows[0].initialMembership, 'unknown');
  await f.observeMembership(1, { ok: true, isInChannel: true }, joinedAt);
  assert.equal(f.User.rows[0].initialMembership, 'existing');
  assert.equal(f.Conversion.rows.length, 0);
});

test('new user outside channel then verified inside queues exactly once across repeats', async () => {
  const f = fixture();
  await f.observeMembership(1, { ok: true, isInChannel: false }, capturedAt);
  await f.observeMembership(1, { ok: true, isInChannel: true }, joinedAt);
  await f.observeMembership(1, { ok: true, isInChannel: true }, new Date(joinedAt.getTime() + 1000));
  assert.equal(f.Conversion.rows.length, 1);
  assert.equal(f.Conversion.rows[0].joinedAt.getTime(), joinedAt.getTime());
  assert.equal(f.User.rows[0].subscriptionQueued, true);
});

test('membership transitions from the wrong channel, leaves and member promotions are ignored', async () => {
  const f = fixture({ initialMembership: 'outside' });
  const update = { chat: { id: -100123 }, date: joinedAt.getTime() / 1000, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member', user: { id: 1 } } };
  await f.handleChatMember({ ...update, chat: { id: -999 } });
  await f.handleChatMember({ ...update, old_chat_member: { status: 'member' }, new_chat_member: { status: 'administrator', user: { id: 1 } } });
  assert.equal(f.Conversion.rows.length, 0);
  await f.handleChatMember(update);
  assert.equal(f.Conversion.rows.length, 1);
  assert.equal(isMember({ status: 'restricted', is_member: true }), true);
  assert.equal(isMember({ status: 'restricted', is_member: false }), false);
});

test('observed join before Start can qualify only after website capture and only for a new user', async () => {
  const f = fixture();
  await f.ChannelJoin.updateOne({ userId: 1 }, { $max: { joinedAt } }, { upsert: true });
  await f.observeMembership(1, { ok: true, isInChannel: true }, new Date(joinedAt.getTime() + 1000));
  assert.equal(f.Conversion.rows.length, 1);
  assert.equal(canConfirmJoin({ acquisitionEligible: true, initialMembership: 'unknown' }, { joinedAt: new Date(capturedAt.getTime() - 10000) }, { capturedAt }), false);
  assert.equal(canConfirmJoin({ acquisitionEligible: false }, { joinedAt }, { capturedAt }), false);
  // Telegram truncates transition timestamps to whole seconds.
  assert.equal(canConfirmJoin({ acquisitionEligible: true }, { joinedAt: new Date('2026-11-25T10:00:00Z') }, { capturedAt }), true);
});

test('references bind once, preserve original campaign and cannot be claimed by another user', async () => {
  const f = fixture({ attributionId: null }, { telegramUserId: null });
  assert.equal(await f.bindAttribution(1, 'ref_abc'), 'campaign');
  assert.equal(f.User.rows[0].attributionId, 'abc');
  assert.equal(f.Attribution.rows[0].telegramUserId, 1);
  assert.equal(await f.bindAttribution(2, 'ref_abc'), null);
  assert.equal(await f.bindAttribution(1, 'old_campaign'), null);
});

test('delayed join updates can prove a pre-start join but a later rejoin by an existing member cannot', async () => {
  const checkTime = new Date(joinedAt.getTime() + 1000);
  const f = fixture();
  await f.observeMembership(1, { ok: true, isInChannel: true }, checkTime);
  assert.equal(f.Conversion.rows.length, 0);
  const update = { chat: { id: -100123 }, date: joinedAt.getTime() / 1000, old_chat_member: { status: 'left' }, new_chat_member: { status: 'member', user: { id: 1 } } };
  await f.handleChatMember(update);
  assert.equal(f.Conversion.rows.length, 1);
  const oldMember = fixture();
  await oldMember.observeMembership(1, { ok: true, isInChannel: true }, capturedAt);
  await oldMember.handleChatMember(update);
  assert.equal(oldMember.Conversion.rows.length, 0);
});

test('delivery retries reuse the event ID and event time, with atomic leases preventing parallel sends', async () => {
  const f = fixture({ initialMembership: 'outside' });
  await f.observeMembership(1, { ok: true, isInChannel: true }, joinedAt);
  const sent = [];
  let failures = true;
  const delivery = createDeliveryService({ ...f, config, fetch: async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return { ok: !failures, status: 500, json: async () => ({ events_received: 1 }) };
  } });
  await Promise.all([delivery.deliverOne(joinedAt), delivery.deliverOne(joinedAt)]);
  assert.equal(sent.length, 1);
  assert.equal(f.Conversion.rows[0].status, 'pending');
  failures = false;
  await delivery.deliverOne(new Date(joinedAt.getTime() + 31000));
  assert.equal(f.Conversion.rows[0].status, 'sent');
  assert.equal(sent[0].data[0].event_id, sent[1].data[0].event_id);
  assert.equal(sent[1].data[0].event_time, joinedAt.getTime() / 1000);
  assert.equal(sent[1].data[0].user_data.fbc, 'click');
  assert.equal(sent[1].data[0].action_source, 'chat');
  assert.match(sent[1].data[0].user_data.external_id[0], /^[a-f0-9]{64}$/);
  assert.equal(await delivery.deliverOne(new Date(joinedAt.getTime() + 62000)), false);
});

test('expired conversions are not sent and missing credentials leave delivery pending', async () => {
  const f = fixture({ initialMembership: 'outside' });
  await f.observeMembership(1, { ok: true, isInChannel: true }, joinedAt);
  const fetch = () => assert.fail('must not send');
  assert.equal(await createDeliveryService({ ...f, config: {}, fetch }).deliverOne(joinedAt), false);
  await createDeliveryService({ ...f, config, fetch }).deliverOne(new Date(joinedAt.getTime() + 8 * 86400000));
  assert.equal(f.Conversion.rows[0].status, 'expired');
});

test('delivery reads admin settings dynamically and respects pause', async () => {
  const f = fixture({ initialMembership: 'outside' });
  await f.observeMembership(1, { ok: true, isInChannel: true }, joinedAt);
  let settings = { enabled: false, metaPixelId: 'admin-pixel', metaAccessToken: 'admin-token' };
  let sent = 0;
  const delivery = createDeliveryService({ ...f, config, getSettings: async () => settings, fetch: async (url, options) => {
    sent++;
    assert.ok(url.includes('/admin-pixel/events'));
    assert.equal(options.headers.Authorization, 'Bearer admin-token');
    return { ok: true, json: async () => ({ events_received: 1 }) };
  } });
  assert.equal(await delivery.deliverOne(joinedAt), false);
  settings = { ...settings, enabled: true };
  await delivery.deliverOne(joinedAt);
  assert.equal(sent, 1);
});
