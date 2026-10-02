const { Markup } = require("telegraf");
const config = require("../config");
const User = require("../models/User");
const { getContent } = require("../models/Content");
const { isAdmin, sendAd, replyBold, isUserInChannel } = require("./helpers");
const { EMOJIS, escapeHtml } = require("./emoji");
const { START_BUTTONS } = require("./startMessage");
const { setState } = require("./state");
const { createThrottle } = require("./throttle");

const SCAN_CONCURRENCY = 3;
const SCAN_MAX_EDITS = 40;
const SCAN_BACKOFF_CAP_MS = 30 * 1000;

let activeScan = null;

function cancelChannelScan() {
  if (!activeScan) return false;
  activeScan.cancelled = true;
  return true;
}

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
      if (activeScan)
        return replyBold(
          ctx,
          `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>A member check is already running.</b>`,
          panelKeyboard(),
        );

      const tracked = await User.countDocuments({ isBlocked: { $ne: true } });
      if (!tracked) {
        return replyBold(
          ctx,
          `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>No users in the database yet.</b>`,
          panelKeyboard(),
        );
      }

      const runStartedAt = new Date();
      const baseInterval = config.channelCheckIntervalMs;
      const maxMs = Number(config.channelScanMaxMs) || 0;
      const deadline = maxMs > 0 ? Date.now() + maxMs : Infinity;
      const batchSize = Math.max(25, Math.ceil(tracked / SCAN_MAX_EDITS));
      const gate = createThrottle(baseInterval);

      const scan = { cancelled: false, finished: false };
      activeScan = scan;

      const msg = await replyBold(
        ctx,
        `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> <b>Checking channel members…</b>\n\n` +
          `0 / ${tracked} checked\n` +
          `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Channel: <b>@${escapeHtml(config.channelUsername)}</b>\n\n` +
          `Keeps running until every user is checked. Send /cancel to stop.`,
        panelKeyboard(),
      );
      const messageId = msg && msg.message_id;

      let renderChain = Promise.resolve();
      const render = (text, extra) => {
        if (!messageId) return renderChain;
        renderChain = renderChain
          .then(() =>
            ctx.telegram.editMessageText(ctx.chat.id, messageId, undefined, text, {
              ...extra,
              parse_mode: "HTML",
            }),
          )
          .catch(() => {});
        return renderChain;
      };

      let inChannel = 0;
      let notInChannel = 0;
      let unverified = 0;
      let checked = 0;
      let stampable = 0;
      let rateLimited = 0;
      let penalty = 0;
      let lastId = null;
      let fatal = null;
      let timedOut = false;

      const pendingFilter = {
        isBlocked: { $ne: true },
        $or: [
          { channelCheckedAt: null },
          { channelCheckedAt: { $lt: runStartedAt } },
        ],
      };

      const progressText = () =>
        `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> <b>Checking channel members…</b>\n\n` +
        `${checked} / ${tracked} checked\n` +
        `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> In channel: <b>${inChannel}</b>\n` +
        `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> Not in channel: <b>${notInChannel}</b>` +
        (unverified
          ? `\n<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> Could not verify: <b>${unverified}</b>`
          : "");

      const checkUser = async (user) => {
        await gate();
        const res = await isUserInChannel(ctx.telegram, user.userId, { quiet: true });
        checked++;

        if (res.rateLimited) {
          rateLimited++;
          unverified++;
          const backoff = Math.min(SCAN_BACKOFF_CAP_MS, 1000 * 2 ** Math.min(penalty, 5));
          penalty++;
          gate.pause(res.retryAfter * 1000 + backoff);
          gate.setInterval(baseInterval + backoff);
        } else if (res.fatal) {
          unverified++;
          fatal = res;
        } else if (!res.ok) {
          unverified++;
        } else {
          penalty = 0;
          gate.setInterval(baseInterval);
          stampable++;
          if (res.isInChannel) inChannel++;
          else notInChannel++;
          await User.updateOne(
            { userId: user.userId },
            { $set: { inChannel: res.isInChannel, channelCheckedAt: new Date() } },
          ).catch(() => {});
        }
      };

      let passes = 0;

      try {
        for (;;) {
          if (scan.cancelled || fatal) break;
          if (Date.now() >= deadline) {
            timedOut = true;
            break;
          }

          passes++;
          lastId = null;
          const checkedBefore = checked;
          const stampableBefore = stampable;

          for (;;) {
            if (scan.cancelled || fatal) break;
            if (Date.now() >= deadline) {
              timedOut = true;
              break;
            }

            const query = { ...pendingFilter };
            if (lastId) query._id = { $gt: lastId };

            const batch = await User.find(query)
              .sort({ _id: 1 })
              .limit(batchSize)
              .select("userId")
              .lean();
            if (!batch.length) break;
            lastId = batch[batch.length - 1]._id;

            let i = 0;
            const workers = Array.from(
              { length: Math.min(SCAN_CONCURRENCY, batch.length) },
              async () => {
                while (i < batch.length) {
                  if (scan.cancelled || fatal || Date.now() >= deadline) return;
                  await checkUser(batch[i++]);
                }
              },
            );
            await Promise.all(workers);

            await render(
              passes > 1 ? `${progressText()}\n\n<i>pass ${passes}</i>` : progressText(),
            );
          }

          if (checked === checkedBefore) break;
          if (stampable === stampableBefore) break;
        }
      } catch (err) {
        console.error("[channel scan]", err);
      }

      const blocked = await User.countDocuments({ isBlocked: true });
      const remaining = await User.countDocuments(pendingFilter);

      let header;
      if (fatal) header = `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> <b>Member check stopped</b>`;
      else if (scan.cancelled)
        header = `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Member check cancelled</b>`;
      else if (!remaining)
        header = `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> <b>Member check complete — all users checked</b>`;
      else if (timedOut)
        header = `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Member check paused (time limit)</b>`;
      else
        header = `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> <b>Member check stopped (Telegram rate limit)</b>`;

      let txt = `${header}\n\n`;
      txt += `<tg-emoji emoji-id="${EMOJIS.globe}">🌐</tg-emoji> Users tracked: <b>${tracked}</b>\n`;
      txt += `<tg-emoji emoji-id="${EMOJIS.link}">🔗</tg-emoji> Checked this run: <b>${checked}</b>\n`;
      txt += `<tg-emoji emoji-id="${EMOJIS.check}">☑️</tg-emoji> In channel: <b>${inChannel}</b>\n`;
      txt += `<tg-emoji emoji-id="${EMOJIS.cross}">❌</tg-emoji> Not in channel: <b>${notInChannel}</b>\n`;
      if (unverified)
        txt += `<tg-emoji emoji-id="${EMOJIS.warn}">⚠️</tg-emoji> Could not verify: <b>${unverified}</b>\n`;
      txt += `<tg-emoji emoji-id="${EMOJIS.stop}">⛔️</tg-emoji> Blocked (skipped): <b>${blocked}</b>\n`;
      txt += `<tg-emoji emoji-id="${EMOJIS.info}">ℹ️</tg-emoji> Remaining: <b>${remaining}</b>${remaining ? " — tap 👥 Channel Members again to continue" : ""}\n`;
      if (rateLimited)
        txt += `<tg-emoji emoji-id="${EMOJIS.info}">ℹ️</tg-emoji> Rate limited: <b>${rateLimited}</b> request(s), throttled automatically\n`;
      if (fatal)
        txt +=
          `\n<b>Action needed:</b> the bot cannot read members of ` +
          `<b>@${escapeHtml(config.channelUsername)}</b>. Add the bot as an administrator ` +
          `with the <b>Read channel members</b> permission, then try again.`;

      scan.finished = true;
      activeScan = null;
      await render(txt, { reply_markup: panelKeyboard() });
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

module.exports = { sendAdminPanel, handleAdminText, handleAdminCallback, cancelChannelScan, formatReport, buildDayReport, handleDayReport };