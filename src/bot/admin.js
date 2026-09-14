const { Markup } = require("telegraf");
const User = require("../models/User");
const { getContent } = require("../models/Content");
const { isAdmin, sendAd, replyBold } = require("./helpers");
const { EMOJIS } = require("./emoji");
const { START_BUTTONS } = require("./startMessage");
const { setState } = require("./state");

const PANEL_ACTIONS = {
  "📊 Stats": "stats",
  "📊 Report": "report",
  "🖇 Change Image": "image",
  "🗣 Broadcast": "broadcast",
  "👁 Preview Ad": "preview",
  "❌ Close": "close",
};

const panelKeyboard = () =>
  Markup.keyboard([
    ["📊 Stats", "📊 Report"],
    ["🖇 Change Image"],
    ["🗣 Broadcast"],
    ["👁 Preview Ad", "❌ Close"],
  ]).resize();

async function adminPanelText() {
  const content = await getContent();
  let txt = `<tg-emoji emoji-id="${EMOJIS.gear}">⚙️</tg-emoji> <b>Admin Panel</b>\n\n`;
  txt += `<tg-emoji emoji-id="${EMOJIS.paperclip}">🖇</tg-emoji> Image: ${content.imageFileId ? "<b>☑️ set</b>" : "<b>❌ not set</b>"}\n\n`;
  txt += `<tg-emoji emoji-id="${EMOJIS.chat}">💬</tg-emoji> Caption: <b>hardcoded</b>\n\n`;
  txt += `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Buttons: <b>${START_BUTTONS.length} (hardcoded)</b>\n\n`;
  txt += "Choose an action:";
  return txt;
}

async function sendAdminPanel(ctx) {
  await replyBold(ctx, await adminPanelText(), panelKeyboard());
}

async function handleAdminText(ctx, text) {
  const action = PANEL_ACTIONS[text];
  if (!action) return false;
  if (!isAdmin(ctx.from.id)) return true;

  switch (action) {
    case "stats": {
      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;
      const [total, newToday, newWeek, active, blocked] = await Promise.all([
        User.countDocuments(),
        User.countDocuments({ firstSeen: { $gte: new Date(now - day) } }),
        User.countDocuments({ firstSeen: { $gte: new Date(now - 7 * day) } }),
        User.countDocuments({ lastSeen: { $gte: new Date(now - day) } }),
        User.countDocuments({ isBlocked: true }),
      ]);
      const content = await getContent();
      const txt =
        `<tg-emoji emoji-id="${EMOJIS.stats}">📊</tg-emoji> <b>Bot Stats</b>\n\n` +
        `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> Total users: <b>${total}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.star}">🌟</tg-emoji> New (24h): <b>${newToday}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.star}">🌟</tg-emoji> New (7d): <b>${newWeek}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.green}">🟢</tg-emoji> Active (24h): <b>${active}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.stop}">⛔️</tg-emoji> Blocked: <b>${blocked}</b>\n\n` +
        `<tg-emoji emoji-id="${EMOJIS.book}">📚</tg-emoji> <b>Content</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.paperclip}">🖇</tg-emoji> Image: ${content.imageFileId ? "<b>☑️</b>" : "<b>❌</b>"}\n` +
        `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Buttons: <b>${START_BUTTONS.length} (hardcoded)</b>`;
      return replyBold(ctx, txt, panelKeyboard());
    }
    case "report": {
      const rows = await User.aggregate([
        { $group: { _id: "$cid", count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
      ]);
      const total = rows.reduce((sum, row) => sum + row.count, 0);
      return replyBold(ctx, formatReport(rows, total), panelKeyboard());
    }
    case "image": {
      setState(ctx.chat.id, { action: "setImage" });
      return replyBold(
        ctx,
        `<tg-emoji emoji-id="${EMOJIS.paperclip}">🖇</tg-emoji> <b>Send the new image (photo).</b>\n\nUse /cancel to abort.`,
        panelKeyboard(),
      );
    }
    case "broadcast": {
      setState(ctx.chat.id, { action: "broadcast" });
      return replyBold(
        ctx,
        `<tg-emoji emoji-id="${EMOJIS.broadcast}">🗣</tg-emoji> <b>Send the media or text to broadcast.</b>\n\n Use /cancel to abort.`,
        panelKeyboard(),
      );
    }
    case "preview":
      return sendAd(ctx.telegram, ctx.from.id);
    case "close":
      return replyBold(ctx, `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> <b>Panel closed.</b>`, {
        reply_markup: { remove_keyboard: true },
      });
  }
  return true;
}

function formatReport(rows, total) {
  let txt = `<tg-emoji emoji-id="${EMOJIS.stats}">📊</tg-emoji> <b>Cid Report</b>\n\n`;
  txt += `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> Total users: <b>${total}</b>\n`;

  const lines = rows.map((row) => {
    if (row._id === null || row._id === undefined || row._id === "")
      return `\n<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Cid: <b>— no cid</b> — <b>${row.count}</b> users`;
    return `\n<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Cid: <b>${row._id}</b> — <b>${row.count}</b> users`;
  });
  txt += lines.join("");
  if (!rows.length) txt += `\nNo users yet.`;
  return txt;
}

async function handleAdminCallback(ctx, data) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Not allowed");
  await ctx.answerCbQuery().catch(() => {});
  if (data === "adm:back") {
    await ctx.deleteMessage().catch(() => {});
    return sendAdminPanel(ctx);
  }
}

module.exports = { sendAdminPanel, handleAdminText, handleAdminCallback, formatReport };