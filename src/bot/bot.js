const { Telegraf, Markup } = require('telegraf');
const config = require('../config');
const User = require('../models/User');
const { getContent, DEFAULT_VIP_URL } = require('../models/Content');
const { isAdmin, isValidHttpUrl, replyBold, sendAd, sendStartVoice, sendStartLink, notifyAdmins, isUserInChannel } = require('./helpers');
const { EMOJIS, escapeHtml } = require('./emoji');
const { getState, clearState } = require('./state');
const { scheduleJoinReminder } = require('./joinReminder');
const { sendAdminPanel, handleAdminText, handleAdminCallback, handleDayReport, cancelBroadcastScan } = require('./admin');
const { handleBroadcastCallback, handleBroadcastMessage } = require('./broadcast');
const tracking = require('../tracking');
const { handleMetaCallback, handleMetaText } = require('./metaAdmin');

const bot = new Telegraf(config.botToken);

bot.catch((err) => console.error('[bot][error]', err));

bot.use(async (ctx, next) => {
  if (ctx.from) {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
    User.updateOne(
      { userId: ctx.from.id, lastSeen: { $lt: fiveMinAgo } },
      { $set: { lastSeen: new Date() } }
    ).catch(() => {});
  }
  return next();
});

bot.start(async (ctx) => {
  try {
    const from = ctx.from;
    const startPayload = (ctx.startPayload || '').trim();
    let cid = startPayload.startsWith('ref_') ? null : startPayload || null;

    const update = {
      $set: {
        firstName: from.first_name || '', lastName: from.last_name || '',
        username: from.username || null, isBlocked: false,
        ...(cid ? { cid } : {}),
      },
      $setOnInsert: {
        firstSeen: new Date(), firstStartPayload: startPayload || null,
        acquisitionEligible: !isAdmin(from.id) && /^ref_[A-Za-z0-9_-]{1,60}$/.test(startPayload),
      },
    };
    let result;
    try {
      result = await User.updateOne({ userId: from.id }, update, { upsert: true });
    } catch (err) {
      if (err.code !== 11000) throw err;
      // Another simultaneous /start created this Telegram user first.
      result = await User.updateOne({ userId: from.id }, { $set: update.$set });
    }
    const isNew = result.upsertedCount === 1;
    if (startPayload.startsWith('ref_')) {
      try {
        cid = await tracking.bindAttribution(from.id, startPayload);
        if (cid) await User.updateOne({ userId: from.id }, { $set: { cid } });
      } catch (err) { console.error('[tracking] attribution binding failed:', err.name); }
    }

    const membership = await isUserInChannel(ctx.telegram, from.id, { quiet: true });
    await tracking.safelyObserve(from.id, membership);
    await User.updateOne({ userId: from.id }, { $set: { trackingInitialized: true } });
    // Reconcile a transition that arrived while /start was binding attribution.
    await tracking.safelyObserve(from.id, membership);

    if (isNew || cid) {
      const total = await User.countDocuments();
      const isInChannel = membership.ok ? membership.isInChannel : null;
      await notifyAdmins(ctx.telegram, from, total, cid, !isNew, isInChannel);
    }

    const name = from.first_name || 'there';
    await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> <b>Welcome, ${escapeHtml(name)}!</b>`).catch(() => {});
    await sendAd(ctx.telegram, from.id);
    await sendStartVoice(ctx.telegram, from.id);
    await sendStartLink(ctx.telegram, from.id);
    await replyBold(
      ctx,
      `<tg-emoji emoji-id="${EMOJIS.money}">💰</tg-emoji> <b>Tap below to get your free signal</b>`,
      Markup.keyboard([['Get Free Signal 🎯']]).resize(),
    ).catch(() => {});

    // nudge non-members 15s later (skips admins, re-checks membership at fire time)
    scheduleJoinReminder(ctx.telegram, from, undefined, tracking.safelyObserve);
  } catch (err) {
    console.error('[start handler]', err);
    await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> <b>Something went wrong. Please try again.</b>`).catch(() => {});
  }
});

bot.on('chat_member', async (ctx) => {
  try { await tracking.handleChatMember(ctx.update.chat_member); }
  catch (err) { console.error('[tracking] channel update failed:', err.name); }
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id))
    return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.stop}">⛔️</tg-emoji> <b>You are not authorized.</b>`);
  await sendAdminPanel(ctx);
});

bot.command('cancel', async (ctx) => {
  clearState(ctx.chat.id);
  const stopped = cancelBroadcastScan();
  await replyBold(
    ctx,
    `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>${stopped ? 'Member check stopping…' : 'Operation cancelled.'}</b>`,
  );
});

bot.command('help', async (ctx) => {
  await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> <b>Send /start to view the content.</b>`);
});

bot.on('callback_query', async (ctx) => {
  const data = ctx.callbackQuery.data || '';
  if (data.startsWith('meta:')) return handleMetaCallback(ctx, data);
  if (data.startsWith('adm:')) return handleAdminCallback(ctx, data);
  if (data.startsWith('bc:')) return handleBroadcastCallback(ctx, data);
  if (data === 'gfs:check') return handleGetFreeSignal(ctx);
  await ctx.answerCbQuery().catch(() => {});
});

async function handleGetFreeSignal(ctx) {
  const membership = await isUserInChannel(ctx.telegram, ctx.from.id);
  await tracking.safelyObserve(ctx.from.id, membership);
  const {
    isInChannel,
    text: checkText,
  } = membership;
  if (!isInChannel) {
    await replyBold(
      ctx,
      `${checkText}\n\n<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> <b>Join the channel first to unlock free signal!</b>`,
      Markup.inlineKeyboard([
        Markup.button.url('Join Channel', config.channelInvite),
        Markup.button.callback('Try Again 🔄', 'gfs:check'),
      ]),
    ).catch(() => {});
    return;
  }

  const content = await getContent();
  const vipUrl = content.vipUrl || DEFAULT_VIP_URL;

  await replyBold(
    ctx,
    `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>You're a member! Access your free VIP signal:</b>`,
    Markup.inlineKeyboard([
      Markup.button.url('Free VIP Access', vipUrl),
    ]),
  ).catch(() => {});
}

bot.on('message', async (ctx) => {
  const m = ctx.message;

  if (m.text && m.text.trim() === 'Get Free Signal 🎯') {
    return handleGetFreeSignal(ctx);
  }

  if (!isAdmin(ctx.from.id)) return;
  const state = getState(ctx.chat.id);

  if (m.text) {
    if (await handleMetaText(ctx, m.text)) return;
    const handled = await handleAdminText(ctx, m.text);
    if (handled) return;
  }

  if (!state) return;
  try {
    switch (state.action) {
      case 'setImage': {
        if (!m.photo)
          return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Please send a photo.</b>\n\nUse /cancel to abort.`);
        const content = await getContent();
        content.imageFileId = m.photo[m.photo.length - 1].file_id;
        await content.save();
        clearState(ctx.chat.id);
        await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>Image updated!</b>`);
        return sendAdminPanel(ctx);
      }
      case 'setVoice': {
        if (!m.voice)
          return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Please send a voice message.</b>\n\nUse /cancel to abort.`);
        const content = await getContent();
        content.voiceFileId = m.voice.file_id;
        await content.save();
        clearState(ctx.chat.id);
        await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>Voice updated!</b>`);
        return sendAdminPanel(ctx);
      }
      case 'setVipUrl': {
        if (!isValidHttpUrl(m.text))
          return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Please send a valid http(s) link.</b>\n\nUse /cancel to abort.`);
        const content = await getContent();
        content.vipUrl = m.text.trim();
        await content.save();
        clearState(ctx.chat.id);
        await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>VIP link updated!</b>`);
        return sendAdminPanel(ctx);
      }
      case 'broadcast':
        return handleBroadcastMessage(ctx, m, (state.target) || 'all');
      case 'dayreport': {
        const days = Number(m.text.trim());
        if (!Number.isInteger(days) || days < 1) {
          return replyBold(
            ctx,
            `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Please send a valid number of days.</b>\n\nUse /cancel to abort.`,
          );
        }
        clearState(ctx.chat.id);
        return handleDayReport(ctx, days);
      }
      default:
        return;
    }
  } catch (err) {
    console.error('[message handler]', err);
    await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> <b>Something went wrong. Please try again.</b>`).catch(() => {});
  }
});

module.exports = bot;
