const { Telegraf, Markup } = require('telegraf');
const config = require('../config');
const User = require('../models/User');
const { getContent } = require('../models/Content');
const { isAdmin, replyBold, sendAd, notifyAdmins, isUserInChannel } = require('./helpers');
const { EMOJIS, escapeHtml } = require('./emoji');
const { getState, clearState } = require('./state');
const { sendAdminPanel, handleAdminText, handleAdminCallback, handleDayReport, cancelChannelScan } = require('./admin');
const { handleBroadcastCallback, handleBroadcastMessage } = require('./broadcast');

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
    const existing = await User.findOne({ userId: from.id });
    const isNew = !existing;
    const cid = (ctx.startPayload || '').trim() || null;

    await User.updateOne(
      { userId: from.id },
      {
        $set: {
          firstName: from.first_name || '',
          lastName: from.last_name || '',
          username: from.username || null,
          isBlocked: false,
          ...(cid ? { cid } : {}),
        },
        $setOnInsert: { firstSeen: new Date() },
      },
      { upsert: true }
    );

    if (isNew || cid) {
      const total = await User.countDocuments();
      let isInChannel = null;
      try {
        ({ isInChannel } = await isUserInChannel(ctx.telegram, from.id));
      } catch {}
      await notifyAdmins(ctx.telegram, from, total, cid, !isNew, isInChannel);
    }

    const name = from.first_name || 'there';
    await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.smile}">🙂</tg-emoji> <b>Welcome, ${escapeHtml(name)}!</b>`).catch(() => {});
    await sendAd(ctx.telegram, from.id);
    await replyBold(
      ctx,
      `<tg-emoji emoji-id="${EMOJIS.money}">💰</tg-emoji> <b>Tap below to get your free signal</b>`,
      Markup.keyboard([['Get Free Signal 🎯']]).resize(),
    ).catch(() => {});
  } catch (err) {
    console.error('[start handler]', err);
    await replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> <b>Something went wrong. Please try again.</b>`).catch(() => {});
  }
});

bot.command('admin', async (ctx) => {
  if (!isAdmin(ctx.from.id))
    return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.stop}">⛔️</tg-emoji> <b>You are not authorized.</b>`);
  await sendAdminPanel(ctx);
});

bot.command('cancel', async (ctx) => {
  clearState(ctx.chat.id);
  const stopped = cancelChannelScan();
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
  if (data.startsWith('adm:')) return handleAdminCallback(ctx, data);
  if (data.startsWith('bc:')) return handleBroadcastCallback(ctx, data);
  if (data === 'gfs:check') return handleGetFreeSignal(ctx);
  await ctx.answerCbQuery().catch(() => {});
});

async function handleGetFreeSignal(ctx) {
  const {
    isInChannel,
    text: checkText,
  } = await isUserInChannel(ctx.telegram, ctx.from.id);
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

  await replyBold(
    ctx,
    `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>You're a member! Access your free VIP signal:</b>`,
    Markup.inlineKeyboard([
      Markup.button.url('Free VIP Access', 'https://t.me/Bfssfreevipbot'),
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