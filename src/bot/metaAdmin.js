const { Markup } = require('telegraf');
const { isAdmin, replyBold } = require('./helpers');
const { getState, setState, clearState } = require('./state');
const { escapeHtml } = require('./emoji');
const { getMetaSettings, saveMetaSettings } = require('../models/MetaSettings');

function createMetaAdmin({ getSettings, saveSettings, isAdmin, reply, getState, setState, clearState }) {
  const authorized = (ctx) => ctx.chat?.type === 'private' && isAdmin(ctx.from?.id);
  async function show(ctx) {
    if (!authorized(ctx)) return reply(ctx, 'Open Meta settings in a private chat with the bot as an admin.');
    clearState(ctx.chat.id);
    const settings = await getSettings();
    const ready = settings.metaPixelId && settings.metaAccessToken;
    return reply(ctx,
      `<b>Meta Conversions API</b>\n\n` +
      `Pixel ID: <b>${escapeHtml(settings.metaPixelId || 'not set')}</b>\n` +
      `Access token: <b>${settings.metaAccessToken ? '•••••••• (configured)' : 'not set'}</b>\n` +
      `Test event code: <b>${escapeHtml(settings.metaTestEventCode || 'off — live events')}</b>\n` +
      `Delivery: <b>${!settings.enabled ? 'paused' : ready ? 'enabled' : 'waiting for credentials'}</b>\n\n` +
      `Only eligible new channel joins send Subscribe. Use the same Pixel ID as the landing page.`,
      Markup.inlineKeyboard([
        [Markup.button.callback('Set Pixel ID', 'meta:pixel'), Markup.button.callback('Set CAPI Token', 'meta:token')],
        [Markup.button.callback('Test Event Code', 'meta:test')],
        [Markup.button.callback(settings.enabled ? 'Pause Delivery' : 'Enable Delivery', settings.enabled ? 'meta:pause' : 'meta:enable')],
      ]),
    );
  }

  async function callback(ctx, data) {
    if (!authorized(ctx)) { await ctx.answerCbQuery('Admin private chat only').catch(() => {}); return true; }
    await ctx.answerCbQuery().catch(() => {});
    if (data === 'meta:pause' || data === 'meta:enable') {
      await saveSettings({ enabled: data === 'meta:enable' }, ctx.from.id);
      await show(ctx);
      return true;
    }
    const fields = { 'meta:pixel': 'pixelId', 'meta:token': 'accessToken', 'meta:test': 'testEventCode' };
    const field = fields[data];
    if (!field) return true;
    setState(ctx.chat.id, { action: 'metaSetting', field });
    const prompts = {
      pixelId: 'Send the numeric Meta Pixel/dataset ID. It must match the landing page Pixel ID.',
      accessToken: 'Send the Meta Conversions API access token. The bot will attempt to delete your token message after receiving it. The saved token is not shown in the panel.',
      testEventCode: 'Send the Test Events code from Meta, or send OFF to use live events.',
    };
    await reply(ctx, `${prompts[field]}\n\nUse /cancel to abort.`);
    return true;
  }

  async function text(ctx, value) {
    const state = getState(ctx.chat?.id);
    if (state?.action !== 'metaSetting') return false;
    if (!authorized(ctx)) return true;
    if (state.field === 'accessToken') await ctx.deleteMessage().catch(() => {});
    const input = value.trim();
    const valid = state.field === 'pixelId' ? /^\d{5,30}$/.test(input)
      : state.field === 'accessToken' ? input.length >= 10 && input.length <= 4096 && !/\s/.test(input)
      : state.field === 'testEventCode' && /^[A-Za-z0-9_-]{1,128}$/.test(input);
    if (!valid) { await reply(ctx, 'Invalid value. Send the requested value again, or /cancel.'); return true; }
    try {
      await saveSettings({ [state.field]: state.field === 'testEventCode' && input.toUpperCase() === 'OFF' ? '' : input }, ctx.from.id);
    } catch {
      // Do not bubble database errors that could include the submitted token.
      await reply(ctx, 'Could not save Meta settings. Please try again.');
      return true;
    }
    clearState(ctx.chat.id);
    await reply(ctx, 'Meta setting saved.');
    await show(ctx);
    return true;
  }
  return { show, callback, text };
}

const admin = createMetaAdmin({ getSettings: getMetaSettings, saveSettings: saveMetaSettings, isAdmin, reply: replyBold, getState, setState, clearState });
module.exports = { createMetaAdmin, showMetaSettings: admin.show, handleMetaCallback: admin.callback, handleMetaText: admin.text };
