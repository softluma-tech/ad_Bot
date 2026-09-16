const { Markup } = require("telegraf");
const User = require("../models/User");
const { getContent } = require("../models/Content");
const { isAdmin, sendAd, replyBold, isUserInChannel } = require("./helpers");
const { EMOJIS } = require("./emoji");
const { START_BUTTONS } = require("./startMessage");
const { setState } = require("./state");
const { createThrottle } = require("./throttle");

const PANEL_ACTIONS = {
  "📊 Stats": "stats",
  "📊 Report": "report",
  "📅 Day Report": "dayreport",
  "🖇 Change Image": "image",
  "👥 Channel Members": "channel",
  "🗣 Broadcast": "broadcast",
  "👁 Preview Ad": "preview",
  "❌ Close": "close",
};

const panelKeyboard = () =>
  Markup.keyboard([
    ["📊 Stats", "📊 Report"],
    ["📅 Day Report"],
    ["🖇 Change Image", "👥 Channel Members"],
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
    case "channel": {
      const gate = createThrottle(20);
      const CONCURRENCY = 5;

      const users = await User.find({ isBlocked: { $ne: true } })
        .select("userId")
        .lean();
      const total = users.length;
      if (!total) {
        return replyBold(
          ctx,
          `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>No users in the database yet.</b>`,
          panelKeyboard(),
        );
      }

      let inChannel = 0;
      let notInChannel = 0;
      let unverified = 0;
      let idx = 0;
      let done = 0;

      const msg = await replyBold(
        ctx,
        `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> <b>Checking channel members…</b>\n\n0 / ${total} checked`,
      );
      const messageId = msg.message_id;

      const progress = async (text) => {
        try {
          await ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, {
            parse_mode: "HTML",
          });
        } catch {}
      };

      const checkUser = async (user) => {
        await gate();
        try {
          const { isInChannel, ok } = await isUserInChannel(ctx.telegram, user.userId);
          if (ok) {
            if (isInChannel) inChannel++;
            else notInChannel++;
          } else {
            unverified++;
          }
        } catch {
          unverified++;
        }
        done++;
        if (done % 25 === 0 || done === total) {
          await progress(
            `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> <b>Checking channel members…</b>\n\n${done} / ${total} checked`,
          );
        }
      };

      const workers = Array.from({ length: Math.min(CONCURRENCY, total) }, async () => {
        while (idx < users.length) {
          const i = idx++;
          await checkUser(users[i]);
        }
      });
      await Promise.all(workers);

      const blocked = await User.countDocuments({ isBlocked: true });

      await progress(
        `<tg-emoji emoji-id="${EMOJIS.stats}">📊</tg-emoji> <b>Channel Member Report</b>\n\n` +
          `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> Users checked: <b>${done}</b>\n` +
          `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> In channel: <b>${inChannel}</b>\n` +
          `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> Not in channel: <b>${notInChannel}</b>\n` +
          (unverified
            ? `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> Could not verify: <b>${unverified}</b>\n`
            : "") +
          `<tg-emoji emoji-id="${EMOJIS.info}">ℹ️</tg-emoji> Blocked (skipped): <b>${blocked}</b>`,
      );
      return;
    }
    case "broadcast": {
      setState(ctx.chat.id, { action: "broadcast" });
      return replyBold(
        ctx,
        `<tg-emoji emoji-id="${EMOJIS.broadcast}">🗣</tg-emoji> <b>Send the media or text to broadcast.</b>\n\n Use /cancel to abort.`,
        panelKeyboard(),
      );
    }
    case "dayreport": {
      setState(ctx.chat.id, { action: "dayreport" });
      return replyBold(
        ctx,
        `<tg-emoji emoji-id="${EMOJIS.calendar}">🗓</tg-emoji> <b>Day-wise report</b>\n\nSend the number of days (up to 90). Example: <b>5</b> → last 5 days including today.\n\nUse /cancel to abort.`,
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

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MAX_DAYS = 90;

function istDayStart(daysAgo) {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  istNow.setUTCHours(0, 0, 0, 0);
  istNow.setUTCDate(istNow.getUTCDate() - daysAgo);
  return new Date(istNow.getTime() - IST_OFFSET_MS);
}

function buildDayReport(days, rows) {
  let txt =
    `<tg-emoji emoji-id="${EMOJIS.stats}">📊</tg-emoji> <b>Day-wise Report (last ${days} days)</b>`;
  for (const r of rows) {
    txt +=
      `\n\n<tg-emoji emoji-id="${EMOJIS.calendar}">🗓</tg-emoji> ` +
      (r.isToday ? `<b>${r.label} (Today)</b>` : r.label) +
      `\n<tg-emoji emoji-id="${EMOJIS.star}">🌟</tg-emoji> New users: <b>${r.newCount}</b>\n` +
      `<tg-emoji emoji-id="${EMOJIS.green}">🟢</tg-emoji> Active users: <b>${r.activeCount}</b>`;
  }
  return txt;
}

async function handleDayReport(ctx, days) {
  const n = Math.min(MAX_DAYS, Math.max(1, Math.floor(days)));
  const rows = [];
  for (let d = n - 1; d >= 0; d--) {
    const start = istDayStart(d);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [newCount, activeCount] = await Promise.all([
      User.countDocuments({ firstSeen: { $gte: start, $lt: end } }),
      User.countDocuments({ lastSeen: { $gte: start, $lt: end } }),
    ]);
    rows.push({
      label: start.toLocaleDateString("en-GB", {
        timeZone: "Asia/Kolkata",
        weekday: "short",
        day: "2-digit",
        month: "short",
        year: "numeric",
      }),
      newCount,
      activeCount,
      isToday: d === 0,
    });
  }
  return replyBold(ctx, buildDayReport(n, rows), panelKeyboard());
}

async function handleAdminCallback(ctx, data) {
  if (!isAdmin(ctx.from.id)) return ctx.answerCbQuery("⛔ Not allowed");
  await ctx.answerCbQuery().catch(() => {});
  if (data === "adm:back") {
    await ctx.deleteMessage().catch(() => {});
    return sendAdminPanel(ctx);
  }
}

module.exports = { sendAdminPanel, handleAdminText, handleAdminCallback, formatReport, buildDayReport, handleDayReport };