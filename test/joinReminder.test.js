const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  JOIN_REMINDER_MS,
  buildReminderText,
  sendJoinReminder,
  scheduleJoinReminder,
  clearJoinReminder,
} = require('../src/bot/joinReminder');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fakeTelegram({ status = 'left', throwErr = null } = {}) {
  const sent = [];
  return {
    sent,
    getChatMember: async () => {
      if (throwErr) throw throwErr;
      return { status };
    },
    sendMessage: async (chatId, text, extra) => {
      sent.push({ chatId, text, extra });
      return { message_id: 1 };
    },
  };
}

test('JOIN_REMINDER_MS is a 15 second delay', () => {
  assert.equal(JOIN_REMINDER_MS, 15_000);
});

test('buildReminderText announces the session and includes the invite url', () => {
  const txt = buildReminderText();
  assert.ok(txt.includes('Public Session Start in 5 Minutes'));
  assert.ok(txt.includes('Youtube Live'));
  assert.ok(txt.includes(config.channelInvite));
});

test('sendJoinReminder sends when the user is not a member', async () => {
  const tg = fakeTelegram({ status: 'left' });
  const sent = await sendJoinReminder(tg, 111);
  assert.equal(sent, true);
  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, 111);
  assert.equal(tg.sent[0].extra.parse_mode, 'HTML');
  assert.ok(tg.sent[0].text.includes('Public Session Start in 5 Minutes'));
  assert.ok(tg.sent[0].text.includes(config.channelInvite));
});

test('sendJoinReminder stays silent for members', async () => {
  for (const status of ['member', 'administrator', 'creator']) {
    const tg = fakeTelegram({ status });
    assert.equal(await sendJoinReminder(tg, 111), false);
    assert.equal(tg.sent.length, 0);
  }
});

test('sendJoinReminder stays silent when the check fails', async () => {
  const rateLimited = new Error('429');
  rateLimited.response = { error_code: 429, parameters: { retry_after: 5 } };
  const forbidden = new Error('403');
  forbidden.response = { error_code: 403 };

  for (const err of [rateLimited, forbidden]) {
    const tg = fakeTelegram({ throwErr: err });
    assert.equal(await sendJoinReminder(tg, 111), false);
    assert.equal(tg.sent.length, 0);
  }
});

test('scheduleJoinReminder fires after the delay and nudges a non-member', async () => {
  const tg = fakeTelegram({ status: 'left' });
  scheduleJoinReminder(tg, 222, 20);
  assert.equal(tg.sent.length, 0);
  await wait(60);
  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, 222);
  clearJoinReminder(222);
});

test('scheduleJoinReminder never nudges admins', async () => {
  const original = config.adminIds.slice();
  config.adminIds.push(333);
  try {
    const tg = fakeTelegram({ status: 'left' });
    assert.equal(scheduleJoinReminder(tg, 333, 20), null);
    await wait(60);
    assert.equal(tg.sent.length, 0);
  } finally {
    config.adminIds.length = 0;
    config.adminIds.push(...original);
  }
});

test('re-scheduling the same user replaces the previous timer (single nudge)', async () => {
  const tg = fakeTelegram({ status: 'left' });
  scheduleJoinReminder(tg, 444, 30);
  scheduleJoinReminder(tg, 444, 30);
  await wait(90);
  assert.equal(tg.sent.length, 1);
  clearJoinReminder(444);
});

test('clearJoinReminder cancels a pending nudge', async () => {
  const tg = fakeTelegram({ status: 'left' });
  scheduleJoinReminder(tg, 555, 20);
  clearJoinReminder(555);
  await wait(60);
  assert.equal(tg.sent.length, 0);
});
