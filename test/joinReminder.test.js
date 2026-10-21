const test = require('node:test');
const assert = require('node:assert/strict');

const config = require('../src/config');
const {
  JOIN_REMINDER_MS,
  buildReminderText,
  buildJoinedLogText,
  sendJoinReminder,
  scheduleJoinReminder,
  clearJoinReminder,
} = require('../src/bot/joinReminder');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const FROM = { id: 111, first_name: 'John', last_name: 'Doe', username: 'johndoe' };

function fakeTelegram({ status = 'left', throwErr = null, failChatId = null } = {}) {
  const sent = [];
  return {
    sent,
    getChatMember: async () => {
      if (throwErr) throw throwErr;
      return { status };
    },
    sendMessage: async (chatId, text, extra) => {
      if (failChatId !== null && chatId === failChatId) {
        const err = new Error('chat not found');
        err.response = { error_code: 400, description: 'Bad Request: chat not found' };
        throw err;
      }
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

test('buildJoinedLogText includes name, username, id and a linked name', () => {
  const txt = buildJoinedLogText(FROM);
  assert.ok(txt.includes('User joined the channel'));
  assert.ok(txt.includes('tg://user?id=111'));
  assert.ok(txt.includes('<b>John Doe</b>'));
  assert.ok(txt.includes('@johndoe'));
  assert.ok(txt.includes('ID: <b>111</b>'));
  assert.ok(txt.includes('Date: <b>'));
});

test('buildJoinedLogText escapes the name and handles a missing username', () => {
  const txt = buildJoinedLogText({ id: 7, first_name: '<b>hax</b>', username: undefined });
  assert.ok(txt.includes('&lt;b&gt;hax&lt;/b&gt;'));
  assert.ok(txt.includes('Username: —'));
});

test('sendJoinReminder nudges a non-member and posts nothing to the log channel', async () => {
  const tg = fakeTelegram({ status: 'left' });
  const sent = await sendJoinReminder(tg, FROM);
  assert.equal(sent, true);
  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, FROM.id);
  assert.equal(tg.sent[0].extra.parse_mode, 'HTML');
  assert.ok(tg.sent[0].text.includes('Public Session Start in 5 Minutes'));
  assert.ok(tg.sent[0].text.includes(config.channelInvite));
});

test('sendJoinReminder posts user details to the join-log channel for members', async () => {
  for (const status of ['member', 'administrator', 'creator']) {
    const tg = fakeTelegram({ status });
    const sent = await sendJoinReminder(tg, FROM);
    assert.equal(sent, true);
    assert.equal(tg.sent.length, 1);
    assert.equal(tg.sent[0].chatId, -1003902452318);
    assert.ok(tg.sent[0].text.includes('User joined the channel'));
    assert.ok(tg.sent[0].text.includes('@johndoe'));
    assert.ok(tg.sent[0].text.includes('ID: <b>111</b>'));
    // the user gets no direct message in the joined branch
    assert.ok(!tg.sent.some((m) => m.chatId === FROM.id));
  }
});

test('sendJoinReminder stays silent when the check fails', async () => {
  const rateLimited = new Error('429');
  rateLimited.response = { error_code: 429, parameters: { retry_after: 5 } };
  const forbidden = new Error('403');
  forbidden.response = { error_code: 403 };

  for (const err of [rateLimited, forbidden]) {
    const tg = fakeTelegram({ throwErr: err });
    assert.equal(await sendJoinReminder(tg, FROM), false);
    assert.equal(tg.sent.length, 0);
  }
});

test('sendJoinReminder swallows log-channel post failures', async () => {
  const tg = fakeTelegram({ status: 'member', failChatId: -1003902452318 });
  assert.equal(await sendJoinReminder(tg, FROM), false);
  assert.equal(tg.sent.length, 0);
});

test('scheduleJoinReminder fires after the delay and nudges a non-member', async () => {
  const tg = fakeTelegram({ status: 'left' });
  scheduleJoinReminder(tg, FROM, 20);
  assert.equal(tg.sent.length, 0);
  await wait(60);
  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, FROM.id);
  clearJoinReminder(FROM.id);
});

test('scheduleJoinReminder logs a member to the channel after the delay', async () => {
  const tg = fakeTelegram({ status: 'member' });
  scheduleJoinReminder(tg, FROM, 20);
  await wait(60);
  assert.equal(tg.sent.length, 1);
  assert.equal(tg.sent[0].chatId, -1003902452318);
  clearJoinReminder(FROM.id);
});

test('scheduleJoinReminder never nudges admins', async () => {
  const original = config.adminIds.slice();
  config.adminIds.push(333);
  try {
    const tg = fakeTelegram({ status: 'left' });
    assert.equal(scheduleJoinReminder(tg, { ...FROM, id: 333 }, 20), null);
    await wait(60);
    assert.equal(tg.sent.length, 0);
  } finally {
    config.adminIds.length = 0;
    config.adminIds.push(...original);
  }
});

test('re-scheduling the same user replaces the previous timer (single send)', async () => {
  const tg = fakeTelegram({ status: 'left' });
  scheduleJoinReminder(tg, FROM, 30);
  scheduleJoinReminder(tg, FROM, 30);
  await wait(90);
  assert.equal(tg.sent.length, 1);
  clearJoinReminder(FROM.id);
});

test('clearJoinReminder cancels a pending nudge', async () => {
  const tg = fakeTelegram({ status: 'left' });
  scheduleJoinReminder(tg, FROM, 20);
  clearJoinReminder(FROM.id);
  await wait(60);
  assert.equal(tg.sent.length, 0);
});
