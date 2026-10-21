const config = require('../config');
const { isUserInChannel, sendBold } = require('./helpers');
const { EMOJIS } = require('./emoji');

const JOIN_REMINDER_MS = 15 * 1000;

const timers = new Map();

function buildReminderText() {
  return (
    `<tg-emoji emoji-id="${EMOJIS.calendar}">🗓</tg-emoji> <b>Public Session Start in 5 Minutes</b>\n\n` +
    `<tg-emoji emoji-id="${EMOJIS.video}">▶️</tg-emoji> <b>Youtube Live — Time Update Soon</b>\n\n` +
    `${config.channelInvite}`
  );
}

async function sendJoinReminder(telegram, userId) {
  const res = await isUserInChannel(telegram, userId, { quiet: true });
  // only nudge when we positively verified the user is NOT a member
  if (!res.ok || res.isInChannel) return false;
  await sendBold(telegram, userId, buildReminderText());
  return true;
}

function scheduleJoinReminder(telegram, userId, delayMs = JOIN_REMINDER_MS) {
  const id = Number(userId);
  // never nudge admins
  if (config.adminIds.includes(id)) return null;

  const existing = timers.get(id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    timers.delete(id);
    sendJoinReminder(telegram, id).catch((err) =>
      console.error('[join reminder]', err),
    );
  }, delayMs);
  timers.set(id, timer);
  return timer;
}

function clearJoinReminder(userId) {
  const id = Number(userId);
  const existing = timers.get(id);
  if (existing) clearTimeout(existing);
  timers.delete(id);
}

module.exports = {
  JOIN_REMINDER_MS,
  buildReminderText,
  sendJoinReminder,
  scheduleJoinReminder,
  clearJoinReminder,
};
