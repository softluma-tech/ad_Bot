const config = require('../config');
const { isUserInChannel, sendBold } = require('./helpers');
const { EMOJIS, escapeHtml } = require('./emoji');

const JOIN_REMINDER_MS = 15 * 1000;

const timers = new Map();

function buildReminderText() {
  return (
    `<tg-emoji emoji-id="${EMOJIS.calendar}">🗓</tg-emoji> <b>Public Session Start in 5 Minutes</b>\n\n` +
    `<tg-emoji emoji-id="${EMOJIS.video}">▶️</tg-emoji> <b>Youtube Live — Time Update Soon</b>\n\n` +
    `${config.channelInvite}`
  );
}

function buildJoinedLogText(from = {}) {
  const id = from.id;
  const name =
    [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Unknown';
  const username = from.username
    ? `<b>@${escapeHtml(from.username)}</b>`
    : '—';
  return (
    `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>User joined the channel</b>\n\n` +
    `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> Name: <a href="tg://user?id=${id}"><b>${escapeHtml(name)}</b></a>\n` +
    `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Username: ${username}\n` +
    `<tg-emoji emoji-id="${EMOJIS.info}">ℹ️</tg-emoji> ID: <b>${id}</b>\n` +
    `<tg-emoji emoji-id="${EMOJIS.calendar}">🗓</tg-emoji> Date: <b>${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })}</b>`
  );
}

async function logChannelJoin(telegram, from) {
  try {
    await sendBold(telegram, config.joinLogChannelId, buildJoinedLogText(from));
    return true;
  } catch (err) {
    console.error(
      `[join log] failed to post to ${config.joinLogChannelId}: ${err.message}`,
    );
    return false;
  }
}

async function sendJoinReminder(telegram, from) {
  const userId = typeof from === 'number' ? from : from.id;
  const res = await isUserInChannel(telegram, userId, { quiet: true });
  // unverifiable (rate limit, 403, channel not found…) — stay silent
  if (!res.ok) return false;

  // joined within the reminder window — log the user to the join-log channel
  if (res.isInChannel) return logChannelJoin(telegram, from);

  await sendBold(telegram, userId, buildReminderText());
  return true;
}

function scheduleJoinReminder(telegram, from, delayMs = JOIN_REMINDER_MS) {
  const id = Number(typeof from === 'number' ? from : from.id);
  // never nudge admins
  if (config.adminIds.includes(id)) return null;

  const existing = timers.get(id);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    timers.delete(id);
    sendJoinReminder(telegram, from).catch((err) =>
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
  buildJoinedLogText,
  sendJoinReminder,
  scheduleJoinReminder,
  clearJoinReminder,
};
