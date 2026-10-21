const { Markup } = require('telegraf');
const config = require('../config');
const User = require('../models/User');
const { acquireBroadcastLock, releaseBroadcastLock, isBroadcasting } = require('../models/BroadcastLock');
const { setPending, getPending, clearPending } = require('../models/Pending');
const { delay, sendBold, replyBold, editBold, isAdmin } = require('./helpers');
const { panelKeyboard } = require('./admin');
const { EMOJIS, escapeHtml, truncate, stripHtml } = require('./emoji');
const { createThrottle } = require('./throttle');
const { clearState } = require('./state');

const CONCURRENCY = 5;
const PACE_MS = 35;
const MAX_ATTEMPTS = 3;

const MEDIA_LABELS = {
  photo: `<tg-emoji emoji-id="${EMOJIS.paperclip}">🖇</tg-emoji> Photo`,
  video: `<tg-emoji emoji-id="${EMOJIS.video}">▶️</tg-emoji> Video`,
  animation: `<tg-emoji emoji-id="${EMOJIS.gif}">🔄</tg-emoji> GIF`,
  audio: `<tg-emoji emoji-id="${EMOJIS.audio}">🎵</tg-emoji> Audio`,
  document: `<tg-emoji emoji-id="${EMOJIS.book}">📚</tg-emoji> Document`,
  voice: `<tg-emoji emoji-id="${EMOJIS.broadcast}">🗣</tg-emoji> Voice`,
  video_note: `<tg-emoji emoji-id="${EMOJIS.video}">▶️</tg-emoji> Video note`,
  sticker: `<tg-emoji emoji-id="${EMOJIS.sparkle}">✨</tg-emoji> Sticker`,
  text: `<tg-emoji emoji-id="${EMOJIS.chat}">💬</tg-emoji> Text`,
};

function buildTargetQuery(target = 'all') {
  const base = { userId: { $nin: config.adminIds }, isBlocked: { $ne: true } };
  if (target === 'nonChannel') return { ...base, inChannel: false };
  return base;
}

function targetLabel(target) {
  return target === 'nonChannel'
    ? `<tg-emoji emoji-id="${EMOJIS.stop}">⛔️</tg-emoji> Users NOT in the channel <b>only</b>`
    : `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> All users`;
}

function extractPayload(m) {
  const cap = (c) => truncate(c, 1024);
  if (m.photo) return { type: 'photo', fileId: m.photo[m.photo.length - 1].file_id, caption: cap(m.caption || '') };
  if (m.video) return { type: 'video', fileId: m.video.file_id, caption: cap(m.caption || '') };
  if (m.animation) return { type: 'animation', fileId: m.animation.file_id, caption: cap(m.caption || '') };
  if (m.audio) return { type: 'audio', fileId: m.audio.file_id, caption: cap(m.caption || '') };
  if (m.document) return { type: 'document', fileId: m.document.file_id, caption: cap(m.caption || '') };
  if (m.voice) return { type: 'voice', fileId: m.voice.file_id, caption: cap(m.caption || '') };
  if (m.video_note) return { type: 'video_note', fileId: m.video_note.file_id };
  if (m.sticker) return { type: 'sticker', fileId: m.sticker.file_id };
  if (m.text) return { type: 'text', text: m.text };
  return null;
}

async function sendPayload(telegram, chatId, payload) {
  const captionExtra = payload.caption ? { caption: payload.caption, parse_mode: 'HTML' } : {};
  const send = (extra) => {
    switch (payload.type) {
      case 'photo':
        return telegram.sendPhoto(chatId, payload.fileId, extra);
      case 'video':
        return telegram.sendVideo(chatId, payload.fileId, extra);
      case 'animation':
        return telegram.sendAnimation(chatId, payload.fileId, extra);
      case 'audio':
        return telegram.sendAudio(chatId, payload.fileId, extra);
      case 'document':
        return telegram.sendDocument(chatId, payload.fileId, extra);
      case 'voice':
        return telegram.sendVoice(chatId, payload.fileId, extra);
      case 'video_note':
        return telegram.sendVideoNote(chatId, payload.fileId);
      case 'sticker':
        return telegram.sendSticker(chatId, payload.fileId);
      default:
        return sendBold(telegram, chatId, payload.text || '');
    }
  };
  try {
    return await send(captionExtra);
  } catch (err) {
    const description = err && err.response ? err.response.description || '' : '';
    if (payload.caption && /parse|entit|escap/i.test(description)) {
      return send({ caption: stripHtml(payload.caption) });
    }
    throw err;
  }
}

async function handleBroadcastMessage(ctx, m, target = 'all') {
  if (await isBroadcasting()) return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>A broadcast is already running. Please wait.</b>`);
  const payload = extractPayload(m);
  if (!payload) return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Unsupported media type.</b>\n\nUse /cancel to abort.`);

  const total = await User.countDocuments(buildTargetQuery(target));

  if (!total) {
    return replyBold(
      ctx,
      `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>No users match this target.</b>\n\n` +
        (target === 'nonChannel'
          ? `No verified non-members found. Use 👥 Channel Members first and wait for the check to finish, then try again.`
          : `No recipients available.`) +
        `\n\nUse /cancel to abort.`,
      panelKeyboard(),
    );
  }

  await setPending(ctx.chat.id, 'broadcastConfirm', { payload, target });

  const label = MEDIA_LABELS[payload.type] || payload.type;
  const summary = payload.caption || payload.text || '';
  let txt = `<tg-emoji emoji-id="${EMOJIS.broadcast}">🗣</tg-emoji> <b>Broadcast preview</b>\n\n`;
  txt += `<b>Type:</b> ${label}\n`;
  if (summary) txt += `<tg-emoji emoji-id="${EMOJIS.chat}">💬</tg-emoji> ${escapeHtml(truncate(summary, 100))}\n`;
  txt += `<b>Target:</b> ${targetLabel(target)}\n`;
  txt += `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> Will receive: <b>${total}</b> users\n\n`;
  txt += 'Confirm?';

  return replyBold(ctx, txt, Markup.inlineKeyboard([
    [Markup.button.callback('☑️ Send to all', 'bc:confirm')],
    [Markup.button.callback('❌ Cancel', 'bc:cancel')],
  ]));
}

async function handleBroadcastCallback(ctx, data) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery('⛔ Not allowed');
  await ctx.answerCbQuery().catch(() => {});

  const chatId = ctx.chat.id;
  if (data === 'bc:cancel') {
    await clearPending(chatId);
    clearState(chatId);
    return editBold(ctx.telegram, chatId, ctx.callbackQuery.message.message_id, `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> <b>Broadcast cancelled.</b>`, {
      reply_markup: { inline_keyboard: [] },
    });
  }
  if (data !== 'bc:confirm') return;

  if (await isBroadcasting()) return ctx.answerCbQuery('⚠️ Already running', { show_alert: true });

  const state = await getPending(chatId);
  if (!state || state.action !== 'broadcastConfirm') return ctx.answerCbQuery('⚠️ Nothing queued');

  const acquired = await acquireBroadcastLock();
  if (!acquired) return ctx.answerCbQuery('⚠️ Broadcast already in progress', { show_alert: true });

  await clearPending(chatId);
  clearState(chatId);
  const { payload, target = 'all' } = state.payload || {};
  if (!payload) return ctx.answerCbQuery('⚠️ Nothing queued');
  const messageId = ctx.callbackQuery.message.message_id;

  try {
    const users = await User.find(buildTargetQuery(target));
    const total = users.length;
    let sent = 0;
    let blocked = 0;
    let failed = 0;
    let idx = 0;
    let done = 0;

    const gate = createThrottle(PACE_MS);

    const progress = async (text, extra = {}) => {
      try {
        await editBold(ctx.telegram, chatId, messageId, text, extra);
      } catch {}
    };

    const sendToUser = async (user) => {
      let ok = false;
      let isUserBlocked = false;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        await gate();
        try {
          await sendPayload(ctx.telegram, user.userId, payload);
          ok = true;
          break;
        } catch (err) {
          const resp = err && err.response ? err.response : {};
          if (resp.error_code === 403) {
            isUserBlocked = true;
            break;
          }
          if (resp.error_code === 429) {
            const retryAfter = resp.parameters && resp.parameters.retry_after;
            await delay(Math.max(1000, (retryAfter || 1) * 1000));
            continue;
          }
          break;
        }
      }
      if (ok) sent++;
      else if (isUserBlocked) {
        blocked++;
        await User.updateOne({ userId: user.userId }, { $set: { isBlocked: true } }).catch(() => {});
      } else failed++;
      done++;
      if (done % 25 === 0 || done === total) {
        await progress(`<tg-emoji emoji-id="${EMOJIS.broadcast}">🗣</tg-emoji> <b>Broadcasting…</b>\n\n${done} / ${total}`);
      }
    };

    await progress(`<tg-emoji emoji-id="${EMOJIS.broadcast}">🗣</tg-emoji> <b>Broadcasting…</b>\n\n0 / ${total}`);

    const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
      while (idx < users.length) {
        const i = idx++;
        await sendToUser(users[i]);
      }
    });
    await Promise.all(workers);

    await progress(
      `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>Broadcast finished!</b>\n\n` +
        `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> Total: <b>${total}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> Sent: <b>${sent}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.stop}">⛔️</tg-emoji> Blocked: <b>${blocked}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> Failed: <b>${failed}</b>`,
      { reply_markup: { inline_keyboard: [] } }
    );
  } finally {
    await releaseBroadcastLock();
  }
}

module.exports = { handleBroadcastMessage, handleBroadcastCallback, extractPayload, sendPayload, buildTargetQuery, targetLabel, MEDIA_LABELS };