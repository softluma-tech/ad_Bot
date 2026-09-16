const config = require('../config');
const { getContent } = require('../models/Content');
const { EMOJIS, escapeHtml, stripHtml } = require('./emoji');
const { START_CAPTION, START_BUTTONS } = require('./startMessage');

const isAdmin = (userId) => config.adminIds.includes(Number(userId));

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendBold(telegram, chatId, text, extra = {}) {
  try {
    return await telegram.sendMessage(chatId, text, { ...extra, parse_mode: 'HTML' });
  } catch (err) {
    if (err && err.response && err.response.error_code === 400) {
      return telegram.sendMessage(chatId, stripHtml(text), extra);
    }
    throw err;
  }
}

function replyBold(ctx, text, extra = {}) {
  return sendBold(ctx.telegram, ctx.chat.id, text, extra);
}

async function editBold(telegram, chatId, messageId, text, extra = {}) {
  try {
    return await telegram.editMessageText(chatId, messageId, undefined, text, { ...extra, parse_mode: 'HTML' });
  } catch (err) {
    if (err && err.response && err.response.error_code === 400) {
      return telegram.editMessageText(chatId, messageId, undefined, stripHtml(text), extra);
    }
    throw err;
  }
}

function editBoldCtx(ctx, text, extra = {}) {
  return editBold(ctx.telegram, ctx.chat.id, ctx.callbackQuery.message.message_id, text, extra);
}

const BUTTON_STYLES = { primary: 'primary', blue: 'primary', success: 'success', green: 'success', danger: 'danger', red: 'danger' };

async function sendAd(telegram, chatId) {
  const content = await getContent();
  const keyboard = START_BUTTONS.map((b) => [
    { text: b.text, url: b.url, style: BUTTON_STYLES[b.colour] || 'primary' },
  ]);
  const reply_markup = keyboard.length ? { inline_keyboard: keyboard } : undefined;

  if (content.imageFileId) {
    const opts = { caption: START_CAPTION.trim(), reply_markup };
    try {
      await telegram.sendPhoto(chatId, content.imageFileId, { ...opts, parse_mode: 'HTML' });
    } catch (err) {
      if (err && err.response && err.response.error_code === 400) {
        await telegram.sendPhoto(chatId, content.imageFileId, { ...opts, caption: stripHtml(START_CAPTION) });
      } else {
        throw err;
      }
    }
  } else {
    await sendBold(telegram, chatId, START_CAPTION, { reply_markup });
  }
}

async function isUserInChannel(telegram, userId) {
  try {
    const member = await telegram.getChatMember(
      `@${config.channelUsername}`,
      userId,
    );
    const status = member && member.status;
    const allowed = ['creator', 'administrator', 'member'];
    if (allowed.includes(status)) {
      return {
        isInChannel: true,
        ok: true,
        text: `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>Verified!</b>`,
      };
    }
    return {
      isInChannel: false,
      ok: true,
      text: `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>You haven't joined the channel yet.</b>`,
    };
  } catch (err) {
    if (
      err &&
      err.response &&
      err.response.error_code === 400 &&
      /chat not found|user not found|not a participant/i.test(err.response.description || '')
    ) {
      return {
        isInChannel: false,
        ok: true,
        text: `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>You haven't joined the channel yet.</b>`,
      };
    }
    console.error('[getChatMember]', err.response || err);
    return {
      isInChannel: false,
      ok: false,
      text: `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Verification is temporarily unavailable. Please try again in a moment.</b>`,
    };
  }
}

async function notifyAdmins(telegram, from, total, cid, isReturning = false, isInChannel = null) {
  const name = [from.first_name, from.last_name].filter(Boolean).join(' ') || 'Unknown';
  let text =
    (isReturning
      ? `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> <b>Old user returned!</b>`
      : `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> <b>New user joined!</b>`) +
    `\n\n` +
    `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> Name: <a href="tg://user?id=${from.id}"><b>${escapeHtml(name)}</b></a>\n` +
    `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Username: ${from.username ? '<b>@' + escapeHtml(from.username) + '</b>' : '—'}\n` +
    `<tg-emoji emoji-id="${EMOJIS.info}">ℹ️</tg-emoji> ID: <b>${from.id}</b>\n`;
  if (cid) text += `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Cid: <b>${escapeHtml(cid)}</b>\n`;
  if (isInChannel === true)
    text += `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> In Channel: <b>Yes</b>\n`;
  else if (isInChannel === false)
    text += `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> In Channel: <b>No</b>\n`;
  text += `<tg-emoji emoji-id="${EMOJIS.calendar}">🗓</tg-emoji> Date: <b>${new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' })}</b>\n\n` +
    `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> <b>Total users: ${total}</b>`;
  for (const adminId of config.adminIds) {
    try {
      await sendBold(telegram, adminId, text);
    } catch (err) {
      console.error(`[notify] failed to notify admin ${adminId}: ${err.message}`);
    }
  }
}

module.exports = { isAdmin, delay, sendBold, replyBold, editBold, editBoldCtx, sendAd, notifyAdmins, isUserInChannel };